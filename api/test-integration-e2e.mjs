/**
 * Full E2E Integration Test for AgentEcon on Base Sepolia
 * Run: node test-integration-e2e.mjs
 * 
 * Uses deterministic wallets so validators/agent persist across runs.
 * Skips registration for already-registered entities.
 */

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RPC_URL = "https://sepolia.base.org";
const PRIVATE_KEY = "0xc1dbab5f8ef144fd30149fc9f011f3594d6a51f123a67570d2dcdd8049cb8898";

const ADDRESSES = {
  abbCore:        "0xD41cD6D1194cd7fEA4E4356A66F2CBA0C12525e1",
  agentRegistry:  "0x8d9306058c0086480D8D315A27757ea4F9147893",
  taskRegistry:   "0x550cD829285A81605BBc5d04D64F6608A528F5Ef",
  bountyEscrow:   "0xa9BF10D5D2e380966Bab587AEa8fbf1c531926DE",
  validatorPool:  "0x8fEBfdab529966C787E37b2990A4336560F9F49a",
};

function loadAbi(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "src", "abis", `${name}.json`), "utf8"));
}

const results = [];
function step(n, desc) { console.log(`\n${"=".repeat(60)}\n  Step ${n}: ${desc}\n${"=".repeat(60)}`); }
function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitTx(tx) {
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("tx reverted");
  return receipt;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(PRIVATE_KEY, provider);
  const balance = await provider.getBalance(deployer.address);

  console.log(`\n🏴‍☠️ AgentEcon — Full E2E Integration Test`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance: ${ethers.formatEther(balance)} ETH`);

  const abbCore       = new ethers.Contract(ADDRESSES.abbCore,       loadAbi("ABBCore"),       deployer);
  const agentRegistry = new ethers.Contract(ADDRESSES.agentRegistry, loadAbi("AgentRegistry"), deployer);
  const taskRegistry  = new ethers.Contract(ADDRESSES.taskRegistry,  loadAbi("TaskRegistry"),  deployer);
  const bountyEscrow  = new ethers.Contract(ADDRESSES.bountyEscrow,  loadAbi("BountyEscrow"),  deployer);
  const validatorPool = new ethers.Contract(ADDRESSES.validatorPool, loadAbi("ValidatorPool"), deployer);

  // Deterministic wallets
  const agentOperator = new ethers.Wallet(
    ethers.keccak256(ethers.solidityPacked(["bytes32", "string"], [PRIVATE_KEY, "agent-op-v3"])), provider
  );
  const validatorWallets = [];
  for (let i = 0; i < 5; i++) {
    validatorWallets.push(new ethers.Wallet(
      ethers.keccak256(ethers.solidityPacked(["bytes32", "string", "uint256"], [PRIVATE_KEY, "val-v3", i])), provider
    ));
  }
  info(`Agent operator: ${agentOperator.address}`);
  validatorWallets.forEach((w, i) => info(`Validator ${i}: ${w.address}`));

  let nonce = await provider.getTransactionCount(deployer.address, "latest");

  // === Step 0: Configure short timing ===
  step(0, "Configure short commit/reveal timing (5s each)");
  try {
    await waitTx(await abbCore.configureTiming(5, 5, { nonce: nonce++ }));
    pass("Timing set to 5s/5s");
    results.push({ step: "Configure timing", status: "pass" });
  } catch (e) {
    fail(e.message); results.push({ step: "Configure timing", status: "fail", error: e.message });
  }

  // === Step 1: Fund agent operator ===
  step(1, "Fund agent operator");
  try {
    const bal = await provider.getBalance(agentOperator.address);
    if (bal < ethers.parseEther("0.002")) {
      await waitTx(await deployer.sendTransaction({ to: agentOperator.address, value: ethers.parseEther("0.003"), nonce: nonce++ }));
      pass("Funded agent operator");
    } else {
      info(`Already funded: ${ethers.formatEther(bal)} ETH`);
    }
    results.push({ step: "Fund agent", status: "pass" });
  } catch (e) {
    fail(e.message); results.push({ step: "Fund agent", status: "fail", error: e.message }); process.exit(1);
  }

  // === Step 2: Register agent ===
  step(2, "Register agent");
  let agentId;
  try {
    const existing = await agentRegistry.getOperatorAgents(agentOperator.address);
    if (existing.length > 0) {
      agentId = existing[0];
      info(`Agent already registered: ID ${agentId}`);
    } else {
      const tx = await agentRegistry.connect(agentOperator).registerAgent(
        ethers.keccak256(ethers.toUtf8Bytes("test-agent-" + Date.now()))
      );
      const receipt = await waitTx(tx);
      for (const log of receipt.logs) {
        try {
          const p = agentRegistry.interface.parseLog(log);
          if (p?.name === "AgentRegistered") { agentId = p.args[0]; break; }
        } catch {}
      }
      pass(`Agent registered: ID ${agentId}`);
    }
    results.push({ step: "Register agent", status: "pass" });
  } catch (e) {
    fail(e.message); results.push({ step: "Register agent", status: "fail", error: e.message }); process.exit(1);
  }

  // === Step 3: Register validators ===
  step(3, "Register 5 validators (0.01 ETH stake each)");
  try {
    // Refresh nonce since agent operator may have used some
    nonce = await provider.getTransactionCount(deployer.address, "latest");
    for (let i = 0; i < 5; i++) {
      const vInfo = await validatorPool.getValidator(validatorWallets[i].address);
      if (vInfo.registeredAt > 0n) {
        info(`Validator ${i} already registered`);
        continue;
      }
      const vBal = await provider.getBalance(validatorWallets[i].address);
      if (vBal < ethers.parseEther("0.012")) {
        await waitTx(await deployer.sendTransaction({
          to: validatorWallets[i].address,
          value: ethers.parseEther("0.013") - vBal,
          nonce: nonce++
        }));
        info(`Funded validator ${i}`);
      }
      await waitTx(await validatorPool.connect(validatorWallets[i]).registerValidator({ value: ethers.parseEther("0.01") }));
      pass(`Validator ${i} registered`);
    }
    const count = await validatorPool.getActiveValidatorCount();
    info(`Active validators: ${count}`);
    results.push({ step: "Register validators", status: "pass" });
  } catch (e) {
    fail(e.message); results.push({ step: "Register validators", status: "fail", error: e.message }); process.exit(1);
  }

  // === Step 4: Create task ===
  step(4, "Create task (0.001 ETH bounty)");
  let taskId;
  try {
    nonce = await provider.getTransactionCount(deployer.address, "latest");
    const tx = await abbCore.createTaskETH(
      ethers.keccak256(ethers.toUtf8Bytes("task-" + Date.now())),
      Math.floor(Date.now() / 1000) + 3600,
      { value: ethers.parseEther("0.001"), nonce: nonce++ }
    );
    const receipt = await waitTx(tx);
    for (const log of receipt.logs) {
      try {
        const p = abbCore.interface.parseLog(log);
        if (p?.name === "TaskCreatedAndFunded") { taskId = p.args[0]; break; }
      } catch {}
    }
    pass(`Task created: ID ${taskId}`);
    results.push({ step: "Create task", status: "pass" });
  } catch (e) {
    fail(e.message); results.push({ step: "Create task", status: "fail", error: e.message }); process.exit(1);
  }

  // === Step 5: Agent claims task ===
  step(5, "Agent claims task");
  try {
    await waitTx(await abbCore.connect(agentOperator).claimTask(taskId, agentId));
    pass(`Agent ${agentId} claimed task ${taskId}`);
    results.push({ step: "Claim task", status: "pass" });
  } catch (e) {
    fail(e.message); results.push({ step: "Claim task", status: "fail", error: e.message }); process.exit(1);
  }

  // === Step 6: Agent submits work ===
  step(6, "Agent submits work (triggers panel selection)");
  let panelAddrs = [];
  try {
    const tx = await abbCore.connect(agentOperator).submitWork(
      taskId, ethers.keccak256(ethers.toUtf8Bytes("submission-" + Date.now()))
    );
    const receipt = await waitTx(tx);
    const taskState = await taskRegistry.getTaskState(taskId);
    info(`Task state: ${taskState} (3=InReview)`);
    for (const log of receipt.logs) {
      try {
        const p = validatorPool.interface.parseLog(log);
        if (p?.name === "PanelSelected") { panelAddrs = [...p.args[1]]; break; }
      } catch {}
    }
    info(`Panel: ${panelAddrs.length} validators`);
    panelAddrs.forEach(a => info(`  ${a}`));
    pass("Work submitted");
    results.push({ step: "Submit work", status: "pass" });
  } catch (e) {
    fail(e.message); results.push({ step: "Submit work", status: "fail", error: e.message }); process.exit(1);
  }

  // === Step 7: Validators commit scores ===
  step(7, "Validators commit scores (score=80)");
  const score = 80;
  const salts = [];
  const committedIdxs = [];
  {
    // Map our wallets to panel positions
    const panelSet = new Set(panelAddrs.map(a => a.toLowerCase()));
    for (let i = 0; i < 5; i++) {
      const addr = validatorWallets[i].address.toLowerCase();
      if (!panelSet.has(addr)) {
        info(`Validator ${i} not on panel, skipping`);
        salts.push(null);
        continue;
      }
      const salt = ethers.randomBytes(32);
      salts.push(salt);
      const commitHash = ethers.keccak256(
        ethers.solidityPacked(["uint256", "uint8", "bytes32"], [taskId, score, salt])
      );
      try {
        await waitTx(await validatorPool.connect(validatorWallets[i]).commitScore(taskId, commitHash));
        pass(`Validator ${i} committed`);
        committedIdxs.push(i);
      } catch (e) {
        fail(`Validator ${i}: ${e.message?.slice(0, 100)}`);
      }
    }
    info(`${committedIdxs.length} validators committed`);
    results.push({ step: "Commit scores", status: committedIdxs.length >= 3 ? "pass" : "fail" });
  }

  // === Step 8: Wait, then reveal ===
  step(8, "Wait for commit phase, then reveal");
  {
    info("Waiting 8s for commit deadline...");
    await sleep(8000);
    let revealed = 0;
    for (const i of committedIdxs) {
      try {
        await waitTx(await validatorPool.connect(validatorWallets[i]).revealScore(taskId, score, salts[i]));
        pass(`Validator ${i} revealed: ${score}`);
        revealed++;
      } catch (e) {
        fail(`Validator ${i} reveal: ${e.message?.slice(0, 120)}`);
      }
    }
    info(`${revealed}/${committedIdxs.length} revealed`);
    results.push({ step: "Reveal scores", status: revealed >= 3 ? "pass" : "fail" });
  }

  // === Step 9: Finalize ===
  step(9, "Wait for reveal phase, then finalize");
  try {
    info("Waiting 8s for reveal deadline...");
    await sleep(8000);
    nonce = await provider.getTransactionCount(deployer.address, "latest");
    const receipt = await waitTx(await abbCore.finalizeReview(taskId, { nonce: nonce++ }));
    for (const log of receipt.logs) {
      try {
        const p = abbCore.interface.parseLog(log);
        if (p?.name === "ReviewFinalized") {
          info(`Accepted: ${p.args[1]}, Median: ${p.args[2]}`);
          break;
        }
      } catch {}
    }
    pass("Review finalized!");
    results.push({ step: "Finalize review", status: "pass" });
  } catch (e) {
    fail(e.message); results.push({ step: "Finalize review", status: "fail", error: e.message });
  }

  // === Step 10: Verify ===
  step(10, "Verify final state and balances");
  try {
    const task = await taskRegistry.getTask(taskId);
    const states = ["Open","Claimed","Submitted","InReview","Completed","Disputed","Resolved","Cancelled"];
    const s = Number(task.state);
    info(`Task state: ${states[s]} (${s})`);

    const agent = await agentRegistry.getAgent(agentId);
    info(`Agent reputation: ${agent.reputationScore}, completed: ${agent.tasksCompleted}, earned: ${ethers.formatEther(agent.totalEarned)} ETH`);

    const claimable = await bountyEscrow.claimableETH(agentOperator.address);
    info(`Claimable for agent operator: ${ethers.formatEther(claimable)} ETH`);

    if (claimable > 0n) {
      await waitTx(await bountyEscrow.connect(agentOperator).withdrawETH());
      pass(`Withdrew ${ethers.formatEther(claimable)} ETH`);
    }

    info(`Agent operator balance: ${ethers.formatEther(await provider.getBalance(agentOperator.address))} ETH`);
    info(`Deployer balance: ${ethers.formatEther(await provider.getBalance(deployer.address))} ETH`);

    if (s === 4) {
      pass("✅ TASK COMPLETED — Full E2E flow works!");
      results.push({ step: "Verification", status: "pass" });
    } else {
      fail(`Unexpected state: ${states[s]}`);
      results.push({ step: "Verification", status: "fail", error: states[s] });
    }
  } catch (e) {
    fail(e.message); results.push({ step: "Verification", status: "fail", error: e.message });
  }

  // === Summary ===
  console.log(`\n${"=".repeat(60)}\n  📊 Summary\n${"=".repeat(60)}`);
  let p = 0, f = 0;
  for (const r of results) {
    console.log(`  ${r.status === "pass" ? "✅" : "❌"} ${r.step}${r.error ? ` — ${r.error}` : ""}`);
    r.status === "pass" ? p++ : f++;
  }
  console.log(`\n  ${p} passed, ${f} failed / ${results.length} total`);
  console.log("=".repeat(60));
  process.exit(f > 0 ? 1 : 0);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
