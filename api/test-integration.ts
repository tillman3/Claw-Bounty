/**
 * Integration test for Agent Bounty Board contracts on Base Sepolia.
 * Run: npx tsx test-integration.ts
 *
 * Tests the full flow:
 *   1. Configure short timing for testing
 *   2. Register an agent
 *   3. Create a task with 0.001 ETH bounty
 *   4. Agent claims the task
 *   5. Agent submits work
 *   6. Register 5 validators (min stake 0.1 ETH each)
 *   7. Validators commit scores
 *   8. Wait for commit phase, validators reveal scores
 *   9. Wait for reveal phase, finalize review
 *   10. Check final state
 */

import { ethers, Wallet, JsonRpcProvider, Contract, keccak256, solidityPacked, randomBytes, parseEther, formatEther } from "ethers";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, ".env") });

// --- Config ---
const RPC_URL = process.env.RPC_URL!;
const PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY!;

const ADDRESSES = {
  abbCore: process.env.ABBCORE_ADDRESS!,
  agentRegistry: process.env.AGENT_REGISTRY_ADDRESS!,
  taskRegistry: process.env.TASK_REGISTRY_ADDRESS!,
  bountyEscrow: process.env.BOUNTY_ESCROW_ADDRESS!,
  validatorPool: process.env.VALIDATOR_POOL_ADDRESS!,
};

// --- Load ABIs ---
function loadAbi(name: string) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "src", "abis", `${name}.json`), "utf8"));
}

// --- Helpers ---
function step(n: number, desc: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Step ${n}: ${desc}`);
  console.log("=".repeat(60));
}

function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.log(`  ❌ ${msg}`); }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Main ---
async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new Wallet(PRIVATE_KEY, provider);
  const signerAddr = await signer.getAddress();
  const balance = await provider.getBalance(signerAddr);

  console.log(`\n🏴‍☠️ Agent Bounty Board — Integration Test`);
  console.log(`  Signer: ${signerAddr}`);
  console.log(`  Balance: ${formatEther(balance)} ETH`);
  console.log(`  Network: Base Sepolia`);

  const MIN_BALANCE = parseEther("0.01");
  if (balance < MIN_BALANCE) {
    fail(`Insufficient balance. Need at least 0.01 ETH, have ${formatEther(balance)}`);
    process.exit(1);
  }
  const canAffordValidators = balance >= parseEther("0.6");
  if (!canAffordValidators) {
    info("⚠️  Low balance — will test steps 1-4 (agent/task/claim/submit) but skip validator flow");
    info("   Fund the signer with ~0.6 ETH to test the full commit-reveal-finalize flow");
  }

  // Contracts
  const abbCore = new Contract(ADDRESSES.abbCore, loadAbi("ABBCore"), signer);
  const agentRegistry = new Contract(ADDRESSES.agentRegistry, loadAbi("AgentRegistry"), signer);
  const taskRegistry = new Contract(ADDRESSES.taskRegistry, loadAbi("TaskRegistry"), signer);
  const bountyEscrow = new Contract(ADDRESSES.bountyEscrow, loadAbi("BountyEscrow"), signer);
  const validatorPool = new Contract(ADDRESSES.validatorPool, loadAbi("ValidatorPool"), signer);

  const results: { step: string; status: "pass" | "fail"; error?: string }[] = [];

  // ---------------------------------------------------------------
  // Step 0: Configure short timing (owner only)
  // ---------------------------------------------------------------
  step(0, "Configure short commit/reveal timing (5s each)");
  try {
    const tx = await abbCore.configureTiming(5, 5);
    await tx.wait();
    pass("Timing set to 5s commit + 5s reveal");
    results.push({ step: "Configure timing", status: "pass" });
  } catch (e: any) {
    fail(`Configure timing failed: ${e.message}`);
    results.push({ step: "Configure timing", status: "fail", error: e.message });
    // Non-fatal — may already be configured
  }

  // ---------------------------------------------------------------
  // Step 1: Register an agent
  // ---------------------------------------------------------------
  step(1, "Register an agent");
  let agentId: bigint;
  try {
    const metadataHash = keccak256(Buffer.from("test-agent-metadata-" + Date.now()));
    const tx = await agentRegistry.registerAgent(metadataHash);
    const receipt = await tx.wait();
    // Parse AgentRegistered event
    const event = receipt.logs.find((l: any) => {
      try { return agentRegistry.interface.parseLog(l)?.name === "AgentRegistered"; } catch { return false; }
    });
    const parsed = agentRegistry.interface.parseLog(event);
    agentId = parsed!.args[0];
    pass(`Agent registered with ID: ${agentId}`);
    results.push({ step: "Register agent", status: "pass" });
  } catch (e: any) {
    fail(`Register agent failed: ${e.message}`);
    results.push({ step: "Register agent", status: "fail", error: e.message });
    process.exit(1);
  }

  // ---------------------------------------------------------------
  // Step 2: Create a task with 0.001 ETH bounty
  // ---------------------------------------------------------------
  step(2, "Create task with 0.001 ETH bounty");
  let taskId: bigint;
  try {
    const descHash = keccak256(Buffer.from("test-task-description-" + Date.now()));
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const tx = await abbCore.createTaskETH(descHash, deadline, { value: parseEther("0.001") });
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => {
      try { return abbCore.interface.parseLog(l)?.name === "TaskCreatedAndFunded"; } catch { return false; }
    });
    const parsed = abbCore.interface.parseLog(event);
    taskId = parsed!.args[0];
    pass(`Task created with ID: ${taskId}, bounty: 0.001 ETH`);
    results.push({ step: "Create task", status: "pass" });
  } catch (e: any) {
    fail(`Create task failed: ${e.message}`);
    results.push({ step: "Create task", status: "fail", error: e.message });
    process.exit(1);
  }

  // ---------------------------------------------------------------
  // Step 3: Agent claims the task
  // ---------------------------------------------------------------
  step(3, "Agent claims the task");
  try {
    const tx = await abbCore.claimTask(taskId!, agentId!);
    await tx.wait();
    pass(`Agent ${agentId} claimed task ${taskId}`);
    results.push({ step: "Claim task", status: "pass" });
  } catch (e: any) {
    fail(`Claim task failed: ${e.message}`);
    results.push({ step: "Claim task", status: "fail", error: e.message });
    process.exit(1);
  }

  // ---------------------------------------------------------------
  // Step 4: Agent submits work
  // Note: submitWork calls selectPanel which needs 5 validators.
  // If we can't afford validators, we test submitWork expecting a revert.
  // ---------------------------------------------------------------
  if (!canAffordValidators) {
    step(4, "Agent submits work (expecting revert — no validators)");
    try {
      const submissionHash = keccak256(Buffer.from("test-submission-" + Date.now()));
      const tx = await abbCore.submitWork(taskId!, submissionHash);
      await tx.wait();
      // If it succeeded, great
      pass(`Work submitted for task ${taskId}`);
      results.push({ step: "Submit work", status: "pass" });
    } catch (e: any) {
      // 0xae575a88 = NotEnoughValidators(), 0x8f9a780c = InvalidStateTransition()
      if (e.message.includes("NotEnoughValidators") || e.data === "0xae575a88" || e.message.includes("0xae575a88")) {
        pass("Correctly reverted with NotEnoughValidators (no validators registered)");
        results.push({ step: "Submit work (no validators)", status: "pass" });
      } else {
        fail(`Submit work failed unexpectedly: ${e.message}`);
        results.push({ step: "Submit work", status: "fail", error: e.message });
      }
    }

    // Skip to summary
  } else {

  // Full flow with validators
  step(4, "Agent submits work");
  try {
    const submissionHash = keccak256(Buffer.from("test-submission-" + Date.now()));
    const tx = await abbCore.submitWork(taskId!, submissionHash);
    await tx.wait();
    pass(`Work submitted for task ${taskId}`);
    results.push({ step: "Submit work", status: "pass" });

    const taskState = await taskRegistry.getTaskState(taskId!);
    info(`Task state after submission: ${taskState} (3 = InReview)`);
  } catch (e: any) {
    fail(`Submit work failed: ${e.message}`);
    results.push({ step: "Submit work", status: "fail", error: e.message });
    info("This likely failed because we need 5 validators first. Continuing to register validators...");
  }

  // ---------------------------------------------------------------
  // Step 5: Register 5 validators (0.1 ETH stake each)
  // ---------------------------------------------------------------
  step(5, "Register 5 validators");
  // We need 5 separate addresses. Generate from the signer's key deterministically.
  const validatorWallets: Wallet[] = [];
  try {
    // Create 5 wallets and fund them
    for (let i = 0; i < 5; i++) {
      const seed = keccak256(solidityPacked(["bytes32", "uint256"], [PRIVATE_KEY, i]));
      const w = new Wallet(seed, provider);
      validatorWallets.push(w);

      // Fund the wallet (0.15 ETH: 0.1 stake + gas)
      const wBal = await provider.getBalance(w.address);
      if (wBal < parseEther("0.12")) {
        info(`Funding validator ${i} (${w.address})...`);
        const fundTx = await signer.sendTransaction({ to: w.address, value: parseEther("0.15") });
        await fundTx.wait();
      } else {
        info(`Validator ${i} (${w.address}) already funded: ${formatEther(wBal)} ETH`);
      }
    }

    // Register each validator
    for (let i = 0; i < 5; i++) {
      const vp = validatorPool.connect(validatorWallets[i]) as Contract;
      try {
        const tx = await vp.registerValidator({ value: parseEther("0.1") });
        await tx.wait();
        pass(`Validator ${i} registered (${validatorWallets[i].address})`);
      } catch (e: any) {
        if (e.message.includes("AlreadyRegistered")) {
          info(`Validator ${i} already registered`);
        } else {
          throw e;
        }
      }
    }

    const activeCount = await validatorPool.getActiveValidatorCount();
    info(`Active validators: ${activeCount}`);
    results.push({ step: "Register validators", status: "pass" });
  } catch (e: any) {
    fail(`Register validators failed: ${e.message}`);
    results.push({ step: "Register validators", status: "fail", error: e.message });
    process.exit(1);
  }

  // If step 4 failed (no validators), retry submitting work now
  if (results.find(r => r.step === "Submit work")?.status === "fail") {
    step(4.5, "Retry: Agent submits work (now with validators)");
    try {
      // Task is still in Claimed state — resubmit
      const submissionHash = keccak256(Buffer.from("test-submission-retry-" + Date.now()));
      const tx = await abbCore.submitWork(taskId!, submissionHash);
      await tx.wait();
      pass(`Work submitted for task ${taskId}`);
      results.push({ step: "Submit work (retry)", status: "pass" });
    } catch (e: any) {
      fail(`Submit work retry failed: ${e.message}`);
      results.push({ step: "Submit work (retry)", status: "fail", error: e.message });
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------
  // Step 6: Validators commit scores
  // ---------------------------------------------------------------
  step(6, "Validators commit scores");
  const score = 80; // Above PASS_SCORE (60)
  const salts: Uint8Array[] = [];
  try {
    // Get the panel validators for this task
    // All 5 of our validators should be on the panel
    for (let i = 0; i < 5; i++) {
      const salt = randomBytes(32);
      salts.push(salt);
      const commitHash = keccak256(solidityPacked(
        ["uint256", "uint8", "bytes32"],
        [taskId!, score, salt]
      ));
      const vp = validatorPool.connect(validatorWallets[i]) as Contract;
      const tx = await vp.commitScore(taskId!, commitHash);
      await tx.wait();
      pass(`Validator ${i} committed score`);
    }
    results.push({ step: "Commit scores", status: "pass" });
  } catch (e: any) {
    fail(`Commit scores failed: ${e.message}`);
    results.push({ step: "Commit scores", status: "fail", error: e.message });
    // Some validators may not be on panel — report and continue
  }

  // ---------------------------------------------------------------
  // Step 7: Wait for commit phase, then reveal
  // ---------------------------------------------------------------
  step(7, "Wait for commit phase to end, then reveal scores");
  try {
    info("Waiting 10s for commit phase to end...");
    await sleep(10000);

    for (let i = 0; i < 5; i++) {
      try {
        const vp = validatorPool.connect(validatorWallets[i]) as Contract;
        const tx = await vp.revealScore(taskId!, score, salts[i]);
        await tx.wait();
        pass(`Validator ${i} revealed score: ${score}`);
      } catch (e: any) {
        fail(`Validator ${i} reveal failed: ${e.message}`);
      }
    }
    results.push({ step: "Reveal scores", status: "pass" });
  } catch (e: any) {
    fail(`Reveal scores failed: ${e.message}`);
    results.push({ step: "Reveal scores", status: "fail", error: e.message });
  }

  // ---------------------------------------------------------------
  // Step 8: Finalize review
  // ---------------------------------------------------------------
  step(8, "Wait for reveal phase, then finalize review");
  try {
    info("Waiting 10s for reveal phase to end...");
    await sleep(10000);

    const tx = await abbCore.finalizeReview(taskId!);
    await tx.wait();
    pass("Review finalized");
    results.push({ step: "Finalize review", status: "pass" });
  } catch (e: any) {
    fail(`Finalize review failed: ${e.message}`);
    results.push({ step: "Finalize review", status: "fail", error: e.message });
  }

  // ---------------------------------------------------------------
  // Step 9: Check final state
  // ---------------------------------------------------------------
  step(9, "Check final state");
  try {
    const task = await taskRegistry.getTask(taskId!);
    const taskState = Number(task.state);
    const stateNames = ["Open", "Claimed", "Submitted", "InReview", "Completed", "Disputed", "Resolved", "Cancelled"];
    info(`Task state: ${stateNames[taskState]} (${taskState})`);

    const agent = await agentRegistry.getAgent(agentId!);
    info(`Agent reputation: ${agent.reputationScore}`);
    info(`Agent tasks completed: ${agent.tasksCompleted}`);
    info(`Agent total earned: ${formatEther(agent.totalEarned)} ETH`);

    const claimable = await bountyEscrow.claimableETH(signerAddr);
    info(`Claimable ETH for signer: ${formatEther(claimable)}`);

    if (taskState === 4) { // Completed
      pass("Task completed successfully! Full flow works.");
      results.push({ step: "Final state check", status: "pass" });
    } else {
      fail(`Unexpected task state: ${stateNames[taskState]}`);
      results.push({ step: "Final state check", status: "fail", error: `State: ${stateNames[taskState]}` });
    }
  } catch (e: any) {
    fail(`Final state check failed: ${e.message}`);
    results.push({ step: "Final state check", status: "fail", error: e.message });
  }

  } // end canAffordValidators

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  console.log(`\n${"=".repeat(60)}`);
  console.log("  📊 Integration Test Summary");
  console.log("=".repeat(60));
  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : "❌";
    console.log(`  ${icon} ${r.step}${r.error ? ` — ${r.error}` : ""}`);
    if (r.status === "pass") passed++; else failed++;
  }
  console.log(`\n  Total: ${passed} passed, ${failed} failed out of ${results.length}`);
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
