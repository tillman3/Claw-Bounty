// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title AgentRegistry
/// @notice Manages AI agent registration, operator mappings, and reputation scores
/// @dev One operator can register multiple agents. Each agent has a unique ID.
contract AgentRegistry is Ownable2Step, Pausable {
    // --- Structs ---
    struct Agent {
        uint256 id;
        address operator;
        bytes32 metadataHash; // IPFS hash of agent capabilities/description
        uint256 reputationScore; // 0-10000 basis points
        uint256 tasksCompleted;
        uint256 tasksFailed;
        uint256 totalEarned;
        uint64 registeredAt;
        bool active;
    }

    // --- Constants ---
    uint256 public constant MAX_REPUTATION = 10_000;
    uint256 public constant INITIAL_REPUTATION = 1_000;

    // --- State ---
    uint256 public nextAgentId = 1; // M-3 FIX: Start at 1 so ID 0 means "no agent"
    mapping(uint256 => Agent) internal _agents;
    mapping(address => uint256[]) public operatorAgents; // operator => agent IDs
    mapping(uint256 => bool) public agentExists;

    // Authorized callers (ABBCore)
    mapping(address => bool) public authorizedCallers;

    // --- Events ---
    event AgentRegistered(uint256 indexed agentId, address indexed operator, bytes32 metadataHash);
    event AgentDeregistered(uint256 indexed agentId, address indexed operator);
    event AgentMetadataUpdated(uint256 indexed agentId, bytes32 newMetadataHash);
    event ReputationUpdated(uint256 indexed agentId, uint256 oldScore, uint256 newScore);
    event AuthorizedCallerSet(address indexed caller, bool authorized);

    // --- Errors ---
    error ZeroAddress();
    error InvalidMetadata();
    error AgentNotFound();
    error AgentNotActive();
    error NotOperator();
    error NotAuthorized();

    // --- Modifiers ---
    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    modifier onlyOperatorOf(uint256 agentId) {
        if (!agentExists[agentId]) revert AgentNotFound();
        if (_agents[agentId].operator != msg.sender) revert NotOperator();
        _;
    }

    // --- Constructor ---
    constructor(address _owner) Ownable(_owner) {}

    // --- External Functions ---

    /// @notice Register a new agent
    /// @param metadataHash IPFS hash of agent metadata
    /// @return agentId The newly created agent ID
    function registerAgent(bytes32 metadataHash) external whenNotPaused returns (uint256 agentId) {
        if (metadataHash == bytes32(0)) revert InvalidMetadata();

        agentId = nextAgentId++;
        _agents[agentId] = Agent({
            id: agentId,
            operator: msg.sender,
            metadataHash: metadataHash,
            reputationScore: INITIAL_REPUTATION,
            tasksCompleted: 0,
            tasksFailed: 0,
            totalEarned: 0,
            registeredAt: uint64(block.timestamp),
            active: true
        });
        agentExists[agentId] = true;
        operatorAgents[msg.sender].push(agentId);

        emit AgentRegistered(agentId, msg.sender, metadataHash);
    }

    /// @notice Deregister an agent (operator only)
    /// @param agentId The agent to deregister
    function deregisterAgent(uint256 agentId) external onlyOperatorOf(agentId) {
        _agents[agentId].active = false;
        emit AgentDeregistered(agentId, msg.sender);
    }

    /// @notice Update agent metadata
    /// @param agentId The agent to update
    /// @param newMetadataHash New IPFS metadata hash
    function updateMetadata(uint256 agentId, bytes32 newMetadataHash) external onlyOperatorOf(agentId) {
        if (newMetadataHash == bytes32(0)) revert InvalidMetadata();
        _agents[agentId].metadataHash = newMetadataHash;
        emit AgentMetadataUpdated(agentId, newMetadataHash);
    }

    /// @notice Record task outcome — updates reputation and stats
    /// @param agentId The agent
    /// @param success Whether the task was completed successfully
    /// @param earned Amount earned (0 if failed)
    function recordOutcome(uint256 agentId, bool success, uint256 earned) external onlyAuthorized {
        if (!agentExists[agentId]) revert AgentNotFound();
        Agent storage agent = _agents[agentId];

        uint256 oldScore = agent.reputationScore;
        if (success) {
            agent.tasksCompleted++;
            agent.totalEarned += earned;
            // Increase reputation: +100 bps, capped at MAX
            uint256 increase = 100;
            if (agent.reputationScore + increase > MAX_REPUTATION) {
                agent.reputationScore = MAX_REPUTATION;
            } else {
                agent.reputationScore += increase;
            }
        } else {
            agent.tasksFailed++;
            // Decrease reputation: -200 bps, floor at 0
            if (agent.reputationScore < 200) {
                agent.reputationScore = 0;
            } else {
                agent.reputationScore -= 200;
            }
        }

        emit ReputationUpdated(agentId, oldScore, agent.reputationScore);
    }

    /// @notice Set authorized caller (ABBCore)
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    // --- View Functions ---

    /// @notice Get agent details
    function getAgent(uint256 agentId) external view returns (Agent memory) {
        if (!agentExists[agentId]) revert AgentNotFound();
        return _agents[agentId];
    }

    /// @notice Check if an agent is active and registered
    function isActiveAgent(uint256 agentId) external view returns (bool) {
        return agentExists[agentId] && _agents[agentId].active;
    }

    /// @notice Get operator's agent IDs
    function getOperatorAgents(address operator) external view returns (uint256[] memory) {
        return operatorAgents[operator];
    }

    /// @notice Get agent reputation score
    function getReputation(uint256 agentId) external view returns (uint256) {
        if (!agentExists[agentId]) revert AgentNotFound();
        return _agents[agentId].reputationScore;
    }

    // --- Admin ---
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
