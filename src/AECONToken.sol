// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title AECON Token — Governance & utility token for AgentEcon protocol
/// @notice Fixed supply ERC-20 with ERC-20Votes for on-chain governance.
///         100,000,000 AECON minted at deploy. No inflation. No mint function.
/// @dev Allocation:
///   30% Protocol Treasury (locked in vesting)
///   25% Ecosystem Rewards (validator + agent incentives)
///   15% Initial Liquidity (paired with ETH on Aerodrome)
///   15% Team / Founder (1-year cliff, 3-year linear vest)
///   10% Grants & Partnerships
///    5% Community Airdrop
contract AECONToken is ERC20, ERC20Permit, ERC20Votes, Ownable2Step {
    uint256 public constant TOTAL_SUPPLY = 100_000_000 ether; // 100M with 18 decimals

    /// @notice All tokens minted to deployer at construction.
    ///         Deployer then distributes to vesting contracts, LP, etc.
    /// @param _owner Address that receives total supply and contract ownership
    constructor(address _owner) ERC20("AgentEcon", "AECON") ERC20Permit("AgentEcon") Ownable(_owner) {
        _mint(_owner, TOTAL_SUPPLY);
    }

    // ─── Overrides required by Solidity for ERC20Votes ───

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner_) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner_);
    }
}
