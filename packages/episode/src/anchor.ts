// Galileo anchoring (plan Task 11): commitScenario before the first inference, finalizeEpisode after publish.
// The salt lives in anchor.json, which only the sealed tar carries (publicJson never reads it).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, sha256, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from '@noble/hashes/utils.js'
import { galileo } from '@sealedai/integrations'
import { EPISODE_REGISTRY, episodeRegistryAbi } from './abi/episodeRegistry.ts'

const commitOf = (bytes: Uint8Array, salt: Hex) =>
  keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [salt, sha256(bytes)]))
export const scenarioCommitment = commitOf
export const resultCommitment = commitOf

export type AnchorConfig = { rpcUrl: string; privateKey: string; registry?: Hex }

function clients(cfg: AnchorConfig) {
  const chain = galileo(cfg.rpcUrl)
  const account = privateKeyToAccount((cfg.privateKey.startsWith('0x') ? cfg.privateKey : `0x${cfg.privateKey}`) as Hex)
  return { pub: createPublicClient({ chain, transport: http(cfg.rpcUrl) }), wallet: createWalletClient({ chain, transport: http(cfg.rpcUrl), account }), account }
}

async function send(cfg: AnchorConfig, functionName: 'commitScenario' | 'finalizeEpisode', args: readonly unknown[]) {
  const { pub, wallet, account } = clients(cfg)
  const address = cfg.registry ?? EPISODE_REGISTRY
  const { request } = await pub.simulateContract({ address, abi: episodeRegistryAbi, functionName, args: args as never, account })
  const hash = await wallet.writeContract(request)
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 })
  if (r.status !== 'success') throw new Error(`${functionName} reverted: ${hash}`)
  const block = await pub.getBlock({ blockNumber: r.blockNumber })
  return { tx: hash, block: Number(r.blockNumber), blockTimestamp: Number(block.timestamp) }
}

const readJson = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))

export async function commit(dir: string, cfg: AnchorConfig) {
  if (existsSync(join(dir, 'anchor.json'))) throw new Error('already committed (anchor.json exists)')
  const episodeId = `0x${readJson(dir, 'manifest.json').episode_id}` as Hex
  const salt = toHex(randomBytes(32))
  const commitment = scenarioCommitment(readFileSync(join(dir, 'scenario.json')), salt)
  const r = await send(cfg, 'commitScenario', [episodeId, commitment])
  const out = { registry: cfg.registry ?? EPISODE_REGISTRY, episodeId, salt, scenarioCommitment: commitment,
    commitTx: r.tx, commitBlock: r.block, commitBlockTimestamp: r.blockTimestamp }
  writeFileSync(join(dir, 'anchor.json'), JSON.stringify(out, null, 2) + '\n')
  return { episodeId, commitment, tx: r.tx, commitBlockTimestamp: r.blockTimestamp }
}

export async function finalize(dir: string, cfg: AnchorConfig) {
  const a = readJson(dir, 'anchor.json'), p = readJson(dir, 'publish.json'), m = readJson(dir, 'manifest.json')
  if (a.finalizeTx) throw new Error('already finalized')
  const result = resultCommitment(readFileSync(join(dir, 'metrics.json')), a.salt)
  const status = m.status === 'completed' ? 1 : 2
  const r = await send(cfg, 'finalizeEpisode', [a.episodeId, p.publicRoot, p.sealedRoot, result, status, !!m.collision])
  const { pub } = clients(cfg)
  const onchain = await pub.readContract({ address: a.registry, abi: episodeRegistryAbi, functionName: 'getEpisode', args: [a.episodeId] })
  const out = { ...a, resultCommitment: result, status, collision: !!m.collision, finalizeTx: r.tx, finalizeBlock: r.block,
    finalizeBlockTimestamp: r.blockTimestamp,
    onchainMatches: onchain.publicRoot === p.publicRoot && onchain.sealedRoot === p.sealedRoot && onchain.resultCommitment === result && onchain.scenarioCommitment === a.scenarioCommitment }
  writeFileSync(join(dir, 'anchor.json'), JSON.stringify(out, null, 2) + '\n')
  return { tx: r.tx, onchainMatches: out.onchainMatches }
}
