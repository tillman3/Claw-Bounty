// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title TaskRegistry
/// @notice Core state machine for task lifecycle management
/// @dev State transitions: Open → Claimed → Submitted → InReview → Completed | Disputed → Resolved | Cancelled
contract TaskRegistry is Ownable2Step, Pausable {
    // --- Enums ---
    enum TaskState { Open, Claimed, Submitted, InReview, Completed, Disputed, Resolved, Cancelled }

    // --- Structs ---
    struct Task {
        uint256 id;
        address poster;
        bytes32 descriptionHash; // IPFS CID hash
        uint256 bountyAmount;
        address paymentToken; // address(0) = ETH
        uint64 deadline;
        TaskState state;
        uint256 assignedAgent; // agent ID from AgentRegistry
        bytes32 submissionHash; // IPFS CID of submission
        uint64 createdAt;
        uint64 claimedAt;
        uint64 submittedAt;
    }

    // --- State ---
    uint256 public nextTaskId;
    mapping(uint256 => Task) internal _tasks;
    mapping(uint256 => bool) public taskExists;

    // Authorized callers (ABBCore)
    mapping(address => bool) public authorizedCallers;

    // --- Events ---
    event TaskCreated(uint256 indexed taskId, address indexed poster, uint256 bountyAmount, address paymentToken, uint64 deadline);
    event TaskClaimed(uint256 indexed taskId, uint256 indexed agentId, address claimedBy);
    event WorkSubmitted(uint256 indexed taskId, bytes32 submissionHash);
    event TaskInReview(uint256 indexed taskId);
    event TaskCompleted(uint256 indexed taskId);
    event TaskDisputed(uint256 indexed taskId, address disputedBy);
    event TaskResolved(uint256 indexed taskId, bool accepted);
    event TaskCancelled(uint256 indexed taskId, address cancelledBy);
    event AuthorizedCallerSet(address indexed caller, bool authorized);

    // --- Errors ---
    error ZeroAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidDescription();
    error TaskNotFound();
    error InvalidStateTransition();
    error NotPoster();
    error NotAuthorized();
    error DeadlinePassed();

    // --- Modifiers ---
    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    modifier inState(uint256 taskId, TaskState expected) {
        if (!taskExists[taskId]) revert TaskNotFound();
        if (_tasks[taskId].state != expected) revert InvalidStateTransition();
        _;
    }

    // --- Constructor ---
    constructor(address _owner) Ownable(_owner) {}

    // --- External Functions ---

    /// @notice Create a new task
    /// @param poster Address of the task poster
    /// @param descriptionHash IPFS hash of task description
    /// @param bountyAmount Bounty amount in payment token
    /// @param paymentToken Token address (address(0) for ETH)
    /// @param deadline Unix timestamp deadline
    /// @return taskId The newly created task ID
    function createTask(
        address poster,
        bytes32 descriptionHash,
        uint256 bountyAmount,
        address paymentToken,
        uint64 deadline
    ) external onlyAuthorized whenNotPaused returns (uint256 taskId) {
        if (poster == address(0)) revert ZeroAddress();
        if (bountyAmount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (descriptionHash == bytes32(0)) revert InvalidDescription();

        taskId = nextTaskId++;
        _tasks[taskId] = Task({
            id: taskId,
            poster: poster,
            descriptionHash: descriptionHash,
            bountyAmount: bountyAmount,
            paymentToken: paymentToken,
            deadline: deadline,
            state: TaskState.Open,
            assignedAgent: 0,
            submissionHash: bytes32(0),
            createdAt: uint64(block.timestamp),
            claimedAt: 0,
            submittedAt: 0
        });
        taskExists[taskId] = true;

        emit TaskCreated(taskId, poster, bountyAmount, paymentToken, deadline);
    }

    /// @notice Claim a task (assigns an agent)
    /// @param taskId The task to claim
    /// @param agentId The agent ID claiming the task
    function claimTask(uint256 taskId, uint256 agentId) external onlyAuthorized inState(taskId, TaskState.Open) {
        Task storage task = _tasks[taskId];
        if (block.timestamp >= task.deadline) revert DeadlinePassed();

        task.state = TaskState.Claimed;
        task.assignedAgent = agentId;
        task.claimedAt = uint64(block.timestamp);

        emit TaskClaimed(taskId, agentId, msg.sender);
    }

    /// @notice Submit work for a task
    /// @param taskId The task to submit work for
    /// @param submissionHash IPFS hash of the submission
    function submitWork(uint256 taskId, bytes32 submissionHash) external onlyAuthorized inState(taskId, TaskState.Claimed) {
        if (submissionHash == bytes32(0)) revert InvalidDescription();
        Task storage task = _tasks[taskId];
        if (block.timestamp >= task.deadline) revert DeadlinePassed();

        task.state = TaskState.Submitted;
        task.submissionHash = submissionHash;
        task.submittedAt = uint64(block.timestamp);

        emit WorkSubmitted(taskId, submissionHash);
    }

    /// @notice Move task to InReview state
    /// @param taskId The task ID
    function setInReview(uint256 taskId) external onlyAuthorized inState(taskId, TaskState.Submitted) {
        _tasks[taskId].state = TaskState.InReview;
        emit TaskInReview(taskId);
    }

    /// @notice Complete a task (verification passed)
    /// @param taskId The task ID
    function completeTask(uint256 taskId) external onlyAuthorized inState(taskId, TaskState.InReview) {
        _tasks[taskId].state = TaskState.Completed;
        emit TaskCompleted(taskId);
    }

    /// @notice Mark task as disputed
    /// @param taskId The task ID
    /// @param disputedBy Who raised the dispute
    function disputeTask(uint256 taskId, address disputedBy) external onlyAuthorized {
        if (!taskExists[taskId]) revert TaskNotFound();
        TaskState current = _tasks[taskId].state;
        // Can dispute from InReview or Submitted
        if (current != TaskState.InReview && current != TaskState.Submitted) revert InvalidStateTransition();

        _tasks[taskId].state = TaskState.Disputed;
        emit TaskDisputed(taskId, disputedBy);
    }

    /// @notice Resolve a disputed task
    /// @param taskId The task ID
    /// @param accepted Whether the work was accepted
    function resolveDispute(uint256 taskId, bool accepted) external onlyAuthorized inState(taskId, TaskState.Disputed) {
        _tasks[taskId].state = TaskState.Resolved;
        emit TaskResolved(taskId, accepted);
    }

    /// @notice Cancel a task (only if Open)
    /// @param taskId The task to cancel
    /// @param cancelledBy Who cancelled (must be poster, enforced by ABBCore)
    function cancelTask(uint256 taskId, address cancelledBy) external onlyAuthorized inState(taskId, TaskState.Open) {
        _tasks[taskId].state = TaskState.Cancelled;
        emit TaskCancelled(taskId, cancelledBy);
    }

    /// @notice Set authorized caller
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    // --- View Functions ---

    /// @notice Get task details
    function getTask(uint256 taskId) external view returns (Task memory) {
        if (!taskExists[taskId]) revert TaskNotFound();
        return _tasks[taskId];
    }

    /// @notice Get task state
    function getTaskState(uint256 taskId) external view returns (TaskState) {
        if (!taskExists[taskId]) revert TaskNotFound();
        return _tasks[taskId].state;
    }

    /// @notice Get task poster
    function getTaskPoster(uint256 taskId) external view returns (address) {
        if (!taskExists[taskId]) revert TaskNotFound();
        return _tasks[taskId].poster;
    }

    /// @notice Get assigned agent for a task
    function getAssignedAgent(uint256 taskId) external view returns (uint256) {
        if (!taskExists[taskId]) revert TaskNotFound();
        return _tasks[taskId].assignedAgent;
    }

    // --- Admin ---
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
