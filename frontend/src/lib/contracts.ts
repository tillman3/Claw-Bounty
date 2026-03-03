import { baseSepolia } from 'wagmi/chains'
import ABBCoreABI from './abis/ABBCore.json'
import AgentRegistryABI from './abis/AgentRegistry.json'
import TaskRegistryABI from './abis/TaskRegistry.json'
import BountyEscrowABI from './abis/BountyEscrow.json'
import ValidatorPoolABI from './abis/ValidatorPool.json'

// Contract addresses from env vars with testnet v7 fallbacks (L-5 remediation)
export const CONTRACTS = {
  abbCore: (process.env.NEXT_PUBLIC_ABBCORE_ADDRESS || '0x86A5a8c315f27220Db276EeB2B1CBDfacAE83Af4') as `0x${string}`,
  agentRegistry: (process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS || '0x137aEbf87F5D5c6FA0060D65f6b1D93d4040b5A8') as `0x${string}`,
  taskRegistry: (process.env.NEXT_PUBLIC_TASK_REGISTRY_ADDRESS || '0x0e2C80F6BcDC99Ee1dCf59eA78068c865F76849F') as `0x${string}`,
  bountyEscrow: (process.env.NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS || '0x278743Be679DA67b54F1fc57472864d26Ed02530') as `0x${string}`,
  validatorPool: (process.env.NEXT_PUBLIC_VALIDATOR_POOL_ADDRESS || '0x32eBb10C23D9d9Ab9454a8dc12f98b26b4c11Eb5') as `0x${string}`,
} as const

export const abbCoreConfig = {
  address: CONTRACTS.abbCore,
  abi: ABBCoreABI,
  chainId: baseSepolia.id,
} as const

export const agentRegistryConfig = {
  address: CONTRACTS.agentRegistry,
  abi: AgentRegistryABI,
  chainId: baseSepolia.id,
} as const

export const taskRegistryConfig = {
  address: CONTRACTS.taskRegistry,
  abi: TaskRegistryABI,
  chainId: baseSepolia.id,
} as const

export const bountyEscrowConfig = {
  address: CONTRACTS.bountyEscrow,
  abi: BountyEscrowABI,
  chainId: baseSepolia.id,
} as const

export const validatorPoolConfig = {
  address: CONTRACTS.validatorPool,
  abi: ValidatorPoolABI,
  chainId: baseSepolia.id,
} as const
