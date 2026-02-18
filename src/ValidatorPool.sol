// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ValidatorPool
/// @notice Manages validator registration, staking, selection, commit-reveal scoring, and slashing
/// @dev Pseudo-random selection for now; VRF integration point marked with TODO
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

    // --- Constants ---
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint64 public constant UNSTAKE_COOLDOWN = 7 days;
    uint256 public constant MAX_REPUTATION = 10_000;
    uint256 public constant INITIAL_REPUTATION = 5_000;
    uint8 public constant CONSENSUS_THRESHOLD = 3; // 3 out of 5
    uint8 public constant PANEL_SIZE = 5;
    uint8 public constant PASS_SCORE = 60;
    uint8 public constant OUTLIER_DELTA = 15;

    // --- State ---
    mapping(address => Validator) public validators;
    address[] public validatorList; // for selection
    uint256 public activeValidatorCount;

    mapping(uint256 => ReviewRound) internal _rounds; // taskId => round

    // Authorized callers (ABBCore)
    mapping(address => bool) public authorizedCallers;

    // --- Events ---
    event ValidatorRegistered(address indexed validator, uint256 stake);
    event StakeAdded(address indexed validator, uint256 amount, uint256 totalStake);
    event UnstakeRequested(address indexed validator, uint256 amount);
    event UnstakeCompleted(address indexed validator, uint256 amount);
    event ValidatorDeactivated(address indexed validator);
    event PanelSelected(uint256 indexed taskId, address[] validators);
    event ScoreCommitted(uint256 indexed taskId, address indexed validator);
    event ScoreRevealed(uint256 indexed taskId, address indexed validator, uint8 score);
    event RoundFinalized(uint256 indexed taskId, bool accepted, uint8 medianScore);
    event ValidatorSlashed(address indexed validator, uint256 amount, string reason);
    event ReputationUpdated(address indexed validator, uint256 oldScore, uint256 newScore);
    event AuthorizedCallerSet(address indexed caller, bool authorized);

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
    constructor(address _owner) Ownable(_owner) {}

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
    /// @param amount Amount to unstake
    function initiateUnstake(uint256 amount) external onlyActiveValidator {
        Validator storage v = validators[msg.sender];
        if (amount == 0 || amount > v.stakeAmount) revert InsufficientStake();

        v.pendingUnstake = amount;
        v.unstakeRequestTime = uint64(block.timestamp);

        // If remaining stake below minimum, deactivate
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

        // EFFECTS
        v.stakeAmount -= amount;
        v.pendingUnstake = 0;
        v.unstakeRequestTime = 0;

        // INTERACTIONS
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit UnstakeCompleted(msg.sender, amount);
    }

    /// @notice Select a panel of validators for a task review
    /// @param taskId The task to review
    /// @param commitDuration Duration for commit phase
    /// @param revealDuration Duration for reveal phase
    function selectPanel(uint256 taskId, uint64 commitDuration, uint64 revealDuration)
        external
        onlyAuthorized
        whenNotPaused
        returns (address[] memory panel)
    {
        if (activeValidatorCount < PANEL_SIZE) revert NotEnoughValidators();

        ReviewRound storage round = _rounds[taskId];
        round.taskId = taskId;
        round.initialized = true;
        round.commitDeadline = uint64(block.timestamp) + commitDuration;
        round.revealDeadline = uint64(block.timestamp) + commitDuration + revealDuration;
        round.requiredReveals = CONSENSUS_THRESHOLD;

        // TODO: Replace with Chainlink VRF for production
        // Pseudo-random selection: Fisher-Yates partial shuffle
        panel = new address[](PANEL_SIZE);
        uint256 len = validatorList.length;
        address[] memory candidates = new address[](len);
        for (uint256 i; i < len; i++) {
            candidates[i] = validatorList[i];
        }

        uint256 selected;
        uint256 seed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, taskId)));
        for (uint256 i; i < len && selected < PANEL_SIZE; i++) {
            uint256 j = i + (seed % (len - i));
            seed = uint256(keccak256(abi.encodePacked(seed)));
            // Swap
            (candidates[i], candidates[j]) = (candidates[j], candidates[i]);
            if (validators[candidates[i]].active) {
                panel[selected] = candidates[i];
                round.validators.push(candidates[i]);
                selected++;
            }
        }

        if (selected < PANEL_SIZE) revert NotEnoughValidators();

        emit PanelSelected(taskId, panel);
    }

    /// @notice Commit a score hash for a task
    /// @param taskId The task ID
    /// @param commitHash keccak256(abi.encodePacked(taskId, score, salt))
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
    /// @param taskId The task ID
    /// @param score The actual score (0-100)
    /// @param salt The salt used in commitment
    function revealScore(uint256 taskId, uint8 score, bytes32 salt) external onlyActiveValidator {
        if (score > 100) revert InvalidScore();
        ReviewRound storage round = _rounds[taskId];
        if (!round.initialized) revert RoundNotFound();
        if (block.timestamp <= round.commitDeadline) revert CommitDeadlinePassed(); // must wait for commit phase to end
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
    /// @param taskId The task ID
    /// @return accepted Whether the submission was accepted
    /// @return medianScore The median score
    function finalizeRound(uint256 taskId) external onlyAuthorized returns (bool accepted, uint8 medianScore) {
        ReviewRound storage round = _rounds[taskId];
        if (!round.initialized) revert RoundNotFound();
        if (round.finalized) revert RoundAlreadyFinalized();
        if (block.timestamp <= round.revealDeadline) revert RevealDeadlineNotPassed();

        // Collect revealed scores
        uint8[] memory scores = new uint8[](round.revealCount);
        uint256 idx;
        for (uint256 i; i < round.validators.length; i++) {
            if (round.hasRevealed[round.validators[i]]) {
                scores[idx] = round.revealedScores[round.validators[i]];
                idx++;
            }
        }

        // Sort scores for median
        _sortScores(scores);
        medianScore = scores[scores.length / 2];

        // Check consensus: count validators within ±OUTLIER_DELTA of median
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

        // Update validator reputations — penalize outliers
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
    /// @param validator The validator to slash
    /// @param amount Amount to slash
    /// @param reason Reason for slashing
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

    // --- View Functions ---

    /// @notice Get validator info
    function getValidator(address addr) external view returns (Validator memory) {
        return validators[addr];
    }

    /// @notice Check if round is finalized
    function isRoundFinalized(uint256 taskId) external view returns (bool) {
        return _rounds[taskId].finalized;
    }

    /// @notice Get round result
    function getRoundResult(uint256 taskId) external view returns (bool accepted, uint8 medianScore) {
        ReviewRound storage r = _rounds[taskId];
        return (r.accepted, r.medianScore);
    }

    /// @notice Get number of active validators
    function getActiveValidatorCount() external view returns (uint256) {
        return activeValidatorCount;
    }

    // --- Internal ---

    /// @dev Simple insertion sort for small arrays (max 5 elements)
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
