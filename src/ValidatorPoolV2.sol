// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./vendor/chainlink/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import "./vendor/chainlink/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title ValidatorPoolV2
/// @notice Tiered validation: Micro (instant, 1 AI validator), Standard (3 panel),
///         Premium (5 panel commit-reveal). Supports both ETH staking (legacy) and
///         future $AECON staking integration.
/// @dev Extends V1 with ValidationTier enum and auto-score paths for AI validators.
contract ValidatorPoolV2 is Ownable2Step, Pausable, ReentrancyGuard {
    // ═══════════════════════════════════════════
    //  Enums
    // ═══════════════════════════════════════════

    /// @notice Validation tier determines panel size and scoring mechanism
    enum ValidationTier {
        Micro, // < 0.01 ETH bounty — 1 AI validator, instant score
        Standard, // 0.01-1 ETH — 3 AI validators, direct score (no commit-reveal)
        Premium // > 1 ETH — 5 validators, full commit-reveal consensus
    }

    // ═══════════════════════════════════════════
    //  Structs
    // ═══════════════════════════════════════════

    struct Validator {
        address addr;
        uint256 stakeAmount;
        uint256 reputationScore; // 0-10000 bps
        uint64 registeredAt;
        bool active;
        bool isAIValidator; // V2: can auto-score (no commit-reveal needed)
        uint256 pendingUnstake;
        uint64 unstakeRequestTime;
    }

    struct ReviewRound {
        uint256 taskId;
        ValidationTier tier;
        bool initialized;
        address[] validators;
        // Direct scores (Micro + Standard tiers)
        mapping(address => uint8) scores;
        mapping(address => bool) hasScored;
        uint8 scoreCount;
        // Commit-reveal (Premium tier only)
        mapping(address => bytes32) commitments;
        mapping(address => uint8) revealedScores;
        mapping(address => bool) hasCommitted;
        mapping(address => bool) hasRevealed;
        uint8 revealCount;
        uint8 requiredScores; // minimum scores needed for consensus
        uint64 commitDeadline; // Premium only
        uint64 revealDeadline; // Premium only
        bool finalized;
        bool accepted;
        uint8 medianScore;
    }

    struct PendingPanelRequest {
        uint256 taskId;
        ValidationTier tier;
        uint64 commitDuration;
        uint64 revealDuration;
        uint64 requestedAt;
        bool pending;
    }

    // ═══════════════════════════════════════════
    //  Constants
    // ═══════════════════════════════════════════

    uint256 public constant MIN_STAKE = 0.1 ether;
    uint64 public constant UNSTAKE_COOLDOWN = 7 days;
    uint256 public constant MAX_REPUTATION = 10_000;
    uint256 public constant INITIAL_REPUTATION = 5_000;
    uint8 public constant PASS_SCORE = 60;
    uint8 public constant OUTLIER_DELTA = 15;
    uint64 public constant VRF_TIMEOUT = 30 minutes;

    // Tier-specific panel sizes and consensus thresholds
    uint8 public constant MICRO_PANEL_SIZE = 1;
    uint8 public constant MICRO_CONSENSUS = 1;
    uint8 public constant STANDARD_PANEL_SIZE = 3;
    uint8 public constant STANDARD_CONSENSUS = 2;
    uint8 public constant PREMIUM_PANEL_SIZE = 5;
    uint8 public constant PREMIUM_CONSENSUS = 3;

    // Bounty thresholds for auto-tier selection
    uint256 public constant MICRO_THRESHOLD = 0.01 ether;
    uint256 public constant STANDARD_THRESHOLD = 1 ether;

    // ═══════════════════════════════════════════
    //  VRF Config
    // ═══════════════════════════════════════════

    IVRFCoordinatorV2Plus public immutable vrfCoordinator;
    bytes32 public vrfKeyHash;
    uint256 public vrfSubscriptionId;
    uint16 public vrfRequestConfirmations = 0;
    uint32 public vrfCallbackGasLimit = 500_000;

    // ═══════════════════════════════════════════
    //  State
    // ═══════════════════════════════════════════

    mapping(address => Validator) public validators;
    address[] public validatorList;
    uint256 public activeValidatorCount;
    uint256 public aiValidatorCount; // V2: track AI validators separately

    mapping(uint256 => ReviewRound) internal _rounds;
    mapping(uint256 => PendingPanelRequest) public pendingRequests;
    mapping(uint256 => bool) public panelSelected;
    mapping(uint256 => uint256) public taskVRFRequest;

    address public treasury;
    mapping(address => bool) public authorizedCallers;

    // ═══════════════════════════════════════════
    //  Events
    // ═══════════════════════════════════════════

    event ValidatorRegistered(address indexed validator, uint256 stake, bool isAI);
    event StakeAdded(address indexed validator, uint256 amount, uint256 totalStake);
    event UnstakeRequested(address indexed validator, uint256 amount);
    event UnstakeCompleted(address indexed validator, uint256 amount);
    event ValidatorDeactivated(address indexed validator);
    event PanelRequested(uint256 indexed taskId, ValidationTier tier, uint256 indexed vrfRequestId);
    event PanelSelected(uint256 indexed taskId, ValidationTier tier, address[] validators);
    event DirectScoreSubmitted(uint256 indexed taskId, address indexed validator, uint8 score);
    event ScoreCommitted(uint256 indexed taskId, address indexed validator);
    event ScoreRevealed(uint256 indexed taskId, address indexed validator, uint8 score);
    event RoundFinalized(uint256 indexed taskId, bool accepted, uint8 medianScore, ValidationTier tier);
    event ValidatorSlashed(address indexed validator, uint256 amount, string reason);
    event ReputationUpdated(address indexed validator, uint256 oldScore, uint256 newScore);
    event AuthorizedCallerSet(address indexed caller, bool authorized);
    event VRFConfigUpdated(bytes32 keyHash, uint256 subscriptionId, uint16 confirmations, uint32 callbackGasLimit);
    event PanelSelectionFailed(uint256 indexed taskId, uint256 selected, uint256 required);
    event VRFRequestCancelled(uint256 indexed taskId, uint256 indexed vrfRequestId);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event SlashedFundsTransferred(address indexed treasury, uint256 amount);
    event MicroPanelSelected(uint256 indexed taskId, address validator);

    // ═══════════════════════════════════════════
    //  Errors
    // ═══════════════════════════════════════════

    error ZeroAddress();
    error InsufficientStake();
    error AlreadyRegistered();
    error NotValidator();
    error ValidatorNotActive();
    error UnstakeCooldownNotMet();
    error NoPendingUnstake();
    error NotEnoughValidators();
    error NotAuthorized();
    error AlreadyScored();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error CommitDeadlinePassed();
    error CommitPhaseNotOver();
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
    error NotOnPanel();
    error WrongTier();
    error NotEnoughScores();

    // ═══════════════════════════════════════════
    //  Modifiers
    // ═══════════════════════════════════════════

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    modifier onlyActiveValidator() {
        if (!validators[msg.sender].active) revert ValidatorNotActive();
        _;
    }

    function _requireOnPanel(uint256 taskId) internal view {
        address[] storage panel = _rounds[taskId].validators;
        bool found;
        for (uint256 i; i < panel.length; i++) {
            if (panel[i] == msg.sender) found = true;
            break;
        }
        if (!found) revert NotOnPanel();
    }

    // ═══════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════

    constructor(address _owner, address _vrfCoordinator, uint256 _subscriptionId, bytes32 _keyHash) Ownable(_owner) {
        if (_vrfCoordinator == address(0)) revert ZeroAddress();
        vrfCoordinator = IVRFCoordinatorV2Plus(_vrfCoordinator);
        vrfSubscriptionId = _subscriptionId;
        vrfKeyHash = _keyHash;
    }

    // ═══════════════════════════════════════════
    //  Validator Registration
    // ═══════════════════════════════════════════

    /// @notice Register as a validator (human or AI)
    /// @param isAI Whether this validator is an AI agent (enables direct scoring)
    function registerValidator(bool isAI) external payable whenNotPaused {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        if (validators[msg.sender].registeredAt != 0) revert AlreadyRegistered();

        validators[msg.sender] = Validator({
            addr: msg.sender,
            stakeAmount: msg.value,
            reputationScore: INITIAL_REPUTATION,
            registeredAt: uint64(block.timestamp),
            active: true,
            isAIValidator: isAI,
            pendingUnstake: 0,
            unstakeRequestTime: 0
        });
        validatorList.push(msg.sender);
        activeValidatorCount++;
        if (isAI) aiValidatorCount++;

        emit ValidatorRegistered(msg.sender, msg.value, isAI);
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
            if (v.isAIValidator) aiValidatorCount--;
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

    // ═══════════════════════════════════════════
    //  Tier Selection (helper)
    // ═══════════════════════════════════════════

    /// @notice Determine validation tier from bounty amount
    function getTier(uint256 bountyAmount) public pure returns (ValidationTier) {
        if (bountyAmount < MICRO_THRESHOLD) return ValidationTier.Micro;
        if (bountyAmount <= STANDARD_THRESHOLD) return ValidationTier.Standard;
        return ValidationTier.Premium;
    }

    function _panelSizeForTier(ValidationTier tier) internal pure returns (uint8) {
        if (tier == ValidationTier.Micro) return MICRO_PANEL_SIZE;
        if (tier == ValidationTier.Standard) return STANDARD_PANEL_SIZE;
        return PREMIUM_PANEL_SIZE;
    }

    function _consensusForTier(ValidationTier tier) internal pure returns (uint8) {
        if (tier == ValidationTier.Micro) return MICRO_CONSENSUS;
        if (tier == ValidationTier.Standard) return STANDARD_CONSENSUS;
        return PREMIUM_CONSENSUS;
    }

    // ═══════════════════════════════════════════
    //  Micro Tier — Instant single-validator scoring
    // ═══════════════════════════════════════════

    /// @notice Select a single AI validator for micro-tier (no VRF needed)
    /// @dev Uses prevrandao as cheap randomness — acceptable for tasks below MICRO_THRESHOLD.
    ///      Miners/sequencers could influence selection but economic incentive is negligible
    ///      at these bounty levels. For higher-value tasks, use Standard/Premium with VRF.
    function requestMicroPanel(uint256 taskId) external onlyAuthorized whenNotPaused {
        if (aiValidatorCount < 1) revert NotEnoughValidators();
        if (panelSelected[taskId] || _rounds[taskId].initialized) revert PanelAlreadyRequested();

        // Cheap pseudo-random selection (acceptable for micro bounties)
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, taskId, block.timestamp)));
        address selected;
        uint256 len = validatorList.length;

        for (uint256 i; i < len; i++) {
            uint256 idx = (seed + i) % len;
            address candidate = validatorList[idx];
            if (validators[candidate].active && validators[candidate].isAIValidator) {
                selected = candidate;
                break;
            }
        }

        if (selected == address(0)) revert NotEnoughValidators();

        ReviewRound storage round = _rounds[taskId];
        round.taskId = taskId;
        round.tier = ValidationTier.Micro;
        round.initialized = true;
        round.validators.push(selected);
        round.requiredScores = MICRO_CONSENSUS;
        panelSelected[taskId] = true;

        emit MicroPanelSelected(taskId, selected);
    }

    // ═══════════════════════════════════════════
    //  Standard Tier — 3 validators, direct scoring
    // ═══════════════════════════════════════════

    /// @notice Request a standard panel via VRF (3 validators)
    function requestStandardPanel(uint256 taskId) external onlyAuthorized whenNotPaused returns (uint256 vrfRequestId) {
        uint8 needed = STANDARD_PANEL_SIZE;
        if (activeValidatorCount < needed) revert NotEnoughValidators();
        if (panelSelected[taskId] || _rounds[taskId].initialized) revert PanelAlreadyRequested();

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

        pendingRequests[vrfRequestId] = PendingPanelRequest({
            taskId: taskId,
            tier: ValidationTier.Standard,
            commitDuration: 0, // not used for standard
            revealDuration: 0,
            requestedAt: uint64(block.timestamp),
            pending: true
        });
        taskVRFRequest[taskId] = vrfRequestId;

        emit PanelRequested(taskId, ValidationTier.Standard, vrfRequestId);
    }

    // ═══════════════════════════════════════════
    //  Premium Tier — 5 validators, commit-reveal
    // ═══════════════════════════════════════════

    /// @notice Request premium panel via VRF (5 validators, commit-reveal)
    function requestPremiumPanel(uint256 taskId, uint64 commitDuration, uint64 revealDuration)
        external
        onlyAuthorized
        whenNotPaused
        returns (uint256 vrfRequestId)
    {
        if (activeValidatorCount < PREMIUM_PANEL_SIZE) revert NotEnoughValidators();
        if (panelSelected[taskId] || _rounds[taskId].initialized) revert PanelAlreadyRequested();

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

        pendingRequests[vrfRequestId] = PendingPanelRequest({
            taskId: taskId,
            tier: ValidationTier.Premium,
            commitDuration: commitDuration,
            revealDuration: revealDuration,
            requestedAt: uint64(block.timestamp),
            pending: true
        });
        taskVRFRequest[taskId] = vrfRequestId;

        emit PanelRequested(taskId, ValidationTier.Premium, vrfRequestId);
    }

    /// @notice Legacy V1 compatible panel request (defaults to Premium)
    function requestPanel(uint256 taskId, uint64 commitDuration, uint64 revealDuration)
        external
        onlyAuthorized
        whenNotPaused
        returns (uint256)
    {
        return this.requestPremiumPanel(taskId, commitDuration, revealDuration);
    }

    // ═══════════════════════════════════════════
    //  VRF Callback — handles Standard + Premium
    // ═══════════════════════════════════════════

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(vrfCoordinator)) revert OnlyVRFCoordinator();

        PendingPanelRequest storage req = pendingRequests[requestId];
        if (!req.pending) revert RoundNotFound();

        req.pending = false;
        uint256 taskId = req.taskId;
        ValidationTier tier = req.tier;
        uint8 panelSize = _panelSizeForTier(tier);

        ReviewRound storage round = _rounds[taskId];
        round.taskId = taskId;
        round.tier = tier;
        round.initialized = true;
        round.requiredScores = _consensusForTier(tier);

        // Premium gets commit-reveal deadlines
        if (tier == ValidationTier.Premium) {
            round.commitDeadline = uint64(block.timestamp) + req.commitDuration;
            round.revealDeadline = uint64(block.timestamp) + req.commitDuration + req.revealDuration;
        }

        // Fisher-Yates selection
        uint256 len = validatorList.length;
        address[] memory candidates = new address[](len);
        for (uint256 i; i < len; i++) {
            candidates[i] = validatorList[i];
        }

        address[] memory panel = new address[](panelSize);
        uint256 selected;
        uint256 seed = randomWords[0];

        for (uint256 i; i < len && selected < panelSize; i++) {
            uint256 j = i + (seed % (len - i));
            seed = uint256(keccak256(abi.encodePacked(seed)));
            (candidates[i], candidates[j]) = (candidates[j], candidates[i]);
            if (validators[candidates[i]].active) {
                panel[selected] = candidates[i];
                round.validators.push(candidates[i]);
                selected++;
            }
        }

        if (selected < panelSize) {
            round.initialized = false;
            delete panelSelected[taskId];
            emit PanelSelectionFailed(taskId, selected, panelSize);
            revert IncompletePanelSelection();
        }

        panelSelected[taskId] = true;
        emit PanelSelected(taskId, tier, panel);
    }

    // ═══════════════════════════════════════════
    //  Direct Scoring (Micro + Standard tiers)
    // ═══════════════════════════════════════════

    /// @notice Submit a direct score (Micro and Standard tiers only)
    /// @dev No commit-reveal needed — AI validators score instantly
    function submitScore(uint256 taskId, uint8 score) external onlyActiveValidator {
        if (score > 100) revert InvalidScore();
        ReviewRound storage round = _rounds[taskId];
        if (!round.initialized) revert RoundNotFound();
        if (round.tier == ValidationTier.Premium) revert WrongTier();
        _requireOnPanel(taskId);
        if (round.hasScored[msg.sender]) revert AlreadyScored();

        round.scores[msg.sender] = score;
        round.hasScored[msg.sender] = true;
        round.scoreCount++;

        emit DirectScoreSubmitted(taskId, msg.sender, score);
    }

    // ═══════════════════════════════════════════
    //  Commit-Reveal Scoring (Premium tier only)
    // ═══════════════════════════════════════════

    function commitScore(uint256 taskId, bytes32 commitHash) external onlyActiveValidator {
        ReviewRound storage round = _rounds[taskId];
        if (!round.initialized) revert RoundNotFound();
        if (round.tier != ValidationTier.Premium) revert WrongTier();
        _requireOnPanel(taskId);
        if (block.timestamp > round.commitDeadline) revert CommitDeadlinePassed();
        if (round.hasCommitted[msg.sender]) revert AlreadyCommitted();

        round.commitments[msg.sender] = commitHash;
        round.hasCommitted[msg.sender] = true;
        emit ScoreCommitted(taskId, msg.sender);
    }

    function revealScore(uint256 taskId, uint8 score, bytes32 salt) external onlyActiveValidator {
        if (score > 100) revert InvalidScore();
        ReviewRound storage round = _rounds[taskId];
        if (!round.initialized) revert RoundNotFound();
        if (round.tier != ValidationTier.Premium) revert WrongTier();
        _requireOnPanel(taskId);
        if (block.timestamp <= round.commitDeadline) revert CommitPhaseNotOver();
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

    // ═══════════════════════════════════════════
    //  Finalization (all tiers)
    // ═══════════════════════════════════════════

    /// @notice Finalize a review round — works for all tiers
    function finalizeRound(uint256 taskId) external onlyAuthorized returns (bool accepted, uint8 medianScore) {
        ReviewRound storage round = _rounds[taskId];
        if (!round.initialized) revert RoundNotFound();
        if (round.finalized) revert RoundAlreadyFinalized();

        if (round.tier == ValidationTier.Premium) {
            if (block.timestamp <= round.revealDeadline) revert RevealDeadlineNotPassed();
            return _finalizePremium(taskId);
        } else {
            return _finalizeDirect(taskId);
        }
    }

    /// @notice Finalize Micro/Standard tier (direct scores)
    function _finalizeDirect(uint256 taskId) internal returns (bool accepted, uint8 medianScore) {
        ReviewRound storage round = _rounds[taskId];
        uint8 needed = round.requiredScores;

        if (round.scoreCount < needed) revert NotEnoughScores();

        // Collect scores
        uint8[] memory scores = new uint8[](round.scoreCount);
        uint256 idx;
        for (uint256 i; i < round.validators.length; i++) {
            if (round.hasScored[round.validators[i]]) {
                scores[idx] = round.scores[round.validators[i]];
                idx++;
            }
        }

        _sortScores(scores);
        medianScore = scores[scores.length / 2];

        // For Micro tier, single score = direct accept/reject
        if (round.tier == ValidationTier.Micro) {
            accepted = medianScore >= PASS_SCORE;
        } else {
            // Standard tier — consensus check
            uint256 inConsensus;
            for (uint256 i; i < scores.length; i++) {
                uint8 s = scores[i];
                if (s + OUTLIER_DELTA >= medianScore && medianScore + OUTLIER_DELTA >= s) {
                    inConsensus++;
                }
            }
            accepted = medianScore >= PASS_SCORE && inConsensus >= needed;
        }

        round.finalized = true;
        round.accepted = accepted;
        round.medianScore = medianScore;

        // Update reputation
        _updateReputation(round, medianScore);

        emit RoundFinalized(taskId, accepted, medianScore, round.tier);
    }

    /// @notice Finalize Premium tier (commit-reveal)
    function _finalizePremium(uint256 taskId) internal returns (bool accepted, uint8 medianScore) {
        ReviewRound storage round = _rounds[taskId];

        if (round.revealCount == 0) {
            round.finalized = true;
            round.accepted = false;
            round.medianScore = 0;
            // Slash non-revealing validators
            for (uint256 i; i < round.validators.length; i++) {
                address v = round.validators[i];
                uint256 oldRep = validators[v].reputationScore;
                validators[v].reputationScore = oldRep > 200 ? oldRep - 200 : 0;
                emit ReputationUpdated(v, oldRep, validators[v].reputationScore);
            }
            emit RoundFinalized(taskId, false, 0, ValidationTier.Premium);
            return (false, 0);
        }

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
        accepted = medianScore >= PASS_SCORE && inConsensus >= PREMIUM_CONSENSUS;

        round.finalized = true;
        round.accepted = accepted;
        round.medianScore = medianScore;

        // Premium reputation: also penalize non-revealers
        for (uint256 i; i < round.validators.length; i++) {
            address v = round.validators[i];
            uint256 oldRep = validators[v].reputationScore;
            if (round.hasRevealed[v]) {
                uint8 s = round.revealedScores[v];
                bool isOutlier = !(s + OUTLIER_DELTA >= medianScore && medianScore + OUTLIER_DELTA >= s);
                if (isOutlier) {
                    validators[v].reputationScore = oldRep > 100 ? oldRep - 100 : 0;
                } else {
                    uint256 newRep = oldRep + 50;
                    validators[v].reputationScore = newRep > MAX_REPUTATION ? MAX_REPUTATION : newRep;
                }
            } else {
                validators[v].reputationScore = oldRep > 200 ? oldRep - 200 : 0;
            }
            emit ReputationUpdated(v, oldRep, validators[v].reputationScore);
        }

        emit RoundFinalized(taskId, accepted, medianScore, ValidationTier.Premium);
    }

    /// @notice Update reputation for Micro/Standard validators
    function _updateReputation(ReviewRound storage round, uint8 medianScore) internal {
        for (uint256 i; i < round.validators.length; i++) {
            address v = round.validators[i];
            uint256 oldRep = validators[v].reputationScore;

            if (round.hasScored[v]) {
                uint8 s = round.scores[v];
                bool isOutlier = !(s + OUTLIER_DELTA >= medianScore && medianScore + OUTLIER_DELTA >= s);
                if (isOutlier) {
                    validators[v].reputationScore = oldRep > 100 ? oldRep - 100 : 0;
                } else {
                    uint256 newRep = oldRep + 50;
                    validators[v].reputationScore = newRep > MAX_REPUTATION ? MAX_REPUTATION : newRep;
                }
            }
            // Non-scorers on Micro/Standard don't get penalized (they just don't earn)
            emit ReputationUpdated(v, oldRep, validators[v].reputationScore);
        }
    }

    // ═══════════════════════════════════════════
    //  VRF Timeout + Slash + Admin
    // ═══════════════════════════════════════════

    function cancelTimedOutRequest(uint256 taskId) external onlyAuthorized {
        uint256 reqId = taskVRFRequest[taskId];
        if (reqId == 0) revert NoPendingRequest();
        PendingPanelRequest storage req = pendingRequests[reqId];
        if (!req.pending) revert NoPendingRequest();
        if (block.timestamp < req.requestedAt + VRF_TIMEOUT) revert VRFRequestNotTimedOut();

        req.pending = false;
        delete panelSelected[taskId];
        delete taskVRFRequest[taskId];
        emit VRFRequestCancelled(taskId, reqId);
    }

    function slash(address validator, uint256 amount, string calldata reason) external onlyAuthorized {
        Validator storage v = validators[validator];
        if (v.registeredAt == 0) revert NotValidator();

        uint256 slashAmount = amount > v.stakeAmount ? v.stakeAmount : amount;
        v.stakeAmount -= slashAmount;

        if (v.stakeAmount < MIN_STAKE && v.active) {
            v.active = false;
            activeValidatorCount--;
            if (v.isAIValidator) aiValidatorCount--;
            emit ValidatorDeactivated(validator);
        }

        if (slashAmount > 0 && treasury != address(0)) {
            (bool ok,) = treasury.call{value: slashAmount}("");
            if (!ok) revert TransferFailed();
            emit SlashedFundsTransferred(treasury, slashAmount);
        }
        emit ValidatorSlashed(validator, slashAmount, reason);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(old, _treasury);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    function setVRFConfig(bytes32 _keyHash, uint256 _subscriptionId, uint16 _confirmations, uint32 _callbackGasLimit)
        external
        onlyOwner
    {
        vrfKeyHash = _keyHash;
        vrfSubscriptionId = _subscriptionId;
        vrfRequestConfirmations = _confirmations;
        vrfCallbackGasLimit = _callbackGasLimit;
        emit VRFConfigUpdated(_keyHash, _subscriptionId, _confirmations, _callbackGasLimit);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════
    //  View Functions
    // ═══════════════════════════════════════════

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

    function getRoundTier(uint256 taskId) external view returns (ValidationTier) {
        return _rounds[taskId].tier;
    }

    function getActiveValidatorCount() external view returns (uint256) {
        return activeValidatorCount;
    }

    function getAIValidatorCount() external view returns (uint256) {
        return aiValidatorCount;
    }

    // ═══════════════════════════════════════════
    //  Internal Helpers
    // ═══════════════════════════════════════════

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
}
