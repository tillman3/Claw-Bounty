// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ValidatorStaking — $AECON staking for AI validators
/// @notice Validators stake $AECON to participate in scoring panels.
///         Higher stake = higher selection weight = more rewards.
///         Stake can be slashed for dishonest scoring.
/// @dev Designed for AI validator agents, not human stakers.
///      Integrates with ValidatorPool for panel selection weighting.
contract ValidatorStaking is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct StakeInfo {
        uint256 amount; // total staked $AECON
        uint256 rewards; // accumulated unclaimed rewards
        uint64 stakedAt; // timestamp of initial stake
        uint64 lastRewardUpdate; // last time rewards were calculated
        bool active; // can participate in panels
    }

    IERC20 public immutable aeconToken;

    uint256 public minStake = 1_000 ether; // 1,000 AECON minimum
    uint256 public totalStaked;
    uint256 public rewardPool; // accumulated rewards for distribution
    uint256 public rewardRatePerToken; // accumulated reward per staked token
    uint256 public slashBasisPoints = 1000; // 10% slash on dishonest scoring
    uint256 public constant MAX_SLASH_BP = 5000; // max 50% slash

    mapping(address => StakeInfo) public stakes;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => bool) public authorizedCallers; // ABBCore / ValidatorPool

    address[] public activeValidators;
    mapping(address => uint256) private _validatorIndex;

    // Events
    event Staked(address indexed validator, uint256 amount);
    event Unstaked(address indexed validator, uint256 amount);
    event RewardClaimed(address indexed validator, uint256 amount);
    event Slashed(address indexed validator, uint256 amount, string reason);
    event RewardsDeposited(uint256 amount);
    event MinStakeUpdated(uint256 newMinStake);
    event SlashRateUpdated(uint256 newBasisPoints);

    // Errors
    error InsufficientStake();
    error NotActive();
    error NotAuthorized();
    error NoRewardsToClaim();
    error StillActive();
    error AlreadyStaked();
    error InvalidAmount();
    error CooldownNotMet();

    uint64 public constant UNSTAKE_COOLDOWN = 7 days;

    constructor(address _token, address _owner) Ownable(_owner) {
        aeconToken = IERC20(_token);
    }

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    // ─── Validator Actions ───

    /// @notice Stake $AECON to become an active validator
    /// @param amount Number of tokens to stake (must be >= minStake)
    function stake(uint256 amount) external nonReentrant whenNotPaused {
        if (amount < minStake) revert InsufficientStake();

        StakeInfo storage info = stakes[msg.sender];

        // Update rewards before changing stake
        _updateReward(msg.sender);

        if (info.active) {
            // Adding to existing stake
            info.amount += amount;
        } else {
            // New validator
            info.amount = amount;
            info.stakedAt = uint64(block.timestamp);
            info.lastRewardUpdate = uint64(block.timestamp);
            info.active = true;

            // Add to active list
            _validatorIndex[msg.sender] = activeValidators.length;
            activeValidators.push(msg.sender);
        }

        totalStaked += amount;
        aeconToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake all $AECON and deactivate as validator
    /// @dev Enforces cooldown period to prevent stake-and-run attacks
    function unstake() external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        if (!info.active) revert NotActive();
        if (block.timestamp < info.stakedAt + UNSTAKE_COOLDOWN) revert CooldownNotMet();

        _updateReward(msg.sender);

        uint256 amount = info.amount;
        info.amount = 0;
        info.active = false;

        // Remove from active list (swap and pop)
        _removeFromActiveList(msg.sender);

        totalStaked -= amount;

        // Transfer stake + any pending rewards
        uint256 pending = info.rewards;
        info.rewards = 0;

        aeconToken.safeTransfer(msg.sender, amount + pending);

        emit Unstaked(msg.sender, amount);
        if (pending > 0) {
            emit RewardClaimed(msg.sender, pending);
        }
    }

    /// @notice Claim accumulated staking rewards without unstaking
    function claimRewards() external nonReentrant {
        _updateReward(msg.sender);

        StakeInfo storage info = stakes[msg.sender];
        uint256 reward = info.rewards;
        if (reward == 0) revert NoRewardsToClaim();

        info.rewards = 0;
        aeconToken.safeTransfer(msg.sender, reward);

        emit RewardClaimed(msg.sender, reward);
    }

    // ─── Protocol Actions (authorized) ───

    /// @notice Slash a validator's stake for dishonest scoring
    /// @param validator Address of the validator to slash
    /// @param reason Human-readable reason for the slash
    function slash(address validator, string calldata reason) external onlyAuthorized {
        StakeInfo storage info = stakes[validator];
        if (!info.active) revert NotActive();

        uint256 slashAmount = (info.amount * slashBasisPoints) / 10000;
        info.amount -= slashAmount;
        totalStaked -= slashAmount;

        // Half burned (sent to dead address), half to reward pool
        uint256 burnAmount = slashAmount / 2;
        uint256 rewardAmount = slashAmount - burnAmount;

        // Burn by sending to dead address
        aeconToken.safeTransfer(address(0xdead), burnAmount);
        rewardPool += rewardAmount;

        // Deactivate if below minimum
        if (info.amount < minStake) {
            info.active = false;
            _removeFromActiveList(validator);
        }

        emit Slashed(validator, slashAmount, reason);
    }

    /// @notice Deposit rewards into the pool (called by protocol fee distributor)
    /// @param amount Number of $AECON to add to reward pool
    function depositRewards(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();

        aeconToken.safeTransferFrom(msg.sender, address(this), amount);

        if (totalStaked > 0) {
            rewardRatePerToken += (amount * 1e18) / totalStaked;
        }
        rewardPool += amount;

        emit RewardsDeposited(amount);
    }

    // ─── Views ───

    /// @notice Get the number of active validators
    function getActiveValidatorCount() external view returns (uint256) {
        return activeValidators.length;
    }

    /// @notice Get all active validator addresses
    function getActiveValidators() external view returns (address[] memory) {
        return activeValidators;
    }

    /// @notice Get a validator's pending rewards
    function pendingRewards(address validator) external view returns (uint256) {
        StakeInfo storage info = stakes[validator];
        if (!info.active || info.amount == 0) return info.rewards;

        uint256 pending = (info.amount * (rewardRatePerToken - userRewardPerTokenPaid[validator])) / 1e18;
        return info.rewards + pending;
    }

    /// @notice Get validator's stake weight (for panel selection)
    /// @return weight Basis points weight relative to total stake (0-10000)
    function getStakeWeight(address validator) external view returns (uint256 weight) {
        if (totalStaked == 0) return 0;
        return (stakes[validator].amount * 10000) / totalStaked;
    }

    // ─── Admin ───

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setMinStake(uint256 newMinStake) external onlyOwner {
        minStake = newMinStake;
        emit MinStakeUpdated(newMinStake);
    }

    function setSlashRate(uint256 newBasisPoints) external onlyOwner {
        if (newBasisPoints > MAX_SLASH_BP) revert InvalidAmount();
        slashBasisPoints = newBasisPoints;
        emit SlashRateUpdated(newBasisPoints);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Internal ───

    function _updateReward(address validator) internal {
        StakeInfo storage info = stakes[validator];
        if (info.active && info.amount > 0) {
            uint256 pending = (info.amount * (rewardRatePerToken - userRewardPerTokenPaid[validator])) / 1e18;
            info.rewards += pending;
        }
        userRewardPerTokenPaid[validator] = rewardRatePerToken;
        info.lastRewardUpdate = uint64(block.timestamp);
    }

    function _removeFromActiveList(address validator) internal {
        uint256 index = _validatorIndex[validator];
        uint256 lastIndex = activeValidators.length - 1;

        if (index != lastIndex) {
            address lastValidator = activeValidators[lastIndex];
            activeValidators[index] = lastValidator;
            _validatorIndex[lastValidator] = index;
        }

        activeValidators.pop();
        delete _validatorIndex[validator];
    }
}
