// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BountyEscrow
/// @notice Holds bounty funds in escrow, releases on completion, refunds on cancellation
/// @dev Uses pull payment pattern, ReentrancyGuard, and checks-effects-interactions
contract BountyEscrow is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Structs ---
    struct EscrowEntry {
        address depositor;
        address paymentToken; // address(0) = ETH
        uint256 amount;
        bool released;
        bool refunded;
    }

    // --- Constants ---
    uint256 public constant MAX_FEE_BPS = 1_000; // 10% hard cap

    // --- State ---
    mapping(uint256 => EscrowEntry) public escrows; // taskId => escrow
    uint256 public totalLockedETH;
    mapping(address => uint256) public totalLockedToken; // token => total locked

    // Pull payment balances
    mapping(address => uint256) public ethPayable; // address => claimable ETH
    mapping(address => mapping(address => uint256)) public tokenPayable; // address => token => claimable

    // Fee configuration
    uint256 public feeBps; // platform fee in basis points
    address public feeRecipient;

    // Authorized callers (ABBCore)
    mapping(address => bool) public authorizedCallers;

    // --- Events ---
    event Deposited(uint256 indexed taskId, address indexed depositor, address token, uint256 amount);
    event Released(uint256 indexed taskId, address indexed beneficiary, uint256 agentAmount, uint256 feeAmount);
    event Refunded(uint256 indexed taskId, address indexed depositor, uint256 amount);
    event FeeConfigured(uint256 feeBps, address feeRecipient);
    event Withdrawn(address indexed to, address token, uint256 amount);
    event AuthorizedCallerSet(address indexed caller, bool authorized);

    // --- Errors ---
    error ZeroAddress();
    error InvalidAmount();
    error InvalidFee();
    error AlreadyReleased();
    error AlreadyRefunded();
    error EscrowNotFound();
    error NotAuthorized();
    error TransferFailed();
    error NothingToWithdraw();

    // --- Modifiers ---
    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    // --- Constructor ---
    constructor(address _owner, address _feeRecipient, uint256 _feeBps) Ownable(_owner) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS) revert InvalidFee();
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
    }

    // --- External Functions ---

    /// @notice Deposit ETH into escrow for a task
    /// @param taskId The task ID
    /// @param depositor The depositor address
    function depositETH(uint256 taskId, address depositor) external payable onlyAuthorized whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();
        if (depositor == address(0)) revert ZeroAddress();

        escrows[taskId] = EscrowEntry({
            depositor: depositor, paymentToken: address(0), amount: msg.value, released: false, refunded: false
        });
        totalLockedETH += msg.value;

        emit Deposited(taskId, depositor, address(0), msg.value);
    }

    /// @notice Deposit ERC20 tokens into escrow for a task
    /// @param taskId The task ID
    /// @param depositor The depositor address
    /// @param token The ERC20 token address
    /// @param amount The amount to deposit
    function depositToken(uint256 taskId, address depositor, address token, uint256 amount)
        external
        onlyAuthorized
        whenNotPaused
    {
        if (amount == 0) revert InvalidAmount();
        if (depositor == address(0)) revert ZeroAddress();
        if (token == address(0)) revert ZeroAddress();

        // Handle fee-on-transfer tokens
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(depositor, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;

        escrows[taskId] = EscrowEntry({
            depositor: depositor, paymentToken: token, amount: received, released: false, refunded: false
        });
        totalLockedToken[token] += received;

        emit Deposited(taskId, depositor, token, received);
    }

    /// @notice Release escrowed funds to agent (pull pattern: credits their balance)
    /// @param taskId The task ID
    /// @param beneficiary The agent address to receive payment
    function release(uint256 taskId, address beneficiary) external onlyAuthorized nonReentrant whenNotPaused {
        if (beneficiary == address(0)) revert ZeroAddress();

        EscrowEntry storage entry = escrows[taskId];
        if (entry.amount == 0) revert EscrowNotFound();
        if (entry.released) revert AlreadyReleased();
        if (entry.refunded) revert AlreadyRefunded();

        // EFFECTS
        entry.released = true;
        uint256 feeAmount = (entry.amount * feeBps) / 10_000;
        uint256 agentAmount = entry.amount - feeAmount;

        if (entry.paymentToken == address(0)) {
            totalLockedETH -= entry.amount;
            ethPayable[beneficiary] += agentAmount;
            ethPayable[feeRecipient] += feeAmount;
        } else {
            totalLockedToken[entry.paymentToken] -= entry.amount;
            tokenPayable[beneficiary][entry.paymentToken] += agentAmount;
            tokenPayable[feeRecipient][entry.paymentToken] += feeAmount;
        }

        emit Released(taskId, beneficiary, agentAmount, feeAmount);
    }

    /// @notice Refund escrowed funds to poster (pull pattern)
    /// @param taskId The task ID
    function refund(uint256 taskId) external onlyAuthorized nonReentrant whenNotPaused {
        EscrowEntry storage entry = escrows[taskId];
        if (entry.amount == 0) revert EscrowNotFound();
        if (entry.released) revert AlreadyReleased();
        if (entry.refunded) revert AlreadyRefunded();

        // EFFECTS
        entry.refunded = true;

        if (entry.paymentToken == address(0)) {
            totalLockedETH -= entry.amount;
            ethPayable[entry.depositor] += entry.amount;
        } else {
            totalLockedToken[entry.paymentToken] -= entry.amount;
            tokenPayable[entry.depositor][entry.paymentToken] += entry.amount;
        }

        emit Refunded(taskId, entry.depositor, entry.amount);
    }

    /// @notice Withdraw claimable ETH (pull payment)
    function withdrawETH() external nonReentrant {
        uint256 amount = ethPayable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        // EFFECTS before INTERACTIONS
        ethPayable[msg.sender] = 0;

        // INTERACTIONS
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, address(0), amount);
    }

    /// @notice Withdraw claimable ERC20 tokens (pull payment)
    /// @param token The token to withdraw
    function withdrawToken(address token) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        uint256 amount = tokenPayable[msg.sender][token];
        if (amount == 0) revert NothingToWithdraw();

        // EFFECTS before INTERACTIONS
        tokenPayable[msg.sender][token] = 0;

        // INTERACTIONS
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Configure platform fee
    /// @param _feeBps Fee in basis points (max 10%)
    /// @param _feeRecipient Address to receive fees
    function configureFee(uint256 _feeBps, address _feeRecipient) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert InvalidFee();
        if (_feeRecipient == address(0)) revert ZeroAddress();
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
        emit FeeConfigured(_feeBps, _feeRecipient);
    }

    /// @notice Set authorized caller
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    // --- View Functions ---

    /// @notice Get escrow entry for a task
    function getEscrow(uint256 taskId) external view returns (EscrowEntry memory) {
        return escrows[taskId];
    }

    /// @notice Get claimable ETH balance
    function claimableETH(address account) external view returns (uint256) {
        return ethPayable[account];
    }

    /// @notice Get claimable token balance
    function claimableToken(address account, address token) external view returns (uint256) {
        return tokenPayable[account][token];
    }

    // --- Admin ---
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
