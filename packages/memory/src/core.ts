// Safety memory core (browser-safe): the Merkle scheme of faultline/memory.py, the per-claim recomputation an auditor
// runs, the snapshot sealing key, the Arkiv claim schema and the AgentMemoryRegistry ABI.
// Merkle scheme (identical to Python; raw bytes only, JSON is never re-serialized across languages):
//   record_hash = sha256(raw UTF-8 line without newline); parent = sha256(0x01 || left || right);
//   an odd last node is carried up unchanged; root of [] = sha256(""). Roots are 0x-prefixed hex.
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { addr, dec, defineSchema, str, u64 } from '@arkiv-network/sdk/schema'
import { parseAbi } from 'viem'
import { open, seal } from '../../protocol/src/envelope.ts'
import { packTar, unpackTar } from '../../protocol/src/tar.ts'

export const recordHash = (line: Uint8Array) => bytesToHex(sha256(line))

export function merkleRoot(leavesHex: string[]): string {
  let level: Uint8Array[] = leavesHex.map((h) => hexToBytes(h.replace(/^0x/, '')))
  if (!level.length) return `0x${bytesToHex(sha256(new Uint8Array()))}`
  while (level.length > 1) {
    const next: Uint8Array[] = []
    for (let i = 0; i + 1 < level.length; i += 2) next.push(sha256(concatBytes(new Uint8Array([1]), level[i], level[i + 1])))
    if (level.length % 2) next.push(level[level.length - 1])
    level = next
  }
  return `0x${bytesToHex(level[0])}`
}

/** Raw JSONL bytes -> raw lines (no re-encoding). */
export function splitLines(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = []
  let s = 0
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 10) {
      if (i > s) out.push(bytes.subarray(s, i))
      s = i + 1
    }
  }
  return out
}
export const linesRoot = (lines: Uint8Array[]) => merkleRoot(lines.map(recordHash))

const Z95 = 1.959963984540054
const r6 = (x: number) => Math.round(x * 1e6) / 1e6
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1]
  const p = k / n, z2 = Z95 * Z95
  const c = (p + z2 / (2 * n)) / (1 + z2 / n), h = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
  return [r6(Math.max(0, c - h)), r6(Math.min(1, c + h))]
}

export type Claim = {
  agent_id: number; model_id: string; version: string; artifact_digest: string; category: string; n_tests: number; n_collisions: number
  rate: number; ci95: [number, number]; n_unsafe: number; unsafe_rate: number; unsafe_ci95: [number, number]; mean_speed_mps: number
  records_merkle_root: string; record_indices: number[]
}
type Rec = { i: number; model: { model_id: string; version: string; artifact_digest: string }; category: string
  outcome: { safe: boolean; collision: boolean; mean_speed_mps: number } }

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

/** Recompute one claim from the raw record lines: n and counts exactly, rates/CI within rounding (1.5e-6). */
export function checkClaim(c: Claim, lines: Uint8Array[]) {
  const td = new TextDecoder()
  const sub = lines.map((l) => ({ l, r: JSON.parse(td.decode(l)) as Rec }))
    .filter(({ r }) => r.model.model_id === c.model_id && r.model.version === c.version && r.category === c.category)
  const n = sub.length, kc = sub.filter(({ r }) => r.outcome.collision).length, ku = sub.filter(({ r }) => !r.outcome.safe).length
  const ci = wilson(kc, n), uci = wilson(ku, n)
  const speed = n ? sub.reduce((s, { r }) => s + r.outcome.mean_speed_mps, 0) / n : NaN
  const checks = {
    indices: JSON.stringify(sub.map(({ r }) => r.i)) === JSON.stringify(c.record_indices),
    digest: sub.every(({ r }) => r.model.artifact_digest === c.artifact_digest),
    n_tests: n === c.n_tests, n_collisions: kc === c.n_collisions, n_unsafe: ku === c.n_unsafe,
    rate: n > 0 && near(kc / n, c.rate, 1.5e-6), unsafe_rate: n > 0 && near(ku / n, c.unsafe_rate, 1.5e-6),
    ci95: near(ci[0], c.ci95[0], 1.5e-6) && near(ci[1], c.ci95[1], 1.5e-6),
    unsafe_ci95: near(uci[0], c.unsafe_ci95[0], 1.5e-6) && near(uci[1], c.unsafe_ci95[1], 1.5e-6),
    mean_speed: near(speed, c.mean_speed_mps, 1e-4),
    records_merkle_root: linesRoot(sub.map(({ l }) => l)) === c.records_merkle_root,
  }
  return { version: c.version, category: c.category, n: c.n_tests, collisions: c.n_collisions, rate: c.rate, ok: Object.values(checks).every(Boolean), checks }
}

/** Every (model, version, category) group present in the records must have exactly one claim (nothing hidden). */
export function claimsCoverRecords(claims: Claim[], lines: Uint8Array[]): boolean {
  const td = new TextDecoder()
  const groups = new Set(lines.map((l) => JSON.parse(td.decode(l)) as Rec).map((r) => `${r.model.model_id}|${r.model.version}|${r.category}`))
  const named = claims.map((c) => `${c.model_id}|${c.version}|${c.category}`)
  return named.length === new Set(named).size && named.length === groups.size && named.every((g) => groups.has(g))
}

// Sealed snapshot: tar{snapshot.json, records.jsonl} in the protocol's AES-256-GCM envelope (PROTOCOL §3).
// key = HKDF-SHA256(ikm = tenant key, no salt, info = "memory:" + memory_version, 32 bytes); memory_version is
// "<model_id>@<version>#<seq>", so one leaked snapshot key opens only that snapshot.
export const memoryKey = (tenantKey: Uint8Array, memoryVersion: string) => hkdf(sha256, tenantKey, undefined, utf8ToBytes(`memory:${memoryVersion}`), 32)
const meta = (mv: string) => ({ objectType: 'report' as const, objectId: `memory:${mv}`, version: 1 })

export function sealSnapshot(files: { name: string; data: Uint8Array }[], tenantKey: Uint8Array, memoryVersion: string) {
  return seal(packTar(files), meta(memoryVersion), memoryKey(tenantKey, memoryVersion)).blob
}
export function openSnapshot(blob: Uint8Array, tenantKey: Uint8Array, memoryVersion: string) {
  const { plaintext } = open(blob, memoryKey(tenantKey, memoryVersion), meta(memoryVersion))
  return Object.fromEntries(unpackTar(plaintext).map((f) => [f.name, f.data])) as Record<string, Uint8Array>
}

// Galileo AgentMemoryRegistry (contracts/src/AgentMemoryRegistry.sol); address from contracts/deployments/16602.json
export const AGENT_MEMORY_REGISTRY = '0x7a8676D267f1aa17d6B55cF5BfcD2A9509b963e3' as const
export const agentMemoryRegistryAbi = parseAbi([
  'struct Anchor { bytes32 publicRoot; bytes32 sealedRoot; bytes32 prevRoot; bytes32 claimsRoot; address owner; uint64 blockNumber; uint64 timestamp; string version; }',
  'function anchor(uint256 agentId, bytes32 modelId, string version, bytes32 publicRoot, bytes32 sealedRoot, bytes32 prevRoot, bytes32 claimsRoot) returns (uint64 seq)',
  'function getAnchor(uint256 agentId, bytes32 modelId, uint64 seq) view returns (Anchor)',
  'function latestSeq(uint256 agentId, bytes32 modelId) view returns (uint64)',
  'event MemoryAnchored(uint256 indexed agentId, bytes32 indexed modelId, uint64 indexed seq, string version, bytes32 publicRoot, bytes32 sealedRoot, bytes32 prevRoot, bytes32 claimsRoot, address owner)',
])

// One Arkiv entity per shareable claim (arkiv/schema.md). Indexed = what OEMs, insurers and auditors filter on.
export const ClaimV1 = defineSchema('faultline.claim/v1', {
  model_id: str().indexed(),
  version: str().indexed(),
  category: str().indexed(),
  agent_id: u64().indexed(),
  campaign: str().indexed(),
  n_tests: u64().indexed(),
  n_collisions: u64(),
  rate: dec().indexed(),
  ci95_lo: dec(),
  ci95_hi: dec(),
  n_unsafe: u64(),
  unsafe_rate: dec().indexed(),
  mean_speed_mps: dec(),
  artifact_digest: str(),
  public_root: str().indexed(),
  sealed_root: str(),
  claims_root: str(),
  records_merkle_root: str(),
  registry: addr(),
  anchor_seq: u64(),
  anchor_tx: str(),
})
export { addr, dec, u64 }
