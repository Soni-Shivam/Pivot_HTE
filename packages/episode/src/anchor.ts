// Galileo anchoring (plan Task 11) on EpisodeRegistryV2: commitScenario(id, commitment, configHash) before the first
// inference, finalizeEpisode after publish. anchor.json (sealed) keeps the salt; publish reveals scenario.json and the
// salt in public.json (audit R7) so anyone can recompute both commitments. commitBlock's hash is the prompt nonce (A3).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, sha256, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from '@noble/hashes/utils.js'
import { galileo } from '@sealedai/integrations'
import { EPISODE_REGISTRY_V2, episodeRegistryV2Abi } from './abi/episodeRegistry.ts'
import { configHashOf } from './onchain.ts'

const commitOf = (bytes: Uint8Array, salt: Hex) =>
  keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [salt, sha256(bytes)]))
export const scenarioCommitment = commitOf
export const resultCommitment = commitOf
/** configHash = keccak256(abi.encode(bytes32 prompt_hash, string model, string git_commit)); inputs are public. */
export const configHash = configHashOf

export type AnchorConfig = { rpcUrl: string; privateKey: string; registry?: Hex }

function clients(cfg: AnchorConfig) {
  const chain = galileo(cfg.rpcUrl)
  const account = privateKeyToAccount((cfg.privateKey.startsWith('0x') ? cfg.privateKey : `0x${cfg.privateKey}`) as Hex)
  return { pub: createPublicClient({ chain, transport: http(cfg.rpcUrl) }), wallet: createWalletClient({ chain, transport: http(cfg.rpcUrl), account }), account }
}

async function send(cfg: AnchorConfig, functionName: 'commitScenario' | 'finalizeEpisode', args: readonly unknown[]) {
  const { pub, wallet, account } = clients(cfg)
  const address = cfg.registry ?? EPISODE_REGISTRY_V2
  const { request } = await pub.simulateContract({ address, abi: episodeRegistryV2Abi, functionName, args: args as never, account })
  const hash = await wallet.writeContract(request)
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 })
  if (r.status !== 'success') throw new Error(`${functionName} reverted: ${hash}`)
  const block = await pub.getBlock({ blockNumber: r.blockNumber })
  return { tx: hash, block: Number(r.blockNumber), blockHash: r.blockHash, blockTimestamp: Number(block.timestamp), evaluator: account.address }
}

const readJson = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))

export async function commit(dir: string, cfg: AnchorConfig) {
  if (existsSync(join(dir, 'anchor.json'))) throw new Error('already committed (anchor.json exists)')
  const m = readJson(dir, 'manifest.json')
  if (!m.config?.prompt_hash || !m.config?.git_commit) throw new Error('preliminary manifest needs config {prompt_hash, model, git_commit}')
  const episodeId = `0x${m.episode_id}` as Hex
  const salt = toHex(randomBytes(32))
  const commitment = scenarioCommitment(readFileSync(join(dir, 'scenario.json')), salt)
  const cfgHash = configHash(m.config)
  const r = await send(cfg, 'commitScenario', [episodeId, commitment, cfgHash])
  const registry = cfg.registry ?? EPISODE_REGISTRY_V2
  const onchain = await clients(cfg).pub.readContract({ address: registry, abi: episodeRegistryV2Abi, functionName: 'getEpisode', args: [r.evaluator, episodeId] })
  if (Number(onchain.commitBlock) !== r.block) throw new Error('commitBlock on chain differs from the receipt')
  const out = { registry, evaluator: r.evaluator, episodeId, salt, scenarioCommitment: commitment, configHash: cfgHash, config: m.config,
    seq: Number(onchain.seq), commitTx: r.tx, commitBlock: r.block, commitBlockHash: r.blockHash, commitBlockTimestamp: r.blockTimestamp }
  writeFileSync(join(dir, 'anchor.json'), JSON.stringify(out, null, 2) + '\n')
  return { episodeId, commitment, configHash: cfgHash, seq: out.seq, tx: r.tx, commitBlock: r.block, commitBlockTimestamp: r.blockTimestamp }
}

export async function finalize(dir: string, cfg: AnchorConfig) {
  const a = readJson(dir, 'anchor.json'), p = readJson(dir, 'publish.json'), m = readJson(dir, 'manifest.json')
  if (a.finalizeTx) throw new Error('already finalized')
  const result = resultCommitment(readFileSync(join(dir, 'metrics.json')), a.salt)
  const status = m.status === 'completed' ? 1 : 2
  const r = await send(cfg, 'finalizeEpisode', [a.episodeId, p.publicRoot, p.sealedRoot, result, status, !!m.collision])
  const { pub } = clients(cfg)
  const onchain = await pub.readContract({ address: a.registry, abi: episodeRegistryV2Abi, functionName: 'getEpisode', args: [a.evaluator, a.episodeId] })
  // 0G Storage log positions of both uploads (audit C1: chain-ordered evidence for the log), recorded at finalize
  const out = { ...a, resultCommitment: result, status, collision: !!m.collision, finalizeTx: r.tx, finalizeBlock: r.block,
    finalizeBlockTimestamp: r.blockTimestamp, publicTx: p.publicTx, publicTxSeq: p.publicTxSeq ?? null, sealedTx: p.sealedTx, sealedTxSeq: p.sealedTxSeq ?? null,
    onchainMatches: onchain.publicRoot === p.publicRoot && onchain.sealedRoot === p.sealedRoot && onchain.resultCommitment === result &&
      onchain.scenarioCommitment === a.scenarioCommitment && onchain.configHash === a.configHash }
  writeFileSync(join(dir, 'anchor.json'), JSON.stringify(out, null, 2) + '\n')
  return { tx: r.tx, onchainMatches: out.onchainMatches }
}
