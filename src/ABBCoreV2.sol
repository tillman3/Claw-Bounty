// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./TaskRegistry.sol";
import "./BountyEscrow.sol";
import "./ValidatorPoolV2.sol";
import "./AgentRegistry.sol";

/// @title ABBCoreV2
/// @notice Orchestrator V2 — routes tasks to Micro/Standard/Premium validation tiers
///         based on bounty amount. Drop-in replacement for ABBCore.
/// @dev Key change from V1: submitWork() auto-selects tier via ValidatorPoolV2.getTier()
contract ABBCoreV2 is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State ---
    TaskRegistry public immutable taskRegistry;
    BountyEscrow public immutable bountyEscrow;
    ValidatorPoolV2 public immutable validatorPool;
    AgentRegistry public immutable agentRegistry;

    // Review timing config (Premium tier only — Standard/Micro don't use commit-reveal)
    uint64 public commitDuration = 1 days;
    uint64 public revealDuration = 1 days;
    uint64 public constant DISPUTE_WINDOW = 1 days;

    // Track rejection timestamps for dispute window
    mapping(uint256 => uint64) public rejectedAt;

    // Track which tier each task uses (for UX/API queries)
    mapping(uint256 => ValidatorPoolV2.ValidationTier) public taskTier;

    // --- Events ---
    event TaskCreatedAndFunded(uint256 indexed taskId, address indexed poster, uint256 amount, address token);
    event TaskClaimedByAgent(uint256 indexed taskId, uint256 indexed agentId);
    event WorkSubmittedForReview(uint256 indexed taskId, ValidatorPoolV2.ValidationTier tier);
    event ReviewFinalized(uint256 indexed taskId, bool accepted, uint8 medianScore);
    event DisputeRaised(uint256 indexed taskId, address indexed by);
    event DisputeResolved(uint256 indexed taskId, bool accepted);
    event TaskCancelledAndRefunded(uint256 indexed taskId);
    event TimingConfigured(uint64 commitDuration, uint64 revealDuration);

    // --- Errors ---
    error ZeroAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidDescription();
    error AgentNotActive();
    error NotPoster();
    error NotPosterOrAgent();
    error TaskNotInExpectedState();
    error ReviewNotFinalized();
    error TokenMismatch();
    error DisputeWindowActive();
    error DisputeWindowExpired();

    // --- Constructor ---
    constructor(
        address _owner,
        address _taskRegistry,
        address _bountyEscrow,
        address _validatorPool,
        address _agentRegistry
    ) Ownable(_owner) {
        if (_taskRegistry == address(0)) revert ZeroAddress();
        if (_bountyEscrow == address(0)) revert ZeroAddress();
        if (_validatorPool == address(0)) revert ZeroAddress();
        if (_agentRegistry == address(0)) revert ZeroAddress();

        taskRegistry = TaskRegistry(_taskRegistry);
        bountyEscrow = BountyEscrow(_bountyEscrow);
        validatorPool = ValidatorPoolV2(_validatorPool);
        agentRegistry = AgentRegistry(_agentRegistry);
    }

    // ═══════════════════════════════════════════
    //  Task Creation (unchanged from V1)
    // ═══════════════════════════════════════════

    function createTaskETH(bytes32 descriptionHash, uint64 deadline)
        external
        payable
        whenNotPaused
        returns (uint256 taskId)
    {
        if (msg.value == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (descriptionHash == bytes32(0)) revert InvalidDescription();

        taskId = taskRegistry.createTask(msg.sender, descriptionHash, msg.value, address(0), deadline);
        bountyEscrow.depositETH{value: msg.value}(taskId, msg.sender);

        emit TaskCreatedAndFunded(taskId, msg.sender, msg.value, address(0));
    }

    function createTaskToken(bytes32 descriptionHash, address token, uint256 amount, uint64 deadline)
        external
        whenNotPaused
        returns (uint256 taskId)
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (descriptionHash == bytes32(0)) revert InvalidDescription();

        taskId = taskRegistry.createTask(msg.sender, descriptionHash, amount, token, deadline);
        bountyEscrow.depositToken(taskId, msg.sender, token, amount);

        emit TaskCreatedAndFunded(taskId, msg.sender, amount, token);
    }

    // ═══════════════════════════════════════════
    //  Task Claiming (unchanged from V1)
    // ═══════════════════════════════════════════

    function claimTask(uint256 taskId, uint256 agentId) external whenNotPaused {
        AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.operator != msg.sender) revert NotPosterOrAgent();
        if (!agent.active) revert AgentNotActive();

        taskRegistry.claimTask(taskId, agentId);
        emit TaskClaimedByAgent(taskId, agentId);
    }

    // ═══════════════════════════════════════════
    //  Work Submission — V2 TIERED ROUTING
    // ═══════════════════════════════════════════

    /// @notice Submit work — automatically routes to correct validation tier
    /// @dev Micro: instant panel (no VRF). Standard/Premium: async VRF panel selection.
    /// @param taskId The task ID
    /// @param submissionHash IPFS hash of submission
    function submitWork(uint256 taskId, bytes32 submissionHash) external whenNotPaused {
        // Verify caller is operator of assigned agent
        uint256 agentId = taskRegistry.getAssignedAgent(taskId);
        AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.operator != msg.sender) revert NotPosterOrAgent();

        taskRegistry.submitWork(taskId, submissionHash);
        taskRegistry.setInReview(taskId);

        // Determine tier from bounty amount
        TaskRegistry.Task memory task = taskRegistry.getTask(taskId);
        ValidatorPoolV2.ValidationTier tier = validatorPool.getTier(task.bountyAmount);
        taskTier[taskId] = tier;

        if (tier == ValidatorPoolV2.ValidationTier.Micro) {
            // Instant: single AI validator, no VRF needed
            validatorPool.requestMicroPanel(taskId);
        } else if (tier == ValidatorPoolV2.ValidationTier.Standard) {
            // 3 validators via VRF, direct scoring
            uint256 vrfReqId = validatorPool.requestStandardPanel(taskId);
            (vrfReqId); // suppress unused warning — ID tracked in ValidatorPoolV2
        } else {
            // Premium: 5 validators, full commit-reveal
            uint256 vrfReqId = validatorPool.requestPremiumPanel(taskId, commitDuration, revealDuration);
            (vrfReqId);
        }

        emit WorkSubmittedForReview(taskId, tier);
    }

    // ═══════════════════════════════════════════
    //  Review Finalization (same logic, works with all tiers)
    // ═══════════════════════════════════════════

    function finalizeReview(uint256 taskId) external whenNotPaused nonReentrant {
        if (!validatorPool.isRoundFinalized(taskId)) {
            (bool _accepted, uint8 _median) = validatorPool.finalizeRound(taskId);
            (_accepted); // tracked via getRoundResult below
            (_median);
        }

        (bool accepted, uint8 medianScore) = validatorPool.getRoundResult(taskId);

        if (accepted) {
            taskRegistry.completeTask(taskId);
            uint256 agentId = taskRegistry.getAssignedAgent(taskId);
            AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
            bountyEscrow.release(taskId, agent.operator);

            TaskRegistry.Task memory task = taskRegistry.getTask(taskId);
            agentRegistry.recordOutcome(agentId, true, task.bountyAmount);
        } else {
            rejectedAt[taskId] = uint64(block.timestamp);
        }

        emit ReviewFinalized(taskId, accepted, medianScore);
    }

    // ═══════════════════════════════════════════
    //  Dispute + Refund (unchanged from V1)
    // ═══════════════════════════════════════════

    function claimRefundAfterRejection(uint256 taskId) external whenNotPaused nonReentrant {
        uint64 rejected = rejectedAt[taskId];
        if (rejected == 0) revert TaskNotInExpectedState();
        if (block.timestamp < rejected + DISPUTE_WINDOW) revert DisputeWindowActive();

        delete rejectedAt[taskId];

        uint256 agentId = taskRegistry.getAssignedAgent(taskId);
        agentRegistry.recordOutcome(agentId, false, 0);

        taskRegistry.disputeTask(taskId, address(this));
        taskRegistry.resolveDispute(taskId, false);
        bountyEscrow.refund(taskId);

        emit TaskCancelledAndRefunded(taskId);
    }

    function cancelTask(uint256 taskId) external whenNotPaused {
        address poster = taskRegistry.getTaskPoster(taskId);
        if (poster != msg.sender) revert NotPoster();

        taskRegistry.cancelTask(taskId, msg.sender);
        bountyEscrow.refund(taskId);

        emit TaskCancelledAndRefunded(taskId);
    }

    function raiseDispute(uint256 taskId) external whenNotPaused {
        address poster = taskRegistry.getTaskPoster(taskId);
        uint256 agentId = taskRegistry.getAssignedAgent(taskId);
        AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);

        if (msg.sender != poster && msg.sender != agent.operator) revert NotPosterOrAgent();

        taskRegistry.disputeTask(taskId, msg.sender);
        emit DisputeRaised(taskId, msg.sender);
    }

    function resolveDispute(uint256 taskId, bool accepted) external onlyOwner {
        taskRegistry.resolveDispute(taskId, accepted);

        uint256 agentId = taskRegistry.getAssignedAgent(taskId);
        AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);

        if (accepted) {
            bountyEscrow.release(taskId, agent.operator);
            TaskRegistry.Task memory task = taskRegistry.getTask(taskId);
            agentRegistry.recordOutcome(agentId, true, task.bountyAmount);
        } else {
            bountyEscrow.refund(taskId);
            agentRegistry.recordOutcome(agentId, false, 0);
        }

        emit DisputeResolved(taskId, accepted);
    }

    function reclaimExpiredTask(uint256 taskId) external whenNotPaused {
        address poster = taskRegistry.getTaskPoster(taskId);
        if (poster != msg.sender) revert NotPoster();

        taskRegistry.reclaimExpiredTask(taskId);
        bountyEscrow.refund(taskId);
    }

    // ═══════════════════════════════════════════
    //  Config + Admin
    // ═══════════════════════════════════════════

    function configureTiming(uint64 _commitDuration, uint64 _revealDuration) external onlyOwner {
        commitDuration = _commitDuration;
        revealDuration = _revealDuration;
        emit TimingConfigured(_commitDuration, _revealDuration);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════
    //  View Helpers
    // ═══════════════════════════════════════════

    /// @notice Get the validation tier for a task
    function getTaskTier(uint256 taskId) external view returns (ValidatorPoolV2.ValidationTier) {
        return taskTier[taskId];
    }
}
