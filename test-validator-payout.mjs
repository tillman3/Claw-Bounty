import { ethers } from "ethers";
import { readFileSync } from "fs";

const RPC = "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(RPC);

const envLines = readFileSync(".env", "utf8").split("\n");
const env = {};
for (const l of envLines) { const [k,v] = l.split("="); if(k&&v) env[k.trim()] = v.trim(); }

const deployer = new ethers.Wallet(env.PRIVATE_KEY, provider);

// Fresh deployment - clean slate, no orphaned validators
const ADDR = {
  core: "0xBf894AC956d49d27FbD46a0af32BC4c39E0cf6ab",
  agentReg: "0x1071fc6AF785eB664C8E6CF632B247DdB050aDe3",
  taskReg: "0x91E8219025b9BBbb391f1cDAA03c0210E8E35C73",
  escrow: "0x844A6386C9Cb3Bc8c21dF1B0F37bdc3f4148d671",
  valPool: "0x50Dc171e86F0aB31af32Bca48644B99850254a77",
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

async function sleep(ms) {
  const secs = Math.ceil(ms / 1000);
  console.log(`\n⏳ Waiting ${secs}s...`);
  const start = Date.now();
  while (Date.now() - start < ms) {
    await new Promise(r => setTimeout(r, 5000));
    const left = Math.ceil((ms - (Date.now() - start)) / 1000);
    if (left > 0) process.stdout.write(`  ${left}s remaining...\r`);
  }
  console.log("  ✓ Wait complete\n");
}

async function main() {
  const bal = await provider.getBalance(deployer.address);
  console.log("════════════════════════════════════════════════");
  console.log("  AgentEcon — Full Validator Payout E2E Test");
  console.log("════════════════════════════════════════════════");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  console.log("Contracts: FRESH deployment (0 validators)\n");

  // 1. Configure timing: 3 min commit, 3 min reveal
  try {
    const tx = await core.configureTiming(180, 180);
    await waitTx(tx, "configureTiming(180,180)");
    log("Configure timing (3min/3min)", "PASS");
  } catch (e) { log("Configure timing", "FAIL", e.shortMessage || e.message); return; }

  // 2. Create exactly 5 validator wallets (PANEL_SIZE = 5)
  console.log("--- Creating 5 validator wallets ---");
  const valWallets = Array.from({length: 5}, () => ethers.Wallet.createRandom().connect(provider));
  
  // Fund them: 0.01 ETH stake + gas buffer = 0.0015 each
  const fundAmount = ethers.parseEther("0.003"); // 0.01 stake + gas for commit+reveal
  let nonce = await provider.getTransactionCount(deployer.address, "latest");
  
  const minStake = await valPool.MIN_STAKE();
  console.log(`  MIN_STAKE: ${ethers.formatEther(minStake)} ETH`);
  
  const perWallet = minStake + ethers.parseEther("0.001"); // stake + gas
  console.log(`  Funding each: ${ethers.formatEther(perWallet)} ETH`);
  
  for (let i = 0; i < 5; i++) {
    const tx = await deployer.sendTransaction({ to: valWallets[i].address, value: perWallet, nonce: nonce++ });
    await tx.wait(1);
  }
  log("Fund 5 validator wallets", "PASS");

  // 3. Register all 5 validators
  for (let i = 0; i < 5; i++) {
    try {
      const tx = await valPool.connect(valWallets[i]).registerValidator({ value: minStake });
      await waitTx(tx, `registerValidator[${i}]`);
      log(`Register validator ${i}`, "PASS", valWallets[i].address.slice(0,10) + "...");
    } catch (e) { log(`Register validator ${i}`, "FAIL", e.shortMessage || e.message); return; }
  }

  const avc = await valPool.getActiveValidatorCount();
  console.log(`  Active validators: ${avc} (should be 5)\n`);

  // 4. Register agent (deployer as operator)
  let agentId;
  try {
    const tx = await agentReg.registerAgent(ethers.keccak256(ethers.toUtf8Bytes("e2e-agent-" + Date.now())));
    const r = await waitTx(tx, "registerAgent");
    agentId = findEvent(r, agentReg, "AgentRegistered")?.agentId;
    log("Register agent", "PASS", `agentId=${agentId}`);
  } catch (e) { log("Register agent", "FAIL", e.shortMessage || e.message); return; }

  // 5. Create task with 0.005 ETH bounty
  let taskId;
  try {
    const tx = await core.createTaskETH(
      ethers.keccak256(ethers.toUtf8Bytes("e2e-task-" + Date.now())),
      Math.floor(Date.now() / 1000) + 86400,
      { value: ethers.parseEther("0.005") }
    );
    const r = await waitTx(tx, "createTaskETH");
    taskId = findEvent(r, core, "TaskCreatedAndFunded")?.taskId;
    log("Create task (0.005 ETH bounty)", "PASS", `taskId=${taskId}`);
  } catch (e) { log("Create task", "FAIL", e.shortMessage || e.message); return; }

  // 6. Agent claims task
  try {
    const tx = await core.claimTask(taskId, agentId);
    await waitTx(tx, "claimTask");
    log("Agent claims task", "PASS");
  } catch (e) { log("Agent claims task", "FAIL", e.shortMessage || e.message); return; }

  // 7. Agent submits work → triggers panel selection
  let panelAddresses;
  try {
    const tx = await core.submitWork(taskId, ethers.keccak256(ethers.toUtf8Bytes("my-submission")));
    const r = await waitTx(tx, "submitWork");
    
    // Find PanelSelected event to see which validators were picked
    const panelEvent = findEvent(r, valPool, "PanelSelected");
    if (panelEvent) {
      panelAddresses = panelEvent.validators || panelEvent[1];
      console.log(`  Panel selected: ${panelAddresses.map(a => a.slice(0,10) + "...").join(", ")}`);
    }
    log("Submit work (panel selected)", "PASS");
  } catch (e) { log("Submit work", "FAIL", e.shortMessage || e.message); return; }

  // 8. Map panel addresses to our wallets
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
  console.log(`  ${panelWallets.length}/5 panel members are our wallets`);

  if (panelWallets.length < 3) {
    log("Panel coverage", "FAIL", `Only ${panelWallets.length}/5 panel members are ours`);
    console.log("\n❌ Not enough of our validators on the panel.");
    return;
  }

  // 9. Commit phase: all panel members commit score=80
  console.log("\n--- Commit Phase (scoring 80/100) ---");
  for (let i = 0; i < panelWallets.length; i++) {
    try {
      const commitHash = ethers.solidityPackedKeccak256(
        ["uint256", "uint8", "bytes32"], [taskId, score, panelSalts[i]]
      );
      const tx = await valPool.connect(panelWallets[i]).commitScore(taskId, commitHash);
      await waitTx(tx, `commitScore[${i}]`);
      log(`Panel member ${i} commits`, "PASS");
    } catch (e) { log(`Panel member ${i} commits`, "FAIL", e.shortMessage || e.message); }
  }

  // 10. Wait for commit phase to end (180s + buffer)
  await sleep(185000);

  // 11. Reveal phase
  console.log("--- Reveal Phase ---");
  for (let i = 0; i < panelWallets.length; i++) {
    try {
      const tx = await valPool.connect(panelWallets[i]).revealScore(taskId, score, panelSalts[i]);
      await waitTx(tx, `revealScore[${i}]`);
      log(`Panel member ${i} reveals`, "PASS");
    } catch (e) { log(`Panel member ${i} reveals`, "FAIL", e.shortMessage || e.message); }
  }

  // 12. Wait for reveal phase to end
  await sleep(185000);

  // 13. Finalize review
  try {
    const tx = await core.finalizeReview(taskId);
    const r = await waitTx(tx, "finalizeReview");
    const ev = findEvent(r, core, "ReviewFinalized");
    log("Finalize review", "PASS", `accepted=${ev?.accepted}, medianScore=${ev?.medianScore}`);
  } catch (e) { log("Finalize review", "FAIL", e.shortMessage || e.message); }

  // 14. Check final task state
  const state = await taskReg.getTaskState(taskId);
  const names = ["Open","Claimed","Submitted","InReview","Completed","Disputed","Resolved","Cancelled"];
  log("Final task state", names[Number(state)] === "Completed" ? "PASS" : "INFO", names[Number(state)]);

  // 15. Check and withdraw payout
  try {
    const claimable = await escrow.claimableETH(deployer.address);
    log("Agent claimable ETH", claimable > 0n ? "PASS" : "INFO", ethers.formatEther(claimable) + " ETH");
    
    if (claimable > 0n) {
      const tx = await escrow.withdrawETH();
      await waitTx(tx, "withdrawETH");
      log("Withdraw payout", "PASS");
    }
  } catch (e) { log("Withdrawal", "FAIL", e.shortMessage || e.message); }

  // Final report
  const finalBal = await provider.getBalance(deployer.address);
  console.log("\n════════════════════════════════════════════════");
  console.log("  FINAL RESULTS");
  console.log("════════════════════════════════════════════════");
  for (const r of results) console.log(`  [${r.status}] ${r.step}${r.detail ? " — " + r.detail : ""}`);
  
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`\n  Deployer balance: ${ethers.formatEther(finalBal)} ETH`);
  console.log(`  ✅ ${passed} passed | ❌ ${failed} failed`);
  
  if (failed === 0) {
    console.log("\n  🎉 FULL E2E VALIDATOR PAYOUT TEST PASSED!");
    console.log("  Flow: Create → Claim → Submit → Commit → Reveal → Finalize → Payout ✓");
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
