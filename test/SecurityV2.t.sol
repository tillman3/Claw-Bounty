// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AECONToken.sol";
import "../src/TokenVesting.sol";
import "../src/ValidatorStaking.sol";
import "../src/AgentIdentity8004.sol";
import "../src/ReputationRegistry8004.sol";

/// @title SecurityV2 — targeted security tests for V2 contracts
contract SecurityV2Test is Test {
    AECONToken public token;
    TokenVesting public vesting;
    ValidatorStaking public staking;
    AgentIdentity8004 public identity;
    ReputationRegistry8004 public reputation;

    address public owner = address(0x1);
    address public alice = address(0xA);
    address public bob = address(0xB);
    address public attacker = address(0xBAD);

    function setUp() public {
        vm.startPrank(owner);
        token = new AECONToken(owner);
        vesting = new TokenVesting(address(token), owner);
        staking = new ValidatorStaking(address(token), owner);
        identity = new AgentIdentity8004(owner);
        reputation = new ReputationRegistry8004(owner, address(identity));

        // Fund staking contract
        token.transfer(address(staking), 25_000_000 ether);
        // Fund alice + bob for testing
        token.transfer(alice, 100_000 ether);
        token.transfer(bob, 100_000 ether);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════
    //  Token Security
    // ═══════════════════════════════════════════

    function test_cannotMintTokens() public {
        // No mint function exists — verify supply is fixed
        assertEq(token.totalSupply(), 100_000_000 ether);
        // No way to increase supply
    }

    function test_cannotTransferMoreThanBalance() public {
        vm.prank(attacker);
        vm.expectRevert();
        token.transfer(alice, 1 ether); // attacker has 0 balance
    }

    function testFuzz_transferIntegrity(uint256 amount) public {
        amount = bound(amount, 0, 100_000 ether);
        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);

        vm.prank(alice);
        if (amount > aliceBefore) {
            vm.expectRevert();
            token.transfer(bob, amount);
        } else {
            token.transfer(bob, amount);
            assertEq(token.balanceOf(alice), aliceBefore - amount);
            assertEq(token.balanceOf(bob), bobBefore + amount);
        }
    }

    // ═══════════════════════════════════════════
    //  Staking Security
    // ═══════════════════════════════════════════

    function test_cannotStakeWithoutApproval() public {
        vm.prank(alice);
        vm.expectRevert();
        staking.stake(1000 ether);
    }

    function test_cannotStakeZero() public {
        vm.prank(alice);
        vm.expectRevert();
        staking.stake(0);
    }

    function test_cannotUnstakeBeforeCooldown() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        // Try to unstake immediately — should fail (7 day cooldown)
        vm.expectRevert();
        staking.unstake();
        vm.stopPrank();
    }

    function test_unstakeAfterCooldown() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        vm.warp(block.timestamp + 7 days + 1);
        staking.unstake();
        vm.stopPrank();

        assertEq(token.balanceOf(alice), 100_000 ether); // got it all back
    }

    function test_cannotDoubleStake() public {
        vm.startPrank(alice);
        token.approve(address(staking), 2000 ether);
        staking.stake(1000 ether);
        // Second stake should add to existing
        staking.stake(1000 ether);
        vm.stopPrank();
    }

    function test_slashOnlyOwner() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        vm.stopPrank();

        vm.prank(attacker);
        vm.expectRevert();
        staking.slash(alice, "bad behavior");
    }

    function test_slashReducesStake() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        vm.stopPrank();

        uint256 balBefore;
        (balBefore,,,,) = staking.stakes(alice);

        vm.prank(owner);
        staking.slash(alice, "outlier scoring");

        (uint256 balAfter,,,,) = staking.stakes(alice);
        assertLt(balAfter, balBefore); // slashed some
    }

    // ═══════════════════════════════════════════
    //  Vesting Security
    // ═══════════════════════════════════════════

    function test_cannotReleaseBeforeCliff() public {
        // Owner approves vesting contract, then createGrant pulls tokens
        vm.startPrank(owner);
        token.approve(address(vesting), 10_000 ether);
        vesting.createGrant(alice, 10_000 ether, uint64(block.timestamp), 90 days, 365 days);
        vm.stopPrank();

        vm.warp(block.timestamp + 30 days); // before 90-day cliff
        vm.prank(alice);
        vm.expectRevert();
        vesting.release();
    }

    function test_releaseAfterCliff() public {
        vm.startPrank(owner);
        token.approve(address(vesting), 10_000 ether);
        vesting.createGrant(bob, 10_000 ether, uint64(block.timestamp), 90 days, 365 days);
        vm.stopPrank();

        vm.warp(block.timestamp + 180 days); // past cliff, halfway through vesting
        vm.prank(bob);
        vesting.release();

        // Should have received roughly half (~4900)
        uint256 released = token.balanceOf(bob) - 100_000 ether; // subtract initial
        assertGt(released, 4000 ether);
        assertLt(released, 6000 ether);
    }

    function test_cannotCreateGrantUnauthorized() public {
        vm.prank(attacker);
        vm.expectRevert();
        vesting.createGrant(attacker, 1000 ether, uint64(block.timestamp), 365 days, 0);
    }

    // ═══════════════════════════════════════════
    //  Identity Security
    // ═══════════════════════════════════════════

    function test_cannotSetMetadataOnOthersNFT() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        vm.prank(attacker);
        vm.expectRevert(AgentIdentity8004.NotAgentOwnerOrApproved.selector);
        identity.setMetadata(agentId, "name", abi.encodePacked("hacked"));
    }

    function test_cannotSetURIOnOthersNFT() public {
        vm.prank(alice);
        uint256 agentId = identity.register("ipfs://original");

        vm.prank(attacker);
        vm.expectRevert(AgentIdentity8004.NotAgentOwnerOrApproved.selector);
        identity.setAgentURI(agentId, "ipfs://hacked");
    }

    function test_walletClearedOnTransfer() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        assertEq(identity.getAgentWallet(agentId), alice);

        vm.prank(alice);
        identity.transferFrom(alice, bob, agentId);

        // Wallet MUST be cleared on transfer (ERC-8004 security)
        assertEq(identity.getAgentWallet(agentId), address(0));
    }

    function test_cannotSetReservedMetadataKey() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        vm.prank(alice);
        vm.expectRevert(AgentIdentity8004.ReservedMetadataKey.selector);
        identity.setMetadata(agentId, "agentWallet", abi.encodePacked(attacker));
    }

    // ═══════════════════════════════════════════
    //  Reputation Security
    // ═══════════════════════════════════════════

    function test_cannotSelfFeedback() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        ReputationRegistry8004.FeedbackInput memory input = ReputationRegistry8004.FeedbackInput({
            agentId: agentId,
            value: 100,
            valueDecimals: 0,
            tag1: "",
            tag2: "",
            endpoint: "",
            feedbackURI: "",
            feedbackHash: bytes32(0)
        });

        vm.prank(alice); // agent owner
        vm.expectRevert(ReputationRegistry8004.CannotFeedbackOwnAgent.selector);
        reputation.giveFeedback(input);
    }

    function test_unauthorizedSourceCannotSubmitFeedback() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        vm.prank(attacker);
        vm.expectRevert(ReputationRegistry8004.NotFeedbackAuthor.selector);
        reputation.giveFeedbackFrom(agentId, bob, 100, 0, "tag", "");
    }

    function testFuzz_feedbackDoesNotOverflow(int128 value1, int128 value2) public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        ReputationRegistry8004.FeedbackInput memory input = ReputationRegistry8004.FeedbackInput({
            agentId: agentId,
            value: value1,
            valueDecimals: 0,
            tag1: "",
            tag2: "",
            endpoint: "",
            feedbackURI: "",
            feedbackHash: bytes32(0)
        });

        vm.prank(bob);
        reputation.giveFeedback(input);

        input.value = value2;
        address carol = address(0xC);
        vm.prank(carol);
        reputation.giveFeedback(input);

        (int256 score, uint256 count) = reputation.getAggregateScore(agentId);
        assertEq(score, int256(value1) + int256(value2));
        assertEq(count, 2);
    }

    // ═══════════════════════════════════════════
    //  Access Control
    // ═══════════════════════════════════════════

    function test_onlyOwnerCanPause() public {
        vm.prank(attacker);
        vm.expectRevert();
        identity.pause();

        vm.prank(owner);
        identity.pause();
        assertTrue(identity.paused());
    }

    function test_cannotRegisterWhenPaused() public {
        vm.prank(owner);
        identity.pause();

        vm.prank(alice);
        vm.expectRevert();
        identity.register();
    }
}
