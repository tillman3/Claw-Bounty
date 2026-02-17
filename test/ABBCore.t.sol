// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/ABBCore.sol";
import "../src/TaskRegistry.sol";
import "../src/BountyEscrow.sol";
import "../src/ValidatorPool.sol";
import "../src/AgentRegistry.sol";

contract ABBCoreTest is Test {
    ABBCore public core;
    TaskRegistry public taskRegistry;
    BountyEscrow public bountyEscrow;
    ValidatorPool public validatorPool;
    AgentRegistry public agentRegistry;

    address public owner = address(0x1);
    address public poster = address(0x2);
    address public operator = address(0x3);
    address public feeRecipient = address(0x4);
    address[] public validatorAddrs;

    function setUp() public {
        vm.startPrank(owner);

        taskRegistry = new TaskRegistry(owner);
        bountyEscrow = new BountyEscrow(owner, feeRecipient, 500); // 5% fee
        validatorPool = new ValidatorPool(owner);
        agentRegistry = new AgentRegistry(owner);

        core = new ABBCore(
            owner,
            address(taskRegistry),
            address(bountyEscrow),
            address(validatorPool),
            address(agentRegistry)
        );

        // Authorize core on all sub-contracts
        taskRegistry.setAuthorizedCaller(address(core), true);
        bountyEscrow.setAuthorizedCaller(address(core), true);
        validatorPool.setAuthorizedCaller(address(core), true);
        agentRegistry.setAuthorizedCaller(address(core), true);

        // Set short timing for tests
        core.configureTiming(1, 1); // 1 second each

        vm.stopPrank();

        // Register 5 validators
        for (uint256 i = 0; i < 5; i++) {
            address v = address(uint160(0x100 + i));
            validatorAddrs.push(v);
            vm.deal(v, 1 ether);
            vm.prank(v);
            validatorPool.registerValidator{value: 0.1 ether}();
        }

        // Fund poster and operator
        vm.deal(poster, 10 ether);
        vm.deal(operator, 1 ether);
    }

    // === AgentRegistry Tests ===

    function test_registerAgent() public {
        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("metadata1"));
        AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        assertEq(agent.operator, operator);
        assertTrue(agent.active);
        assertEq(agent.reputationScore, 1000);
    }

    function test_registerAgent_revertZeroMetadata() public {
        vm.prank(operator);
        vm.expectRevert(AgentRegistry.InvalidMetadata.selector);
        agentRegistry.registerAgent(bytes32(0));
    }

    function test_deregisterAgent() public {
        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("metadata1"));

        vm.prank(operator);
        agentRegistry.deregisterAgent(agentId);

        AgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        assertFalse(agent.active);
    }

    function test_deregisterAgent_revertNotOperator() public {
        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("metadata1"));

        vm.prank(poster);
        vm.expectRevert(AgentRegistry.NotOperator.selector);
        agentRegistry.deregisterAgent(agentId);
    }

    // === TaskRegistry Tests ===

    function test_createTask() public {
        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        TaskRegistry.Task memory task = taskRegistry.getTask(taskId);
        assertEq(task.poster, poster);
        assertEq(task.bountyAmount, 1 ether);
        assertEq(uint8(task.state), uint8(TaskRegistry.TaskState.Open));
    }

    function test_createTask_revertZeroValue() public {
        vm.prank(poster);
        vm.expectRevert(ABBCore.InvalidAmount.selector);
        core.createTaskETH{value: 0}(bytes32("desc"), uint64(block.timestamp + 1 days));
    }

    function test_createTask_revertPastDeadline() public {
        vm.prank(poster);
        vm.expectRevert(ABBCore.InvalidDeadline.selector);
        core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp - 1));
    }

    // === Claim Tests ===

    function test_claimTask() public {
        // Register agent
        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("meta"));

        // Create task
        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        // Claim
        vm.prank(operator);
        core.claimTask(taskId, agentId);

        TaskRegistry.Task memory task = taskRegistry.getTask(taskId);
        assertEq(uint8(task.state), uint8(TaskRegistry.TaskState.Claimed));
        assertEq(task.assignedAgent, agentId);
    }

    function test_claimTask_revertNotOperator() public {
        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("meta"));

        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        vm.prank(poster); // not the operator
        vm.expectRevert(ABBCore.NotPosterOrAgent.selector);
        core.claimTask(taskId, agentId);
    }

    // === Cancel Tests ===

    function test_cancelTask() public {
        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        vm.prank(poster);
        core.cancelTask(taskId);

        TaskRegistry.Task memory task = taskRegistry.getTask(taskId);
        assertEq(uint8(task.state), uint8(TaskRegistry.TaskState.Cancelled));

        // Poster should have claimable refund
        assertEq(bountyEscrow.claimableETH(poster), 1 ether);
    }

    function test_cancelTask_revertNotPoster() public {
        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        vm.prank(operator);
        vm.expectRevert(ABBCore.NotPoster.selector);
        core.cancelTask(taskId);
    }

    // === Escrow Tests ===

    function test_escrowDeposit() public {
        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        BountyEscrow.EscrowEntry memory entry = bountyEscrow.getEscrow(taskId);
        assertEq(entry.amount, 1 ether);
        assertEq(entry.depositor, poster);
        assertFalse(entry.released);
        assertFalse(entry.refunded);
    }

    function test_pullPaymentWithdraw() public {
        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        vm.prank(poster);
        core.cancelTask(taskId);

        uint256 balBefore = poster.balance;
        vm.prank(poster);
        bountyEscrow.withdrawETH();
        assertEq(poster.balance - balBefore, 1 ether);
    }

    function test_withdrawETH_revertNothingToWithdraw() public {
        vm.prank(poster);
        vm.expectRevert(BountyEscrow.NothingToWithdraw.selector);
        bountyEscrow.withdrawETH();
    }

    // === Full Workflow Test ===

    function test_fullWorkflow_accepted() public {
        // Register agent
        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("meta"));

        // Create task
        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        // Claim
        vm.prank(operator);
        core.claimTask(taskId, agentId);

        // Submit work
        vm.prank(operator);
        core.submitWork(taskId, bytes32("submission"));

        // Validators commit scores (all score 80)
        for (uint256 i; i < 5; i++) {
            bytes32 hash = keccak256(abi.encodePacked(taskId, uint8(80), bytes32(uint256(i + 1))));
            vm.prank(validatorAddrs[i]);
            validatorPool.commitScore(taskId, hash);
        }

        // Advance past commit deadline
        vm.warp(block.timestamp + 2);

        // Validators reveal
        for (uint256 i; i < 5; i++) {
            vm.prank(validatorAddrs[i]);
            validatorPool.revealScore(taskId, 80, bytes32(uint256(i + 1)));
        }

        // Advance past reveal deadline
        vm.warp(block.timestamp + 2);

        // Finalize
        core.finalizeReview(taskId);

        // Check task completed
        TaskRegistry.Task memory task = taskRegistry.getTask(taskId);
        assertEq(uint8(task.state), uint8(TaskRegistry.TaskState.Completed));

        // Check agent can withdraw (0.95 ETH after 5% fee)
        assertEq(bountyEscrow.claimableETH(operator), 0.95 ether);
        assertEq(bountyEscrow.claimableETH(feeRecipient), 0.05 ether);
    }

    function test_fullWorkflow_rejected() public {
        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("meta"));

        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        vm.prank(operator);
        core.claimTask(taskId, agentId);

        vm.prank(operator);
        core.submitWork(taskId, bytes32("submission"));

        // Validators all score 30 (below pass threshold of 60)
        for (uint256 i; i < 5; i++) {
            bytes32 hash = keccak256(abi.encodePacked(taskId, uint8(30), bytes32(uint256(i + 1))));
            vm.prank(validatorAddrs[i]);
            validatorPool.commitScore(taskId, hash);
        }

        vm.warp(block.timestamp + 2);

        for (uint256 i; i < 5; i++) {
            vm.prank(validatorAddrs[i]);
            validatorPool.revealScore(taskId, 30, bytes32(uint256(i + 1)));
        }

        vm.warp(block.timestamp + 2);

        core.finalizeReview(taskId);

        // Poster gets refund
        assertEq(bountyEscrow.claimableETH(poster), 1 ether);
    }

    // === ValidatorPool Tests ===

    function test_validatorRegistration() public {
        address newV = address(0x999);
        vm.deal(newV, 1 ether);
        vm.prank(newV);
        validatorPool.registerValidator{value: 0.1 ether}();

        ValidatorPool.Validator memory v = validatorPool.getValidator(newV);
        assertTrue(v.active);
        assertEq(v.stakeAmount, 0.1 ether);
    }

    function test_validatorRegistration_revertInsufficientStake() public {
        address newV = address(0x999);
        vm.deal(newV, 1 ether);
        vm.prank(newV);
        vm.expectRevert(ValidatorPool.InsufficientStake.selector);
        validatorPool.registerValidator{value: 0.01 ether}();
    }

    function test_unstakeCooldown() public {
        address v = validatorAddrs[0];
        vm.prank(v);
        validatorPool.initiateUnstake(0.1 ether);

        // Try to complete immediately - should fail
        vm.prank(v);
        vm.expectRevert(ValidatorPool.UnstakeCooldownNotMet.selector);
        validatorPool.completeUnstake();

        // Advance 7 days
        vm.warp(block.timestamp + 7 days + 1);
        uint256 balBefore = v.balance;
        vm.prank(v);
        validatorPool.completeUnstake();
        assertEq(v.balance - balBefore, 0.1 ether);
    }

    function test_commitReveal_hashMismatch() public {
        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("meta"));

        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        vm.prank(operator);
        core.claimTask(taskId, agentId);

        vm.prank(operator);
        core.submitWork(taskId, bytes32("sub"));

        // Commit with score 80
        bytes32 hash = keccak256(abi.encodePacked(taskId, uint8(80), bytes32(uint256(1))));
        vm.prank(validatorAddrs[0]);
        validatorPool.commitScore(taskId, hash);

        vm.warp(block.timestamp + 2);

        // Try to reveal with different score
        vm.prank(validatorAddrs[0]);
        vm.expectRevert(ValidatorPool.HashMismatch.selector);
        validatorPool.revealScore(taskId, 90, bytes32(uint256(1)));
    }

    // === Access Control Tests ===

    function test_taskRegistry_revertUnauthorized() public {
        vm.prank(poster);
        vm.expectRevert(TaskRegistry.NotAuthorized.selector);
        taskRegistry.createTask(poster, bytes32("desc"), 1 ether, address(0), uint64(block.timestamp + 1 days));
    }

    function test_escrow_revertUnauthorized() public {
        vm.prank(poster);
        vm.expectRevert(BountyEscrow.NotAuthorized.selector);
        bountyEscrow.depositETH{value: 1 ether}(0, poster);
    }

    // === Pause Tests ===

    function test_pauseUnpause() public {
        vm.prank(owner);
        core.pause();

        vm.prank(poster);
        vm.expectRevert();
        core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        vm.prank(owner);
        core.unpause();

        vm.prank(poster);
        core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));
    }

    // === Dispute Tests ===

    function test_ownerResolveDispute_accepted() public {
        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("meta"));

        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: 1 ether}(bytes32("desc"), uint64(block.timestamp + 1 days));

        vm.prank(operator);
        core.claimTask(taskId, agentId);

        vm.prank(operator);
        core.submitWork(taskId, bytes32("sub"));

        // Poster raises dispute
        vm.prank(poster);
        core.raiseDispute(taskId);

        // Owner resolves in favor of agent
        vm.prank(owner);
        core.resolveDispute(taskId, true);

        assertEq(bountyEscrow.claimableETH(operator), 0.95 ether);
    }

    // === Fuzz Tests ===

    function testFuzz_createTaskETH(uint256 amount, uint64 deadlineOffset) public {
        amount = bound(amount, 1, 100 ether);
        deadlineOffset = uint64(bound(deadlineOffset, 1, 365 days));
        vm.deal(poster, amount);

        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: amount}(bytes32("desc"), uint64(block.timestamp) + deadlineOffset);

        BountyEscrow.EscrowEntry memory entry = bountyEscrow.getEscrow(taskId);
        assertEq(entry.amount, amount);
    }

    function testFuzz_feeCalculation(uint256 amount) public {
        amount = bound(amount, 1, 100 ether);
        vm.deal(poster, amount);

        vm.prank(operator);
        uint256 agentId = agentRegistry.registerAgent(bytes32("meta"));

        vm.prank(poster);
        uint256 taskId = core.createTaskETH{value: amount}(bytes32("desc"), uint64(block.timestamp + 1 days));

        vm.prank(operator);
        core.claimTask(taskId, agentId);

        vm.prank(operator);
        core.submitWork(taskId, bytes32("sub"));

        // Quick commit-reveal with all validators scoring 80
        for (uint256 i; i < 5; i++) {
            bytes32 hash = keccak256(abi.encodePacked(taskId, uint8(80), bytes32(uint256(i + 1))));
            vm.prank(validatorAddrs[i]);
            validatorPool.commitScore(taskId, hash);
        }
        vm.warp(block.timestamp + 2);
        for (uint256 i; i < 5; i++) {
            vm.prank(validatorAddrs[i]);
            validatorPool.revealScore(taskId, 80, bytes32(uint256(i + 1)));
        }
        vm.warp(block.timestamp + 2);

        core.finalizeReview(taskId);

        uint256 expectedFee = (amount * 500) / 10_000;
        uint256 expectedAgent = amount - expectedFee;
        assertEq(bountyEscrow.claimableETH(operator), expectedAgent);
        assertEq(bountyEscrow.claimableETH(feeRecipient), expectedFee);
    }
}

/// @notice Invariant test: escrow solvency
contract EscrowSolvencyInvariant is Test {
    ABBCore public core;
    BountyEscrow public bountyEscrow;
    TaskRegistry public taskRegistry;
    ValidatorPool public validatorPool;
    AgentRegistry public agentRegistry;

    address public owner = address(0x1);
    address public feeRecipient = address(0x4);

    function setUp() public {
        vm.startPrank(owner);
        taskRegistry = new TaskRegistry(owner);
        bountyEscrow = new BountyEscrow(owner, feeRecipient, 500);
        validatorPool = new ValidatorPool(owner);
        agentRegistry = new AgentRegistry(owner);
        core = new ABBCore(owner, address(taskRegistry), address(bountyEscrow), address(validatorPool), address(agentRegistry));
        taskRegistry.setAuthorizedCaller(address(core), true);
        bountyEscrow.setAuthorizedCaller(address(core), true);
        validatorPool.setAuthorizedCaller(address(core), true);
        agentRegistry.setAuthorizedCaller(address(core), true);
        vm.stopPrank();

        targetContract(address(core));
    }

    /// @dev Escrow contract balance should always be >= totalLockedETH
    function invariant_escrowSolvency() public view {
        assertGe(address(bountyEscrow).balance, bountyEscrow.totalLockedETH());
    }
}
