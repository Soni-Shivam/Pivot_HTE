// Recipe catalog v1 (PROTOCOL §7, PLAN §3.3). Every value is enumerated: the agent can only pick, never invent.
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { canonical } from '@sealedai/protocol'

export type Recipe = {
  method: 'lora' | 'head_only'
  lora?: { r: 8 | 16; alpha: 16 | 32; dropout: 0.05 | 0.1; targets: string[] }
  optim: { lr: 5e-5 | 1e-4 | 2e-4; epochs: 1 | 2 | 3; batch: 8 | 16; warmup: 0 | 0.06 }
  classWeights: 'none' | 'balanced'
  maxLen: 128 | 256
}

export const ENUMS = {
  method: ['lora', 'head_only'],
  r: [8, 16],
  alpha: [16, 32],
  dropout: [0.05, 0.1],
  lr: [5e-5, 1e-4, 2e-4],
  epochs: [1, 2, 3],
  batch: [8, 16],
  warmup: [0, 0.06],
  classWeights: ['none', 'balanced'],
  maxLen: [128, 256],
} as const

export type Catalog = { version: 'recipes/v1'; enums: typeof ENUMS; allowedTargets: string[] }

export function catalogV1(card: { allowedTargets: string[] }): Catalog {
  if (!card.allowedTargets.length) throw new Error('model card must list allowedTargets for LoRA')
  return { version: 'recipes/v1', enums: ENUMS, allowedTargets: [...card.allowedTargets].sort() }
}

export const catalogHash = (c: Catalog) => `0x${bytesToHex(keccak_256(canonical(c)))}`

// The seller model as-is: the baseline row in every report.
export const BASELINE = 'baseline'
