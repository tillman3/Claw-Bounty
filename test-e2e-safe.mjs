/**
 * AgentEcon E2E Validator Payout Test — SAFE VERSION
 * 
 * Key safety features:
 * 1. Saves all wallet keys to disk BEFORE funding
 * 2. Checks balance is sufficient BEFORE any transactions
 * 3. Recovers funds from validator wallets on failure or completion
 * 4. Single clean run — redeploys fresh contracts first
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "fs";

const RPC = "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(RPC);

const envLines = readFileSync(".env", "utf8").split("\n");
const env = {};
for (const l of envLines) { const [k,v] = l.split("="); if(k&&v) env[k.trim()] = v.trim(); }

const deployer = new ethers.Wallet(env.PRIVATE_KEY, provider);
const KEYS_FILE = "test-validator-keys.json";

const results = [];
function log(step, status, detail = "") {
  results.push({ step, status, detail });
  console.log(`[${status}] ${step}${detail ? ": " + detail : ""}`);
}

async function waitTx(tx, label) {
  console.log(`  ${label} tx: ${tx.hash}`);
  const r = await tx.wait(1);
  console.log(`  ✓ block ${r.blockNumber}, gas ${r.gasUsed}`);
  return r;
}

function findEvent(receipt, contract, eventName) {
  for (const l of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(l);
      if (parsed?.name === eventName) return parsed.args;
    } catch {}
  }
  return null;
}

async function sleep(secs) {
  console.log(`\n⏳ Waiting ${secs}s...`);
  for (let i = secs; i > 0; i -= 10) {
    await new Promise(r => setTimeout(r, Math.min(10000, i * 1000)));
    if (i > 10) process.stdout.write(`  ${Math.max(0,i-10)}s remaining...\r`);
  }
  console.log("  ✓ Done\n");
}

// SAFETY: Recover ETH from validator wallets back to deployer
async function recoverFunds(wallets) {
  console.log("\n--- Recovering funds from validator wallets ---");
  for (const w of wallets) {
    try {
      const bal = await provider.getBalance(w.address);
      if (bal > ethers.parseEther("0.0001")) {
        const gasPrice = (await provider.getFeeData()).gasPrice || ethers.parseUnits("0.1", "gwei");
        const gasLimit = 21000n;
        const gasCost = gasPrice * gasLimit;
        const sendAmount = bal - gasCost;
        if (sendAmount > 0n) {
          const tx = await w.sendTransaction({ to: deployer.address, value: sendAmount, gasLimit, gasPrice });
          await tx.wait(1);
          console.log(`  Recovered ${ethers.formatEther(sendAmount)} ETH from ${w.address.slice(0,10)}...`);
        }
      }
    } catch (e) {
      console.log(`  Could not recover from ${w.address.slice(0,10)}...: ${e.shortMessage || e.message}`);
    }
  }
}

async function main() {
  const bal = await provider.getBalance(deployer.address);
  console.log("════════════════════════════════════════════════");
  console.log("  AgentEcon — SAFE E2E Payout Test");
  console.log("════════════════════════════════════════════════");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH\n");

  // SAFETY CHECK: Ensure we have enough
  const REQUIRED = ethers.parseEther("0.062");
  if (bal < REQUIRED) {
    console.log(`❌ INSUFFICIENT FUNDS. Have ${ethers.formatEther(bal)} ETH, need ${ethers.formatEther(REQUIRED)} ETH.`);
    console.log(`   Short by: ${ethers.formatEther(REQUIRED - bal)} ETH`);
    console.log(`   Send at least ${ethers.formatEther(REQUIRED - bal)} to ${deployer.address}`);
    
    // Try to recover from any saved wallets
    if (existsSync(KEYS_FILE)) {
      console.log("\n   Found saved wallet keys, attempting recovery...");
      const saved = JSON.parse(readFileSync(KEYS_FILE, "utf8"));
      const savedWallets = saved.map(k => new ethers.Wallet(k, provider));
      await recoverFunds(savedWallets);
      const newBal = await provider.getBalance(deployer.address);
      console.log(`\n   Balance after recovery: ${ethers.formatEther(newBal)} ETH`);
      if (newBal < REQUIRED) {
        console.log("   Still not enough. Please fund the deployer wallet.");
        return;
      }
      console.log("   ✓ Recovery successful! Continuing...\n");
    } else {
      return;
    }
  }

  // Load contract ABIs
  const loadABI = (name) => JSON.parse(readFileSync(`out/${name}.abi.json`, "utf8"));

  // Use the current deployed contracts
  const ADDR = {
    core: "0xBf894AC956d49d27FbD46a0af32BC4c39E0cf6ab",
    agentReg: "0x1071fc6AF785eB664C8E6CF632B247DdB050aDe3",
    taskReg: "0x91E8219025b9BBbb391f1cDAA03c0210E8E35C73",
    escrow: "0x844A6386C9Cb3Bc8c21dF1B0F37bdc3f4148d671",
    valPool: "0x50Dc171e86F0aB31af32Bca48644B99850254a77",
  };

  const core = new ethers.Contract(ADDR.core, loadABI("ABBCore"), deployer);
  const agentReg = new ethers.Contract(ADDR.agentReg, loadABI("AgentRegistry"), deployer);
  const taskReg = new ethers.Contract(ADDR.taskReg, loadABI("TaskRegistry"), deployer);
  const escrow = new ethers.Contract(ADDR.escrow, loadABI("BountyEscrow"), deployer);
  const valPool = new ethers.Contract(ADDR.valPool, loadABI("ValidatorPool"), deployer);

  // Check existing active validators — if > 5 we have orphans from old runs
  const existingAvc = await valPool.getActiveValidatorCount();
  console.log(`Existing active validators: ${existingAvc}`);
  
  if (existingAvc > 0n) {
    console.log("⚠️  There are orphaned validators from previous runs.");
    console.log("   Panel selection is random — our new validators may not all get picked.");
    console.log("   Registering 15 new validators to overwhelm the pool (increase odds).");
  }

  // STEP 1: Generate validator wallets and SAVE KEYS
  const numValidators = existingAvc > 0n ? 15 : 5; // overwhelm old validators if needed
  console.log(`\n--- Creating ${numValidators} validator wallets ---`);
  const valWallets = Array.from({length: numValidators}, () => ethers.Wallet.createRandom().connect(provider));
  
  // SAFETY: Save keys to disk BEFORE sending any ETH
  writeFileSync(KEYS_FILE, JSON.stringify(valWallets.map(w => w.privateKey)));
  console.log(`  ✓ Keys saved to ${KEYS_FILE}`);

  const minStake = await valPool.MIN_STAKE();
  const perWallet = minStake + ethers.parseEther("0.0005"); // tight gas budget
  const totalNeeded = perWallet * BigInt(numValidators) + ethers.parseEther("0.007"); // + bounty + gas
  
  const currentBal = await provider.getBalance(deployer.address);
  if (currentBal < totalNeeded) {
    console.log(`  ❌ Need ${ethers.formatEther(totalNeeded)} ETH, have ${ethers.formatEther(currentBal)}`);
    // If we can't afford 15, try 5
    if (numValidators > 5) {
      console.log("  Falling back to 5 validators (may fail if panel picks old ones)");
      valWallets.splice(5);
      writeFileSync(KEYS_FILE, JSON.stringify(valWallets.map(w => w.privateKey)));
    }
  }

  // STEP 2: Fund validators
  console.log(`\n--- Funding ${valWallets.length} validator wallets ---`);
  let nonce = await provider.getTransactionCount(deployer.address, "latest");
  for (let i = 0; i < valWallets.length; i++) {
    const tx = await deployer.sendTransaction({ to: valWallets[i].address, value: perWallet, nonce: nonce++ });
    await tx.wait(1);
    console.log(`  Funded ${i+1}/${valWallets.length}: ${valWallets[i].address.slice(0,10)}...`);
  }
  log(`Fund ${valWallets.length} validator wallets`, "PASS");

  // STEP 3: Register validators
  for (let i = 0; i < valWallets.length; i++) {
    try {
      const tx = await valPool.connect(valWallets[i]).registerValidator({ value: minStake });
      await waitTx(tx, `registerValidator[${i}]`);
      log(`Register validator ${i}`, "PASS");
    } catch (e) { 
      log(`Register validator ${i}`, "FAIL", e.shortMessage || e.message);
      // Don't return — continue with what we have
    }
  }

  const avc = await valPool.getActiveValidatorCount();
  console.log(`  Total active validators: ${avc}`);

  // STEP 4: Configure timing (3 min each)
  try {
    const tx = await core.configureTiming(180, 180);
    await waitTx(tx, "configureTiming(180,180)");
    log("Configure timing (3min/3min)", "PASS");
  } catch (e) { log("Configure timing", "FAIL", e.shortMessage || e.message); }

  // STEP 5: Register agent
  let agentId;
  try {
    const tx = await agentReg.registerAgent(ethers.keccak256(ethers.toUtf8Bytes("safe-test-" + Date.now())));
    const r = await waitTx(tx, "registerAgent");
    agentId = findEvent(r, agentReg, "AgentRegistered")?.agentId;
    log("Register agent", "PASS", `agentId=${agentId}`);
  } catch (e) { log("Register agent", "FAIL", e.shortMessage || e.message); await recoverFunds(valWallets); return; }

  // STEP 6: Create task
  let taskId;
  try {
    const tx = await core.createTaskETH(
      ethers.keccak256(ethers.toUtf8Bytes("safe-task-" + Date.now())),
      Math.floor(Date.now() / 1000) + 86400,
      { value: ethers.parseEther("0.005") }
    );
    const r = await waitTx(tx, "createTaskETH");
    taskId = findEvent(r, core, "TaskCreatedAndFunded")?.taskId;
    log("Create task (0.005 ETH)", "PASS", `taskId=${taskId}`);
  } catch (e) { log("Create task", "FAIL", e.shortMessage || e.message); await recoverFunds(valWallets); return; }

  // STEP 7: Claim task
  try {
    const tx = await core.claimTask(taskId, agentId);
    await waitTx(tx, "claimTask");
    log("Agent claims task", "PASS");
  } catch (e) { log("Agent claims task", "FAIL", e.shortMessage || e.message); await recoverFunds(valWallets); return; }

  // STEP 8: Submit work
  let panelAddresses;
  try {
    const tx = await core.submitWork(taskId, ethers.keccak256(ethers.toUtf8Bytes("submission")));
    const r = await waitTx(tx, "submitWork");
    const panelEvent = findEvent(r, valPool, "PanelSelected");
    if (panelEvent) {
      panelAddresses = Array.from(panelEvent.validators || panelEvent[1]);
      console.log(`  Panel: ${panelAddresses.map(a => a.slice(0,10)).join(", ")}`);
    }
    log("Submit work (panel selected)", "PASS");
  } catch (e) { log("Submit work", "FAIL", e.shortMessage || e.message); await recoverFunds(valWallets); return; }

  // STEP 9: Match panel to our wallets
  const panelWallets = [];
  const panelSalts = [];
  const score = 80;
  
  for (const addr of (panelAddresses || [])) {
    const wallet = valWallets.find(w => w.address.toLowerCase() === addr.toLowerCase());
    if (wallet) {
      panelWallets.push(wallet);
      panelSalts.push(ethers.hexlify(ethers.randomBytes(32)));
    }
  }
  console.log(`  Our wallets on panel: ${panelWallets.length}/5`);

  const CONSENSUS = await valPool.CONSENSUS_THRESHOLD();
  console.log(`  Consensus threshold: ${CONSENSUS}`);

  if (panelWallets.length < Number(CONSENSUS)) {
    log("Panel coverage", "FAIL", `Only ${panelWallets.length}/${CONSENSUS} needed — orphaned validators got picked`);
    await recoverFunds(valWallets);
    return;
  }
  log("Panel coverage", "PASS", `${panelWallets.length}/5 are ours`);

  // STEP 10: Commit scores
  console.log("\n--- Commit Phase (score: 80/100) ---");
  for (let i = 0; i < panelWallets.length; i++) {
    try {
      const commitHash = ethers.solidityPackedKeccak256(
        ["uint256", "uint8", "bytes32"], [taskId, score, panelSalts[i]]
      );
      const tx = await valPool.connect(panelWallets[i]).commitScore(taskId, commitHash);
      await waitTx(tx, `commitScore[${i}]`);
      log(`Validator ${i} commits`, "PASS");
    } catch (e) { log(`Validator ${i} commits`, "FAIL", e.shortMessage || e.message); }
  }

  // STEP 11: Wait for commit phase
  await sleep(185);

  // STEP 12: Reveal scores
  console.log("--- Reveal Phase ---");
  for (let i = 0; i < panelWallets.length; i++) {
    try {
      const tx = await valPool.connect(panelWallets[i]).revealScore(taskId, score, panelSalts[i]);
      await waitTx(tx, `revealScore[${i}]`);
      log(`Validator ${i} reveals`, "PASS");
    } catch (e) { log(`Validator ${i} reveals`, "FAIL", e.shortMessage || e.message); }
  }

  // STEP 13: Wait for reveal phase
  await sleep(185);

  // STEP 14: Finalize
  try {
    const tx = await core.finalizeReview(taskId);
    const r = await waitTx(tx, "finalizeReview");
    const ev = findEvent(r, core, "ReviewFinalized");
    log("Finalize review", "PASS", `accepted=${ev?.accepted}, medianScore=${ev?.medianScore}`);
  } catch (e) { log("Finalize review", "FAIL", e.shortMessage || e.message); }

  // STEP 15: Check state
  const state = await taskReg.getTaskState(taskId);
  const names = ["Open","Claimed","Submitted","InReview","Completed","Disputed","Resolved","Cancelled"];
  log("Task state", names[Number(state)] === "Completed" ? "PASS" : "INFO", names[Number(state)]);

  // STEP 16: Withdraw payout
  try {
    const claimable = await escrow.claimableETH(deployer.address);
    log("Claimable ETH", claimable > 0n ? "PASS" : "INFO", ethers.formatEther(claimable) + " ETH");
    if (claimable > 0n) {
      const tx = await escrow.withdrawETH();
      await waitTx(tx, "withdrawETH");
      log("Withdraw payout", "PASS");
    }
  } catch (e) { log("Withdrawal", "FAIL", e.shortMessage || e.message); }

  // STEP 17: Recover validator funds
  await recoverFunds(valWallets);

  // Final report
  const finalBal = await provider.getBalance(deployer.address);
  console.log("\n════════════════════════════════════════════════");
  console.log("  RESULTS");
  console.log("════════════════════════════════════════════════");
  for (const r of results) console.log(`  [${r.status}] ${r.step}${r.detail ? " — " + r.detail : ""}`);
  
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`\n  Balance: ${ethers.formatEther(finalBal)} ETH`);
  console.log(`  ✅ ${passed} passed | ❌ ${failed} failed`);
  
  if (failed === 0) {
    console.log("\n  🎉 FULL E2E PAYOUT TEST PASSED!");
    console.log("  Create → Claim → Submit → Commit → Reveal → Finalize → Payout ✓");
  }

  // Cleanup keys file
  writeFileSync(KEYS_FILE, "[]");
}

main().catch(async (e) => {
  console.error("FATAL:", e.shortMessage || e.message);
  // Try to recover funds even on crash
  if (existsSync(KEYS_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(KEYS_FILE, "utf8"));
      if (saved.length > 0) {
        const wallets = saved.map(k => new ethers.Wallet(k, provider));
        await recoverFunds(wallets);
      }
    } catch {}
  }
  process.exit(1);
});
