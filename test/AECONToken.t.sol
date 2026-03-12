// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AECONToken.sol";
import "../src/TokenVesting.sol";
import "../src/ValidatorStaking.sol";

contract AECONTokenTest is Test {
    AECONToken public token;
    TokenVesting public vesting;
    ValidatorStaking public staking;

    address public owner = address(0x1);
    address public alice = address(0x2);
    address public bob = address(0x3);
    address public charlie = address(0x4);
    address public attacker = address(0x666);

    uint256 constant TOTAL_SUPPLY = 100_000_000 ether;

    function setUp() public {
        vm.startPrank(owner);
        token = new AECONToken(owner);
        vesting = new TokenVesting(address(token), owner);
        staking = new ValidatorStaking(address(token), owner);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════
    //  Token Basics
    // ═══════════════════════════════════════════════

    function test_totalSupply() public view {
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
    }

    function test_nameAndSymbol() public view {
        assertEq(token.name(), "AgentEcon");
        assertEq(token.symbol(), "AECON");
    }

    function test_ownerReceivesAllTokens() public view {
        assertEq(token.balanceOf(owner), TOTAL_SUPPLY);
    }

    function test_noMintFunction() public {
        // Verify there's no way to create new tokens
        // Token should always have exactly TOTAL_SUPPLY
        vm.prank(owner);
        token.transfer(alice, 1000 ether);
        assertEq(token.totalSupply(), TOTAL_SUPPLY);
    }

    function test_transfer() public {
        vm.prank(owner);
        token.transfer(alice, 1000 ether);
        assertEq(token.balanceOf(alice), 1000 ether);
        assertEq(token.balanceOf(owner), TOTAL_SUPPLY - 1000 ether);
    }

    // ═══════════════════════════════════════════════
    //  Governance (ERC20Votes)
    // ═══════════════════════════════════════════════

    function test_delegateVotingPower() public {
        vm.prank(owner);
        token.transfer(alice, 10_000 ether);

        vm.prank(alice);
        token.delegate(alice);

        assertEq(token.getVotes(alice), 10_000 ether);
    }

    function test_delegateToOther() public {
        vm.prank(owner);
        token.transfer(alice, 10_000 ether);

        vm.prank(alice);
        token.delegate(bob);

        assertEq(token.getVotes(bob), 10_000 ether);
        assertEq(token.getVotes(alice), 0);
    }

    // ═══════════════════════════════════════════════
    //  Vesting
    // ═══════════════════════════════════════════════

    function test_createVestingGrant() public {
        uint256 amount = 15_000_000 ether; // team allocation
        uint64 start = uint64(block.timestamp);
        uint64 cliff = 365 days; // 1 year cliff
        uint64 duration = 4 * 365 days; // 4 year vest

        vm.startPrank(owner);
        token.approve(address(vesting), amount);
        vesting.createGrant(alice, amount, start, cliff, duration);
        vm.stopPrank();

        // Nothing releasable before cliff
        assertEq(vesting.releasable(alice), 0);

        // After cliff, some should be releasable
        vm.warp(start + cliff + 1);
        assertGt(vesting.releasable(alice), 0);
    }

    function test_vestingLinearRelease() public {
        uint256 amount = 1_000_000 ether;
        uint64 start = uint64(block.timestamp);
        uint64 cliff = 0; // no cliff for this test
        uint64 duration = 365 days;

        vm.startPrank(owner);
        token.approve(address(vesting), amount);
        vesting.createGrant(alice, amount, start, cliff, duration);
        vm.stopPrank();

        // At 50% through vesting, ~50% should be vested
        vm.warp(start + duration / 2);
        uint256 vested = vesting.vestedAmount(alice);
        assertApproxEqRel(vested, amount / 2, 0.01e18); // within 1%

        // At 100%, all should be vested
        vm.warp(start + duration);
        assertEq(vesting.vestedAmount(alice), amount);
    }

    function test_vestingRelease() public {
        uint256 amount = 1_000_000 ether;
        uint64 start = uint64(block.timestamp);

        vm.startPrank(owner);
        token.approve(address(vesting), amount);
        vesting.createGrant(alice, amount, start, 0, 365 days);
        vm.stopPrank();

        // Warp to end of vesting
        vm.warp(start + 365 days);

        vm.prank(alice);
        vesting.release();

        assertEq(token.balanceOf(alice), amount);
    }

    function test_vestingCannotReleaseBeforeCliff() public {
        uint256 amount = 1_000_000 ether;
        uint64 start = uint64(block.timestamp);

        vm.startPrank(owner);
        token.approve(address(vesting), amount);
        vesting.createGrant(alice, amount, start, 365 days, 4 * 365 days);
        vm.stopPrank();

        // Try to release before cliff
        vm.warp(start + 100 days);
        vm.prank(alice);
        vm.expectRevert(TokenVesting.NoTokensDue.selector);
        vesting.release();
    }

    function test_vestingCannotCreateDuplicateGrant() public {
        vm.startPrank(owner);
        token.approve(address(vesting), 2_000_000 ether);
        vesting.createGrant(alice, 1_000_000 ether, uint64(block.timestamp), 0, 365 days);

        vm.expectRevert(TokenVesting.GrantAlreadyExists.selector);
        vesting.createGrant(alice, 1_000_000 ether, uint64(block.timestamp), 0, 365 days);
        vm.stopPrank();
    }

    function test_vestingOnlyCreatorCanCreateGrant() public {
        vm.prank(attacker);
        vm.expectRevert(TokenVesting.OnlyGrantCreator.selector);
        vesting.createGrant(alice, 1_000_000 ether, uint64(block.timestamp), 0, 365 days);
    }

    // ═══════════════════════════════════════════════
    //  Validator Staking
    // ═══════════════════════════════════════════════

    function test_stakeTokens() public {
        uint256 stakeAmount = 5_000 ether;
        _fundAndApprove(alice, stakeAmount);

        vm.prank(alice);
        staking.stake(stakeAmount);

        (uint256 amount,,,, bool active) = staking.stakes(alice);
        assertEq(amount, stakeAmount);
        assertTrue(active);
        assertEq(staking.totalStaked(), stakeAmount);
        assertEq(staking.getActiveValidatorCount(), 1);
    }

    function test_stakeMinimumEnforced() public {
        uint256 tooLow = 500 ether; // below 1000 minimum
        _fundAndApprove(alice, tooLow);

        vm.prank(alice);
        vm.expectRevert(ValidatorStaking.InsufficientStake.selector);
        staking.stake(tooLow);
    }

    function test_addToExistingStake() public {
        _fundAndApprove(alice, 10_000 ether);

        vm.startPrank(alice);
        staking.stake(5_000 ether);
        staking.stake(5_000 ether);
        vm.stopPrank();

        (uint256 amount,,,,) = staking.stakes(alice);
        assertEq(amount, 10_000 ether);
        assertEq(staking.getActiveValidatorCount(), 1); // still 1 validator
    }

    function test_unstakeAfterCooldown() public {
        _fundAndApprove(alice, 5_000 ether);

        vm.prank(alice);
        staking.stake(5_000 ether);

        // Warp past cooldown
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(alice);
        staking.unstake();

        (uint256 amount,,,, bool active) = staking.stakes(alice);
        assertEq(amount, 0);
        assertFalse(active);
        assertEq(token.balanceOf(alice), 5_000 ether);
        assertEq(staking.getActiveValidatorCount(), 0);
    }

    function test_cannotUnstakeBeforeCooldown() public {
        _fundAndApprove(alice, 5_000 ether);

        vm.prank(alice);
        staking.stake(5_000 ether);

        // Try immediately
        vm.prank(alice);
        vm.expectRevert(ValidatorStaking.CooldownNotMet.selector);
        staking.unstake();
    }

    function test_slashValidator() public {
        _fundAndApprove(alice, 10_000 ether);
        vm.prank(alice);
        staking.stake(10_000 ether);

        // Authorize ABBCore to slash
        vm.prank(owner);
        staking.setAuthorizedCaller(address(this), true);

        // Slash 10%
        staking.slash(alice, "outlier scoring on task #42");

        (uint256 amount,,,,) = staking.stakes(alice);
        assertEq(amount, 9_000 ether); // 10% slashed
    }

    function test_slashDeactivatesBelowMinimum() public {
        _fundAndApprove(alice, 1_000 ether); // exactly minimum
        vm.prank(alice);
        staking.stake(1_000 ether);

        vm.prank(owner);
        staking.setAuthorizedCaller(address(this), true);

        // Slash 10% → 900 AECON, below 1000 minimum
        staking.slash(alice, "bad scoring");

        (,,,, bool active) = staking.stakes(alice);
        assertFalse(active);
        assertEq(staking.getActiveValidatorCount(), 0);
    }

    function test_onlyAuthorizedCanSlash() public {
        _fundAndApprove(alice, 5_000 ether);
        vm.prank(alice);
        staking.stake(5_000 ether);

        vm.prank(attacker);
        vm.expectRevert(ValidatorStaking.NotAuthorized.selector);
        staking.slash(alice, "unauthorized slash attempt");
    }

    function test_rewardDistribution() public {
        // Alice and Bob stake
        _fundAndApprove(alice, 5_000 ether);
        _fundAndApprove(bob, 5_000 ether);

        vm.prank(alice);
        staking.stake(5_000 ether);
        vm.prank(bob);
        staking.stake(5_000 ether);

        // Deposit rewards
        uint256 rewardAmount = 1_000 ether;
        vm.startPrank(owner);
        token.approve(address(staking), rewardAmount);
        staking.depositRewards(rewardAmount);
        vm.stopPrank();

        // Each should get ~500 AECON (50/50 split)
        uint256 aliceRewards = staking.pendingRewards(alice);
        uint256 bobRewards = staking.pendingRewards(bob);

        assertApproxEqRel(aliceRewards, 500 ether, 0.01e18);
        assertApproxEqRel(bobRewards, 500 ether, 0.01e18);
    }

    function test_claimRewards() public {
        _fundAndApprove(alice, 5_000 ether);
        vm.prank(alice);
        staking.stake(5_000 ether);

        // Deposit rewards (alice is only staker, gets 100%)
        uint256 rewardAmount = 1_000 ether;
        vm.startPrank(owner);
        token.approve(address(staking), rewardAmount);
        staking.depositRewards(rewardAmount);
        vm.stopPrank();

        uint256 balBefore = token.balanceOf(alice);
        vm.prank(alice);
        staking.claimRewards();
        uint256 balAfter = token.balanceOf(alice);

        assertApproxEqRel(balAfter - balBefore, rewardAmount, 0.01e18);
    }

    function test_stakeWeightCalculation() public {
        _fundAndApprove(alice, 7_500 ether);
        _fundAndApprove(bob, 2_500 ether);

        vm.prank(alice);
        staking.stake(7_500 ether);
        vm.prank(bob);
        staking.stake(2_500 ether);

        // Alice has 75%, Bob has 25%
        assertEq(staking.getStakeWeight(alice), 7500); // 75% in basis points
        assertEq(staking.getStakeWeight(bob), 2500); // 25% in basis points
    }

    function test_multipleValidatorsActiveList() public {
        _fundAndApprove(alice, 2_000 ether);
        _fundAndApprove(bob, 2_000 ether);
        _fundAndApprove(charlie, 2_000 ether);

        vm.prank(alice);
        staking.stake(2_000 ether);
        vm.prank(bob);
        staking.stake(2_000 ether);
        vm.prank(charlie);
        staking.stake(2_000 ether);

        assertEq(staking.getActiveValidatorCount(), 3);

        // Remove middle validator
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob);
        staking.unstake();

        assertEq(staking.getActiveValidatorCount(), 2);

        // Verify remaining validators
        address[] memory validators = staking.getActiveValidators();
        assertEq(validators.length, 2);
    }

    // ═══════════════════════════════════════════════
    //  Security: Fuzz Tests
    // ═══════════════════════════════════════════════

    function testFuzz_stakeAmount(uint256 amount) public {
        amount = bound(amount, 1_000 ether, 10_000_000 ether);
        _fundAndApprove(alice, amount);

        vm.prank(alice);
        staking.stake(amount);

        (uint256 staked,,,,) = staking.stakes(alice);
        assertEq(staked, amount);
        assertEq(staking.totalStaked(), amount);
    }

    function testFuzz_vestingRelease(uint256 elapsed) public {
        uint256 amount = 1_000_000 ether;
        uint64 start = uint64(block.timestamp);
        uint64 duration = 365 days;
        elapsed = bound(elapsed, 0, duration * 2);

        vm.startPrank(owner);
        token.approve(address(vesting), amount);
        vesting.createGrant(alice, amount, start, 0, duration);
        vm.stopPrank();

        vm.warp(start + elapsed);
        uint256 vested = vesting.vestedAmount(alice);

        if (elapsed >= duration) {
            assertEq(vested, amount);
        } else {
            assertLe(vested, amount);
            uint256 expected = (amount * elapsed) / duration;
            assertApproxEqAbs(vested, expected, 1); // rounding tolerance
        }
    }

    function testFuzz_slashAmount(uint256 stakeAmt, uint256 slashBp) public {
        stakeAmt = bound(stakeAmt, 1_000 ether, 1_000_000 ether);
        slashBp = bound(slashBp, 100, 5000); // 1% to 50%

        _fundAndApprove(alice, stakeAmt);
        vm.prank(alice);
        staking.stake(stakeAmt);

        vm.startPrank(owner);
        staking.setSlashRate(slashBp);
        staking.setAuthorizedCaller(address(this), true);
        vm.stopPrank();

        uint256 expectedSlash = (stakeAmt * slashBp) / 10000;
        staking.slash(alice, "fuzz test");

        (uint256 remaining,,,,) = staking.stakes(alice);
        assertEq(remaining, stakeAmt - expectedSlash);
    }

    // ═══════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════

    function _fundAndApprove(address user, uint256 amount) internal {
        vm.prank(owner);
        token.transfer(user, amount);
        vm.prank(user);
        token.approve(address(staking), amount);
    }
}
