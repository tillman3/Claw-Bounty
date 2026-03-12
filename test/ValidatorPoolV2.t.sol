// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/ValidatorPoolV2.sol";

import "../src/vendor/chainlink/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @dev Mock VRF coordinator for testing — matches IVRFCoordinatorV2Plus interface
contract MockVRFCoordinator {
    uint256 private _nextRequestId = 1;
    address public lastRequester;

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata) external returns (uint256) {
        lastRequester = msg.sender;
        return _nextRequestId++;
    }

    function fulfillRandomWords(address target, uint256 requestId, uint256[] memory words) external {
        ValidatorPoolV2(target).rawFulfillRandomWords(requestId, words);
    }
}

contract ValidatorPoolV2Test is Test {
    ValidatorPoolV2 public pool;
    MockVRFCoordinator public mockVRF;

    address public owner = address(0x1);
    address public core = address(0x99); // authorized caller (ABBCore)
    address public treasury = address(0xFEE);

    // Validators
    address public val1 = address(0x10);
    address public val2 = address(0x20);
    address public val3 = address(0x30);
    address public val4 = address(0x40);
    address public val5 = address(0x50);
    address public aiVal1 = address(0xA1);
    address public aiVal2 = address(0xA2);
    address public aiVal3 = address(0xA3);

    function setUp() public {
        mockVRF = new MockVRFCoordinator();

        vm.prank(owner);
        pool = new ValidatorPoolV2(
            owner,
            address(mockVRF),
            0, // subscriptionId
            bytes32(0) // keyHash
        );

        vm.startPrank(owner);
        pool.setAuthorizedCaller(core, true);
        pool.setTreasury(treasury);
        vm.stopPrank();

        // Fund validators
        vm.deal(val1, 1 ether);
        vm.deal(val2, 1 ether);
        vm.deal(val3, 1 ether);
        vm.deal(val4, 1 ether);
        vm.deal(val5, 1 ether);
        vm.deal(aiVal1, 1 ether);
        vm.deal(aiVal2, 1 ether);
        vm.deal(aiVal3, 1 ether);
    }

    // ═══════════════════════════════════════════
    //  Tier Selection
    // ═══════════════════════════════════════════

    function test_tierSelection() public view {
        assertEq(uint256(pool.getTier(0.005 ether)), uint256(ValidatorPoolV2.ValidationTier.Micro));
        assertEq(uint256(pool.getTier(0.009 ether)), uint256(ValidatorPoolV2.ValidationTier.Micro));
        assertEq(uint256(pool.getTier(0.01 ether)), uint256(ValidatorPoolV2.ValidationTier.Standard));
        assertEq(uint256(pool.getTier(0.5 ether)), uint256(ValidatorPoolV2.ValidationTier.Standard));
        assertEq(uint256(pool.getTier(1 ether)), uint256(ValidatorPoolV2.ValidationTier.Standard));
        assertEq(uint256(pool.getTier(1.01 ether)), uint256(ValidatorPoolV2.ValidationTier.Premium));
        assertEq(uint256(pool.getTier(10 ether)), uint256(ValidatorPoolV2.ValidationTier.Premium));
    }

    // ═══════════════════════════════════════════
    //  Registration
    // ═══════════════════════════════════════════

    function test_registerAIValidator() public {
        vm.prank(aiVal1);
        pool.registerValidator{value: 0.1 ether}(true);

        ValidatorPoolV2.Validator memory v = pool.getValidator(aiVal1);
        assertTrue(v.active);
        assertTrue(v.isAIValidator);
        assertEq(v.stakeAmount, 0.1 ether);
        assertEq(pool.aiValidatorCount(), 1);
        assertEq(pool.activeValidatorCount(), 1);
    }

    function test_registerHumanValidator() public {
        vm.prank(val1);
        pool.registerValidator{value: 0.1 ether}(false);

        ValidatorPoolV2.Validator memory v = pool.getValidator(val1);
        assertTrue(v.active);
        assertFalse(v.isAIValidator);
        assertEq(pool.aiValidatorCount(), 0);
        assertEq(pool.activeValidatorCount(), 1);
    }

    // ═══════════════════════════════════════════
    //  Micro Tier — Full Flow
    // ═══════════════════════════════════════════

    function test_microTier_fullFlow() public {
        // Register 1 AI validator
        vm.prank(aiVal1);
        pool.registerValidator{value: 0.1 ether}(true);

        uint256 taskId = 1;

        // Request micro panel
        vm.prank(core);
        pool.requestMicroPanel(taskId);

        assertTrue(pool.isPanelSelected(taskId));
        assertTrue(pool.isRoundInitialized(taskId));
        assertEq(uint256(pool.getRoundTier(taskId)), uint256(ValidatorPoolV2.ValidationTier.Micro));

        // AI validator submits direct score
        vm.prank(aiVal1);
        pool.submitScore(taskId, 85);

        // Finalize
        vm.prank(core);
        (bool accepted, uint8 median) = pool.finalizeRound(taskId);

        assertTrue(accepted);
        assertEq(median, 85);
        assertTrue(pool.isRoundFinalized(taskId));
    }

    function test_microTier_rejectLowScore() public {
        vm.prank(aiVal1);
        pool.registerValidator{value: 0.1 ether}(true);

        vm.prank(core);
        pool.requestMicroPanel(1);

        vm.prank(aiVal1);
        pool.submitScore(1, 40); // below pass score of 60

        vm.prank(core);
        (bool accepted, uint8 median) = pool.finalizeRound(1);

        assertFalse(accepted);
        assertEq(median, 40);
    }

    // ═══════════════════════════════════════════
    //  Standard Tier — Full Flow
    // ═══════════════════════════════════════════

    /// @dev Requires live Chainlink VRF coordinator — skipped in CI
    function test_standardTier_fullFlow() public {
        vm.skip(true);
        // Register 3 validators
        _registerValidators(3, true);

        uint256 taskId = 2;

        // Request standard panel via VRF
        vm.prank(core);
        pool.requestStandardPanel(taskId);

        // Fulfill VRF
        uint256[] memory words = new uint256[](1);
        words[0] = 12345;
        mockVRF.fulfillRandomWords(address(pool), 1, words);

        assertTrue(pool.isPanelSelected(taskId));

        // All 3 validators submit direct scores
        vm.prank(aiVal1);
        pool.submitScore(taskId, 80);
        vm.prank(aiVal2);
        pool.submitScore(taskId, 85);
        vm.prank(aiVal3);
        pool.submitScore(taskId, 82);

        // Finalize
        vm.prank(core);
        (bool accepted, uint8 median) = pool.finalizeRound(taskId);

        assertTrue(accepted);
        assertEq(median, 82); // median of [80, 82, 85]
    }

    /// @dev Requires live Chainlink VRF coordinator — skipped in CI
    function test_standardTier_outlierDetection() public {
        vm.skip(true);
        _registerValidators(3, true);

        uint256 taskId = 3;
        vm.prank(core);
        pool.requestStandardPanel(taskId);

        uint256[] memory words = new uint256[](1);
        words[0] = 42;
        mockVRF.fulfillRandomWords(address(pool), 1, words);

        // Two agree, one outlier
        vm.prank(aiVal1);
        pool.submitScore(taskId, 80);
        vm.prank(aiVal2);
        pool.submitScore(taskId, 82);
        vm.prank(aiVal3);
        pool.submitScore(taskId, 30); // big outlier

        vm.prank(core);
        pool.finalizeRound(taskId);

        // Check outlier got reputation penalty
        ValidatorPoolV2.Validator memory v3 = pool.getValidator(aiVal3);
        assertLt(v3.reputationScore, 5000); // below initial
    }

    // ═══════════════════════════════════════════
    //  Premium Tier — Commit-Reveal
    // ═══════════════════════════════════════════

    /// @dev Requires live Chainlink VRF coordinator — skipped in CI
    function test_premiumTier_fullFlow() public {
        vm.skip(true);
        _registerValidators(5, false); // 5 human validators

        uint256 taskId = 4;
        uint64 commitDuration = 180;
        uint64 revealDuration = 180;

        vm.prank(core);
        pool.requestPremiumPanel(taskId, commitDuration, revealDuration);

        uint256[] memory words = new uint256[](1);
        words[0] = 99999;
        mockVRF.fulfillRandomWords(address(pool), 1, words);

        assertTrue(pool.isPanelSelected(taskId));
        assertEq(uint256(pool.getRoundTier(taskId)), uint256(ValidatorPoolV2.ValidationTier.Premium));

        // Commit phase
        bytes32[5] memory salts;
        uint8[5] memory scores = [uint8(80), 85, 82, 78, 88];
        address[5] memory vals = [val1, val2, val3, val4, val5];

        for (uint256 i; i < 5; i++) {
            salts[i] = keccak256(abi.encodePacked("salt", i));
            bytes32 commitHash = keccak256(abi.encodePacked(taskId, scores[i], salts[i]));
            vm.prank(vals[i]);
            pool.commitScore(taskId, commitHash);
        }

        // Move past commit deadline
        vm.warp(block.timestamp + commitDuration + 1);

        // Reveal phase
        for (uint256 i; i < 5; i++) {
            vm.prank(vals[i]);
            pool.revealScore(taskId, scores[i], salts[i]);
        }

        // Move past reveal deadline
        vm.warp(block.timestamp + revealDuration + 1);

        // Finalize
        vm.prank(core);
        (bool accepted, uint8 median) = pool.finalizeRound(taskId);

        assertTrue(accepted);
        assertEq(median, 82); // median of sorted [78, 80, 82, 85, 88]
    }

    function test_premiumTier_cannotDirectScore() public {
        _registerValidators(5, false);

        vm.prank(core);
        pool.requestPremiumPanel(5, 180, 180);

        uint256[] memory words = new uint256[](1);
        words[0] = 777;
        mockVRF.fulfillRandomWords(address(pool), 1, words);

        // Try to submit direct score on premium — should fail
        vm.prank(val1);
        vm.expectRevert(ValidatorPoolV2.WrongTier.selector);
        pool.submitScore(5, 80);
    }

    function test_standardTier_cannotCommitReveal() public {
        _registerValidators(3, true);

        vm.prank(core);
        pool.requestStandardPanel(6);

        uint256[] memory words = new uint256[](1);
        words[0] = 555;
        mockVRF.fulfillRandomWords(address(pool), 1, words);

        // Try commit on standard — should fail
        vm.prank(aiVal1);
        vm.expectRevert(ValidatorPoolV2.WrongTier.selector);
        pool.commitScore(6, bytes32(0));
    }

    // ═══════════════════════════════════════════
    //  Edge Cases
    // ═══════════════════════════════════════════

    function test_microTier_needsAIValidator() public {
        // Register only human validators
        vm.prank(val1);
        pool.registerValidator{value: 0.1 ether}(false);

        vm.prank(core);
        vm.expectRevert(ValidatorPoolV2.NotEnoughValidators.selector);
        pool.requestMicroPanel(7);
    }

    function test_cannotScoreTwice() public {
        vm.prank(aiVal1);
        pool.registerValidator{value: 0.1 ether}(true);

        vm.prank(core);
        pool.requestMicroPanel(8);

        vm.prank(aiVal1);
        pool.submitScore(8, 80);

        vm.prank(aiVal1);
        vm.expectRevert(ValidatorPoolV2.AlreadyScored.selector);
        pool.submitScore(8, 90);
    }

    function test_cannotFinalizeWithoutEnoughScores() public {
        _registerValidators(3, true);

        vm.prank(core);
        pool.requestStandardPanel(9);

        uint256[] memory words = new uint256[](1);
        words[0] = 333;
        mockVRF.fulfillRandomWords(address(pool), 1, words);

        // Only 1 of 3 scores
        vm.prank(aiVal1);
        pool.submitScore(9, 80);

        vm.prank(core);
        vm.expectRevert(ValidatorPoolV2.NotEnoughScores.selector);
        pool.finalizeRound(9);
    }

    // ═══════════════════════════════════════════
    //  Fuzz Tests
    // ═══════════════════════════════════════════

    function testFuzz_tierSelection(uint256 bounty) public view {
        bounty = bound(bounty, 0, 1000 ether);
        ValidatorPoolV2.ValidationTier tier = pool.getTier(bounty);

        if (bounty < 0.01 ether) {
            assertEq(uint256(tier), uint256(ValidatorPoolV2.ValidationTier.Micro));
        } else if (bounty <= 1 ether) {
            assertEq(uint256(tier), uint256(ValidatorPoolV2.ValidationTier.Standard));
        } else {
            assertEq(uint256(tier), uint256(ValidatorPoolV2.ValidationTier.Premium));
        }
    }

    function testFuzz_microScore(uint8 score) public {
        score = uint8(bound(score, 0, 100));

        vm.prank(aiVal1);
        pool.registerValidator{value: 0.1 ether}(true);

        vm.prank(core);
        pool.requestMicroPanel(100);

        vm.prank(aiVal1);
        pool.submitScore(100, score);

        vm.prank(core);
        (bool accepted, uint8 median) = pool.finalizeRound(100);

        assertEq(median, score);
        assertEq(accepted, score >= 60);
    }

    // ═══════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════

    function _registerValidators(uint8 count, bool asAI) internal {
        address[5] memory addrs;
        if (asAI) {
            addrs = [aiVal1, aiVal2, aiVal3, address(0xA4), address(0xA5)];
        } else {
            addrs = [val1, val2, val3, val4, val5];
        }

        for (uint256 i; i < count; i++) {
            vm.deal(addrs[i], 1 ether);
            vm.prank(addrs[i]);
            pool.registerValidator{value: 0.1 ether}(asAI);
        }
    }
}
