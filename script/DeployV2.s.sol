// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/ABBCoreV2.sol";
import "../src/ValidatorPoolV2.sol";
import "../src/AgentIdentity8004.sol";
import "../src/ReputationRegistry8004.sol";
import "../src/AECONToken.sol";
import "../src/TokenVesting.sol";
import "../src/ValidatorStaking.sol";
import "../src/TaskRegistry.sol";
import "../src/BountyEscrow.sol";
import "../src/AgentRegistry.sol";

/// @title DeployV2
/// @notice Deploys the full AgentEcon V2 stack:
///   - V1 contracts: TaskRegistry, BountyEscrow, AgentRegistry
///   - V2 contracts: ValidatorPoolV2, ABBCoreV2
///   - ERC-8004: AgentIdentity8004, ReputationRegistry8004
///   - Token: AECONToken, TokenVesting, ValidatorStaking
///   - Sets all cross-contract authorizations (lesson from V1 failures)
contract DeployV2 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // VRF config (Base Sepolia)
        address vrfCoordinator = vm.envOr("VRF_COORDINATOR", address(0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE));
        uint256 vrfSubscriptionId = vm.envOr("VRF_SUBSCRIPTION_ID", uint256(0));
        bytes32 vrfKeyHash =
            vm.envOr("VRF_KEY_HASH", bytes32(0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71));

        vm.startBroadcast(deployerPrivateKey);

        // ═══════════════════════════════════════════
        //  1. V1 contracts (unchanged)
        // ═══════════════════════════════════════════

        TaskRegistry taskRegistry = new TaskRegistry(deployer);
        BountyEscrow bountyEscrow = new BountyEscrow(deployer, deployer, 500); // 5% fee
        AgentRegistry agentRegistry = new AgentRegistry(deployer);

        // ═══════════════════════════════════════════
        //  2. V2 contracts
        // ═══════════════════════════════════════════

        ValidatorPoolV2 validatorPool = new ValidatorPoolV2(deployer, vrfCoordinator, vrfSubscriptionId, vrfKeyHash);

        ABBCoreV2 core = new ABBCoreV2(
            deployer, address(taskRegistry), address(bountyEscrow), address(validatorPool), address(agentRegistry)
        );

        // ═══════════════════════════════════════════
        //  3. ERC-8004 contracts
        // ═══════════════════════════════════════════

        AgentIdentity8004 identity = new AgentIdentity8004(deployer);
        ReputationRegistry8004 reputation = new ReputationRegistry8004(deployer, address(identity));

        // ═══════════════════════════════════════════
        //  4. Token contracts
        // ═══════════════════════════════════════════

        AECONToken token = new AECONToken(deployer);
        TokenVesting vesting = new TokenVesting(address(token), deployer);
        ValidatorStaking staking = new ValidatorStaking(address(token), deployer);

        // ═══════════════════════════════════════════
        //  5. Cross-contract authorizations
        //     (CRITICAL — V1 E2E failures were caused by missing these)
        // ═══════════════════════════════════════════

        // ABBCoreV2 needs to call all registries
        taskRegistry.setAuthorizedCaller(address(core), true);
        bountyEscrow.setAuthorizedCaller(address(core), true);
        agentRegistry.setAuthorizedCaller(address(core), true);
        validatorPool.setAuthorizedCaller(address(core), true);

        // ReputationRegistry needs ValidatorPool as authorized feedback source
        reputation.setAuthorizedSource(address(validatorPool), true);
        reputation.setAuthorizedSource(address(core), true);

        // ValidatorPool treasury
        validatorPool.setTreasury(deployer); // Deployer as treasury initially

        // Link identity to legacy registry for migration
        identity.setLegacyRegistry(address(agentRegistry));

        // Distribute token allocations
        // 25M to ecosystem (staking rewards)
        token.transfer(address(staking), 25_000_000 ether);
        // 30M to treasury vesting (4yr unlock)
        token.transfer(address(vesting), 30_000_000 ether);

        vm.stopBroadcast();

        // ═══════════════════════════════════════════
        //  6. Log all addresses
        // ═══════════════════════════════════════════

        console.log("=== AgentEcon V2 Deployment ===");
        console.log("");
        console.log("--- V1 Contracts ---");
        console.log("TaskRegistry:     ", address(taskRegistry));
        console.log("BountyEscrow:     ", address(bountyEscrow));
        console.log("AgentRegistry:    ", address(agentRegistry));
        console.log("");
        console.log("--- V2 Contracts ---");
        console.log("ValidatorPoolV2:  ", address(validatorPool));
        console.log("ABBCoreV2:        ", address(core));
        console.log("");
        console.log("--- ERC-8004 ---");
        console.log("AgentIdentity:    ", address(identity));
        console.log("ReputationRegistry:", address(reputation));
        console.log("");
        console.log("--- Token ---");
        console.log("AECONToken:       ", address(token));
        console.log("TokenVesting:     ", address(vesting));
        console.log("ValidatorStaking: ", address(staking));
        console.log("");
        console.log("Deployer:         ", deployer);
    }
}
