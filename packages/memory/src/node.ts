// Safety memory, Node side: publish (seal + 0G Storage), anchor (Galileo AgentMemoryRegistry), auditor verify,
// Arkiv claims. Env values are passed in by cli.ts and never printed.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk'
import { rabdi } from '@arkiv-network/sdk/chains'
import { and, eq } from '@arkiv-network/sdk/query'
import { createPublicClient as viemPublic, createWalletClient as viemWallet, http, keccak256, toHex, zeroHash, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { galileo, storage } from '@sealedai/integrations'
import { AGENT_MEMORY_REGISTRY, agentMemoryRegistryAbi, checkClaim, claimsCoverRecords, ClaimV1, addr, dec, u64, linesRoot, merkleRoot,
  openSnapshot, sealSnapshot, splitLines, type Claim } from './core.ts'

const hex0x = (k: string) => (k.startsWith('0x') ? k : `0x${k}`) as Hex
const readJson = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const claimsOf = (pub: any): Claim[] => pub.claim_lines.map((l: string) => JSON.parse(l))
export const modelIdOf = (modelId: string) => keccak256(toHex(modelId))

export type Env = { rpcUrl: string; indexerUrl: string; privateKey?: string; tenantKeyHex?: string; arkivRpcUrl?: string; arkivKey?: string; registry?: Hex }

export async function publish(dir: string, env: Env) {
  const tenant = hexToBytes(env.tenantKeyHex!.replace(/^0x/, ''))
  if (tenant.length !== 32) throw new Error('FAULTLINE_TENANT_KEY must be 32 bytes hex')
  const pubBytes = readFileSync(join(dir, 'public.json'))
  const pub = JSON.parse(pubBytes.toString('utf8'))
  const records = readFileSync(join(dir, 'records.jsonl'))
  if (linesRoot(splitLines(records)) !== pub.records_root) throw new Error('records.jsonl does not match public.json records_root')
  const sealed = sealSnapshot([{ name: 'snapshot.json', data: readFileSync(join(dir, 'snapshot.json')) }, { name: 'records.jsonl', data: records }], tenant, pub.memory_version)
  writeFileSync(join(dir, 'sealed.bin'), sealed)
  const st = storage({ rpcUrl: env.rpcUrl, indexerUrl: env.indexerUrl, privateKey: env.privateKey })
  const s = await st.uploadBlob(sealed)
  const p = await st.uploadBlob(new Uint8Array(pubBytes))
  const out = { memory_version: pub.memory_version, publicRoot: p.root, publicTx: p.txHash, sealedRoot: s.root, sealedTx: s.txHash,
    sealedKey: 'hkdf-sha256(tenant key, "memory:"+memory_version), AES-256-GCM envelope (objectType report, objectId memory:<memory_version>)',
    publicBytes: pubBytes.length, sealedBytes: sealed.length, records_root: pub.records_root, claims_root: pub.claims_root }
  writeFileSync(join(dir, 'publish.json'), JSON.stringify(out, null, 2) + '\n')
  return out
}

function galileoClients(env: Env) {
  const chain = galileo(env.rpcUrl)
  const pub = viemPublic({ chain, transport: http(env.rpcUrl) })
  const account = env.privateKey ? privateKeyToAccount(hex0x(env.privateKey)) : undefined
  return { pub, account, wallet: account ? viemWallet({ chain, transport: http(env.rpcUrl), account }) : undefined }
}

export async function anchor(dir: string, env: Env) {
  const pub = readJson(dir, 'public.json'), p = readJson(dir, 'publish.json')
  const { pub: client, wallet, account } = galileoClients(env)
  const registry = env.registry ?? AGENT_MEMORY_REGISTRY
  const args = [BigInt(pub.agent_id), modelIdOf(pub.model_ref.model_id), pub.model_ref.version, p.publicRoot as Hex, p.sealedRoot as Hex,
    (pub.prev_snapshot_root ?? zeroHash) as Hex, pub.claims_root as Hex] as const
  const { request, result } = await client.simulateContract({ address: registry, abi: agentMemoryRegistryAbi, functionName: 'anchor', args, account: account! })
  if (Number(result) !== pub.seq) throw new Error(`registry would assign seq ${result}, snapshot says ${pub.seq}`)
  const hash = await wallet!.writeContract(request)
  const r = await client.waitForTransactionReceipt({ hash, timeout: 180_000 })
  if (r.status !== 'success') throw new Error(`anchor reverted: ${hash}`)
  const on = await client.readContract({ address: registry, abi: agentMemoryRegistryAbi, functionName: 'getAnchor', args: [args[0], args[1], BigInt(pub.seq)] })
  const out = { registry, agentId: pub.agent_id, modelId: args[1], model: pub.model_ref.model_id, version: pub.model_ref.version, seq: pub.seq,
    tx: hash, block: Number(r.blockNumber), owner: account!.address, publicRoot: p.publicRoot, sealedRoot: p.sealedRoot, prevRoot: args[5], claimsRoot: args[6],
    onchainMatches: on.publicRoot === p.publicRoot && on.sealedRoot === p.sealedRoot && on.claimsRoot === pub.claims_root && on.prevRoot === args[5] }
  writeFileSync(join(dir, 'anchor.json'), JSON.stringify(out, null, 2) + '\n')
  return out
}

/** Auditor: download both 0G objects (root-checked), recompute the claims root, open the sealed snapshot with the
 *  tenant key, recompute the records root and every claim's n/rate/CI/Merkle root, and compare with the anchor. */
export async function verify(publicRoot: string, sealedRoot: string, env: Env, deps: { download?: (r: string) => Promise<Uint8Array>
  getAnchor?: (agentId: bigint, modelId: Hex, seq: bigint) => Promise<{ publicRoot: Hex; sealedRoot: Hex; prevRoot: Hex; claimsRoot: Hex; owner: Hex }> } = {}) {
  const download = deps.download ?? storage({ rpcUrl: env.rpcUrl, indexerUrl: env.indexerUrl }).downloadBlob
  const pub = JSON.parse(new TextDecoder().decode(await download(publicRoot)))
  const claims = claimsOf(pub)
  const claimsRootOk = merkleRoot(pub.claim_lines.map((l: string) => bytesToHex(sha256(new TextEncoder().encode(l))))) === pub.claims_root
  const files = openSnapshot(await download(sealedRoot), hexToBytes(env.tenantKeyHex!.replace(/^0x/, '')), pub.memory_version)
  const lines = splitLines(files['records.jsonl'])
  const snap = JSON.parse(new TextDecoder().decode(files['snapshot.json']))
  const getAnchor = deps.getAnchor ?? ((a, m, s) => galileoClients(env).pub.readContract({ address: env.registry ?? AGENT_MEMORY_REGISTRY, abi: agentMemoryRegistryAbi, functionName: 'getAnchor', args: [a, m, s] }))
  const on = await getAnchor(BigInt(pub.agent_id), modelIdOf(pub.model_ref.model_id), BigInt(pub.seq))
  const perClaim = claims.map((c) => checkClaim(c, lines))
  const out = {
    publicRoot, sealedRoot, memory_version: pub.memory_version, publicRootOk: true, sealedRootOk: true, claimsRootOk,
    sealedOpened: true, recordCount: lines.length,
    recordsFileShaOk: bytesToHex(sha256(files['records.jsonl'])) === pub.records_file_sha256,
    recordsRootOk: linesRoot(lines) === pub.records_root && snap.records_root === pub.records_root,
    snapshotMatchesPublic: snap.claims_root === pub.claims_root && snap.memory_version === pub.memory_version && (snap.prev_snapshot_root ?? null) === (pub.prev_snapshot_root ?? null),
    claimsCoverRecords: claimsCoverRecords(claims, lines),
    claims: perClaim, allClaimsOk: perClaim.every((c) => c.ok),
    onchain: { owner: on.owner, publicRoot: on.publicRoot === publicRoot, sealedRoot: on.sealedRoot === sealedRoot, claimsRoot: on.claimsRoot === pub.claims_root,
      prevRoot: on.prevRoot === (pub.prev_snapshot_root ?? zeroHash) },
    checked_at: new Date().toISOString(),
  }
  return { ...out, ok: out.claimsRootOk && out.recordsFileShaOk && out.recordsRootOk && out.snapshotMatchesPublic && out.claimsCoverRecords && out.allClaimsOk && Object.values(out.onchain).slice(1).every(Boolean) }
}

// ---------------------------------------------------------------- Arkiv (Rabdi testnet, chain 7794095)
export function arkivClients(env: Env) {
  // the access key travels as the X-API-KEY header (.claude/skills/sealedai-stack/SKILL.md), never in a printed URL
  const transport = http(env.arkivRpcUrl, { fetchOptions: { headers: { 'X-API-KEY': env.arkivKey ?? '' } } })
  const chain = rabdi({ accessKey: env.arkivKey ?? '' })
  const account = env.privateKey ? privateKeyToAccount(hex0x(env.privateKey)) : undefined
  return { publicClient: createPublicClient({ chain, transport }), walletClient: account ? createWalletClient({ chain, transport, account }) : undefined, account }
}

export const CLAIM_TTL_DAYS = 90 // a regression claim is a quarterly statement; roots on 0G and the anchor on Galileo stay

export async function arkivPublish(dir: string, env: Env) {
  const pub = readJson(dir, 'public.json'), a = readJson(dir, 'anchor.json'), p = readJson(dir, 'publish.json')
  const { walletClient, account } = arkivClients(env)
  const out: { key: Hex; tx?: Hex; version: string; category: string }[] = []
  for (const c of claimsOf(pub)) {
    const res = await walletClient!.createEntity(ClaimV1, {
      model_id: c.model_id, version: c.version, category: c.category, agent_id: u64(BigInt(c.agent_id)), campaign: pub.memory_version,
      n_tests: u64(BigInt(c.n_tests)), n_collisions: u64(BigInt(c.n_collisions)), rate: dec(c.rate.toFixed(6)), ci95_lo: dec(c.ci95[0].toFixed(6)),
      ci95_hi: dec(c.ci95[1].toFixed(6)), n_unsafe: u64(BigInt(c.n_unsafe)), unsafe_rate: dec(c.unsafe_rate.toFixed(6)),
      mean_speed_mps: dec(c.mean_speed_mps.toFixed(4)), artifact_digest: c.artifact_digest, public_root: p.publicRoot, sealed_root: p.sealedRoot,
      claims_root: pub.claims_root, records_merkle_root: c.records_merkle_root, registry: addr(a.registry), anchor_seq: u64(BigInt(a.seq)), anchor_tx: a.tx,
    }, { expiration: ExpirationTime.fromDays(CLAIM_TTL_DAYS) })
    out.push({ key: (res as { entityKey: Hex }).entityKey, tx: (res as { txHash?: Hex }).txHash, version: c.version, category: c.category })
  }
  const doc = { owner: account!.address, schema: 'faultline.claim/v1', ttl_days: CLAIM_TTL_DAYS, campaign: pub.memory_version, entities: out }
  writeFileSync(join(dir, 'arkiv.json'), JSON.stringify(doc, null, 2) + '\n')
  return doc
}

export async function arkivQuery(env: Env, f: { model?: string; version?: string; category?: string; owner?: Hex }) {
  const { publicClient } = arkivClients(env)
  const conds = [f.model && eq('model_id', f.model), f.version && eq('version', f.version), f.category && eq('category', f.category)].filter(Boolean) as ReturnType<typeof eq>[]
  let q = publicClient.select({ $key: true, $owner: true, $expiresAt: true, model_id: true, version: true, category: true, n_tests: true, n_collisions: true,
    rate: true, ci95_lo: true, ci95_hi: true, unsafe_rate: true, public_root: true, anchor_tx: true, campaign: true }).from(ClaimV1)
  if (conds.length) q = q.where((conds.length === 1 ? conds[0] : and(...conds)) as never) // columns checked above by name
  if (f.owner) q = q.ownedBy(f.owner)
  const page = await q.limit(100).fetch()
  return page.entities.map((e: any) => Object.fromEntries(Object.entries(e).map(([k, v]: [string, any]) => [k, v && typeof v === 'object' && 'value' in v ? String(v.value) : String(v)])))
}
