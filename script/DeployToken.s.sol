// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/AECONToken.sol";
import "../src/TokenVesting.sol";
import "../src/ValidatorStaking.sol";

/// @title Deploy $AECON token ecosystem
/// @notice Deploys token, vesting, and staking contracts.
///         Then sets up allocations per tokenomics:
///           30% Protocol Treasury (vested 4 years, no cliff)
///           25% Ecosystem Rewards (vested 4 years, no cliff)
///           15% Initial Liquidity (sent to deployer for LP creation)
///           15% Team/Founder (vested 1yr cliff + 3yr linear)
///           10% Grants & Partnerships (vested 2 years, no cliff)
///            5% Community Airdrop (sent to deployer for distribution)
///
///   Env vars:
///     PRIVATE_KEY              - deployer private key
///     TREASURY_ADDRESS         - multisig/treasury address (default: deployer)
///     TEAM_ADDRESS             - team vesting beneficiary (default: deployer)
contract DeployToken is Script {
    uint256 constant TOTAL_SUPPLY = 100_000_000 ether;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Optional: separate treasury and team addresses
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        address team = vm.envOr("TEAM_ADDRESS", deployer);

        console.log("Deployer:", deployer);
        console.log("Treasury:", treasury);
        console.log("Team:", team);

        vm.startBroadcast(deployerKey);

        // 1. Deploy token — all 100M minted to deployer
        AECONToken token = new AECONToken(deployer);
        console.log("AECONToken:", address(token));
        require(token.balanceOf(deployer) == TOTAL_SUPPLY, "Supply mismatch");

        // 2. Deploy vesting contract
        TokenVesting vesting = new TokenVesting(address(token), deployer);
        console.log("TokenVesting:", address(vesting));

        // 3. Deploy validator staking
        ValidatorStaking staking = new ValidatorStaking(address(token), deployer);
        console.log("ValidatorStaking:", address(staking));

        // 4. Approve vesting contract to pull tokens
        token.approve(address(vesting), TOTAL_SUPPLY);

        // 5. Create vesting grants
        uint64 now_ = uint64(block.timestamp);

        // 30% Protocol Treasury — 4 year linear, no cliff
        vesting.createGrant(
            treasury,
            30_000_000 ether,
            now_,
            0, // no cliff
            4 * 365 days // 4 year vest
        );
        console.log("Treasury grant: 30M AECON, 4yr vest");

        // 25% Ecosystem Rewards — sent to staking contract for distribution
        token.transfer(address(staking), 25_000_000 ether);
        console.log("Ecosystem rewards: 25M AECON -> staking contract");

        // 15% Team/Founder — 1 year cliff, 4 year total vest
        vesting.createGrant(
            team,
            15_000_000 ether,
            now_,
            365 days, // 1 year cliff
            4 * 365 days // 4 year total vest
        );
        console.log("Team grant: 15M AECON, 1yr cliff + 4yr vest");

        // 10% Grants & Partnerships — 2 year linear, no cliff
        // Sent to treasury address via vesting (separate grant if different address)
        // If treasury == team, we can't create duplicate grant, so hold in deployer
        if (treasury != deployer) {
            // Treasury already has a grant, hold grants allocation in deployer
            console.log("Grants allocation: 10M AECON held by deployer for governance distribution");
        } else {
            console.log("Grants allocation: 10M AECON held by deployer for governance distribution");
        }

        // 15% Initial Liquidity — stays with deployer for Aerodrome LP creation
        console.log("Liquidity allocation: 15M AECON held by deployer for LP");

        // 5% Community Airdrop — stays with deployer for distribution
        console.log("Airdrop allocation: 5M AECON held by deployer for distribution");

        vm.stopBroadcast();

        // Verify allocations
        uint256 vestingBalance = token.balanceOf(address(vesting));
        uint256 stakingBalance = token.balanceOf(address(staking));
        uint256 deployerBalance = token.balanceOf(deployer);

        console.log("\n=== Token Deployment Complete ===");
        console.log("AECONToken:", address(token));
        console.log("TokenVesting:", address(vesting));
        console.log("ValidatorStaking:", address(staking));
        console.log("Vesting contract balance:", vestingBalance / 1 ether, "AECON");
        console.log("Staking contract balance:", stakingBalance / 1 ether, "AECON");
        console.log("Deployer balance:", deployerBalance / 1 ether, "AECON (liquidity + airdrop + grants)");
        console.log("Total:", (vestingBalance + stakingBalance + deployerBalance) / 1 ether, "AECON");
    }
}
