// Talks only to the agent console (packages/hedera/src/agent-console.ts). Shapes follow its JSON (cited per endpoint there).
import { RECORDED, type Recorded } from './recorded'
export type Tick = { t_s: number; ego_x: number; ego_v: number; ego_a: number; ego_lat_m: number | null; lead_x: number; lead_v: number
  adv_lat_m: number | null; gt_gap: number; gt_ttc_s: number | null; ttc_s: number | null; lidar_gap: number | null; ccs: number | null; collision: boolean
  cars?: Record<string, { mode?: string }> | null }
export type Decision = { cp: number; sim_time_s: number; action: string | null; source: string; reason: string; request_id: string | null
  provider: string | null; latency_ms: number; wall_clock_utc: string; content?: string | null; phase?: string | null }
export type Run = { name: string; jobId: string | null; status: string; world: string | null; family: string | null; decisions: number | null
  decisions0g: number | null; ccs: number | null; minTtc: number | null; minGap: number | null; collision: boolean | null
  chain: { registry: string; commitTx: string; finalizeTx: string | null; onchainMatches: boolean | null; commitBlockTimestamp?: number | null; committedBeforeFirstCall?: boolean | null } | null
  storage: { publicRoot: string; sealedRoot: string; signaturesArchived: number | null; signatures0g: number | null; signaturesVerified?: number | null } | null
  payment: { transaction: string; payer: string; suite: string; hashscan: string } | null; episodeId: string | null; model: string | null; agentId?: number | null
  arkivEntity?: string | null; free?: boolean | null; requestedBy?: string | null; video?: string | null; mtime?: number }
export type Plan = { name: string, summary: string, roles: Record<string, string>, phases?: unknown }
/** GET /api/jobs/:id (jobPublic in agent-console.ts). */
export type Job = { id: string; kind: string; policy: string | null; suite: string | null; mode: string; label: string; status: string; error: string | null
  queuePos: number; requested_by: string | null; createdAt: number; startedAt: number | null; finishedAt: number | null; runs: string[]
  result: Run | null; etaS: number | null; results: any[]; video: string | null }

// Set at build time (esbuild --define, FAULTLINE_API_BASE); empty = same origin as the page.
declare const FAULTLINE_API_BASE: string
const API = (typeof FAULTLINE_API_BASE === 'string' ? FAULTLINE_API_BASE : '').replace(/\/$/, '')
export const api = (p: string) => API + p
// Videos with a web-sized copy in public/lite (scripts/lite_videos.sh) come from the CDN; any other run video streams from the console.
const LITE = new Set(['videos/video-swarm-fog-001__stitched.mp4', 'videos/arena-live0g-video-001__r7l-2s3__side_by_side.mp4', 'videos/paid-job-002-replay-view__chase.mp4',
  'videos/research-mission-001__carla-failure.mp4', 'videos/research-mission-001__carla-fix-baseline.mp4', 'runs/paid-job-002-replay-view/screen.mp4', 'runs/swarm-carla-010/director.mp4'])
export const media = (p: string) => (LITE.has(p) ? '/lite/' + p : api('/media/' + p))
export const getJson = (p: string) => fetch(api(p)).then((r) => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json() })
export const postJson = async (p: string, body: unknown) => {
  const r = await fetch(api(p), { method: 'POST', headers: { 'content-type': 'application/json', 'x-faultline-console': '1' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `${p}: HTTP ${r.status}`)
  return j
}
/**
 * POST an NDJSON stream (/api/stream) and call onEvent per line. When the console cannot be reached, a replay of a featured run
 * plays its bundled copy (core/recorded.ts) instead; its meta event carries bundled: true.
 */
export async function stream(path: string, body: unknown, onEvent: (e: any) => void, signal?: AbortSignal) {
  let r: Response
  try {
    r = await fetch(api(path), { method: 'POST', headers: { 'content-type': 'application/json', 'x-faultline-console': '1' }, body: JSON.stringify(body), signal })
    if (!r.ok || !r.body) throw new Error(`${path}: HTTP ${r.status}`)
  } catch (err) {
    const b = body as { run?: string, mode?: string, speed?: number } | null
    const rec = path === '/api/stream' && b?.mode === 'replay' && b.run ? RECORDED[b.run] : undefined
    if (!rec || signal?.aborted) throw err
    return replayRecorded(rec, b?.speed ?? 1, onEvent, signal)
  }
  const reader = r.body.getReader(), dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const l of lines) if (l.trim()) onEvent(JSON.parse(l))
  }
}

const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, no) => {
  if (signal?.aborted) return no(new DOMException('aborted', 'AbortError'))
  const t = setTimeout(ok, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); no(new DOMException('aborted', 'AbortError')) }, { once: true })
})
/** The console's replay (POST /api/stream mode replay in agent-console.ts), same events and pacing, from a bundled copy. */
export async function replayRecorded(rec: Recorded, speed: number, onEvent: (e: any) => void, signal?: AbortSignal) {
  const s = rec.run, ticks = rec.ticks, decisions = rec.decisions, sp = Math.min(Math.max(Number(speed) || 1, 0.25), 8)
  const phase = (id: string, status: string, title: string, data?: unknown) => onEvent({ t: 'phase', id, status, title, data })
  onEvent({ t: 'meta', run: s, totalTicks: ticks.length, totalDecisions: decisions.length, mode: 'replay', bundled: true })
  if (rec.plan) onEvent({ t: 'plan', plan: rec.plan })
  if (s.payment) phase('payment', 'ok', 'Payment settled on Hedera', s.payment)
  if (s.jobId) phase('permit', 'ok', 'Run permit accepted', { jobId: s.jobId })
  if (s.chain) phase('commit', 'ok', 'Scenario committed on 0G Galileo', { tx: s.chain.commitTx })
  phase('sim', 'run', `Simulation on ${s.world}`)
  let di = 0
  for (const tick of ticks) {
    while (di < decisions.length && decisions[di].sim_time_s <= tick.t_s + 1e-9) {
      onEvent({ t: 'await0g', cp: decisions[di].cp })
      await pause(Math.min(Number(decisions[di].latency_ms) || 0, 2600) / sp, signal)
      onEvent({ t: 'decision', d: decisions[di++] })
    }
    onEvent({ t: 'ticks', rows: [tick] })
    await pause(50 / sp, signal)
  }
  phase('sim', 'ok', `Simulation on ${s.world}`, { ticks: ticks.length })
  if (s.storage) phase('storage', 'ok', 'Evidence on 0G Storage', s.storage)
  if (s.chain?.finalizeTx) phase('finalize', 'ok', 'Result finalized on 0G Galileo', { tx: s.chain.finalizeTx, onchainMatches: s.chain.onchainMatches })
  onEvent({ t: 'done', run: s })
}

// ---------- GET /api/verify?root= (agent-console.ts verifyRoot: packages/episode verify + ERC-8004 #579 ownerOf) ----------
export type VerifySig = { cp: number; provider: string; verified: boolean; scheme: string; reason: string }
export type VerifyResult = { publicRoot: string; publicRootOk: boolean; episode_id: string; status: string; filesOk: boolean; decisionsWellFormed: boolean
  metricsRecomputedOk: boolean | null; aggregatesOk: boolean | null; signatures: VerifySig[]; signaturesAllTrue: boolean | null
  quoteSignerMatchesChain?: Record<string, boolean>; contentBinding?: string
  onchain?: { anchored: boolean; ok: boolean | null; registry?: string; registryPinned?: boolean; evaluator?: string; committed?: boolean; commitTx?: string
    committedAt?: number; finalizedAt?: number; status?: number; collision?: boolean; publicRoot?: string; sealedRoot?: string; publicRootMatches?: boolean
    firstCall?: string; committedBeforeFirstCall?: boolean | null; reveal?: Record<string, boolean | null>; configHashOk?: boolean | null; bindingOk?: boolean | null
    noncesEchoed?: number; nonces0g?: number; [k: string]: unknown } | null
  replay?: { ok: boolean | null; skipped?: string; [k: string]: unknown } | null; checked_at?: string
  identity?: { registry: string; agentId: number; owner?: string; evaluatorIsOwner?: boolean | null; error?: string } }
export type VerifyError = { status: 400 | 422 | 429 | 503; error: string; rootMismatch?: boolean }
/** VerifyResult.status is the episode status string; an error's status is the HTTP number. */
export const isVerifyError = (x: VerifyResult | VerifyError): x is VerifyError => typeof x.status === 'number'
/** 422 with rootMismatch:false means "could not check" (Unavailable), true means the Merkle root did not match (Failed). */
export async function verifyRoot(root: string): Promise<VerifyResult | VerifyError> {
  let r: Response
  try { r = await fetch(api(`/api/verify?root=${encodeURIComponent(root)}`)) } catch (e) { return { status: 503, error: (e as Error).message } }
  const j = await r.json().catch(() => ({}))
  if (r.ok) return j as VerifyResult
  const status = ([400, 422, 429].includes(r.status) ? r.status : 503) as VerifyError['status']
  return { status, error: String(j.error ?? `HTTP ${r.status}`), ...(typeof j.rootMismatch === 'boolean' ? { rootMismatch: j.rootMismatch } : {}) }
}

// ---------- recorded clips: <video data-src> gets the CDN copy or the console /media path, falling back to the public repo ----------
const RAW = 'https://raw.githubusercontent.com/Soni-Shivam/Pivot_HTE/main/'
export const armClips = (root: ParentNode) => root.querySelectorAll<HTMLVideoElement>('video[data-src]').forEach((v) => { if (!v.getAttribute('src')) v.src = media(v.dataset.src!) })
if (typeof document !== 'undefined') document.addEventListener('error', (e) => {
  const v = e.target as HTMLVideoElement
  if (v instanceof HTMLVideoElement && v.dataset.src && !v.src.startsWith(RAW)) v.src = RAW + v.dataset.src
}, true)
