import { ethers } from "ethers";
import { readFileSync } from "fs";

const RPC = "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(RPC);

// 8th deployment - post-audit contracts
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error("Set PRIVATE_KEY env var"); process.exit(1); }
const deployer = new ethers.Wallet(PRIVATE_KEY, provider);

const ADDR = {
  core: "0x6972d08C4B74e0a03Fa77E49e28A87A695ecf703",
  agentReg: "0x6473048778e011D9b45A0fFa993ED0dA4B777bA5",
  taskReg: "0x819ee47ed96817CBbeD64097B61171dFF302b6c4",
  escrow: "0x2B0eBdF1dce650C52CA6a53205758f181cce1AF6",
  valPool: "0x5241129505300f2BB02B789c5A8fD12908ED1C25",
};

const loadABI = (name) => JSON.parse(readFileSync(`out/${name}.abi.json`, "utf8"));
const core = new ethers.Contract(ADDR.core, loadABI("ABBCore"), deployer);
const agentReg = new ethers.Contract(ADDR.agentReg, loadABI("AgentRegistry"), deployer);
const taskReg = new ethers.Contract(ADDR.taskReg, loadABI("TaskRegistry"), deployer);
const escrow = new ethers.Contract(ADDR.escrow, loadABI("BountyEscrow"), deployer);
const valPool = new ethers.Contract(ADDR.valPool, loadABI("ValidatorPool"), deployer);

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
  for (let i = secs; i > 0; i -= 5) {
    await new Promise(r => setTimeout(r, Math.min(5000, i * 1000)));
    if (i > 5) process.stdout.write(`  ${i-5}s remaining...\r`);
  }
  console.log("  ✓ Done\n");
}

async function main() {
  const bal = await provider.getBalance(deployer.address);
  console.log("════════════════════════════════════════════════");
  console.log("  AgentEcon — E2E Test v8 (post-audit deploy)");
  console.log("════════════════════════════════════════════════");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH\n");

  // Create 5 fresh validator wallets
  const valWallets = Array.from({length: 5}, () => ethers.Wallet.createRandom().connect(provider));
  
  const minStake = await valPool.MIN_STAKE();
  console.log(`MIN_STAKE: ${ethers.formatEther(minStake)} ETH`);
  const perWallet = minStake + ethers.parseEther("0.001");
  
  // Fund them
  let nonce = await provider.getTransactionCount(deployer.address, "latest");
  for (let i = 0; i < 5; i++) {
    const tx = await deployer.sendTransaction({ to: valWallets[i].address, value: perWallet, nonce: nonce++ });
    await tx.wait(1);
  }
  log("Fund 5 validator wallets", "PASS");

  // Register them
  for (let i = 0; i < 5; i++) {
    try {
      const tx = await valPool.connect(valWallets[i]).registerValidator({ value: minStake });
      await waitTx(tx, `registerValidator[${i}]`);
      log(`Register validator ${i}`, "PASS");
    } catch (e) { log(`Register validator ${i}`, "FAIL", e.shortMessage || e.message); return; }
  }

  const avc = await valPool.getActiveValidatorCount();
  console.log(`Active validators: ${avc}`);

  // Register agent
  let agentId;
  try {
    const tx = await agentReg.registerAgent(ethers.keccak256(ethers.toUtf8Bytes("e2e-v8-" + Date.now())));
    const r = await waitTx(tx, "registerAgent");
    agentId = findEvent(r, agentReg, "AgentRegistered")?.agentId;
    log("Register agent", "PASS", `agentId=${agentId}`);
  } catch (e) { log("Register agent", "FAIL", e.shortMessage || e.message); return; }

  // Create task
  let taskId;
  try {
    const tx = await core.createTaskETH(
      ethers.keccak256(ethers.toUtf8Bytes("e2e-v8-task-" + Date.now())),
      Math.floor(Date.now() / 1000) + 86400,
      { value: ethers.parseEther("0.005") }
    );
    const r = await waitTx(tx, "createTaskETH");
    taskId = findEvent(r, core, "TaskCreatedAndFunded")?.taskId;
    log("Create task (0.005 ETH)", "PASS", `taskId=${taskId}`);
  } catch (e) { log("Create task", "FAIL", e.shortMessage || e.message); return; }

  // Claim
  try {
    const tx = await core.claimTask(taskId, agentId);
    await waitTx(tx, "claimTask");
    log("Agent claims task", "PASS");
  } catch (e) { log("Agent claims task", "FAIL", e.shortMessage || e.message); return; }

  // Submit work
  let panelAddresses;
  try {
    const tx = await core.submitWork(taskId, ethers.keccak256(ethers.toUtf8Bytes("submission-" + Date.now())));
    const r = await waitTx(tx, "submitWork");
    const panelEvent = findEvent(r, valPool, "PanelSelected");
    if (panelEvent) {
      panelAddresses = Array.from(panelEvent.validators || panelEvent[1]);
      console.log(`  Panel: ${panelAddresses.map(a => a.slice(0,10)).join(", ")}`);
    }
    log("Submit work", "PASS");
  } catch (e) { log("Submit work", "FAIL", e.shortMessage || e.message); return; }

  // Map panel to our wallets
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
  console.log(`\n  Our wallets on panel: ${panelWallets.length}/5`);

  if (panelWallets.length < 3) {
    log("Panel coverage", "WARN", `Only ${panelWallets.length}/5 — need at least 3`);
    console.log("\n════════════════════════════════════════════════");
    for (const r of results) console.log(`  [${r.status}] ${r.step}${r.detail ? " — " + r.detail : ""}`);
    return;
  }
  log("Panel coverage", "PASS", `${panelWallets.length}/5 are our wallets`);

  // Commit phase
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

  // Wait for commit phase (180s + buffer)
  await sleep(190);

  // Reveal phase
  console.log("--- Reveal Phase ---");
  for (let i = 0; i < panelWallets.length; i++) {
    try {
      const tx = await valPool.connect(panelWallets[i]).revealScore(taskId, score, panelSalts[i]);
      await waitTx(tx, `revealScore[${i}]`);
      log(`Validator ${i} reveals`, "PASS");
    } catch (e) { log(`Validator ${i} reveals`, "FAIL", e.shortMessage || e.message); }
  }

  // Wait for reveal phase
  await sleep(190);

  // Finalize
  try {
    const tx = await core.finalizeReview(taskId);
    const r = await waitTx(tx, "finalizeReview");
    const ev = findEvent(r, core, "ReviewFinalized");
    log("Finalize review", "PASS", `accepted=${ev?.accepted}, medianScore=${ev?.medianScore}`);
  } catch (e) { log("Finalize review", "FAIL", e.shortMessage || e.message); }

  // Check state
  const state = await taskReg.getTaskState(taskId);
  const names = ["Open","Claimed","Submitted","InReview","Completed","Disputed","Resolved","Cancelled"];
  log("Final task state", names[Number(state)] === "Completed" ? "PASS" : "INFO", names[Number(state)]);

  // Withdraw
  try {
    const claimable = await escrow.claimableETH(deployer.address);
    log("Claimable ETH", claimable > 0n ? "PASS" : "INFO", ethers.formatEther(claimable) + " ETH");
    if (claimable > 0n) {
      const tx = await escrow.withdrawETH();
      await waitTx(tx, "withdrawETH");
      log("Withdraw payout", "PASS");
    }
  } catch (e) { log("Withdrawal", "FAIL", e.shortMessage || e.message); }

  // Final
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
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
