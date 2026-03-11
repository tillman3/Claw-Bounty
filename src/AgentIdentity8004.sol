// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title AgentIdentity8004
/// @notice ERC-8004 compliant Identity Registry — every AI agent gets an ERC-721 NFT
///         identity with on-chain metadata and URI pointing to registration file.
/// @dev Implements the ERC-8004 Identity Registry specification:
///      - ERC-721 + URIStorage for portable agent identities
///      - On-chain metadata (getMetadata/setMetadata)
///      - Agent wallet verification via EIP-712 signatures
///      - Registration file URI resolution
contract AgentIdentity8004 is ERC721URIStorage, Ownable2Step, Pausable, EIP712 {
    using ECDSA for bytes32;

    // ═══════════════════════════════════════════
    //  State
    // ═══════════════════════════════════════════

    uint256 private _nextAgentId = 1;

    // On-chain metadata: agentId => metadataKey => metadataValue
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    // Agent wallet: agentId => verified wallet address
    mapping(uint256 => address) private _agentWallets;

    // Link to existing AgentRegistry for reputation data migration
    address public legacyRegistry;

    // Authorized contracts that can register on behalf of agents
    mapping(address => bool) public authorizedCallers;

    // EIP-712 typehash for wallet verification
    bytes32 public constant WALLET_TYPEHASH =
        keccak256("SetAgentWallet(uint256 agentId,address newWallet,uint256 deadline)");

    // ═══════════════════════════════════════════
    //  Events (ERC-8004 spec)
    // ═══════════════════════════════════════════

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );
    event AgentWalletSet(uint256 indexed agentId, address indexed newWallet);
    event AgentWalletCleared(uint256 indexed agentId);
    event AuthorizedCallerSet(address indexed caller, bool authorized);

    // ═══════════════════════════════════════════
    //  Errors
    // ═══════════════════════════════════════════

    error NotAgentOwnerOrApproved();
    error ReservedMetadataKey();
    error InvalidSignature();
    error DeadlineExpired();
    error CannotFeedbackOwnAgent();
    error NotAuthorized();
    error ZeroAddress();

    // ═══════════════════════════════════════════
    //  Structs (ERC-8004 spec)
    // ═══════════════════════════════════════════

    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    // ═══════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════

    constructor(address _owner)
        ERC721("AgentEcon Identity", "AEID")
        Ownable(_owner)
        EIP712("AgentEcon Identity", "1")
    {}

    // ═══════════════════════════════════════════
    //  Registration (ERC-8004 spec)
    // ═══════════════════════════════════════════

    /// @notice Register a new agent with URI and optional metadata
    /// @param agentURI URI pointing to the agent registration file (IPFS, HTTPS, or data:)
    /// @param metadata Array of initial metadata entries
    /// @return agentId The minted token ID
    function register(string calldata agentURI, MetadataEntry[] calldata metadata)
        external
        whenNotPaused
        returns (uint256 agentId)
    {
        agentId = _nextAgentId++;
        _safeMint(msg.sender, agentId);

        if (bytes(agentURI).length > 0) {
            _setTokenURI(agentId, agentURI);
        }

        // Set agentWallet to owner by default
        _agentWallets[agentId] = msg.sender;
        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(msg.sender));

        // Set additional metadata
        for (uint256 i; i < metadata.length; i++) {
            if (_isReservedKey(metadata[i].metadataKey)) revert ReservedMetadataKey();
            _metadata[agentId][metadata[i].metadataKey] = metadata[i].metadataValue;
            emit MetadataSet(agentId, metadata[i].metadataKey, metadata[i].metadataKey, metadata[i].metadataValue);
        }

        emit Registered(agentId, agentURI, msg.sender);
    }

    /// @notice Register with just a URI
    function register(string calldata agentURI)
        external
        whenNotPaused
        returns (uint256 agentId)
    {
        agentId = _nextAgentId++;
        _safeMint(msg.sender, agentId);

        if (bytes(agentURI).length > 0) {
            _setTokenURI(agentId, agentURI);
        }

        _agentWallets[agentId] = msg.sender;
        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(msg.sender));
        emit Registered(agentId, agentURI, msg.sender);
    }

    /// @notice Register with no URI (set later)
    function register() external whenNotPaused returns (uint256 agentId) {
        agentId = _nextAgentId++;
        _safeMint(msg.sender, agentId);

        _agentWallets[agentId] = msg.sender;
        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(msg.sender));
        emit Registered(agentId, "", msg.sender);
    }

    // ═══════════════════════════════════════════
    //  URI Management
    // ═══════════════════════════════════════════

    /// @notice Update the agent's registration URI
    function setAgentURI(uint256 agentId, string calldata newURI) external {
        _requireOwnerOrApproved(agentId);
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    // ═══════════════════════════════════════════
    //  On-Chain Metadata (ERC-8004 spec)
    // ═══════════════════════════════════════════

    /// @notice Get on-chain metadata for an agent
    function getMetadata(uint256 agentId, string calldata metadataKey)
        external
        view
        returns (bytes memory)
    {
        if (keccak256(bytes(metadataKey)) == keccak256("agentWallet")) {
            return abi.encodePacked(_agentWallets[agentId]);
        }
        return _metadata[agentId][metadataKey];
    }

    /// @notice Set on-chain metadata
    function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue) external {
        _requireOwnerOrApproved(agentId);
        if (_isReservedKey(metadataKey)) revert ReservedMetadataKey();

        _metadata[agentId][metadataKey] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    // ═══════════════════════════════════════════
    //  Agent Wallet (EIP-712 verified)
    // ═══════════════════════════════════════════

    /// @notice Set agent wallet with EIP-712 signature proof of new wallet ownership
    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _requireOwnerOrApproved(agentId);
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (newWallet == address(0)) revert ZeroAddress();

        // Verify the new wallet signed the authorization
        bytes32 structHash = keccak256(abi.encode(WALLET_TYPEHASH, agentId, newWallet, deadline));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, signature);
        if (signer != newWallet) revert InvalidSignature();

        _agentWallets[agentId] = newWallet;
        emit AgentWalletSet(agentId, newWallet);
    }

    /// @notice Get the verified wallet address for an agent
    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _agentWallets[agentId];
    }

    /// @notice Clear the agent wallet (reset to zero)
    function unsetAgentWallet(uint256 agentId) external {
        _requireOwnerOrApproved(agentId);
        delete _agentWallets[agentId];
        emit AgentWalletCleared(agentId);
    }

    // ═══════════════════════════════════════════
    //  Transfer Hook — clear wallet on transfer
    // ═══════════════════════════════════════════

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);
        // Clear agentWallet on transfer (ERC-8004 spec)
        if (from != address(0) && to != address(0) && from != to) {
            delete _agentWallets[tokenId];
            emit AgentWalletCleared(tokenId);
        }
        return from;
    }

    // ═══════════════════════════════════════════
    //  Admin
    // ═══════════════════════════════════════════

    function setLegacyRegistry(address _legacyRegistry) external onlyOwner {
        if (_legacyRegistry == address(0)) revert ZeroAddress();
        legacyRegistry = _legacyRegistry;
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ═══════════════════════════════════════════
    //  View
    // ═══════════════════════════════════════════

    function totalAgents() external view returns (uint256) {
        return _nextAgentId - 1;
    }

    // ═══════════════════════════════════════════
    //  Internal
    // ═══════════════════════════════════════════

    function _requireOwnerOrApproved(uint256 agentId) internal view {
        if (
            ownerOf(agentId) != msg.sender &&
            getApproved(agentId) != msg.sender &&
            !isApprovedForAll(ownerOf(agentId), msg.sender)
        ) revert NotAgentOwnerOrApproved();
    }

    function _isReservedKey(string memory key) internal pure returns (bool) {
        return keccak256(bytes(key)) == keccak256("agentWallet");
    }
}
