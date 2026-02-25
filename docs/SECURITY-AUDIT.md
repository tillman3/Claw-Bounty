# Security Audit Report — AgentEcon Smart Contracts

**Date:** 2026-02-25 (Updated)  
**Previous Audit:** 2026-02-21  
**Auditor:** TARS (automated)  
**Contracts:** ABBCore, AgentRegistry, TaskRegistry, BountyEscrow, ValidatorPool  
**Solidity:** 0.8.24 (built-in overflow protection)  
**Framework:** OpenZeppelin (Ownable2Step, Pausable, ReentrancyGuard, SafeERC20)  
**Notable Change:** Chainlink VRF V2.5 integrated for panel selection randomness

---

## Summary

| Severity | Count | Resolved | Open |
|----------|-------|----------|------|
| Critical | 1 | 1 | 0 |
| High | 4 | 0 | 4 |
| Medium | 4 | 0 | 4 |
| Low | 4 | 0 | 4 |
| Informational | 6 | — | — |

**Overall Risk: MEDIUM** — Critical randomness issue resolved. Remaining high findings need fixes before mainnet.

---

## Critical

### C-1: Validator Panel Selection is Manipulable by Miners/Sequencers — ✅ RESOLVED

**Status:** RESOLVED (2026-02-24)  
**Resolution:** Chainlink VRF V2.5 integrated. `requestPanel()` calls `vrfCoordinator.requestRandomWords()`, and panel selection occurs in `rawFulfillRandomWords()` callback with verified on-chain randomness. Fisher-Yates shuffle uses VRF-provided seed.

**Verification:**
- `rawFulfillRandomWords` correctly checks `msg.sender == address(vrfCoordinator)` ✅
- `panelSelected[taskId]` is only set inside VRF callback ✅
- `panelSelected` cannot be externally manipulated — no setter, only written in callback ✅
- `PanelAlreadyRequested` check prevents duplicate requests ✅

---

## High

### H-1: `commitScore` Does Not Verify Caller is on the Panel — ⚠️ OPEN

**Contract:** `ValidatorPool.commitScore()`

**Description:** Any active validator can commit a score for any task — not just those selected for the panel. Only `onlyActiveValidator` is checked, not panel membership.

**Impact:** Non-panel validators can stuff commits. While `finalizeRound` only iterates `round.validators`, the extra state writes waste gas and pollute the `commitments` mapping.

**Recommendation:** Add panel membership check before accepting commit.

### H-2: Token Approval UX — User Must Approve BountyEscrow, Not ABBCore — ⚠️ OPEN

**Contract:** `BountyEscrow.depositToken()` + `ABBCore.createTaskToken()`

**Description:** `safeTransferFrom(depositor, address(this), amount)` in BountyEscrow requires the user to have approved the **BountyEscrow** contract directly, but the user interacts with ABBCore.

**Impact:** Failed transactions for users who approve ABBCore instead of BountyEscrow.

**Recommendation:** Have ABBCore pull tokens first and forward, or use EIP-2612 permit flow.

### H-3: `finalizeReview` Rejection Bypasses Dispute Window — ⚠️ OPEN

**Contract:** `ABBCore.finalizeReview()`

**Description:** On validator rejection, `disputeTask()` and `resolveDispute()` are called in the same transaction — no dispute window for the agent.

**Impact:** Agents have zero recourse against unfair validator rejections through the on-chain dispute path.

**Recommendation:** On rejection, move to Disputed state with a configurable grace period before auto-resolution.

### H-4: VRF Callback Can Silently Create Incomplete Panel — 🆕 NEW

**Contract:** `ValidatorPool.rawFulfillRandomWords()`

**Description:** `activeValidatorCount >= PANEL_SIZE` is checked at `requestPanel()` time, but validators can deactivate (unstake) between VRF request and callback. If `activeValidatorCount` drops below 5, the Fisher-Yates loop selects fewer than `PANEL_SIZE` validators, but the round is still initialized with `panelSelected[taskId] = true`. The round proceeds with an undersized panel.

**Impact:** A review round with <5 validators has weaker consensus guarantees. With <3 active panel members, achieving `CONSENSUS_THRESHOLD` (3) reveals becomes impossible, causing permanent DoS (task stuck in InReview — see M-2).

**Recommendation:** After the selection loop, verify `selected == PANEL_SIZE`. If not, mark the round as failed and allow re-request.

---

## Medium

### M-1: No Slashing of Non-Revealing Validators — ⚠️ OPEN

**Contract:** `ValidatorPool.finalizeRound()`

**Description:** Validators who commit but don't reveal face no penalty. They can grief the system by committing then withholding reveals.

**Impact:** If >2 of 5 panel validators don't reveal, quorum cannot be met. Combined with M-2, this permanently locks the task.

**Recommendation:** Slash non-revealers during `finalizeRound`. Track who committed but didn't reveal.

### M-2: `finalizeRound` Reverts on Zero Reveals — DoS — ⚠️ OPEN

**Contract:** `ValidatorPool.finalizeRound()`

**Description:** If no validators reveal, `scores` has length 0 and `scores[scores.length / 2]` causes an index-out-of-bounds revert. Task is permanently stuck in InReview, bounty locked forever.

**Impact:** Permanent DoS. Any task where all panel validators refuse to reveal is irrecoverable.

**Recommendation:** `require(revealCount > 0)` with a fallback path (refund poster, allow re-panel).

### M-3: Agent ID 0 Ambiguity — ⚠️ OPEN

**Contract:** `AgentRegistry`, `TaskRegistry`

**Description:** `nextAgentId` starts at 0; `assignedAgent` defaults to 0. Cannot distinguish "no agent" from "agent 0".

**Recommendation:** Start `nextAgentId` at 1.

### M-4: No VRF Request Timeout/Retry Mechanism — 🆕 NEW

**Contract:** `ValidatorPool`

**Description:** If the VRF callback never fires (coordinator issue, insufficient LINK/ETH, callback gas too low), the task is stuck: `panelSelected[taskId]` remains false, round not initialized, but `_rounds[taskId].initialized` is false so no re-request is possible since `PanelAlreadyRequested` check passes (it checks `panelSelected[taskId] || _rounds[taskId].initialized`). Wait — actually if callback never fires, both are false, so re-request IS possible. However, the `PendingPanelRequest` for the old requestId remains with `pending = true`, wasting state. More critically: there's no mechanism for the system to *know* VRF failed and trigger a re-request. The task just sits in InReview indefinitely.

**Impact:** Tasks can get stuck waiting for VRF indefinitely with no automatic recovery.

**Recommendation:** Add a timeout (e.g., 1 hour). If VRF hasn't called back, allow `retryPanelRequest(taskId)` that cancels the old pending request and issues a new one.

---

## Low

### L-1: `validatorList` Array Grows Indefinitely — OPEN

Deactivated validators remain in list. Panel selection iterates entire array — gas cost grows linearly.

### L-2: Escrow Deposit Overwrite — OPEN

`depositETH`/`depositToken` silently overwrite existing escrow entries for the same `taskId`. First deposit's ETH is stranded.

**Recommendation:** `require(escrows[taskId].amount == 0, "Already deposited")`.

### L-3: `configureTiming` Allows Zero Duration — OPEN

Owner can set `commitDuration` and `revealDuration` to 0.

**Recommendation:** Enforce minimum durations (e.g., 1 hour).

### L-4: Slashed Funds Locked Forever — OPEN

No withdrawal mechanism for slashed ETH. Funds are permanently locked in the contract.

**Recommendation:** Add treasury withdrawal for slashed funds.

---

## Informational

### I-1: Solidity 0.8.24 Overflow Protection ✅
### I-2: `Ownable2Step` Correctly Used ✅
### I-3: Pull Payment Pattern in BountyEscrow ✅
### I-4: `ReentrancyGuard` on All ETH-Sending Functions ✅
### I-5: Fee Calculation Capped at 10% ✅

### I-6: `vrfRequestConfirmations = 0` — 🆕 NEW

**Contract:** `ValidatorPool`

**Description:** Default VRF request confirmations is 0. On mainnet, this means the VRF response can be delivered in the same block as the request, offering minimal reorg protection. On Base L2 this is acceptable (sequencer finality), but on L1 Ethereum this would be risky.

**Recommendation:** For L1 deployment, set to ≥3. For Base, 0 is acceptable. Make sure `setVRFConfig` is called with appropriate value before mainnet.

---

## VRF Integration Deep Dive

### rawFulfillRandomWords — Griefing Analysis

| Attack Vector | Possible? | Notes |
|---|---|---|
| Call from non-coordinator | ❌ | `msg.sender != vrfCoordinator` check |
| Replay same requestId | ❌ | `req.pending` set to false after first call |
| Manipulate randomness | ❌ | VRF provides cryptographic proof |
| DoS via gas | ⚠️ | If `validatorList` is very large (>1000), Fisher-Yates may exceed `callbackGasLimit` (500k). Monitor and adjust. |
| Front-run callback | ❌ | Only coordinator can call; validators can't deregister in same tx |

### panelSelected Mapping — Manipulation Analysis

- Only written in `rawFulfillRandomWords` (set to `true`)
- Only read in `requestPanel` (to prevent duplicates)
- No external setter, no `delete`, no reset mechanism
- **Verdict: Cannot be manipulated** ✅
- **Caveat:** No way to reset if a round needs to be retried — needs an admin reset function for stuck rounds

---

## Commit-Reveal Analysis (Updated)

The commit-reveal scheme remains mostly correct:
- Commits hidden via `keccak256(taskId, score, salt)` ✅
- Reveal phase enforced after commit deadline ✅
- **H-1 still open:** Non-panel validators can commit (doesn't affect finalization but is messy)
- **M-4 error message** for `CommitDeadlinePassed` in reveal-too-early case is misleading (cosmetic)

---

## Reentrancy Analysis

| Function | Guard | Safe? |
|---|---|---|
| `BountyEscrow.withdrawETH()` | `nonReentrant` + CEI | ✅ |
| `BountyEscrow.withdrawToken()` | `nonReentrant` + CEI | ✅ |
| `BountyEscrow.release()` | `nonReentrant` (no external call) | ✅ |
| `ValidatorPool.completeUnstake()` | `nonReentrant` + CEI | ✅ |
| `ABBCore.finalizeReview()` | `nonReentrant` | ✅ |

**No reentrancy vulnerabilities found.** ✅

---

## Access Control Summary

| Contract | Pattern | Notes |
|---|---|---|
| ABBCore | `Ownable2Step` | Owner controls pause, timing, disputes |
| AgentRegistry | `Ownable2Step` + `authorizedCallers` | ABBCore authorized for `recordOutcome` |
| TaskRegistry | `Ownable2Step` + `authorizedCallers` | ABBCore authorized for state transitions |
| BountyEscrow | `Ownable2Step` + `authorizedCallers` | ABBCore authorized for deposit/release/refund |
| ValidatorPool | `Ownable2Step` + `authorizedCallers` | ABBCore authorized; VRF coordinator for callback |

**Note:** Owner has significant power (pause all contracts, resolve disputes, slash validators, configure fees/timing). TimelockController integration (in progress) will mitigate centralization risk.

---

## Gas Optimization Notes

1. `validatorList` full copy in `rawFulfillRandomWords` is O(n) memory — costly with many validators
2. `operatorAgents` array in AgentRegistry never shrinks
3. Fisher-Yates in VRF callback has hard gas ceiling (`vrfCallbackGasLimit = 500_000`) — may fail with >~200 validators
