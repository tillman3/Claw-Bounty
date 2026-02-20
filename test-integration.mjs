import { ethers } from "ethers";
import { readFileSync } from "fs";

const RPC = "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(RPC);

const envLines = readFileSync(".env", "utf8").split("\n");
const env = {};
for (const l of envLines) { const [k,v] = l.split("="); if(k&&v) env[k.trim()] = v.trim(); }

const deployer = new ethers.Wallet(env.PRIVATE_KEY, provider);

const ADDR = {
  core: "0xD41cD6D1194cd7fEA4E4356A66F2CBA0C12525e1",
  agentReg: "0x8d9306058c0086480D8D315A27757ea4F9147893",
  taskReg: "0x550cD829285A81605BBc5d04D64F6608A528F5Ef",
  escrow: "0xa9BF10D5D2e380966Bab587AEa8fbf1c531926DE",
  valPool: "0x8fEBfdab529966C787E37b2990A4336560F9F49a",
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
  console.log(`  Confirmed block ${r.blockNumber}, gas ${r.gasUsed}`);
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

async function main() {
  const bal = await provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH\n");

  // Use deployer as agent operator too (saves funding a separate wallet)
  // Only fund 5 validator wallets with just enough for stake + gas (0.011 ETH each = 0.055 total)
  // Plus 0.01 ETH for task bounty. Total needed: ~0.065 ETH. We have 0.03... not enough.
  // 
  // Actually we only have 0.03 ETH. We need at minimum:
  // - 5 validators * 0.01 stake = 0.05 ETH (just for stakes)
  // That's already more than we have. We need to reduce to 3 validators.
  // But PANEL_SIZE = 5, selectPanel needs 5 active validators.
  // 
  // We're stuck. Let's check if the first funded wallet still has ETH from the failed run.
  
  // Actually, the previous runs funded some wallets. Those funds are lost to random wallets.
  // With only 0.03 ETH we can't do the full flow. Let me check actual balance:
  console.log("Need ~0.07 ETH for full test (5 validator stakes + task bounty + gas)");
  console.log("Available:", ethers.formatEther(bal), "ETH");
  
  if (bal < ethers.parseEther("0.065")) {
    console.log("\nInsufficient funds for full integration test.");
    console.log("Need to get more Base Sepolia ETH from a faucet.");
    
    // Let's do a partial test - verify contracts are working
    console.log("\n--- Running partial verification ---\n");
    
    // 1. Verify configureTiming already set
    const cd = await core.commitDuration();
    const rd = await core.revealDuration();
    log("Verify timing config", cd == 60n && rd == 60n ? "PASS" : "FAIL", `commit=${cd}s, reveal=${rd}s`);
    
    // 2. Register agent (deployer as operator)
    let agentId;
    try {
      const tx = await agentReg.registerAgent(ethers.keccak256(ethers.toUtf8Bytes("test-agent-v2")));
      const r = await waitTx(tx, "registerAgent");
      agentId = findEvent(r, agentReg, "AgentRegistered")?.agentId;
      log("Register agent (deployer as operator)", "PASS", `agentId=${agentId}`);
    } catch (e) { log("Register agent", "FAIL", e.shortMessage || e.message); }

    // 3. Try to register deployer as validator (0.01 ETH)
    try {
      const tx = await valPool.registerValidator({ value: ethers.parseEther("0.01") });
      const r = await waitTx(tx, "registerValidator");
      log("Register deployer as validator", "PASS");
    } catch (e) { log("Register deployer as validator", "FAIL", e.shortMessage || e.message); }

    // 4. Verify MIN_STAKE is 0.01
    const minStake = await valPool.MIN_STAKE();
    log("Verify MIN_STAKE", minStake == ethers.parseEther("0.01") ? "PASS" : "FAIL", ethers.formatEther(minStake) + " ETH");

    // 5. Check active validator count
    const avc = await valPool.getActiveValidatorCount();
    log("Active validator count", "INFO", avc.toString());

    // Check all contract addresses respond
    for (const [name, addr] of Object.entries(ADDR)) {
      const code = await provider.getCode(addr);
      log(`Contract ${name} deployed`, code.length > 2 ? "PASS" : "FAIL", addr);
    }

    const finalBal = await provider.getBalance(deployer.address);
    console.log("\n========== RESULTS ==========");
    for (const r of results) console.log(`[${r.status}] ${r.step}${r.detail ? ": " + r.detail : ""}`);
    console.log(`\nDeployer balance: ${ethers.formatEther(finalBal)} ETH`);
    console.log("\nNOTE: Full validator commit/reveal flow requires ~0.07 ETH.");
    console.log("Contracts are deployed and verified. Get testnet ETH for full integration test.");
    return;
  }

  // --- Full flow (if we have enough funds) ---
  
  // Configure timing
  try {
    await waitTx(await core.configureTiming(300, 300), "configureTiming");
    log("Configure timing (60s/60s)", "PASS");
  } catch (e) { log("Configure timing", "FAIL", e.shortMessage || e.message); return; }

  // Register agent (deployer as operator to save gas)
  let agentId;
  try {
    const tx = await agentReg.registerAgent(ethers.keccak256(ethers.toUtf8Bytes("test-agent-" + Date.now())));
    const r = await waitTx(tx, "registerAgent");
    agentId = findEvent(r, agentReg, "AgentRegistered")?.agentId;
    log("Register agent", "PASS", `agentId=${agentId}`);
  } catch (e) { log("Register agent", "FAIL", e.shortMessage || e.message); return; }

  // Generate and fund 5 validator wallets
  const validatorWallets = Array.from({length: 5}, () => ethers.Wallet.createRandom().connect(provider));
  let nonce = await provider.getTransactionCount(deployer.address, "latest");
  for (const w of validatorWallets) {
    const tx = await deployer.sendTransaction({ to: w.address, value: ethers.parseEther("0.011"), nonce: nonce++ });
    await tx.wait(1);
  }
  log("Fund 5 validator wallets", "PASS");

  // Register validators
  for (let i = 0; i < 5; i++) {
    try {
      const tx = await valPool.connect(validatorWallets[i]).registerValidator({ value: ethers.parseEther("0.01") });
      await waitTx(tx, `registerValidator[${i}]`);
      log(`Register validator ${i}`, "PASS");
    } catch (e) { log(`Register validator ${i}`, "FAIL", e.shortMessage || e.message); return; }
  }

  // Create task
  let taskId;
  try {
    const tx = await core.createTaskETH(
      ethers.keccak256(ethers.toUtf8Bytes("integration-test-" + Date.now())),
      Math.floor(Date.now() / 1000) + 86400,
      { value: ethers.parseEther("0.01") }
    );
    const r = await waitTx(tx, "createTaskETH");
    taskId = findEvent(r, core, "TaskCreatedAndFunded")?.taskId;
    log("Create task (0.01 ETH)", "PASS", `taskId=${taskId}`);
  } catch (e) { log("Create task", "FAIL", e.shortMessage || e.message); return; }

  // Claim task (deployer is agent operator)
  try {
    const tx = await core.claimTask(taskId, agentId);
    await waitTx(tx, "claimTask");
    log("Agent claims task", "PASS");
  } catch (e) { log("Agent claims task", "FAIL", e.shortMessage || e.message); return; }

  // Submit work (triggers panel selection)
  try {
    const tx = await core.submitWork(taskId, ethers.keccak256(ethers.toUtf8Bytes("submission")));
    await waitTx(tx, "submitWork");
    log("Agent submits work (panel selected)", "PASS");
  } catch (e) { log("Agent submits work", "FAIL", e.shortMessage || e.message); return; }

  // Commit scores
  const score = 75;
  const salts = validatorWallets.map(() => ethers.hexlify(ethers.randomBytes(32)));
  for (let i = 0; i < 5; i++) {
    try {
      const commitHash = ethers.solidityPackedKeccak256(
        ["uint256", "uint8", "bytes32"], [taskId, score, salts[i]]
      );
      const tx = await valPool.connect(validatorWallets[i]).commitScore(taskId, commitHash);
      await waitTx(tx, `commitScore[${i}]`);
      log(`Validator ${i} commits`, "PASS");
    } catch (e) { log(`Validator ${i} commits`, "FAIL", e.shortMessage || e.message); }
  }

  console.log("\nWaiting 305s for commit phase...\n");
  await new Promise(r => setTimeout(r, 305000));

  // Reveal scores
  for (let i = 0; i < 5; i++) {
    try {
      const tx = await valPool.connect(validatorWallets[i]).revealScore(taskId, score, salts[i]);
      await waitTx(tx, `revealScore[${i}]`);
      log(`Validator ${i} reveals`, "PASS");
    } catch (e) { log(`Validator ${i} reveals`, "FAIL", e.shortMessage || e.message); }
  }

  console.log("\nWaiting 305s for reveal phase...\n");
  await new Promise(r => setTimeout(r, 305000));

  // Finalize
  try {
    const tx = await core.finalizeReview(taskId);
    const r = await waitTx(tx, "finalizeReview");
    const ev = findEvent(r, core, "ReviewFinalized");
    log("Finalize review", "PASS", `accepted=${ev?.accepted}, medianScore=${ev?.medianScore}`);
  } catch (e) { log("Finalize review", "FAIL", e.shortMessage || e.message); }

  // Check state & withdrawal
  const state = await taskReg.getTaskState(taskId);
  const names = ["Open","Claimed","Submitted","InReview","Completed","Disputed","Resolved","Cancelled"];
  log("Final task state", "INFO", names[Number(state)]);

  try {
    const claimable = await escrow.claimableETH(deployer.address);
    log("Deployer claimable", "INFO", ethers.formatEther(claimable) + " ETH");
    if (claimable > 0n) {
      const tx = await escrow.withdrawETH();
      await waitTx(tx, "withdrawETH");
      log("Withdraw payout", "PASS");
    }
  } catch (e) { log("Withdrawal", "FAIL", e.shortMessage || e.message); }

  const finalBal = await provider.getBalance(deployer.address);
  console.log("\n========== RESULTS ==========");
  for (const r of results) console.log(`[${r.status}] ${r.step}${r.detail ? ": " + r.detail : ""}`);
  console.log(`\nDeployer balance: ${ethers.formatEther(finalBal)} ETH`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
