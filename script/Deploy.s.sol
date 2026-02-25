// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/AgentRegistry.sol";
import "../src/TaskRegistry.sol";
import "../src/BountyEscrow.sol";
import "../src/ValidatorPool.sol";
import "../src/ABBCore.sol";

/// @title Deploy Agent Bounty Board contracts to Base Sepolia
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerKey);

        // 1. Deploy registries
        AgentRegistry agentRegistry = new AgentRegistry(deployer);
        console.log("AgentRegistry:", address(agentRegistry));

        TaskRegistry taskRegistry = new TaskRegistry(deployer);
        console.log("TaskRegistry:", address(taskRegistry));

        // 2. Deploy escrow with 5% fee (500 bps), deployer as fee recipient
        BountyEscrow escrow = new BountyEscrow(deployer, deployer, 500);
        console.log("BountyEscrow:", address(escrow));

        // 3. Deploy validator pool with VRF config
        // Base Sepolia VRF V2.5 config
        address vrfCoordinator = 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
        uint256 vrfSubscriptionId = vm.envOr("VRF_SUBSCRIPTION_ID", uint256(0));
        bytes32 vrfKeyHash = 0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;

        ValidatorPool validatorPool = new ValidatorPool(deployer, vrfCoordinator, vrfSubscriptionId, vrfKeyHash);
        console.log("ValidatorPool:", address(validatorPool));

        // 4. Deploy orchestrator
        ABBCore core = new ABBCore(
            deployer, address(taskRegistry), address(escrow), address(validatorPool), address(agentRegistry)
        );
        console.log("ABBCore:", address(core));

        // 5. Set ABBCore as authorized caller on ALL sub-contracts
        agentRegistry.setAuthorizedCaller(address(core), true);
        escrow.setAuthorizedCaller(address(core), true);
        taskRegistry.setAuthorizedCaller(address(core), true);
        validatorPool.setAuthorizedCaller(address(core), true);

        vm.stopBroadcast();

        // 6. Verify authorizations
        require(agentRegistry.authorizedCallers(address(core)), "AgentRegistry auth failed");
        require(escrow.authorizedCallers(address(core)), "BountyEscrow auth failed");
        require(taskRegistry.authorizedCallers(address(core)), "TaskRegistry auth failed");
        require(validatorPool.authorizedCallers(address(core)), "ValidatorPool auth failed");

        console.log("\n=== Deployment Complete ===");
        console.log("All cross-contract authorizations verified");
        console.log("Network: Base Sepolia");
        console.log("AgentRegistry:", address(agentRegistry));
        console.log("TaskRegistry:", address(taskRegistry));
        console.log("BountyEscrow:", address(escrow));
        console.log("ValidatorPool:", address(validatorPool));
        console.log("ABBCore (main entry point):", address(core));
    }
}
