import { baseSepolia } from 'wagmi/chains'
import ABBCoreABI from './abis/ABBCore.json'
import AgentRegistryABI from './abis/AgentRegistry.json'
import TaskRegistryABI from './abis/TaskRegistry.json'
import BountyEscrowABI from './abis/BountyEscrow.json'
import ValidatorPoolABI from './abis/ValidatorPool.json'

// Contract addresses from env vars with testnet v7 fallbacks (L-5 remediation)
export const CONTRACTS = {
  abbCore: (process.env.NEXT_PUBLIC_ABBCORE_ADDRESS || '0x6972d08C4B74e0a03Fa77E49e28A87A695ecf703') as `0x${string}`,
  agentRegistry: (process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS || '0x6473048778e011D9b45A0fFa993ED0dA4B777bA5') as `0x${string}`,
  taskRegistry: (process.env.NEXT_PUBLIC_TASK_REGISTRY_ADDRESS || '0x819ee47ed96817CBbeD64097B61171dFF302b6c4') as `0x${string}`,
  bountyEscrow: (process.env.NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS || '0x2B0eBdF1dce650C52CA6a53205758f181cce1AF6') as `0x${string}`,
  validatorPool: (process.env.NEXT_PUBLIC_VALIDATOR_POOL_ADDRESS || '0x5241129505300f2BB02B789c5A8fD12908ED1C25') as `0x${string}`,
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
