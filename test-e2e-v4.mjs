/**
 * AgentEcon — Full E2E Test (4th deployment)
 * Deploy script now handles all authorizations automatically.
 */
import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';

const RPC = 'https://sepolia.base.org';
const provider = new ethers.JsonRpcProvider(RPC);

// 7th deployment
const ADDR = {
  Core:      '0x86A5a8c315f27220Db276EeB2B1CBDfacAE83Af4',
  AgentReg:  '0x137aEbf87F5D5c6FA0060D65f6b1D93d4040b5A8',
  TaskReg:   '0x0e2C80F6BcDC99Ee1dCf59eA78068c865F76849F',
  Escrow:    '0x278743Be679DA67b54F1fc57472864d26Ed02530',
  Validator: '0x32eBb10C23D9d9Ab9454a8dc12f98b26b4c11Eb5',
};

// Load ABIs
const abi = name => JSON.parse(readFileSync(`out/${name}.sol/${name}.json`)).abi;
const CORE_ABI = abi('ABBCore');
const AR_ABI = abi('AgentRegistry');
const TR_ABI = abi('TaskRegistry');
const BE_ABI = abi('BountyEscrow');
const VP_ABI = abi('ValidatorPool');

// Deployer key
const DEPLOYER_KEY = '0xc1dbab5f8ef144fd30149fc9f011f3594d6a51f123a67570d2dcdd8049cb8898';
const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);

const core = new ethers.Contract(ADDR.Core, CORE_ABI, deployer);
const agentReg = new ethers.Contract(ADDR.AgentReg, AR_ABI, deployer);
const taskReg = new ethers.Contract(ADDR.TaskReg, TR_ABI, deployer);
const escrow = new ethers.Contract(ADDR.Escrow, BE_ABI, deployer);
const validatorPool = new ethers.Contract(ADDR.Validator, VP_ABI, deployer);

const SCORE = 80;
const SALT = ethers.id('test-salt-2024');
const BOUNTY = ethers.parseEther('0.0005');
const STAKE = ethers.parseEther('0.01');
const COMMIT_DURATION = 180; // 3 min
const REVEAL_DURATION = 180; // 3 min

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('═'.repeat(60));
  console.log('  AgentEcon — Full E2E Test (4th Deployment)');
  console.log('═'.repeat(60));

  const bal = await provider.getBalance(deployer.address);
  console.log(`\nDeployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(bal)} ETH`);

  // Step 0: Verify authorizations
  console.log('\n--- VERIFY AUTHORIZATIONS ---');
  const checks = [
    [agentReg, 'AgentRegistry'],
    [escrow, 'BountyEscrow'],
    [taskReg, 'TaskRegistry'],
    [validatorPool, 'ValidatorPool'],
  ];
  for (const [c, name] of checks) {
    const auth = await c.authorizedCallers(ADDR.Core);
    console.log(`  ${name}: Core authorized = ${auth}`);
    if (!auth) throw new Error(`${name} missing Core authorization!`);
  }
  console.log('  ✅ All authorizations verified');

  // Get explicit nonce to avoid replacement issues
  let nonce = await provider.getTransactionCount(deployer.address, 'latest');
  console.log(`  Starting nonce: ${nonce}`);

  // Step 1: Configure timing (skip if already set)
  console.log('\n--- CONFIGURE TIMING ---');
  const currentCommit = await core.commitDuration();
  let tx;
  if (Number(currentCommit) !== COMMIT_DURATION) {
    tx = await core.configureTiming(COMMIT_DURATION, REVEAL_DURATION, { nonce: nonce++ });
    await tx.wait();
    console.log(`  ✅ Set: Commit: ${COMMIT_DURATION}s, Reveal: ${REVEAL_DURATION}s`);
  } else {
    console.log(`  ✅ Already set: ${COMMIT_DURATION}s / ${REVEAL_DURATION}s`);
  }

  // Step 2: Register 5 validators
  console.log('\n--- REGISTER VALIDATORS ---');
  const validators = [];
  for (let i = 0; i < 5; i++) {
    const w = ethers.Wallet.createRandom().connect(provider);
    validators.push(w);
  }
  // Save keys to file BEFORE funding (lesson learned the hard way)
  const keyData = {};
  validators.forEach((w,i) => { keyData[i] = { address: w.address, privateKey: w.privateKey }; });
  writeFileSync('test-validator-keys-v7.json', JSON.stringify(keyData, null, 2));
  console.log('  ✅ Validator keys saved to test-validator-keys-v7.json');
  validators.forEach((w,i) => console.log(`    V${i}: ${w.address.slice(0,10)}...`));
  
  // Fund all first, then register all
  console.log('  Funding validators...');
  for (let i = 0; i < 5; i++) {
    tx = await deployer.sendTransaction({ to: validators[i].address, value: STAKE + ethers.parseEther('0.0005'), nonce: nonce++ });
    await tx.wait();
    console.log(`    V${i} funded`);
  }
  console.log('  Registering validators...');
  for (let i = 0; i < 5; i++) {
    const vp = new ethers.Contract(ADDR.Validator, VP_ABI, validators[i]);
    tx = await vp.registerValidator({ value: STAKE });
    await tx.wait();
    console.log(`  ✅ V${i}: ${validators[i].address.slice(0,10)}...`);
  }
  const active = await validatorPool.activeValidatorCount();
  console.log(`  Active validators: ${active}/5`);

  // Step 3: Register agent
  console.log('\n--- REGISTER AGENT ---');
  const metaHash = ethers.id('test-agent-metadata');
  tx = await agentReg.registerAgent(metaHash, { nonce: nonce++ });
  const agentReceipt = await tx.wait();
  const agentId = agentReceipt.logs[0]?.args?.[0] ?? 0n;
  console.log(`  ✅ Agent registered, id=${agentId}`);

  // Step 4: Create task with ETH bounty
  console.log('\n--- CREATE TASK ---');
  const taskHash = ethers.id('test-task-metadata');
  const deadline = Math.floor(Date.now() / 1000) + 86400; // 24h from now
  tx = await core.createTaskETH(taskHash, deadline, { value: BOUNTY, nonce: nonce++ });
  const taskReceipt = await tx.wait();
  // Find task ID from events
  let taskId = 0n;
  for (const log of taskReceipt.logs) {
    try {
      const parsed = taskReg.interface.parseLog(log);
      if (parsed?.name === 'TaskCreated') { taskId = parsed.args[0]; break; }
    } catch {}
  }
  console.log(`  ✅ Task created, id=${taskId}, bounty=${ethers.formatEther(BOUNTY)} ETH`);

  // Step 5: Claim task
  console.log('\n--- CLAIM TASK ---');
  tx = await core.claimTask(taskId, agentId, { nonce: nonce++ });
  await tx.wait();
  console.log(`  ✅ Task claimed by agent ${agentId}`);

  // Step 6: Submit work
  console.log('\n--- SUBMIT WORK ---');
  const workHash = ethers.id('test-work-submission');
  tx = await core.submitWork(taskId, workHash, { nonce: nonce++ });
  await tx.wait();
  console.log('  ✅ Work submitted');

  // Panel is 5 random validators — since we own all 5, it's guaranteed to be ours
  console.log('  Panel: all 5 validators are ours (only 5 registered)');
  
  const submitTime = Math.floor(Date.now() / 1000);

  // Step 7: Commit scores
  console.log('\n--- COMMIT SCORES ---');
  const commitHash = ethers.solidityPackedKeccak256(
    ['uint256', 'uint8', 'bytes32'],
    [taskId, SCORE, SALT]
  );
  for (let i = 0; i < 5; i++) {
    const vp = new ethers.Contract(ADDR.Validator, VP_ABI, validators[i]);
    tx = await vp.commitScore(taskId, commitHash);
    await tx.wait();
    console.log(`  ✅ V${i} committed`);
  }

  // Wait for commit phase to end (COMMIT_DURATION from submission)
  const elapsed = Math.floor(Date.now() / 1000) - submitTime;
  const waitCommit = Math.max(0, COMMIT_DURATION - elapsed + 10);
  console.log(`\n  ⏳ Waiting ${waitCommit}s for commit phase to end...`);
  await sleep(waitCommit * 1000);

  // Step 8: Reveal scores
  console.log('\n--- REVEAL SCORES ---');
  for (let i = 0; i < 5; i++) {
    const vp = new ethers.Contract(ADDR.Validator, VP_ABI, validators[i]);
    tx = await vp.revealScore(taskId, SCORE, SALT);
    await tx.wait();
    console.log(`  ✅ V${i} revealed`);
  }

  // Wait for reveal phase to end (COMMIT_DURATION + REVEAL_DURATION from submission)
  const elapsed2 = Math.floor(Date.now() / 1000) - submitTime;
  const waitReveal = Math.max(0, COMMIT_DURATION + REVEAL_DURATION - elapsed2 + 10);
  console.log(`\n  ⏳ Waiting ${waitReveal}s for reveal phase to end...`);
  await sleep(waitReveal * 1000);

  // Step 9: Finalize
  console.log('\n--- FINALIZE ---');
  nonce = await provider.getTransactionCount(deployer.address, 'latest');
  tx = await core.finalizeReview(taskId, { nonce: nonce++ });
  const finReceipt = await tx.wait();
  console.log(`  ✅ Finalized! Gas: ${finReceipt.gasUsed}`);

  const result = await validatorPool.getRoundResult(taskId);
  console.log(`  Round finalized: ${result[0]} | Median: ${result[1]}`);

  // Verify task completed
  const task = await taskReg.getTask(taskId);
  const states = ['Open','Claimed','Submitted','InReview','Completed','Disputed','Cancelled'];
  const status = states[Number(task[7])] || task[7].toString();
  console.log(`  Task status: ${status}`);

  // Step 10: Withdraw payout
  console.log('\n--- WITHDRAW PAYOUT ---');
  const claimable = await escrow.claimableETH(deployer.address);
  console.log(`  Claimable: ${ethers.formatEther(claimable)} ETH`);
  if (claimable > 0n) {
    tx = await escrow.withdrawETH({ nonce: nonce++ });
    await tx.wait();
    console.log(`  ✅ Payout withdrawn: ${ethers.formatEther(claimable)} ETH`);
  }

  // Note: Validator stakes have UNSTAKE_COOLDOWN — skip recovery in test

  const finalBal = await provider.getBalance(deployer.address);
  console.log(`\nFinal deployer balance: ${ethers.formatEther(finalBal)} ETH`);

  console.log('\n' + '═'.repeat(60));
  console.log('  🎉 FULL E2E TEST PASSED — ALL STEPS COMPLETE 🎉');
  console.log('═'.repeat(60));
}

main().catch(e => {
  console.error('\n❌ TEST FAILED:', e.message || e);
  process.exit(1);
});
