#!/usr/bin/env node
/**
 * AgentEcon Demo Agent Orchestrator
 * 
 * Runs 5 AI agents on Base mainnet that:
 * 1. Register on AgentEcon
 * 2. Post real tasks with micro bounties
 * 3. Claim and complete tasks
 * 4. Generate real on-chain activity
 * 
 * Requires: .env.agents (agent wallets) + funded with small ETH
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load agent wallets
function loadAgents() {
  const envPath = resolve(ROOT, '.env.agents');
  const lines = readFileSync(envPath, 'utf-8').split('\n').filter(Boolean);
  const agents = [];
  
  for (let i = 1; i <= 5; i++) {
    const addr = lines.find(l => l.startsWith(`AGENT${i}_ADDRESS=`))?.split('=')[1];
    const key = lines.find(l => l.startsWith(`AGENT${i}_KEY=`))?.split('=')[1];
    if (addr && key) agents.push({ id: i, address: addr, key });
  }
  return agents;
}

// Contract ABIs (minimal)
const AGENT_REGISTRY_ABI = [
  'function registerAgent(string memory metadataURI) external',
  'function getAgentId(address) external view returns (uint256)',
  'function agentCount() external view returns (uint256)',
];

const TASK_REGISTRY_ABI = [
  'function createTask(string memory title, string memory description, uint8 category) external returns (uint256)',
  'function getTask(uint256 taskId) external view returns (tuple(uint256 id, address creator, string title, string description, uint8 category, uint8 status, uint256 createdAt))',
  'function taskCount() external view returns (uint256)',
];

const ABB_CORE_ABI = [
  'function createChallenge(string memory title, string memory desc, uint8 category) external payable returns (uint256)',
  'function claimChallenge(uint256 challengeId) external',
  'function submitWork(uint256 challengeId, bytes32 workHash) external',
];

// Mainnet contract addresses
const CONTRACTS = {
  agentRegistry: '0x03f62E221cCf126281AF321D1f9e8fb95b6Fe572',
  taskRegistry: '0xc78866b33Ff6Eb5b58281e77fB2666611505C465',
  abbCore: '0x8Bac098243c8AEe9E2d338456b4d2860875084dB',
  agentIdentity: '0x55D42a729dAE31e801bC034797C5AE769D04B3D9',
};

// Agent personas
const AGENT_NAMES = [
  { name: 'CodeBot-α', specialty: 'Code review and optimization', category: 0 },
  { name: 'ResearchAgent-1', specialty: 'Research synthesis and fact-checking', category: 2 },
  { name: 'DataCruncher', specialty: 'Data analysis and visualization', category: 3 },
  { name: 'AuditBot', specialty: 'Smart contract security review', category: 6 },
  { name: 'ContentForge', specialty: 'Technical writing and documentation', category: 1 },
];

// Sample tasks these agents would post/complete
const SAMPLE_TASKS = [
  { title: 'Review ERC-20 token contract for vulnerabilities', desc: 'Analyze a standard ERC-20 implementation for common vulnerabilities including reentrancy, overflow, and access control issues.', category: 6, bounty: '0.001' },
  { title: 'Summarize latest L2 scaling research', desc: 'Compile and summarize the 3 most impactful L2 scaling papers from the last 30 days with key takeaways.', category: 2, bounty: '0.001' },
  { title: 'Optimize gas usage in Solidity mapping patterns', desc: 'Analyze common Solidity mapping patterns and provide optimized alternatives with gas benchmarks.', category: 0, bounty: '0.002' },
  { title: 'Create data visualization of Base TVL growth', desc: 'Generate a clean chart showing Base L2 TVL growth over the last 6 months with key milestones annotated.', category: 3, bounty: '0.001' },
  { title: 'Write integration guide for ERC-8004', desc: 'Create a developer-friendly guide for integrating ERC-8004 agent identity into existing dApps.', category: 1, bounty: '0.002' },
];

async function main() {
  const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
  const agents = loadAgents();
  
  console.log('=== AgentEcon Demo Agent Orchestrator ===\n');
  
  // Check balances
  console.log('Agent balances:');
  let totalNeeded = 0;
  for (const agent of agents) {
    const bal = await provider.getBalance(agent.address);
    const ethBal = ethers.formatEther(bal);
    const persona = AGENT_NAMES[agent.id - 1];
    console.log(`  ${persona.name} (${agent.address}): ${ethBal} ETH`);
    if (bal === 0n) totalNeeded += 0.003;
  }
  
  if (totalNeeded > 0) {
    console.log(`\n⚠️  Agents need funding! Send ~0.003 ETH each for gas + bounties.`);
    console.log(`   Total needed: ~${(totalNeeded).toFixed(3)} ETH ($${(totalNeeded * 2000).toFixed(0)})`);
    console.log('\n   Fund from owner wallet:');
    for (const agent of agents) {
      const bal = await provider.getBalance(agent.address);
      if (bal === 0n) {
        console.log(`   cast send ${agent.address} --value 0.003ether --private-key <OWNER_KEY> --rpc-url https://mainnet.base.org`);
      }
    }
    return;
  }
  
  // Step 1: Register agents
  console.log('\n--- Step 1: Registering Agents ---');
  for (const agent of agents) {
    const wallet = new ethers.Wallet(agent.key, provider);
    const registry = new ethers.Contract(CONTRACTS.agentRegistry, AGENT_REGISTRY_ABI, wallet);
    const persona = AGENT_NAMES[agent.id - 1];
    
    try {
      const existingId = await registry.getAgentId(agent.address);
      if (existingId > 0n) {
        console.log(`  ✅ ${persona.name} already registered (ID: ${existingId})`);
        continue;
      }
    } catch (e) {
      // Not registered yet
    }
    
    try {
      const metadata = JSON.stringify({ name: persona.name, specialty: persona.specialty });
      const tx = await registry.registerAgent(metadata);
      await tx.wait();
      console.log(`  ✅ ${persona.name} registered! tx: ${tx.hash}`);
    } catch (e) {
      console.log(`  ❌ ${persona.name} registration failed: ${e.message?.slice(0, 80)}`);
    }
  }
  
  // Step 2: Create tasks
  console.log('\n--- Step 2: Creating Tasks ---');
  for (let i = 0; i < SAMPLE_TASKS.length; i++) {
    const task = SAMPLE_TASKS[i];
    const agent = agents[i % agents.length];
    const wallet = new ethers.Wallet(agent.key, provider);
    const core = new ethers.Contract(CONTRACTS.abbCore, ABB_CORE_ABI, wallet);
    const persona = AGENT_NAMES[agent.id - 1];
    
    try {
      const tx = await core.createChallenge(task.title, task.desc, task.category, {
        value: ethers.parseEther(task.bounty)
      });
      const receipt = await tx.wait();
      console.log(`  ✅ "${task.title}" posted by ${persona.name} (${task.bounty} ETH) tx: ${tx.hash}`);
    } catch (e) {
      console.log(`  ❌ Task creation failed: ${e.message?.slice(0, 100)}`);
    }
  }
  
  console.log('\n=== Demo agents active! ===');
  console.log('Check BaseScan for live transactions.');
}

main().catch(console.error);
