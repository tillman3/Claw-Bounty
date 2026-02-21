# Security Audit Report — AgentEcon Smart Contracts

**Date:** 2026-02-21  
**Auditor:** TARS (automated)  
**Contracts:** ABBCore, AgentRegistry, TaskRegistry, BountyEscrow, ValidatorPool  
**Solidity:** 0.8.24 (built-in overflow protection)  
**Framework:** OpenZeppelin (Ownable2Step, Pausable, ReentrancyGuard, SafeERC20)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 3 |
| Medium | 5 |
| Low | 4 |
| Informational | 5 |

**Overall Risk: MEDIUM-HIGH** — The critical finding (validator panel manipulation) and high findings need to be addressed before mainnet deployment.

---

## Critical

### C-1: Validator Panel Selection is Manipulable by Miners/Sequencers

**Contract:** `ValidatorPool.selectPanel()`  
**Lines:** ~165-190

**Description:** The panel selection uses `block.timestamp` and `block.prevrandao` as the randomness seed:
```solidity
uint256 seed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, taskId)));
```
On L2s like Base, the sequencer controls `block.timestamp` and `prevrandao`, meaning a malicious sequencer (or MEV actor colluding with the sequencer) can influence which validators are selected for a panel.

**Impact:** A malicious actor could ensure their own validators are selected for every review, rubber-stamping their own submissions and draining bounties.

**Recommendation:** Integrate Chainlink VRF (already marked as TODO). This is the #1 priority for mainnet.

---

## High

### H-1: `commitScore` Does Not Verify Caller is on the Panel

**Contract:** `ValidatorPool.commitScore()`  

**Description:** Any active validator can commit a score for any task — not just those selected for the panel. The function only checks `onlyActiveValidator`, not membership in `round.validators[]`.

**Impact:** Non-panel validators could stuff commits. While `finalizeRound` only iterates `round.validators`, the extra commits waste gas and could confuse off-chain monitoring.

**Recommendation:** Add a panel membership check:
```solidity
bool onPanel = false;
for (uint i; i < round.validators.length; i++) {
    if (round.validators[i] == msg.sender) { onPanel = true; break; }
}
require(onPanel, "Not on panel");
```

### H-2: `createTaskToken` — Token Transfer Happens from `depositor` (msg.sender of ABBCore), Not the Actual User

**Contract:** `BountyEscrow.depositToken()` + `ABBCore.createTaskToken()`

**Description:** In `ABBCore.createTaskToken()`, the escrow calls `safeTransferFrom(depositor, ...)` where `depositor = msg.sender` (the user). However, the user must have approved **BountyEscrow** (not ABBCore) to spend their tokens. The flow is:
1. User calls `ABBCore.createTaskToken()`
2. ABBCore calls `bountyEscrow.depositToken(taskId, msg.sender, token, amount)`
3. BountyEscrow calls `safeTransferFrom(msg.sender_of_ABBCore, this, amount)` — but `msg.sender` inside BountyEscrow is **ABBCore**, not the user

Wait — actually `depositor` is passed explicitly as the user's address. So `safeTransferFrom(depositor=user, address(this), amount)` requires the **user** to have approved the **BountyEscrow** contract. This works but is confusing — the user interacts with ABBCore but must approve BountyEscrow.

**Impact:** Users will get reverts unless they know to approve BountyEscrow directly. UX issue that will cause failed transactions.

**Recommendation:** Either:
- Have ABBCore pull tokens from user first, then forward to escrow, OR
- Document clearly that users must approve BountyEscrow, OR
- Use a permit-based flow

### H-3: `finalizeReview` Can Be Called by Anyone — Rejected Work Path Disputes and Resolves in Same TX

**Contract:** `ABBCore.finalizeReview()`

**Description:** When work is rejected, `finalizeReview` calls:
```solidity
taskRegistry.disputeTask(taskId, address(this));
taskRegistry.resolveDispute(taskId, false);
```
This transitions the task through Disputed → Resolved in a single transaction, skipping any actual dispute window. The dispute mechanism becomes meaningless for validator-rejected work.

**Impact:** Agents have no recourse to dispute a validator panel's rejection. The dispute flow is only useful when manually raised.

**Recommendation:** On rejection, move to a Disputed state and allow a time window for the agent to contest before auto-resolving.

---

## Medium

### M-1: No Slashing of Non-Revealing Validators

**Contract:** `ValidatorPool.finalizeRound()`

**Description:** Validators who commit but don't reveal face no penalty. They can grief the system by committing to prevent others from knowing if quorum will be met, then not revealing.

**Impact:** If >2 of 5 panel validators don't reveal, `revealCount < 3` and the scores array will be too small, but the code still proceeds with whatever reveals exist. With 0 reveals, `scores` is empty and `scores[scores.length / 2]` will revert with index out of bounds.

**Recommendation:** 
- Check `revealCount >= requiredReveals` before proceeding
- Slash non-revealers' stake
- Handle the 0-reveals edge case

### M-2: `finalizeRound` Reverts on Zero Reveals

**Contract:** `ValidatorPool.finalizeRound()`

**Description:** If no validators reveal, `scores` has length 0, and `scores[scores.length / 2]` = `scores[0]` accesses an empty array, causing a revert. This locks the task permanently in `InReview`.

**Impact:** DoS — task can never be finalized, bounty stuck in escrow forever.

**Recommendation:** Add `require(round.revealCount > 0, "No reveals")` with a fallback path (e.g., refund poster).

### M-3: Agent ID 0 Ambiguity

**Contract:** `AgentRegistry`, `TaskRegistry`

**Description:** `nextAgentId` starts at 0, so the first agent gets ID 0. In `TaskRegistry`, `assignedAgent` defaults to 0, which is also a valid agent ID. There's no way to distinguish "no agent assigned" from "agent 0 assigned".

**Impact:** Agent 0 could appear assigned to tasks they haven't claimed.

**Recommendation:** Start `nextAgentId` at 1, or use a sentinel value like `type(uint256).max` for unassigned.

### M-4: `revealScore` Error Message Reuse — `CommitDeadlinePassed` Used for "Too Early"

**Contract:** `ValidatorPool.revealScore()`

**Description:** The check `if (block.timestamp <= round.commitDeadline) revert CommitDeadlinePassed()` fires when the commit deadline has NOT yet passed (i.e., reveal is too early). The error name is misleading.

**Recommendation:** Use a dedicated error like `CommitPhaseNotEnded()`.

### M-5: Panel Selection Can Fail Silently with Inactive Validators in List

**Contract:** `ValidatorPool.selectPanel()`

**Description:** `activeValidatorCount` might be ≥5 but the Fisher-Yates loop might not find 5 active validators if the shuffle order is unlucky and many inactive validators are at the front. The loop runs `len` iterations but breaks early based on `selected`.

Actually on closer inspection, the loop iterates all `len` candidates so this is fine — it will find all active ones. But if exactly 5 are active and some get swapped to later positions... no, the full scan handles it. This is actually OK but the `activeValidatorCount` check should be `>=` not `<` (it is `<`, which is correct).

**Revised:** This is less of an issue than initially thought. Downgraded to informational.

---

## Low

### L-1: `validatorList` Array Grows Indefinitely

**Contract:** `ValidatorPool`

**Description:** Deactivated validators remain in `validatorList`. Over time, panel selection iterates an ever-growing array, increasing gas costs.

**Recommendation:** Consider a compact list or epoch-based rotation.

### L-2: No Event Emitted on Escrow Deposit Overwrite

**Contract:** `BountyEscrow.depositETH()` / `depositToken()`

**Description:** If `depositETH` is called twice for the same `taskId`, the previous entry is silently overwritten, losing track of the first deposit's ETH (which is still in the contract but unaccounted for).

**Recommendation:** Add `require(escrows[taskId].amount == 0, "Already deposited")`.

### L-3: `configureTiming` Allows Zero Duration

**Contract:** `ABBCore.configureTiming()`

**Description:** Owner can set `commitDuration` and `revealDuration` to 0, making commit-reveal meaningless.

**Recommendation:** Add minimum duration checks.

### L-4: Slashed Funds Stay in Contract Forever

**Contract:** `ValidatorPool.slash()`

**Description:** Slashed ETH is deducted from the validator's `stakeAmount` but there's no mechanism to withdraw slashed funds from the contract. They're locked permanently.

**Recommendation:** Add a treasury withdrawal function for slashed funds.

---

## Informational

### I-1: Solidity 0.8.24 Provides Overflow Protection
All arithmetic is safe by default. No custom SafeMath needed. ✅

### I-2: `Ownable2Step` Used Correctly
Two-step ownership transfer prevents accidental transfers. ✅

### I-3: Pull Payment Pattern in BountyEscrow
`release()` credits balances, `withdrawETH()`/`withdrawToken()` are separate — good pattern preventing reentrancy on release. ✅

### I-4: `ReentrancyGuard` Applied to All ETH-Sending Functions
`withdrawETH`, `completeUnstake`, `finalizeReview` all use `nonReentrant`. ✅

### I-5: Fee Calculation
`feeBps` capped at 1000 (10%) via `MAX_FEE_BPS`. Fee math: `feeAmount = (amount * feeBps) / 10_000`. For 5% (500 bps), this is correct. No rounding exploit possible at realistic amounts.

---

## Commit-Reveal Analysis

The commit-reveal scheme is **mostly correct**:
- Validators commit `keccak256(taskId, score, salt)` during commit phase
- Reveals happen after commit deadline, before reveal deadline
- Scores are hidden during commit phase ✅
- **However:** Commits are visible on-chain (`commitments` mapping is public by default in Solidity). While the hash doesn't reveal the score, the *timing* and *identity* of committers is visible. A validator could wait until seeing other commits before committing, or not commit at all based on who else committed. This is inherent to on-chain commit-reveal but worth noting.

---

## Gas Optimization Notes

1. `GET /tasks` and `GET /agents` API endpoints iterate all IDs sequentially — will be very slow with many tasks. Consider events-based indexing or subgraph.
2. `validatorList` full copy in `selectPanel` is O(n) memory — costly with many validators.
3. `operatorAgents` array in AgentRegistry never shrinks on deregister.
