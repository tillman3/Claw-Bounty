// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./AgentIdentity8004.sol";

/// @title ReputationRegistry8004
/// @notice ERC-8004 compliant Reputation Registry — standard interface for posting
///         and fetching feedback signals about AI agents.
/// @dev Feedback is stored on-chain for composability. Off-chain files (IPFS) for
///      rich data. Aggregation can happen both on-chain and off-chain.
contract ReputationRegistry8004 is Ownable2Step, Pausable {
    // ═══════════════════════════════════════════
    //  State
    // ═══════════════════════════════════════════

    AgentIdentity8004 public immutable identityRegistry;

    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
        uint64 feedbackIndex; // 1-indexed per (clientAddress, agentId) pair
        uint64 timestamp;
    }

    // agentId => clientAddress => feedbackIndex => Feedback
    mapping(uint256 => mapping(address => mapping(uint64 => Feedback))) public feedbacks;

    // agentId => clientAddress => total feedback count
    mapping(uint256 => mapping(address => uint64)) public feedbackCount;

    // agentId => total feedback count from all clients
    mapping(uint256 => uint256) public totalFeedbackCount;

    // On-chain aggregation: agentId => running weighted score (sum of values)
    mapping(uint256 => int256) public aggregateScore;
    mapping(uint256 => uint256) public aggregateCount;

    // Authorized feedback sources (e.g., ValidatorPool, ABBCore)
    mapping(address => bool) public authorizedSources;

    // ═══════════════════════════════════════════
    //  Events (ERC-8004 spec)
    // ═══════════════════════════════════════════

    event NewFeedback(
        uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals
    );

    event FeedbackTags(uint256 indexed agentId, uint64 feedbackIndex, string tag1, string tag2);

    event FeedbackDetails(
        uint256 indexed agentId, uint64 feedbackIndex, string endpoint, string feedbackURI, bytes32 feedbackHash
    );

    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex);

    event AuthorizedSourceSet(address indexed source, bool authorized);

    // ═══════════════════════════════════════════
    //  Errors
    // ═══════════════════════════════════════════

    error InvalidValueDecimals();
    error CannotFeedbackOwnAgent();
    error AgentNotRegistered();
    error FeedbackNotFound();
    error AlreadyRevoked();
    error NotFeedbackAuthor();
    error ZeroAddress();

    /// @dev Input struct to avoid stack-too-deep in giveFeedback
    struct FeedbackInput {
        uint256 agentId;
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        string endpoint;
        string feedbackURI;
        bytes32 feedbackHash;
    }

    // ═══════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════

    constructor(address _owner, address _identityRegistry) Ownable(_owner) {
        if (_identityRegistry == address(0)) revert ZeroAddress();
        identityRegistry = AgentIdentity8004(_identityRegistry);
    }

    // ═══════════════════════════════════════════
    //  ERC-8004 Reputation Interface
    // ═══════════════════════════════════════════

    /// @notice Give feedback to an agent (ERC-8004 spec)
    /// @param input FeedbackInput struct with agentId, value, tags, endpoint, URI, hash
    function giveFeedback(FeedbackInput calldata input) external whenNotPaused {
        if (input.valueDecimals > 18) revert InvalidValueDecimals();
        address agentOwner = identityRegistry.ownerOf(input.agentId);
        if (agentOwner == address(0)) revert AgentNotRegistered();
        if (agentOwner == msg.sender) revert CannotFeedbackOwnAgent();

        uint64 idx =
            _recordFeedback(input.agentId, msg.sender, input.value, input.valueDecimals, input.tag1, input.tag2);

        emit NewFeedback(input.agentId, msg.sender, idx, input.value, input.valueDecimals);
        if (bytes(input.tag1).length > 0 || bytes(input.tag2).length > 0) {
            emit FeedbackTags(input.agentId, idx, input.tag1, input.tag2);
        }
        if (bytes(input.endpoint).length > 0 || bytes(input.feedbackURI).length > 0 || input.feedbackHash != bytes32(0))
        {
            emit FeedbackDetails(input.agentId, idx, input.endpoint, input.feedbackURI, input.feedbackHash);
        }
    }

    /// @notice Authorized contracts can submit feedback (e.g., ValidatorPool after scoring)
    function giveFeedbackFrom(
        uint256 agentId,
        address clientAddress,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2
    ) external whenNotPaused {
        if (!authorizedSources[msg.sender]) revert NotFeedbackAuthor();
        if (valueDecimals > 18) revert InvalidValueDecimals();

        uint64 idx = _recordFeedback(agentId, clientAddress, value, valueDecimals, tag1, tag2);

        emit NewFeedback(agentId, clientAddress, idx, value, valueDecimals);
        if (bytes(tag1).length > 0 || bytes(tag2).length > 0) {
            emit FeedbackTags(agentId, idx, tag1, tag2);
        }
    }

    /// @dev Internal helper to record feedback and update aggregation
    function _recordFeedback(
        uint256 agentId,
        address clientAddress,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2
    ) internal returns (uint64 idx) {
        idx = feedbackCount[agentId][clientAddress] + 1;
        feedbackCount[agentId][clientAddress] = idx;
        totalFeedbackCount[agentId]++;

        feedbacks[agentId][clientAddress][idx] = Feedback({
            value: value,
            valueDecimals: valueDecimals,
            tag1: tag1,
            tag2: tag2,
            isRevoked: false,
            feedbackIndex: idx,
            timestamp: uint64(block.timestamp)
        });

        aggregateScore[agentId] += int256(value);
        aggregateCount[agentId]++;
    }

    /// @notice Revoke a previously given feedback
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        Feedback storage fb = feedbacks[agentId][msg.sender][feedbackIndex];
        if (fb.feedbackIndex == 0) revert FeedbackNotFound();
        if (fb.isRevoked) revert AlreadyRevoked();

        fb.isRevoked = true;

        // Remove from aggregation
        aggregateScore[agentId] -= int256(fb.value);
        aggregateCount[agentId]--;

        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    // ═══════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════

    /// @notice Get the identity registry address (ERC-8004 spec)
    function getIdentityRegistry() external view returns (address) {
        return address(identityRegistry);
    }

    /// @notice Get feedback from a specific client
    function getFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (Feedback memory)
    {
        return feedbacks[agentId][clientAddress][feedbackIndex];
    }

    /// @notice Get aggregate reputation score for an agent
    function getAggregateScore(uint256 agentId) external view returns (int256 score, uint256 count) {
        return (aggregateScore[agentId], aggregateCount[agentId]);
    }

    /// @notice Get average score (scaled by 100 for precision)
    function getAverageScore(uint256 agentId) external view returns (int256) {
        if (aggregateCount[agentId] == 0) return 0;
        return (aggregateScore[agentId] * 100) / int256(aggregateCount[agentId]);
    }

    // ═══════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════

    function setAuthorizedSource(address source, bool authorized) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        authorizedSources[source] = authorized;
        emit AuthorizedSourceSet(source, authorized);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
