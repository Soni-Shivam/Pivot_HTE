// Faultline static verifier (plan Task 12). Keyless by default; a pasted tenant key never leaves this tab.
// Everything shown as ✓ is checked in this browser (audit B1): the download's Merkle root is recomputed, archived
// provider signatures are recovered and compared with the TEE signer read from the 0G mainnet InferenceServing contract,
// and the registry address is pinned here, never taken from the downloaded document. Untrusted strings are escaped.
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { unpackTar as untar } from '../../../packages/protocol/src/tar.ts'
import { storage } from '../../../packages/integrations/src/storage.ts'
import { chainOk, checkPublic } from '../../../packages/episode/src/check.ts'
import { EPISODE_REGISTRY, EPISODE_REGISTRY_V2 } from '../../../packages/episode/src/abi/episodeRegistry.ts'
import { checkTee, readService } from '../../../packages/episode/src/tee.ts'
import { openEpisode } from '../../../packages/episode/src/key.ts'
import { checkOnchain, GALILEO_RPC } from '../../../packages/episode/src/onchain.ts'
import { checkReplay } from '../../../packages/episode/src/replay.ts'

const RPC = GALILEO_RPC
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const esc = (s: unknown) => String(s ?? '—').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const tick = (ok: boolean | null | undefined) => (ok === true ? '<span class="ok">✓</span>' : ok === false ? '<span class="bad">✗</span>' : '<span class="muted">—</span>')
const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')
const short = (s: unknown, n = 10) => (typeof s === 'string' && s ? esc(`${s.slice(0, n)}…${s.slice(-4)}`) : '—')
const num = (x: unknown, d?: number) => (typeof x === 'number' && Number.isFinite(x) ? (d === undefined ? String(x) : x.toFixed(d)) : '—')
const badge = (c: number) => (c >= 0.75 ? 'red' : c >= 0.5 ? 'amber' : 'green')
const status = (s: string, cls = 'muted') => { $('status').className = cls; $('status').textContent = s }
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()

let pub: any = null
let traj: any[] = []
let loadedRoot: string | null = null

async function loadRoot() {
  const root = $<HTMLInputElement>('root').value.trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(root)) return status('A root is 0x followed by 64 hex characters.', 'bad')
  $<HTMLButtonElement>('load-root').disabled = true
  status('Downloading from 0G Storage…')
  try {
    const bytes = await storage({ rpcUrl: RPC, indexerUrl: $<HTMLInputElement>('indexer').value.trim() }).downloadBlob(root)
    loadedRoot = root
    show(JSON.parse(new TextDecoder().decode(bytes)), `Downloaded ${bytes.length} bytes from 0G Storage; their Merkle root was recomputed here and equals ${root.slice(0, 10)}….`)
  } catch (e) {
    status(`Download failed: ${(e as Error).message}`, 'bad')
  } finally {
    $<HTMLButtonElement>('load-root').disabled = false
  }
}

function show(p: any, how: string) {
  if (p?.schema !== 'faultline.public/v1') return status('Not a faultline.public/v1 document.', 'bad')
  pub = p
  const c = checkPublic(p)
  traj = c.trajectory
  const m = p.manifest
  status(how, 'ok')
  $('report').classList.remove('hidden')
  const b = badge(c.metrics.ccs)
  $('badge').className = b
  $('badge').textContent = `${b} · CCS ${num(c.metrics.ccs, 3)}${c.aggregatesOk ? '' : ' (does not follow from the trajectory)'}`
  $('manifest').innerHTML = kv([
    ['episode', `<code>${esc(m.episode_id)}</code>`], ['status', esc(m.status)], ['collision', esc(m.collision)],
    ['world', esc(m.world)], ['model', esc(m.model)], ['trust mode', esc(m.trust_mode)],
    ['decisions', `${num(m.decisions_total)} total · ${num(m.decisions_0g)} from 0G · ${num(m.decisions_halt)} safe halt`],
    ['prompt hash', `<code>${short(m.prompt_hash, 16)}</code>`], ['scenario hash', `<code>${short(m.scenario_hash, 16)}</code>`],
    ['started', esc(m.started_at)],
    ...(m.chaos ? [['CHAOS MODE', `<span class="bad">${esc(m.chaos)}: fake Router, not evidence</span>`] as [string, string]] : []),
  ])
  $('checks').innerHTML = kv([
    ['file hashes', `${tick(c.filesOk)} trajectory.jsonl and metrics.json match manifest.files`],
    ['decision log', `${tick(c.decisionsOk)} ${p.decisions.length} entries, every 0G one with request id, provider and response key`],
    ['metrics recomputed', `${tick(c.metricsRecomputedOk)} TTC, THW, DRAC, CCS for ${traj.length} ticks (tolerance 1e-9)`],
    ['headline numbers', `${tick(c.aggregatesOk)} peak CCS, min TTC, min gap, max decel and collision follow from the ticks`],
    ['signatures', '<span class="muted">checking against 0G mainnet…</span>'],
    ['content binding', `${tick(null)} not checkable: the provider signs the Router's sealed (E2EE) turn, not the bytes we log (audit A2)`],
    ['replay', replayRow(p)],
  ])
  $('decisions').querySelector('tbody')!.innerHTML = p.decisions.map((d: any) => {
    return `<tr><td>${num(d.cp)}</td><td>${num(d.sim_time_s, 1)}</td><td>${esc(d.action ?? 'SAFE_HALT')}</td><td>${esc(d.source)}</td><td>${esc(d.reason)}</td>` +
      `<td><code>${esc(d.request_id)}</code></td><td><code title="${esc(d.provider)}">${short(d.provider, 8)}</code></td><td>${num(d.latency_ms)} ms</td><td id="sig-${num(d.cp)}">—</td></tr>`
  }).join('')
  $('sig-note').innerHTML = `Each provider signature was archived at publish (providers keep them about 20 minutes) and is recovered here and compared with the TEE signer on 0G mainnet. CLI: <code>npm run faultline -- verify ${esc(loadedRoot ?? '<publicRoot>')}</code>.`
  const met = c.metrics
  $('metrics').innerHTML = kv([
    ['CCS (peak)', `${num(met.ccs, 4)} at tick ${num(met.peak_step)}`], ['min TTC', `${num(met.min_ttc_s, 2)} s`],
    ['min gap', `${num(met.min_gap_m, 2)} m`], ['max ego decel', `${num(met.max_ego_decel_mps2, 2)} m/s²`],
    ['collision', esc(met.collision)],
    ['LiDAR vs ground truth', `mean ${num(met.perception?.mean_abs_gap_error_m, 3)} m · max ${num(met.perception?.max_abs_gap_error_m, 3)} m · ${num(met.perception?.scans_without_target)} scans without target`],
  ])
  drawChart()
  frame = 0
  drawAnim()
  readChain(m)
  checkSignatures(p)
}

function replayRow(p: any): string {
  const r: any = checkReplay(p)
  if (!r) return `${tick(null)} scenario not revealed (episode published before the reveal), nothing to replay`
  if (r.skipped) return `${tick(null)} ${esc(r.skipped)}`
  if (r.error) return `${tick(false)} ${esc(r.error)}`
  const what = r.kinematic ? 'every field' : 'ground-truth fields only (CARLA LiDAR ray-casts are not bit-deterministic; collision taken from the CARLA sensor)'
  return `${tick(r.ok)} re-ran ${num(r.replayedTicks)} ticks in this browser from the revealed scenario and the public control decels: ${what} ` +
    (r.ok ? 'bit-exact' : r.firstMismatch ? `differ first at tick ${num(r.firstMismatch.tick)} (${esc(r.firstMismatch.field)})` : `tick count ${num(r.replayedTicks)} vs ${num(r.ticks)}`)
}

async function checkSignatures(p: any) {
  const row = (html: string) => { const dd = [...$('checks').querySelectorAll('dt')].find((dt) => dt.textContent === 'signatures')?.nextElementSibling; if (dd) dd.innerHTML = html }
  try {
    const r = await checkTee(p, { readService: (prov) => readService(prov) })
    for (const s of r.signatures) { const td = document.getElementById(`sig-${s.cp}`); if (td) { td.innerHTML = tick(s.verified); td.title = s.reason } }
    const n = r.signatures.filter((s) => s.verified).length
    const q = Object.values(r.quotes)
    const schemes = [...new Set(r.signatures.map((s) => s.scheme).filter(Boolean))]
    row(`${tick(r.allTrue)} ${n}/${r.signatures.length} archived signatures recovered to the provider's on-chain TEE signer` +
      (schemes.length ? ` <span class="muted">(scheme ${esc(schemes.join(', '))})</span>` : '') +
      (r.signatures.length ? '' : ' (no 0G decisions)') + (q.length ? ` · TDX quote report_data names the same signer ${tick(q.every(Boolean))}` : ''))
  } catch (e) {
    row(`${tick(false)} could not check: ${esc((e as Error).message.split('\n')[0])}`)
  }
}

async function readChain(m: any) {
  if (!m.registry) { $('chain').innerHTML = kv([['status', '<span class="muted">episode not anchored on Galileo</span>']]); return }
  $('chain').innerHTML = kv([['status', 'reading 0G Galileo…']])
  try {
    const c = await checkOnchain(pub, loadedRoot, RPC)
    if (!c.registryPinned) { $('chain').innerHTML = kv([['registry', `${tick(false)} the document names <code>${esc(m.registry)}</code>, not a Faultline registry (<code>${EPISODE_REGISTRY_V2}</code> or v1 <code>${EPISODE_REGISTRY}</code>)`]]); return }
    const link = (kind: string, v: unknown) => `<a href="https://chainscan-galileo.0g.ai/${kind}/${esc(v)}" target="_blank" rel="noopener"><code>${esc(v)}</code></a>`
    if (!c.committed) { $('chain').innerHTML = kv([['committed', `${tick(false)} no commitment for this episode on ${link('address', c.registry)}`]]); return }
    const t = (s: number) => (s ? new Date(s * 1000).toISOString() : '—')
    const rv = c.reveal
    $('chain').innerHTML = kv([
      ['registry', `${link('address', c.registry)} <span class="muted">(${c.version === 'v2' ? 'EpisodeRegistryV2' : 'v1'}, pinned in this page)</span>`],
      ['evaluator', link('address', c.evaluator)],
      ...(c.version === 'v2' ? [['evaluator record', `run #${num(c.seq)} of ${num(c.stats.committed)} committed · ${num(c.stats.completed)} completed · ${num(c.stats.interrupted)} interrupted · ${num(c.stats.aborted)} aborted · ${num(c.stats.committed - c.stats.completed - c.stats.interrupted - c.stats.aborted)} never finalized`] as [string, string]] : []),
      ['committed', `${t(c.committedAt)} · <a href="https://chainscan-galileo.0g.ai/tx/${esc(c.commitTx)}" target="_blank" rel="noopener">commit tx</a>` +
        (c.firstCall ? ` · ${tick(c.committedBeforeFirstCall)} before the first 0G call <span class="muted">(${esc(c.firstCall)}, the evaluator's own clock)</span>` : '')],
      ...(c.version === 'v2' ? [
        ['commit-block nonce', `${tick(c.bindingOk && c.noncesEchoed === c.nonces0g && c.nonces0g > 0)} block ${num(c.commitBlock)} hash <code>${short(c.commitBlockHash, 12)}</code> was in every prompt; ${num(c.noncesEchoed)}/${num(c.nonces0g)} accepted 0G answers echoed nonce <code>${esc(String(c.commitBlockHash).slice(2, 10))}</code> <span class="muted">(parser-enforced; not covered by the provider signature, see A2)</span>`],
        ['config hash', `${tick(c.configHashOk)} keccak(prompt hash, model, git commit) = <code>${short(c.configHash, 12)}</code> on chain <span class="muted">(${esc(m.config?.model)} @ ${short(m.config?.git_commit, 8)}${m.config?.git_dirty ? ', dirty tree' : ''})</span>`],
      ] as [string, string][] : []),
      ['finalized', c.finalizedAt ? `${t(c.finalizedAt)} · status ${c.status === 1 ? 'completed' : c.status === 2 ? 'interrupted' : c.status === 3 ? 'aborted' : esc(c.status)} · collision ${esc(c.collision)}` : '<span class="warn">not finalized</span>'],
      ['public root on chain', `<code>${esc(c.publicRoot)}</code> ${c.publicRootMatches === null ? '' : tick(c.publicRootMatches) + ' matches the downloaded root'}`],
      ['sealed root on chain', `<code>${esc(c.sealedRoot)}</code>`],
      ['scenario reveal', rv ? `${tick(rv.scenarioFileOk && rv.scenarioCommitmentOk)} keccak(salt, sha256(scenario.json)) from the revealed scenario equals the on-chain commitment` +
        ` · result commitment ${tick(rv.resultCommitmentOk)}` : `<span class="muted">not revealed (published before reveals); commitment <code>${short(c.scenarioCommitment, 12)}</code> opens with the sealed bundle</span>`],
    ])
    if (!$<HTMLInputElement>('sroot').value) $<HTMLInputElement>('sroot').value = c.sealedRoot
  } catch (err) {
    $('chain').innerHTML = kv([['status', `<span class="bad">chain read failed: ${esc((err as Error).message.split('\n')[0])}</span>`]])
  }
}

async function loadSealed() {
  if (!pub) return status('Load the public episode first.', 'bad')
  const root = $<HTMLInputElement>('sroot').value.trim(), key = $<HTMLInputElement>('skey').value.trim()
  const out = $('sealed-out')
  out.innerHTML = '<p class="muted">Downloading and opening…</p>'
  try {
    const blob = await storage({ rpcUrl: RPC, indexerUrl: $<HTMLInputElement>('indexer').value.trim() }).downloadBlob(root)
    const { plaintext, keyVersion } = openEpisode(blob, hexToBytes(key.replace(/^0x/, '')), pub.manifest.episode_id)
    const files = untar(plaintext)
    const m = pub.manifest
    const dec = files.find((f) => f.name === 'decisions.jsonl')
    out.innerHTML = `<p class="ok">Opened: GCM tag valid, ${files.length} files, ${keyVersion === 2 ? 'per-episode key (HKDF of the tenant key)' : 'tenant key (pre-HKDF bundle)'}.</p><dl class="kv">` + kv([
      ['log chain', `${tick(dec ? chainOk(new TextDecoder().decode(dec.data), m.log_head) : false)} decisions.jsonl links to log_head`],
      ...files.map((f) => [f.name, `${m.files[f.name] ? tick(bytesToHex(sha256(f.data)) === m.files[f.name]) : '<span class="muted">not in manifest</span>'} ${f.data.length} bytes`] as [string, string]),
    ]) + '</dl>'
  } catch (e) {
    out.innerHTML = `<p class="bad">Could not open: ${esc((e as Error).message)}. A wrong key fails the GCM tag; nothing is shown.</p>`
  }
}

function setup(cv: HTMLCanvasElement) {
  const h = Number((cv.dataset.h ??= cv.getAttribute('height')!)) // CSS height; the attribute becomes device pixels
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1
  cv.style.height = `${h}px`
  cv.width = Math.round(r.width * dpr)
  cv.height = Math.round(h * dpr)
  const g = cv.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { g, w: r.width, h }
}

function drawChart() {
  const { g, w, h } = setup($<HTMLCanvasElement>('chart'))
  const pad = 36, T = traj.at(-1)?.t_s ?? 1
  const gmax = Math.max(10, ...traj.map((r) => r.lidar_gap ?? 0))
  const x = (t: number) => pad + (t / T) * (w - 2 * pad)
  g.clearRect(0, 0, w, h)
  g.strokeStyle = css('--line'); g.fillStyle = css('--muted'); g.font = '11px system-ui'
  for (let i = 0; i <= 4; i++) { const y = pad / 2 + (i / 4) * (h - pad); g.beginPath(); g.moveTo(pad, y); g.lineTo(w - pad, y); g.stroke(); g.fillText(`${Math.round(gmax * (1 - i / 4))}`, 4, y + 4); g.fillText(`${(10 * (1 - i / 4)).toFixed(0)}`, w - pad + 6, y + 4) }
  g.fillText('0 s', pad, h - 4); g.fillText(`${T.toFixed(1)} s`, w - pad - 30, h - 4)
  const line = (val: (r: any) => number | null, max: number, color: string) => {
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath()
    let pen = false
    for (const r of traj) {
      const v = val(r)
      if (v === null) { pen = false; continue }
      const y = pad / 2 + (1 - Math.min(v, max) / max) * (h - pad)
      pen ? g.lineTo(x(r.t_s), y) : g.moveTo(x(r.t_s), y)
      pen = true
    }
    g.stroke()
  }
  line((r) => r.lidar_gap, gmax, css('--ego'))
  line((r) => r.ttc_s, 10, css('--lead'))
  for (const d of pub.decisions) { g.fillStyle = d.source === 'none' ? css('--bad') : css('--acc'); g.fillRect(x(d.sim_time_s) - 1, h - pad + 4, 2, 6) }
}

let frame = 0, timer: number | undefined
function drawAnim() {
  const { g, w, h } = setup($<HTMLCanvasElement>('anim'))
  const r = traj[Math.min(frame, traj.length - 1)]
  if (!r) return
  const span = 70, x0 = r.ego_x - 10
  const X = (x: number) => ((x - x0) / span) * w
  g.clearRect(0, 0, w, h)
  g.strokeStyle = css('--line'); g.setLineDash([12, 12]); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.setLineDash([])
  const car = (cx: number, len: number, color: string, label: string) => {
    g.fillStyle = color; g.fillRect(X(cx - len / 2), h / 2 - 14, (len / span) * w, 28)
    g.fillStyle = css('--fg'); g.font = '12px system-ui'; g.fillText(label, X(cx - len / 2), h / 2 - 20)
  }
  car(r.ego_x, 4.9, css('--ego'), `ego ${r.ego_v.toFixed(1)} m/s`)
  car(r.lead_x, 4.7, css('--lead'), `lead (0G) ${r.lead_v.toFixed(1)} m/s`)
  const d = [...pub.decisions].reverse().find((d: any) => d.sim_time_s <= r.t_s)
  $('anim-t').textContent = `${r.t_s.toFixed(2)} s`
  $('anim-info').textContent = `gap ${r.gt_gap.toFixed(2)} m · LiDAR ${r.lidar_gap == null ? 'no target' : r.lidar_gap.toFixed(2) + ' m'} · lead action ${d ? (d.action ?? 'SAFE_HALT') : 'run-up (MAINTAIN)'}${r.collision ? ' · COLLISION' : ''}`
}

$('play').addEventListener('click', () => {
  if (timer) { clearInterval(timer); timer = undefined; $('play').textContent = 'Play'; return }
  if (frame >= traj.length - 1) frame = 0
  $('play').textContent = 'Pause'
  timer = window.setInterval(() => { frame++; drawAnim(); if (frame >= traj.length - 1) { clearInterval(timer); timer = undefined; $('play').textContent = 'Play' } }, 50)
})
$('load-root').addEventListener('click', loadRoot)
$('load-sealed').addEventListener('click', loadSealed)
$('load-paste').addEventListener('click', () => {
  try { loadedRoot = null; show(JSON.parse($<HTMLTextAreaElement>('paste').value), 'Checked pasted JSON (not downloaded: no Merkle proof).') } catch (e) { status(`Not JSON: ${(e as Error).message}`, 'bad') }
})
window.addEventListener('resize', () => { if (pub) { drawChart(); drawAnim() } })
const q = new URLSearchParams(location.search).get('root')
if (q) { $<HTMLInputElement>('root').value = q; loadRoot() }
