// On-chain checks of a published episode against the pinned Faultline registries on 0G Galileo. Browser-safe (viem
// only); the CLI verify and the static page both call this. The registry address is never taken from the document:
// the manifest only selects v1 or v2, and anything else fails.
import { createPublicClient, encodeAbiParameters, http, keccak256, sha256, type Hex } from 'viem'
import { galileo } from '../../integrations/src/chain.ts'
import { EPISODE_REGISTRY, EPISODE_REGISTRY_V2, episodeRegistryAbi, episodeRegistryV2Abi } from './abi/episodeRegistry.ts'

export const GALILEO_RPC = 'https://evmrpc-testnet.0g.ai'
const ZERO = '0x0000000000000000000000000000000000000000'
const commitOf = (bytes: Uint8Array, salt: Hex) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [salt, sha256(bytes)]))
export const configHashOf = (c: { prompt_hash: string; model: string; git_commit: string }) =>
  keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'string' }, { type: 'string' }], [`0x${c.prompt_hash}` as Hex, c.model, c.git_commit]))

/** Reveal (audit R7): scenario.json bytes match manifest.files, and both salted commitments recompute. */
export function revealCommitments(pub: any) {
  const r = pub.reveal
  if (!r || typeof r.scenario_json !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(r.salt ?? '')) return null
  const scen = new TextEncoder().encode(r.scenario_json)
  return { scenarioFileOk: sha256(scen).slice(2) === pub.manifest.files['scenario.json'],
    scenarioCommitment: commitOf(scen, r.salt), resultCommitment: commitOf(new TextEncoder().encode(pub.metrics_json), r.salt) }
}

export type OnchainCheck = Record<string, any> & { anchored: boolean; ok: boolean }

export async function checkOnchain(pub: any, downloadedRoot: string | null, rpc = GALILEO_RPC): Promise<OnchainCheck> {
  const m = pub.manifest
  if (!m.registry) return { anchored: false, ok: false, reason: 'episode not anchored on Galileo' }
  const reg = String(m.registry).toLowerCase()
  const v2 = reg === EPISODE_REGISTRY_V2.toLowerCase()
  if (!v2 && reg !== EPISODE_REGISTRY.toLowerCase()) return { anchored: true, ok: false, registry: m.registry, registryPinned: false, reason: 'document names an unknown registry' }
  const client = createPublicClient({ chain: galileo(rpc), transport: http(rpc) })
  const id = `0x${m.episode_id}` as Hex
  const e: any = v2
    ? await client.readContract({ address: EPISODE_REGISTRY_V2, abi: episodeRegistryV2Abi, functionName: 'getEpisode', args: [m.evaluator as Hex, id] })
    : await client.readContract({ address: EPISODE_REGISTRY, abi: episodeRegistryAbi, functionName: 'getEpisode', args: [id] })
  const evaluator = v2 ? m.evaluator : e.evaluator
  const committed = v2 ? e.seq > 0n : e.evaluator !== ZERO && e.committedAt > 0n
  const out: OnchainCheck = { anchored: true, ok: false, version: v2 ? 'v2' : 'v1', registry: v2 ? EPISODE_REGISTRY_V2 : EPISODE_REGISTRY, registryPinned: true,
    evaluator, committed, commitTx: m.commit_tx ?? null }
  if (!committed) return { ...out, reason: 'no commitment for this episode (and evaluator) on the registry' }
  const firstCall = pub.decisions.find((d: any) => d.request_id)?.wall_clock_utc ?? null
  Object.assign(out, {
    committedAt: Number(e.committedAt), finalizedAt: Number(e.finalizedAt), status: Number(e.status), collision: e.collision,
    publicRoot: e.publicRoot, sealedRoot: e.sealedRoot, scenarioCommitment: e.scenarioCommitment, resultCommitment: e.resultCommitment,
    publicRootMatches: downloadedRoot ? e.publicRoot.toLowerCase() === downloadedRoot.toLowerCase() : null,
    firstCall, committedBeforeFirstCall: firstCall ? Number(e.committedAt) * 1000 < Date.parse(firstCall) : null,
  })
  const rv = revealCommitments(pub)
  out.reveal = rv && { scenarioFileOk: rv.scenarioFileOk, scenarioCommitmentOk: rv.scenarioCommitment === e.scenarioCommitment,
    resultCommitmentOk: e.finalizedAt > 0n ? rv.resultCommitment === e.resultCommitment : null }
  if (v2) {
    const st: any = await client.readContract({ address: EPISODE_REGISTRY_V2, abi: episodeRegistryV2Abi, functionName: 'stats', args: [evaluator as Hex] })
    const block = await client.getBlock({ blockNumber: e.commitBlock })
    const b = m.binding ?? {}
    const zg = pub.decisions.filter((d: any) => d.source === '0g')
    Object.assign(out, {
      seq: Number(e.seq), commitBlock: Number(e.commitBlock), commitBlockHash: block.hash,
      stats: { committed: Number(st.committed), completed: Number(st.completed), interrupted: Number(st.interrupted), aborted: Number(st.aborted) },
      configHashOk: !!m.config && configHashOf(m.config) === e.configHash, configHash: e.configHash,
      // A3: the prompt carried blockhash(commitBlock); every accepted 0G answer echoed its first 8 hex (parser-enforced)
      bindingOk: b.episode_id === m.episode_id && b.commit_block === Number(e.commitBlock) && b.commit_blockhash === block.hash && b.nonce === block.hash.slice(2, 10),
      noncesEchoed: zg.filter((d: any) => d.nonce === block.hash.slice(2, 10)).length, nonces0g: zg.length,
    })
  }
  out.ok = committed && out.publicRootMatches !== false && out.committedBeforeFirstCall !== false && out.finalizedAt > 0 &&
    (!out.reveal || (out.reveal.scenarioFileOk && out.reveal.scenarioCommitmentOk && out.reveal.resultCommitmentOk !== false)) &&
    (!v2 || (out.configHashOk && out.bindingOk && out.noncesEchoed === out.nonces0g))
  return out
}
