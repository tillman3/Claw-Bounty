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

        // 3. Deploy validator pool
        ValidatorPool validatorPool = new ValidatorPool(deployer);
        console.log("ValidatorPool:", address(validatorPool));

        // 4. Deploy orchestrator
        ABBCore core = new ABBCore(
            deployer,
            address(taskRegistry),
            address(escrow),
            address(validatorPool),
            address(agentRegistry)
        );
        console.log("ABBCore:", address(core));

        // 5. Set ABBCore as authorized caller on sub-contracts
        escrow.setAuthorizedCaller(address(core), true);
        taskRegistry.setAuthorizedCaller(address(core), true);
        validatorPool.setAuthorizedCaller(address(core), true);

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("Network: Base Sepolia");
        console.log("ABBCore (main entry point):", address(core));
    }
}
