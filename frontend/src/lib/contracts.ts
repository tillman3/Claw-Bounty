import { baseSepolia } from 'wagmi/chains'
import ABBCoreABI from './abis/ABBCore.json'
import AgentRegistryABI from './abis/AgentRegistry.json'
import TaskRegistryABI from './abis/TaskRegistry.json'
import BountyEscrowABI from './abis/BountyEscrow.json'
import ValidatorPoolABI from './abis/ValidatorPool.json'

// Contract addresses (Base Sepolia testnet v7)
export const CONTRACTS = {
  abbCore: '0x86A5a8c315f27220Db276EeB2B1CBDfacAE83Af4',
  agentRegistry: '0x137aEbf87F5D5c6FA0060D65f6b1D93d4040b5A8',
  taskRegistry: '0x0e2C80F6BcDC99Ee1dCf59eA78068c865F76849F',
  bountyEscrow: '0x278743Be679DA67b54F1fc57472864d26Ed02530',
  validatorPool: '0x32eBb10C23D9d9Ab9454a8dc12f98b26b4c11Eb5',
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
