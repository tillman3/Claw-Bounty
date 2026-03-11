// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TokenVesting — Linear vesting with cliff for $AECON allocations
/// @notice Each grant has a beneficiary, cliff, and linear vesting duration.
///         Used for team tokens, treasury unlock, and ecosystem rewards.
/// @dev Immutable once a grant is created. No admin revocation (trustless).
contract TokenVesting is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct VestingGrant {
        uint256 totalAmount;      // total tokens in grant
        uint256 released;         // tokens already claimed
        uint64  startTime;        // vesting start timestamp
        uint64  cliffDuration;    // seconds before any tokens unlock
        uint64  vestingDuration;  // total vesting period (includes cliff)
        bool    exists;
    }

    IERC20 public immutable token;
    address public immutable grantCreator;

    mapping(address => VestingGrant) public grants;

    event GrantCreated(address indexed beneficiary, uint256 amount, uint64 start, uint64 cliff, uint64 duration);
    event TokensReleased(address indexed beneficiary, uint256 amount);

    error GrantAlreadyExists();
    error GrantNotFound();
    error NoTokensDue();
    error OnlyGrantCreator();
    error InvalidParameters();

    error ZeroAddress();

    /// @param _token Address of the AECON token
    /// @param _grantCreator Address authorized to create grants
    constructor(address _token, address _grantCreator) {
        if (_token == address(0) || _grantCreator == address(0)) revert ZeroAddress();
        token = IERC20(_token);
        grantCreator = _grantCreator;
    }

    /// @notice Create a vesting grant for a beneficiary
    /// @param beneficiary Address that will receive vested tokens
    /// @param amount Total number of tokens to vest
    /// @param startTime When vesting begins (unix timestamp)
    /// @param cliffDuration Seconds before first tokens unlock
    /// @param vestingDuration Total vesting period in seconds (includes cliff)
    function createGrant(
        address beneficiary,
        uint256 amount,
        uint64 startTime,
        uint64 cliffDuration,
        uint64 vestingDuration
    ) external {
        if (msg.sender != grantCreator) revert OnlyGrantCreator();
        if (grants[beneficiary].exists) revert GrantAlreadyExists();
        if (amount == 0 || vestingDuration == 0) revert InvalidParameters();
        if (cliffDuration > vestingDuration) revert InvalidParameters();
        if (beneficiary == address(0)) revert InvalidParameters();

        grants[beneficiary] = VestingGrant({
            totalAmount: amount,
            released: 0,
            startTime: startTime,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            exists: true
        });

        // Transfer tokens into this contract
        token.safeTransferFrom(msg.sender, address(this), amount);

        emit GrantCreated(beneficiary, amount, startTime, cliffDuration, vestingDuration);
    }

    /// @notice Claim all vested tokens available to the caller
    function release() external nonReentrant {
        VestingGrant storage grant = grants[msg.sender];
        if (!grant.exists) revert GrantNotFound();

        uint256 vested = _vestedAmount(grant);
        uint256 due = vested - grant.released;
        if (due == 0) revert NoTokensDue();

        grant.released += due;
        token.safeTransfer(msg.sender, due);

        emit TokensReleased(msg.sender, due);
    }

    /// @notice View how many tokens are currently releasable for a beneficiary
    function releasable(address beneficiary) external view returns (uint256) {
        VestingGrant storage grant = grants[beneficiary];
        if (!grant.exists) return 0;
        return _vestedAmount(grant) - grant.released;
    }

    /// @notice View total vested amount for a beneficiary (includes already released)
    function vestedAmount(address beneficiary) external view returns (uint256) {
        VestingGrant storage grant = grants[beneficiary];
        if (!grant.exists) return 0;
        return _vestedAmount(grant);
    }

    function _vestedAmount(VestingGrant storage grant) internal view returns (uint256) {
        uint256 start = grant.startTime;
        uint256 cliff = start + grant.cliffDuration;
        uint256 end = start + grant.vestingDuration;

        if (block.timestamp < cliff) {
            return 0;
        } else if (block.timestamp >= end) {
            return grant.totalAmount;
        } else {
            return (grant.totalAmount * (block.timestamp - start)) / grant.vestingDuration;
        }
    }
}
