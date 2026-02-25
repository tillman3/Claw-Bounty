// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title Deploy TimelockController and transfer ownership of ABB contracts
/// @notice Run AFTER Deploy.s.sol. Deploys a TimelockController, then transfers
///         ownership of all 5 ABB contracts to it via Ownable2Step.
///
///   Governance architecture:
///
///   ┌─────────────┐  proposes   ┌────────────────────┐  owns   ┌──────────────┐
///   │  Multisig /  │ ─────────► │  TimelockController │ ──────► │  ABBCore     │
///   │  Deployer    │  executes  │  (minDelay: 24h*)   │         │  + 4 modules │
///   └─────────────┘             └────────────────────┘         └──────────────┘
///
///   * 0 for testnet, 86400 (24h) recommended for mainnet.
///
///   After deployment, replace deployer with a Safe multisig:
///     1. Grant PROPOSER_ROLE + EXECUTOR_ROLE to the Safe via timelock
///     2. Revoke roles from deployer EOA via timelock
///     3. Optionally renounce TIMELOCK_ADMIN_ROLE from deployer
///
///   Env vars:
///     PRIVATE_KEY              - deployer (must be current owner of all contracts)
///     TIMELOCK_MIN_DELAY       - seconds (default: 0)
///     AGENT_REGISTRY           - deployed address
///     TASK_REGISTRY            - deployed address
///     BOUNTY_ESCROW            - deployed address
///     VALIDATOR_POOL           - deployed address
///     ABB_CORE                 - deployed address
contract DeployTimelock is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY", uint256(0));

        address[5] memory contracts = [
            vm.envAddress("AGENT_REGISTRY"),
            vm.envAddress("TASK_REGISTRY"),
            vm.envAddress("BOUNTY_ESCROW"),
            vm.envAddress("VALIDATOR_POOL"),
            vm.envAddress("ABB_CORE")
        ];

        console.log("Deployer:", deployer);
        console.log("TimelockController minDelay:", minDelay);

        vm.startBroadcast(deployerKey);

        // Deploy TimelockController: deployer is proposer + executor + admin
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = deployer;

        TimelockController timelock = new TimelockController(minDelay, proposers, executors, deployer);
        console.log("TimelockController:", address(timelock));

        // Initiate ownership transfer (Ownable2Step: step 1)
        for (uint256 i = 0; i < 5; i++) {
            Ownable2Step(contracts[i]).transferOwnership(address(timelock));
            console.log("  transferOwnership initiated:", contracts[i]);
        }

        // If minDelay == 0 (testnet), schedule+execute acceptOwnership immediately
        if (minDelay == 0) {
            for (uint256 i = 0; i < 5; i++) {
                _acceptViaTimelock(timelock, contracts[i]);
            }
            console.log("All ownership accepted (minDelay=0, immediate)");
        } else {
            // Schedule a batch to accept ownership after the delay
            uint256[] memory values = new uint256[](5);
            bytes[] memory payloads = new bytes[](5);
            address[] memory targets = new address[](5);
            for (uint256 i = 0; i < 5; i++) {
                targets[i] = contracts[i];
                payloads[i] = abi.encodeWithSignature("acceptOwnership()");
            }
            bytes32 salt = keccak256("deploy-accept-ownership");
            timelock.scheduleBatch(targets, values, payloads, bytes32(0), salt, minDelay);
            console.log("Batch acceptOwnership scheduled. Execute after delay.");
        }

        vm.stopBroadcast();
    }

    function _acceptViaTimelock(TimelockController timelock, address target) internal {
        bytes memory data = abi.encodeWithSignature("acceptOwnership()");
        bytes32 salt = keccak256(abi.encodePacked("accept-", target));
        timelock.schedule(target, 0, data, bytes32(0), salt, 0);
        timelock.execute(target, 0, data, bytes32(0), salt);
    }
}
