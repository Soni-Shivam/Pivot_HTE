// Safety-memory dashboard (static). Reads claim entities from Arkiv Rabdi (owner-filtered: anyone can write the schema
// tag, so only the OEM wallet's entities count) and the anchors from AgentMemoryRegistry on 0G Galileo. No backend.
import { createPublicClient as arkivPublic } from '@arkiv-network/sdk'
import { rabdi } from '@arkiv-network/sdk/chains'
import { and, eq } from '@arkiv-network/sdk/query'
import { createPublicClient, http, keccak256, parseAbi, toHex, zeroHash, type Hex } from 'viem'
import { galileo } from '../../../packages/integrations/src/chain.ts'
import { AGENT_MEMORY_REGISTRY, agentMemoryRegistryAbi, ClaimV1 } from '../../../packages/memory/src/core.ts'

const AGENT_ID = 579n
const IDENTITY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const
const $ = (id: string) => document.getElementById(id) as HTMLInputElement
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const short = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h)
const tx = (h: string) => `<a href="https://chainscan-galileo.0g.ai/tx/${esc(h)}" target="_blank" rel="noopener"><code>${esc(short(h))}</code></a>`
const root = (h: string) => `<a href="https://storagescan-galileo.0g.ai/submission/${esc(h)}" target="_blank" rel="noopener" title="${esc(h)}"><code>${esc(short(h))}</code></a>`
const pct = (r: number, lo: number, hi: number) => `<span class="bar" style="width:${Math.max(1, r * 80)}px"></span>${(100 * r).toFixed(1)} % <span class="muted">[${(100 * lo).toFixed(1)}, ${(100 * hi).toFixed(1)}]</span>`

type Row = Record<string, string>

async function claims(): Promise<{ rows: Row[]; query: string }> {
  const f = { model_id: $('model').value, version: $('version').value, category: $('category').value }
  const conds = Object.entries(f).filter(([, v]) => v).map(([k, v]) => eq(k, v))
  const client = arkivPublic({ chain: rabdi({ accessKey: $('akey').value.trim() }), transport: http() })
  let q = client.select({ $key: true, $owner: true, $expiresAt: true, model_id: true, version: true, category: true, n_tests: true, n_collisions: true,
    rate: true, ci95_lo: true, ci95_hi: true, n_unsafe: true, unsafe_rate: true, mean_speed_mps: true, public_root: true, anchor_tx: true,
    anchor_seq: true, campaign: true }).from(ClaimV1)
  if (conds.length) q = q.where((conds.length === 1 ? conds[0] : and(...conds)) as never)
  const owner = $('owner').value.trim() as Hex
  q = q.ownedBy(owner)
  const page = await q.limit(100).fetch()
  const rows = page.entities.map((e: any) => Object.fromEntries(Object.entries(e).map(([k, v]: [string, any]) => [k, v && typeof v === 'object' && 'value' in v ? String(v.value) : String(v)])))
  const query = `select faultline.claim/v1 where ${Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k} = "${v}"`).join(' and ') || 'true'} owned by ${owner}`
  return { rows, query }
}

async function anchors(model: string) {
  const pub = createPublicClient({ chain: galileo(), transport: http() })
  const modelId = keccak256(toHex(model))
  const n = Number(await pub.readContract({ address: AGENT_MEMORY_REGISTRY, abi: agentMemoryRegistryAbi, functionName: 'latestSeq', args: [AGENT_ID, modelId] }))
  const list = []
  for (let s = 1; s <= n; s++) list.push({ seq: s, ...(await pub.readContract({ address: AGENT_MEMORY_REGISTRY, abi: agentMemoryRegistryAbi, functionName: 'getAnchor', args: [AGENT_ID, modelId, BigInt(s)] })) })
  const owner = await pub.readContract({ address: IDENTITY, abi: parseAbi(['function ownerOf(uint256) view returns (address)']), functionName: 'ownerOf', args: [AGENT_ID] })
  return { list, owner }
}

function render(rows: Row[], an: Awaited<ReturnType<typeof anchors>>) {
  const latest = new Map<string, Row>() // newest campaign per (version, category)
  for (const r of rows) {
    const k = `${r.version}|${r.category}`
    if (!latest.has(k) || Number(r.anchor_seq) > Number(latest.get(k)!.anchor_seq)) latest.set(k, r)
  }
  const cats = [...new Set(rows.map((r) => r.category))]
  const cell = (r: Row | undefined, k: 'rate' | 'unsafe_rate', n: 'n_collisions' | 'n_unsafe') =>
    r ? `${r[n]}/${r.n_tests} · ${k === 'rate' ? pct(+r.rate, +r.ci95_lo, +r.ci95_hi) : `${(100 * +r.unsafe_rate).toFixed(1)} %`}` : '–'
  document.querySelector('#compare tbody')!.innerHTML = cats.map((c) => {
    const a = latest.get(`1.0|${c}`), b = latest.get(`1.1|${c}`)
    return `<tr><td>${esc(c)}</td><td>${esc((a ?? b)!.n_tests)}</td><td>${cell(a, 'rate', 'n_collisions')}</td><td>${cell(b, 'rate', 'n_collisions')}</td>` +
      `<td>${cell(a, 'unsafe_rate', 'n_unsafe')}</td><td>${cell(b, 'unsafe_rate', 'n_unsafe')}</td><td>${a ? esc(a.mean_speed_mps) : '–'} → ${b ? esc(b.mean_speed_mps) : '–'} m/s</td></tr>`
  }).join('') || '<tr><td colspan="7" class="muted">no claims match</td></tr>'
  const byTx = new Map(an.list.map((a) => [a.seq, a]))
  document.querySelector('#anchors tbody')!.innerHTML = an.list.map((a, i) => {
    const linked = a.prevRoot === (i === 0 ? zeroHash : an.list[i - 1].sealedRoot)
    return `<tr><td>${a.seq}</td><td>${esc(a.version)}</td><td><code>${esc(short(a.owner))}</code></td><td class="${linked ? 'ok' : 'bad'}">${linked ? '✓ ' + (i ? 'prev sealed root' : 'genesis') : '✗'}</td>` +
      `<td>${root(a.publicRoot)}</td><td>${root(a.sealedRoot)}</td><td><code title="${esc(a.claimsRoot)}">${esc(short(a.claimsRoot))}</code></td><td>${a.blockNumber}</td></tr>`
  }).join('')
  const ownerOk = an.list.every((a) => a.owner.toLowerCase() === an.owner.toLowerCase())
  $('identity').innerHTML = `ERC-8004 agent #579 ownerOf (live, Galileo identity registry) = <code>${esc(an.owner)}</code> <span class="${ownerOk ? 'ok' : 'warn'}">${ownerOk ? '✓ every anchor written by the current owner' : 'an anchor was written by a previous owner'}</span>. Registry <a href="https://chainscan-galileo.0g.ai/address/${AGENT_MEMORY_REGISTRY}" target="_blank" rel="noopener"><code>${AGENT_MEMORY_REGISTRY}</code></a>.`
  document.querySelector('#claims tbody')!.innerHTML = rows.map((r) => {
    const a = byTx.get(Number(r.anchor_seq))
    const ok = a && a.publicRoot.toLowerCase() === r.public_root.toLowerCase()
    return `<tr><td><code title="${esc(r.$key)}">${esc(short(r.$key))}</code></td><td>${esc(r.version)}</td><td>${esc(r.category)}</td><td>${esc(r.n_tests)}</td><td>${esc(r.n_collisions)}</td>` +
      `<td>${(100 * +r.rate).toFixed(2)} %</td><td>[${esc(r.ci95_lo)}, ${esc(r.ci95_hi)}]</td><td>seq ${esc(r.anchor_seq)} ${tx(r.anchor_tx)}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</td><td>${esc(r.$expiresAt)}</td></tr>`
  }).join('')
}

async function load() {
  const btn = $('load') as unknown as HTMLButtonElement
  btn.disabled = true
  $('status').textContent = 'Querying Arkiv and reading Galileo…'
  try {
    const [{ rows, query }, an] = await Promise.all([claims(), anchors($('model').value || 'idm-follower')])
    $('query').textContent = query
    render(rows, an)
    $('status').textContent = `${rows.length} claim entities from Arkiv, ${an.list.length} anchors from Galileo.`
    document.body.dataset.loaded = '1'
  } catch (e) {
    $('status').innerHTML = `<span class="bad">${esc((e as Error).message)}</span>`
  } finally {
    btn.disabled = false
  }
}

$('load').addEventListener('click', load)
load()
