// EIP-712 types of PROTOCOL §2. Signed by wallets (Offer, JobManifest, KeyRelease) and the worker (WorkerReceipt).
import { hashTypedData, recoverTypedDataAddress, keccak256, encodeAbiParameters, stringToHex, type Address, type Hex } from 'viem'

export const domain = (escrow: Address, chainId = 16602) => ({ name: 'SealedAI', version: '1', chainId, verifyingContract: escrow }) as const

export const types = {
  Offer: [
    { name: 'seller', type: 'address' }, { name: 'assetId', type: 'bytes32' }, { name: 'assetVersion', type: 'uint32' },
    { name: 'assetCommitment', type: 'bytes32' }, { name: 'assetRoot', type: 'bytes32' }, { name: 'format', type: 'bytes32' },
    { name: 'task', type: 'bytes32' }, { name: 'architecture', type: 'bytes32' }, { name: 'recipeCatalogHash', type: 'bytes32' },
    { name: 'workerImageDigest', type: 'bytes32' }, { name: 'evidencePolicyHash', type: 'bytes32' }, { name: 'token', type: 'address' },
    { name: 'price', type: 'uint256' }, { name: 'licenseHash', type: 'bytes32' }, { name: 'maxTrainingRuns', type: 'uint8' },
    { name: 'validUntil', type: 'uint64' }, { name: 'offerNonce', type: 'uint256' },
  ],
  JobManifest: [
    { name: 'offerHash', type: 'bytes32' }, { name: 'buyer', type: 'address' }, { name: 'seller', type: 'address' },
    { name: 'worker', type: 'address' }, { name: 'workerKeyHash', type: 'bytes32' }, { name: 'evidenceHash', type: 'bytes32' },
    { name: 'runtime', type: 'uint8' }, { name: 'datasetCommitment', type: 'bytes32' }, { name: 'splitCommitment', type: 'bytes32' },
    { name: 'goalCommitment', type: 'bytes32' }, { name: 'planHash', type: 'bytes32' }, { name: 'plannerPolicyHash', type: 'bytes32' },
    { name: 'outputPolicyHash', type: 'bytes32' }, { name: 'maxPlannerCalls', type: 'uint16' }, { name: 'maxGpuSeconds', type: 'uint32' },
    { name: 'maxWallClockSec', type: 'uint32' }, { name: 'maxInferenceCalls', type: 'uint32' }, { name: 'buyerSessionPubKey', type: 'bytes' },
    { name: 'jobId', type: 'uint256' }, { name: 'expiresAt', type: 'uint64' },
  ],
  KeyRelease: [
    { name: 'manifestHash', type: 'bytes32' }, { name: 'role', type: 'uint8' }, { name: 'objectId', type: 'bytes32' }, { name: 'wrappedKeyHash', type: 'bytes32' },
  ],
  WorkerReceipt: [
    { name: 'manifestHash', type: 'bytes32' }, { name: 'jobId', type: 'uint256' }, { name: 'reportRoot', type: 'bytes32' },
    { name: 'reportCommitment', type: 'bytes32' }, { name: 'baselineValMetric', type: 'int32' }, { name: 'selectedValMetric', type: 'int32' },
    { name: 'holdoutMetric', type: 'int32' }, { name: 'trainingRuns', type: 'uint8' }, { name: 'stopReason', type: 'uint8' },
    { name: 'timelineHead', type: 'bytes32' }, { name: 'evidenceHash', type: 'bytes32' }, { name: 'runtime', type: 'uint8' },
  ],
} as const

type Fields<K extends keyof typeof types> = { [F in (typeof types)[K][number] as F['name']]: F['type'] extends `uint${string}` | `int${string}` ? bigint | number : F['type'] extends 'address' ? Address : Hex }
export type Offer = Fields<'Offer'>
export type JobManifest = Fields<'JobManifest'>
export type KeyRelease = Fields<'KeyRelease'>
export type WorkerReceipt = Fields<'WorkerReceipt'>
export type PrimaryType = keyof typeof types

type TD = Parameters<typeof hashTypedData>[0]
/** What to pass to a wallet's signTypedData. */
export const typedData = <K extends PrimaryType>(primaryType: K, message: Fields<K>, escrow: Address) =>
  ({ domain: domain(escrow), types: { [primaryType]: types[primaryType] }, primaryType, message }) as unknown as TD

export const typedHash = <K extends PrimaryType>(primaryType: K, message: Fields<K>, escrow: Address) => hashTypedData(typedData(primaryType, message, escrow))

export const recoverTyped = <K extends PrimaryType>(primaryType: K, message: Fields<K>, signature: Hex, escrow: Address) =>
  recoverTypedDataAddress({ ...(typedData(primaryType, message, escrow) as object), signature } as Parameters<typeof recoverTypedDataAddress>[0])

/** Salted commitment (PROTOCOL header, review R07): keccak256(abi.encode(salt, value)). */
export const commit = (salt: Hex, value: Hex) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [salt, value]))
export const tag = (s: string) => keccak256(stringToHex(s))
export const ROLE = { seller: 1, buyer: 2 } as const
export const RUNTIME = { none: 0, tappGpu: 1, tappCpu: 2, sealedSandbox: 3, dstackGpu: 4 } as const
export const JOB_DESCRIPTION_PREFIX = 'sealedai:v1:'
export const metric1e4 = (x: number) => Math.round(x * 10_000)

/** Rebuild a typed message from JSON (bigints arrive as decimal strings). */
export function reviveTyped<K extends PrimaryType>(primaryType: K, obj: Record<string, unknown>): Fields<K> {
  const out: Record<string, unknown> = {}
  for (const f of types[primaryType]) {
    const v = obj[f.name]
    if (v === undefined) throw new Error(`${primaryType}.${f.name} is missing`)
    out[f.name] = /^u?int/.test(f.type) ? BigInt(v as string | number | bigint) : v
  }
  return out as Fields<K>
}
/** sha256:<hex> image digest ↔ bytes32 */
export const digestToBytes32 = (d: string) => `0x${d.replace(/^sha256:/, '')}` as Hex
