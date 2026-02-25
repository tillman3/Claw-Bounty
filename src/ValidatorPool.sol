// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./vendor/chainlink/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import "./vendor/chainlink/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title ValidatorPool
/// @notice Manages validator registration, staking, VRF-based panel selection, commit-reveal scoring, and slashing
/// @dev Uses Chainlink VRF V2.5 for secure random panel selection (async: request → callback)
contract ValidatorPool is Ownable2Step, Pausable, ReentrancyGuard {
    // --- Structs ---
    struct Validator {
        address addr;
        uint256 stakeAmount;
        uint256 reputationScore; // 0-10000 bps
        uint64 registeredAt;
        bool active;
        uint256 pendingUnstake;
        uint64 unstakeRequestTime;
    }

    struct ReviewRound {
        uint256 taskId;
        bool initialized;
        address[] validators;
        mapping(address => bytes32) commitments; // hash(taskId, score, salt)
        mapping(address => uint8) revealedScores;
        mapping(address => bool) hasCommitted;
        mapping(address => bool) hasRevealed;
        uint8 revealCount;
        uint8 requiredReveals; // e.g., 3 out of 5
        uint64 commitDeadline;
        uint64 revealDeadline;
        bool finalized;
        bool accepted;
        uint8 medianScore;
    }

    /// @notice Pending VRF request data
    struct PendingPanelRequest {
        uint256 taskId;
        uint64 commitDuration;
        uint64 revealDuration;
        uint64 requestedAt;
        bool pending;
    }

    // --- Constants ---
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint64 public constant UNSTAKE_COOLDOWN = 7 days;
    uint256 public constant MAX_REPUTATION = 10_000;
    uint256 public constant INITIAL_REPUTATION = 5_000;
    uint8 public constant CONSENSUS_THRESHOLD = 3; // 3 out of 5
    uint8 public constant PANEL_SIZE = 5;
    uint8 public constant PASS_SCORE = 60;
    uint8 public constant OUTLIER_DELTA = 15;
    uint64 public constant VRF_TIMEOUT = 30 minutes;

    // --- VRF Config ---
    IVRFCoordinatorV2Plus public immutable vrfCoordinator;
    bytes32 public vrfKeyHash;
    uint256 public vrfSubscriptionId;
    uint16 public vrfRequestConfirmations = 0;
    uint32 public vrfCallbackGasLimit = 500_000;

    // --- State ---
    mapping(address => Validator) public validators;
    address[] public validatorList; // for selection
    uint256 public activeValidatorCount;

    mapping(uint256 => ReviewRound) internal _rounds; // taskId => round

    // VRF request tracking
    mapping(uint256 => PendingPanelRequest) public pendingRequests; // requestId => pending request
    mapping(uint256 => bool) public panelSelected; // taskId => whether panel has been selected
    mapping(uint256 => uint256) public taskVRFRequest; // taskId => vrfRequestId (for timeout cancellation)

    // Authorized callers (ABBCore)
    mapping(address => bool) public authorizedCallers;

    // --- Events ---
    event ValidatorRegistered(address indexed validator, uint256 stake);
    event StakeAdded(address indexed validator, uint256 amount, uint256 totalStake);
    event UnstakeRequested(address indexed validator, uint256 amount);
    event UnstakeCompleted(address indexed validator, uint256 amount);
    event ValidatorDeactivated(address indexed validator);
    event PanelRequested(uint256 indexed taskId, uint256 indexed vrfRequestId);
    event PanelSelected(uint256 indexed taskId, address[] validators);
    event ScoreCommitted(uint256 indexed taskId, address indexed validator);
    event ScoreRevealed(uint256 indexed taskId, address indexed validator, uint8 score);
    event RoundFinalized(uint256 indexed taskId, bool accepted, uint8 medianScore);
    event ValidatorSlashed(address indexed validator, uint256 amount, string reason);
    event ReputationUpdated(address indexed validator, uint256 oldScore, uint256 newScore);
    event AuthorizedCallerSet(address indexed caller, bool authorized);
    event VRFConfigUpdated(bytes32 keyHash, uint256 subscriptionId, uint16 confirmations, uint32 callbackGasLimit);
    event PanelSelectionFailed(uint256 indexed taskId, uint256 selected, uint256 required);
    event VRFRequestCancelled(uint256 indexed taskId, uint256 indexed vrfRequestId);

    // --- Errors ---
    error ZeroAddress();
    error InsufficientStake();
    error AlreadyRegistered();
    error NotValidator();
    error ValidatorNotActive();
    error UnstakeCooldownNotMet();
    error NoPendingUnstake();
    error NotEnoughValidators();
    error NotAuthorized();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error CommitDeadlinePassed();
    error RevealDeadlinePassed();
    error RevealDeadlineNotPassed();
    error HashMismatch();
    error RoundAlreadyFinalized();
    error InvalidScore();
    error TransferFailed();
    error RoundNotFound();
    error PanelAlreadyRequested();
    error OnlyVRFCoordinator();
    error IncompletePanelSelection();
    error VRFRequestNotTimedOut();
    error NoPendingRequest();

    // --- Modifiers ---
    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    modifier onlyActiveValidator() {
        if (!validators[msg.sender].active) revert ValidatorNotActive();
        _;
    }

    // --- Constructor ---
    constructor(address _owner, address _vrfCoordinator, uint256 _subscriptionId, bytes32 _keyHash) Ownable(_owner) {
        if (_vrfCoordinator == address(0)) revert ZeroAddress();
        vrfCoordinator = IVRFCoordinatorV2Plus(_vrfCoordinator);
        vrfSubscriptionId = _subscriptionId;
        vrfKeyHash = _keyHash;
    }

    // --- External Functions ---

    /// @notice Register as a validator with minimum stake
    function registerValidator() external payable whenNotPaused {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        if (validators[msg.sender].registeredAt != 0) revert AlreadyRegistered();

        validators[msg.sender] = Validator({
            addr: msg.sender,
            stakeAmount: msg.value,
            reputationScore: INITIAL_REPUTATION,
            registeredAt: uint64(block.timestamp),
            active: true,
            pendingUnstake: 0,
            unstakeRequestTime: 0
        });
        validatorList.push(msg.sender);
        activeValidatorCount++;

        emit ValidatorRegistered(msg.sender, msg.value);
    }

    /// @notice Add more stake
    function addStake() external payable onlyActiveValidator {
        if (msg.value == 0) revert InsufficientStake();
        validators[msg.sender].stakeAmount += msg.value;
        emit StakeAdded(msg.sender, msg.value, validators[msg.sender].stakeAmount);
    }

    /// @notice Request unstake with cooldown
    function initiateUnstake(uint256 amount) external onlyActiveValidator {
        Validator storage v = validators[msg.sender];
        if (amount == 0 || amount > v.stakeAmount) revert InsufficientStake();

        v.pendingUnstake = amount;
        v.unstakeRequestTime = uint64(block.timestamp);

        if (v.stakeAmount - amount < MIN_STAKE) {
            v.active = false;
            activeValidatorCount--;
            emit ValidatorDeactivated(msg.sender);
        }

        emit UnstakeRequested(msg.sender, amount);
    }

    /// @notice Complete unstake after cooldown
    function completeUnstake() external nonReentrant {
        Validator storage v = validators[msg.sender];
        if (v.pendingUnstake == 0) revert NoPendingUnstake();
        if (block.timestamp < v.unstakeRequestTime + UNSTAKE_COOLDOWN) revert UnstakeCooldownNotMet();

        uint256 amount = v.pendingUnstake;
        v.stakeAmount -= amount;
        v.pendingUnstake = 0;
        v.unstakeRequestTime = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit UnstakeCompleted(msg.sender, amount);
    }

    /// @notice Request a validator panel via Chainlink VRF (async — phase 1)
    /// @dev Panel is actually selected in the VRF callback (fulfillRandomWords)
    /// @param taskId The task to review
    /// @param commitDuration Duration for commit phase (starts after VRF callback)
    /// @param revealDuration Duration for reveal phase (starts after commit phase)
    /// @return vrfRequestId The VRF request ID for tracking
    function requestPanel(uint256 taskId, uint64 commitDuration, uint64 revealDuration)
        external
        onlyAuthorized
        whenNotPaused
        returns (uint256 vrfRequestId)
    {
        if (activeValidatorCount < PANEL_SIZE) revert NotEnoughValidators();
        if (panelSelected[taskId] || _rounds[taskId].initialized) revert PanelAlreadyRequested();

        // Request randomness from Chainlink VRF V2.5
        vrfRequestId = vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubscriptionId,
                requestConfirmations: vrfRequestConfirmations,
                callbackGasLimit: vrfCallbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
            })
        );

        // Store pending request
        pendingRequests[vrfRequestId] = PendingPanelRequest({
            taskId: taskId,
            commitDuration: commitDuration,
            revealDuration: revealDuration,
            requestedAt: uint64(block.timestamp),
            pending: true
        });
        taskVRFRequest[taskId] = vrfRequestId;

        emit PanelRequested(taskId, vrfRequestId);
    }

    /// @notice VRF callback — called by the VRF Coordinator with verified randomness
    /// @dev Performs Fisher-Yates shuffle to select panel, sets commit/reveal deadlines
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(vrfCoordinator)) revert OnlyVRFCoordinator();

        PendingPanelRequest storage req = pendingRequests[requestId];
        if (!req.pending) revert RoundNotFound();

        req.pending = false;
        uint256 taskId = req.taskId;

        // Initialize round — deadlines start NOW (from VRF callback, not request time)
        ReviewRound storage round = _rounds[taskId];
        round.taskId = taskId;
        round.initialized = true;
        round.commitDeadline = uint64(block.timestamp) + req.commitDuration;
        round.revealDeadline = uint64(block.timestamp) + req.commitDuration + req.revealDuration;
        round.requiredReveals = CONSENSUS_THRESHOLD;

        // Fisher-Yates partial shuffle with VRF seed
        uint256 len = validatorList.length;
        address[] memory candidates = new address[](len);
        for (uint256 i; i < len; i++) {
            candidates[i] = validatorList[i];
        }

        address[] memory panel = new address[](PANEL_SIZE);
        uint256 selected;
        uint256 seed = randomWords[0];

        for (uint256 i; i < len && selected < PANEL_SIZE; i++) {
            uint256 j = i + (seed % (len - i));
            seed = uint256(keccak256(abi.encodePacked(seed)));
            (candidates[i], candidates[j]) = (candidates[j], candidates[i]);
            if (validators[candidates[i]].active) {
                panel[selected] = candidates[i];
                round.validators.push(candidates[i]);
                selected++;
            }
        }

        // H-4 FIX: Revert if we couldn't fill the panel (validators unstaked between request and callback)
        if (selected < PANEL_SIZE) {
            // Reset state so task can be retried
            round.initialized = false;
            delete panelSelected[taskId];
            emit PanelSelectionFailed(taskId, selected, PANEL_SIZE);
            revert IncompletePanelSelection();
        }

        panelSelected[taskId] = true;

        emit PanelSelected(taskId, panel);
    }

    /// @notice Cancel a timed-out VRF request so the task can be retried
    /// @dev M-4 FIX: Prevents tasks from being stuck forever if VRF callback never fires
    function cancelTimedOutRequest(uint256 taskId) external onlyAuthorized {
        uint256 reqId = taskVRFRequest[taskId];
        if (reqId == 0) revert NoPendingRequest();

        PendingPanelRequest storage req = pendingRequests[reqId];
        if (!req.pending) revert NoPendingRequest();
        if (block.timestamp < req.requestedAt + VRF_TIMEOUT) revert VRFRequestNotTimedOut();

        // Clear pending state so task can be re-submitted
        req.pending = false;
        delete panelSelected[taskId];
        delete taskVRFRequest[taskId];

        emit VRFRequestCancelled(taskId, reqId);
    }

    /// @notice Commit a score hash for a task
    function commitScore(uint256 taskId, bytes32 commitHash) external onlyActiveValidator {
        ReviewRound storage round = _rounds[taskId];
        if (!round.initialized) revert RoundNotFound();
        if (block.timestamp > round.commitDeadline) revert CommitDeadlinePassed();
        if (round.hasCommitted[msg.sender]) revert AlreadyCommitted();

        round.commitments[msg.sender] = commitHash;
        round.hasCommitted[msg.sender] = true;

        emit ScoreCommitted(taskId, msg.sender);
    }

    /// @notice Reveal a committed score
    function revealScore(uint256 taskId, uint8 score, bytes32 salt) external onlyActiveValidator {
        if (score > 100) revert InvalidScore();
        ReviewRound storage round = _rounds[taskId];
        if (!round.initialized) revert RoundNotFound();
        if (block.timestamp <= round.commitDeadline) revert CommitDeadlinePassed();
        if (block.timestamp > round.revealDeadline) revert RevealDeadlinePassed();
        if (!round.hasCommitted[msg.sender]) revert NotCommitted();
        if (round.hasRevealed[msg.sender]) revert AlreadyRevealed();

        bytes32 expected = keccak256(abi.encodePacked(taskId, score, salt));
        if (round.commitments[msg.sender] != expected) revert HashMismatch();

        round.revealedScores[msg.sender] = score;
        round.hasRevealed[msg.sender] = true;
        round.revealCount++;

        emit ScoreRevealed(taskId, msg.sender, score);
    }

    /// @notice Finalize a review round and determine consensus
    function finalizeRound(uint256 taskId) external onlyAuthorized returns (bool accepted, uint8 medianScore) {
        ReviewRound storage round = _rounds[taskId];
        if (!round.initialized) revert RoundNotFound();
        if (round.finalized) revert RoundAlreadyFinalized();
        if (block.timestamp <= round.revealDeadline) revert RevealDeadlineNotPassed();

        uint8[] memory scores = new uint8[](round.revealCount);
        uint256 idx;
        for (uint256 i; i < round.validators.length; i++) {
            if (round.hasRevealed[round.validators[i]]) {
                scores[idx] = round.revealedScores[round.validators[i]];
                idx++;
            }
        }

        _sortScores(scores);
        medianScore = scores[scores.length / 2];

        uint256 inConsensus;
        for (uint256 i; i < scores.length; i++) {
            uint8 s = scores[i];
            if (s + OUTLIER_DELTA >= medianScore && medianScore + OUTLIER_DELTA >= s) {
                inConsensus++;
            }
        }

        accepted = medianScore >= PASS_SCORE && inConsensus >= CONSENSUS_THRESHOLD;

        round.finalized = true;
        round.accepted = accepted;
        round.medianScore = medianScore;

        for (uint256 i; i < round.validators.length; i++) {
            address v = round.validators[i];
            if (round.hasRevealed[v]) {
                uint8 s = round.revealedScores[v];
                bool isOutlier = !(s + OUTLIER_DELTA >= medianScore && medianScore + OUTLIER_DELTA >= s);
                uint256 oldRep = validators[v].reputationScore;
                if (isOutlier) {
                    validators[v].reputationScore = oldRep > 100 ? oldRep - 100 : 0;
                } else {
                    uint256 newRep = oldRep + 50;
                    validators[v].reputationScore = newRep > MAX_REPUTATION ? MAX_REPUTATION : newRep;
                }
                emit ReputationUpdated(v, oldRep, validators[v].reputationScore);
            }
        }

        emit RoundFinalized(taskId, accepted, medianScore);
    }

    /// @notice Slash a validator's stake
    function slash(address validator, uint256 amount, string calldata reason) external onlyAuthorized {
        Validator storage v = validators[validator];
        if (v.registeredAt == 0) revert NotValidator();

        uint256 slashAmount = amount > v.stakeAmount ? v.stakeAmount : amount;
        v.stakeAmount -= slashAmount;

        if (v.stakeAmount < MIN_STAKE && v.active) {
            v.active = false;
            activeValidatorCount--;
            emit ValidatorDeactivated(validator);
        }

        emit ValidatorSlashed(validator, slashAmount, reason);
    }

    /// @notice Set authorized caller
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    /// @notice Update VRF configuration
    function setVRFConfig(
        bytes32 _keyHash,
        uint256 _subscriptionId,
        uint16 _requestConfirmations,
        uint32 _callbackGasLimit
    ) external onlyOwner {
        vrfKeyHash = _keyHash;
        vrfSubscriptionId = _subscriptionId;
        vrfRequestConfirmations = _requestConfirmations;
        vrfCallbackGasLimit = _callbackGasLimit;
        emit VRFConfigUpdated(_keyHash, _subscriptionId, _requestConfirmations, _callbackGasLimit);
    }

    // --- View Functions ---

    function getValidator(address addr) external view returns (Validator memory) {
        return validators[addr];
    }

    function isRoundFinalized(uint256 taskId) external view returns (bool) {
        return _rounds[taskId].finalized;
    }

    function isRoundInitialized(uint256 taskId) external view returns (bool) {
        return _rounds[taskId].initialized;
    }

    function isPanelSelected(uint256 taskId) external view returns (bool) {
        return panelSelected[taskId];
    }

    function getRoundResult(uint256 taskId) external view returns (bool accepted, uint8 medianScore) {
        ReviewRound storage r = _rounds[taskId];
        return (r.accepted, r.medianScore);
    }

    function getActiveValidatorCount() external view returns (uint256) {
        return activeValidatorCount;
    }

    // --- Internal ---

    function _sortScores(uint8[] memory arr) internal pure {
        for (uint256 i = 1; i < arr.length; i++) {
            uint8 key = arr[i];
            uint256 j = i;
            while (j > 0 && arr[j - 1] > key) {
                arr[j] = arr[j - 1];
                j--;
            }
            arr[j] = key;
        }
    }

    // --- Admin ---
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
