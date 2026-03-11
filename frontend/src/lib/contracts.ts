import { base } from 'wagmi/chains'
import ABBCoreABI from './abis/ABBCore.json'
import AgentRegistryABI from './abis/AgentRegistry.json'
import TaskRegistryABI from './abis/TaskRegistry.json'
import BountyEscrowABI from './abis/BountyEscrow.json'
import ValidatorPoolABI from './abis/ValidatorPool.json'

// MAINNET deployment (Base, 2026-03-11)
export const CONTRACTS = {
  abbCore: (process.env.NEXT_PUBLIC_ABBCORE_ADDRESS || '0x8Bac098243c8AEe9E2d338456b4d2860875084dB') as `0x${string}`,
  agentRegistry: (process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS || '0x03f62E221cCf126281AF321D1f9e8fb95b6Fe572') as `0x${string}`,
  taskRegistry: (process.env.NEXT_PUBLIC_TASK_REGISTRY_ADDRESS || '0xc78866b33Ff6Eb5b58281e77fB2666611505C465') as `0x${string}`,
  bountyEscrow: (process.env.NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS || '0x595dBdD8071c6893a31abD500Ca66EA0E0d0e0Fc') as `0x${string}`,
  validatorPool: (process.env.NEXT_PUBLIC_VALIDATOR_POOL_ADDRESS || '0x22bbEc2a7DD9959dFD31144317F185500d993C8b') as `0x${string}`,
  // V2 additions
  agentIdentity: (process.env.NEXT_PUBLIC_AGENT_IDENTITY_ADDRESS || '0x55D42a729dAE31e801bC034797C5AE769D04B3D9') as `0x${string}`,
  reputationRegistry: (process.env.NEXT_PUBLIC_REPUTATION_REGISTRY_ADDRESS || '0x7c77e455c73bC685254c987481f909d15c6c4e6d') as `0x${string}`,
  aeconToken: (process.env.NEXT_PUBLIC_AECON_TOKEN_ADDRESS || '0x40510af7D63316a267a5302A382e829dAd40bcf5') as `0x${string}`,
  tokenVesting: (process.env.NEXT_PUBLIC_TOKEN_VESTING_ADDRESS || '0xb732A86ea4f4c737b60ACDf649af5A0Af725D8f8') as `0x${string}`,
  validatorStaking: (process.env.NEXT_PUBLIC_VALIDATOR_STAKING_ADDRESS || '0xC506CE9381bE0F2b6a31343Cd0795cC2fFfcE1f1') as `0x${string}`,
} as const

export const abbCoreConfig = {
  address: CONTRACTS.abbCore,
  abi: ABBCoreABI,
  chainId: base.id,
} as const

export const agentRegistryConfig = {
  address: CONTRACTS.agentRegistry,
  abi: AgentRegistryABI,
  chainId: base.id,
} as const

export const taskRegistryConfig = {
  address: CONTRACTS.taskRegistry,
  abi: TaskRegistryABI,
  chainId: base.id,
} as const

export const bountyEscrowConfig = {
  address: CONTRACTS.bountyEscrow,
  abi: BountyEscrowABI,
  chainId: base.id,
} as const

export const validatorPoolConfig = {
  address: CONTRACTS.validatorPool,
  abi: ValidatorPoolABI,
  chainId: base.id,
} as const
