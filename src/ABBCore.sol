// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./TaskRegistry.sol";
import "./BountyEscrow.sol";
import "./ValidatorPool.sol";
import "./AgentRegistry.sol";

/// @title ABBCore
/// @notice Orchestrator contract tying TaskRegistry, BountyEscrow, ValidatorPool, and AgentRegistry together
/// @dev Handles the full workflow: create task → escrow funds → agent claims → submits → validators review → payout or dispute
contract ABBCore is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State ---
    TaskRegistry public immutable taskRegistry;
    BountyEscrow public immutable bountyEscrow;
    ValidatorPool public immutable validatorPool;
    AgentRegistry public immutable agentRegistry;

    // Review timing config
    uint64 public commitDuration = 1 days;
    uint64 public revealDuration = 1 days;

    // --- Events ---
    event TaskCreatedAndFunded(uint256 indexed taskId, address indexed poster, uint256 amount, address token);
    event TaskClaimedByAgent(uint256 indexed taskId, uint256 indexed agentId);
    event WorkSubmittedForReview(uint256 indexed taskId);
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
        validatorPool = ValidatorPool(_validatorPool);
        agentRegistry = AgentRegistry(_agentRegistry);
    }

    // --- Core Workflow ---

    /// @notice Create a task and escrow ETH
    /// @param descriptionHash IPFS hash of task description
    /// @param deadline Task deadline
    /// @return taskId The created task ID
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

    /// @notice Create a task and escrow ERC20 tokens
    /// @param descriptionHash IPFS hash of task description
    /// @param token Payment token address
    /// @param amount Bounty amount
    /// @param deadline Task deadline
    /// @return taskId The created task ID
    function createTaskToken(bytes32 descriptionHash, address token, uint256 amount, uint64 deadline)
        external
        whenNotPaused
        returns (uint256 taskId)
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (descriptionHash == bytes32(0)) revert InvalidDescription();

        // Approve this contract to spend tokens first
        taskId = taskRegistry.createTask(msg.sender, descriptionHash, amount, token, deadline);
        bountyEscrow.depositToken(taskId, msg.sender, token, amount);

        emit TaskCreatedAndFunded(taskId, msg.sender, amount, token);
    }

    /// @notice Claim a task with a registered agent
    /// @param taskId The task to claim
    /// @param agentId The agent ID to assign
    function claimTask(uint256 taskId, uint256 agentId) external whenNotPaused {
        // Verify caller is the agent's operator
        AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.operator != msg.sender) revert NotPosterOrAgent();
        if (!agent.active) revert AgentNotActive();

        taskRegistry.claimTask(taskId, agentId);

        emit TaskClaimedByAgent(taskId, agentId);
    }

    /// @notice Submit work and initiate validator review
    /// @param taskId The task ID
    /// @param submissionHash IPFS hash of submission
    function submitWork(uint256 taskId, bytes32 submissionHash) external whenNotPaused {
        // Verify caller is operator of assigned agent
        uint256 agentId = taskRegistry.getAssignedAgent(taskId);
        AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.operator != msg.sender) revert NotPosterOrAgent();

        taskRegistry.submitWork(taskId, submissionHash);
        taskRegistry.setInReview(taskId);

        // Select validator panel
        validatorPool.selectPanel(taskId, commitDuration, revealDuration);

        emit WorkSubmittedForReview(taskId);
    }

    /// @notice Finalize review and process payment or refund
    /// @param taskId The task ID
    function finalizeReview(uint256 taskId) external whenNotPaused nonReentrant {
        if (!validatorPool.isRoundFinalized(taskId)) {
            // Try to finalize the round
            validatorPool.finalizeRound(taskId);
        }

        (bool accepted, uint8 medianScore) = validatorPool.getRoundResult(taskId);

        if (accepted) {
            taskRegistry.completeTask(taskId);
            // Get agent address for payment
            uint256 agentId = taskRegistry.getAssignedAgent(taskId);
            AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
            bountyEscrow.release(taskId, agent.operator);

            // Update agent reputation
            TaskRegistry.Task memory task = taskRegistry.getTask(taskId);
            agentRegistry.recordOutcome(agentId, true, task.bountyAmount);
        } else {
            // Rejected — refund poster
            taskRegistry.disputeTask(taskId, address(this));
            taskRegistry.resolveDispute(taskId, false);
            bountyEscrow.refund(taskId);

            uint256 agentId = taskRegistry.getAssignedAgent(taskId);
            agentRegistry.recordOutcome(agentId, false, 0);
        }

        emit ReviewFinalized(taskId, accepted, medianScore);
    }

    /// @notice Cancel an open task and refund
    /// @param taskId The task to cancel
    function cancelTask(uint256 taskId) external whenNotPaused {
        address poster = taskRegistry.getTaskPoster(taskId);
        if (poster != msg.sender) revert NotPoster();

        taskRegistry.cancelTask(taskId, msg.sender);
        bountyEscrow.refund(taskId);

        emit TaskCancelledAndRefunded(taskId);
    }

    /// @notice Raise a dispute on a task in review
    /// @param taskId The task to dispute
    function raiseDispute(uint256 taskId) external whenNotPaused {
        address poster = taskRegistry.getTaskPoster(taskId);
        uint256 agentId = taskRegistry.getAssignedAgent(taskId);
        AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);

        if (msg.sender != poster && msg.sender != agent.operator) revert NotPosterOrAgent();

        taskRegistry.disputeTask(taskId, msg.sender);

        emit DisputeRaised(taskId, msg.sender);
    }

    /// @notice Resolve a dispute (owner only for now)
    /// @param taskId The task ID
    /// @param accepted Whether to accept the work
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

    // --- Config ---

    /// @notice Configure review timing
    /// @param _commitDuration Duration for commit phase
    /// @param _revealDuration Duration for reveal phase
    function configureTiming(uint64 _commitDuration, uint64 _revealDuration) external onlyOwner {
        commitDuration = _commitDuration;
        revealDuration = _revealDuration;
        emit TimingConfigured(_commitDuration, _revealDuration);
    }

    // --- Admin ---
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
