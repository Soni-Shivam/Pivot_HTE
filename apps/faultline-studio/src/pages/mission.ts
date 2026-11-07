// Mission Control (/mission/:id), PRD §4.4: a live job or a recorded run with its state rail, 0G plan, paid job timeline,
// decision timeline + inspector, telemetry, worst-moment jump and verdict. Ported from openRun at 0f00ef3 (src/main.ts).
// Stream events: POST /api/stream in packages/hedera/src/agent-console.ts (meta, plan, queue, phase, step, await0g, ticks, decision, done, error).
import { orb } from '../orb'
import { SWARM, href } from '../routes'
import { api, media, stream, type Decision, type Plan, type Run, type Tick } from '../core/api'
import { $, C, canvas2d, esc, extLink, galileoTx, loading, num, short } from '../core/dom'
import { announce } from '../core/a11y'
import { isJob, runTabs, runTitle, say, videoOf, why } from '../core/run'
import { railHtml, trustFromRun } from '../core/trust'
import { ROLES } from '../core/catalogue'

const SWARM_SUITE = 'swarm-v1-carla'
type State = 'Ready' | 'Waiting for 0G' | 'Executing' | 'Completed' | 'Safe halt' | 'Interrupted'
type JobRow = { status: 'run' | 'ok' | 'fail', title: string, link?: string }
type Mc = { id: string, run: Run | null, ticks: Tick[], ds: Decision[], sel: number, aligned: boolean, live: boolean, swarm: boolean, plan: Plan | null
  state: State, done: boolean, paid: boolean, job: Record<string, JobRow>, queue: string, error: string | null, gone: boolean, lost: boolean, t0: number }
let mc: Mc | null = null
let ctl: AbortController | null = null
let progT = 0

// Swarm car colours as filmed in CARLA (same table as 0f00ef3 ROLE_CAR).
const ROLE_CAR: Record<string, [string, string]> = { A: ['#e5484d', 'red car'], B: ['#f3c623', 'yellow taxi'], C: ['#3b82f6', 'blue car'], D: ['#d63384', 'magenta car'] }
const rolesHtml = (roles: Record<string, string>) => Object.entries(roles).map(([k, v]) => `<li><i style="background:${ROLE_CAR[k]?.[0] ?? '#999'}"></i><b>${esc(k)}</b> ${esc(ROLE_CAR[k]?.[1] ?? '')}: ${esc(v)}</li>`).join('')
// Swarm replies carry {"actions":{"A":"KEEP_LANE",...},"phase","why"} (runs/swarm-carla-010/decisions.jsonl).
const carActions = (d: Decision): Record<string, string> | null => { try { const a = JSON.parse(d.content ?? '').actions; return a && typeof a === 'object' ? a : null } catch { return null } }
const halted = (d: Decision) => d.source !== '0g'
const label = (d: Decision) => mc?.swarm ? d.phase ?? d.action ?? 'SAFE_HALT' : d.action ?? 'SAFE_HALT'

// Paid job: buyer steps (packages/hedera/src/buyer.ts StepId) and console phases folded into the seven stages the PRD names.
const JOB: [string, string][] = [['quote', 'Quote'], ['policy', 'Policy'], ['settle', 'Settlement'], ['permit', 'Permit'], ['run', 'Run'], ['publish', 'Publish'], ['finalize', 'Finalize']]
const STEP_TO: Record<string, string> = { discover: 'quote', negotiate: 'quote', quote: 'quote', facilitator: 'policy', policy: 'policy', settle: 'settle', mirror: 'settle', bind: 'permit', activate: 'permit' }
const PHASE_TO: Record<string, string> = { payment: 'settle', permit: 'permit', commit: 'run', sim: 'run', storage: 'publish', finalize: 'finalize' }

const css = `
#v-mission .mc-head { display: flex; justify-content: space-between; gap: 16px; align-items: center; flex-wrap: wrap }
#v-mission .mc-head h1 { color: var(--paper); margin: 0; display: flex; gap: 10px; align-items: center; font-size: clamp(24px, 2.6vw, 34px); font-weight: 600 }
#v-mission .mc-prov { font: 13px var(--mono); color: #b8b8b2; margin: 8px 0 0 }
#v-mission .states { list-style: none; display: flex; gap: 6px; flex-wrap: wrap; padding: 0; margin: 0 }
#v-mission .states li { font: 12px var(--mono); padding: 5px 10px; border-radius: 999px; border: 1px solid #444; color: #9a9a94 }
#v-mission .states li.done { color: var(--paper); border-color: #666 } #v-mission .states li.cur { background: var(--paper); color: var(--ink); border-color: var(--paper) }
#v-mission .states li.bad { background: var(--hot); color: var(--ink); border-color: var(--hot) }
#v-mission .mc-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start }
#v-mission .mc-left { display: grid; gap: 16px; min-width: 0 } #v-mission .mc-grid > *, #v-mission .mc-left > * { min-width: 0 }
#v-mission .runtabs { display: flex; gap: 8px; flex-wrap: wrap }
#v-mission .runtabs a { min-height: 44px; display: inline-flex; align-items: center; padding: 0 18px; border-radius: 999px; border: 1.5px solid #fbfbf655; color: var(--paper); text-decoration: none; font-weight: 600 }
#v-mission .runtabs a.on { background: var(--paper); color: var(--ink) }
#v-mission .mc-main { padding: 16px } #v-mission .mc-stage { position: relative }
#v-mission .mc-stage video, #v-mission .mc-stage img { width: 100%; aspect-ratio: 16 / 9; display: block; border-radius: 14px; background: #000; object-fit: contain; border: 0 }
#v-mission .mc-novid { aspect-ratio: 16 / 9; border-radius: 14px; background: #0d0d0d; color: #b8b8b2; display: flex; align-items: center; justify-content: center; text-align: center; padding: 20px }
#v-mission .mc-overlay { position: absolute; left: 12px; top: 12px; bottom: auto; display: flex; gap: 6px; flex-wrap: wrap; pointer-events: none }
#v-mission .mc-overlay span { font: 600 13px var(--mono); background: #000000c0; color: #fff; padding: 5px 9px; border-radius: 8px }
#v-mission .mc-overlay .act-on { background: var(--yellow); color: var(--ink) }
#v-mission .mc-progress { min-height: 260px; background: #0d0d0d; border-radius: 14px; padding: 20px; color: var(--paper) }
#v-mission .mc-orb-row { display: flex; gap: 16px; align-items: center; margin-bottom: 14px }
#v-mission .mc-progress h3 { margin: 0 0 6px; font-size: 20px } #v-mission .mc-progress .eta { font: 13px var(--mono); color: #b8b8b2; margin: 0 }
#v-mission .mc-progress ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; max-height: 320px; overflow: auto }
#v-mission .mc-progress li { border-left: 3px solid #444; padding: 4px 10px; font-size: 15px } #v-mission .mc-progress li.ok { border-color: var(--lime) }
#v-mission .mc-progress li.run { border-color: var(--yellow) } #v-mission .mc-progress li.bad { border-color: var(--hot) }
#v-mission .mc-progress small { display: block; font: 12px var(--mono); color: #b8b8b2; overflow-wrap: anywhere }
#v-mission #mc-live.peek { position: absolute; right: 12px; bottom: 12px; width: 32%; aspect-ratio: 16 / 9; border: 1px solid #444 }
#v-mission .mc-note { color: #b8b8b2; font-size: 14px; margin: 8px 0 0 } #v-mission .mc-note:empty { display: none }
#v-mission .mc-lost { margin-top: 10px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; color: var(--paper) }
#v-mission .mc-timeline { display: flex; gap: 6px; overflow-x: auto; padding: 12px 0 2px; align-items: stretch }
#v-mission .mc-timeline button { flex: none; font: 12px var(--mono); color: var(--paper); background: transparent; border: 1px solid #444; border-radius: 10px; padding: 6px 9px; text-align: left; min-height: 44px; cursor: pointer; transition: background .18s var(--ease) }
#v-mission .mc-timeline button.on { background: var(--paper); color: var(--ink) } #v-mission .mc-timeline button.halt { border-color: var(--hot) }
#v-mission .mc-timeline button.plan { border-color: var(--yellow) }
#v-mission .mc-wait { flex: none; display: inline-flex; gap: 6px; align-items: center; font: 12px var(--mono); color: #b8b8b2; padding: 0 8px }
#v-mission .mc-insp { position: sticky; top: 84px; max-height: calc(100vh - 100px); overflow: auto }
#v-mission .mc-insp dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 14px }
#v-mission .mc-insp dt { color: var(--muted) } #v-mission .mc-insp dd { margin: 0; font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere }
#v-mission .why-q { background: #f1f1ea; border-radius: 12px; padding: 10px 12px; margin: 12px 0 }
#v-mission .srcs { font: 12px var(--mono); color: var(--muted) }
#v-mission .roles { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 20px }
#v-mission .roles li { display: flex; gap: 8px; align-items: center; font-size: 15px } #v-mission .roles i { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--ink); flex: none }
#v-mission .mc-job ol { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px }
#v-mission .mc-job li { border-top: 3px solid #ccc; padding-top: 8px; font-size: 14px; min-width: 0 } #v-mission .mc-job li.ok { border-color: #2f9e44 }
#v-mission .mc-job li.run { border-color: var(--yellow) } #v-mission .mc-job li.fail { border-color: var(--hot) } #v-mission .mc-job li.na { border-top-style: dashed }
#v-mission .mc-job b { display: block } #v-mission .mc-job span { display: block; font: 12px var(--mono); color: var(--muted); overflow-wrap: anywhere }
#v-mission canvas.tele { width: 100%; height: 220px; display: block }
#v-mission .mc-table { overflow-x: auto } #v-mission .mc-table table { width: 100%; border-collapse: collapse; font-size: 13px }
#v-mission .mc-table td, #v-mission .mc-table th { padding: 6px; border-bottom: 1px solid #11111120; text-align: left; white-space: nowrap }
#v-mission .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 18px }
#v-mission .stats div { background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column }
#v-mission .stats b { font-size: 22px; font-family: var(--mono) } #v-mission .stats span { font-size: 13px; color: var(--muted) }
#v-mission .mc-out { display: flex; gap: 10px; align-items: center; flex-wrap: wrap } #v-mission .mc-out h2 { margin: 0 }
#v-mission .chip.bad { background: var(--hot) }
@media (max-width: 1000px) { #v-mission .mc-grid { grid-template-columns: minmax(0, 1fr) } #v-mission .mc-insp { position: static; max-height: none } #v-mission .mc-job ol { grid-template-columns: repeat(4, minmax(0, 1fr)) } }
@media (max-width: 640px) { #v-mission .stats, #v-mission .mc-job ol { grid-template-columns: 1fr 1fr } #v-mission .roles { grid-template-columns: 1fr } }
`

const html = `<div class="grid">
  <div id="mc-tabs"></div>
  <div class="card k mc-head">
    <div><p class="kicker" id="mc-kind">Run</p><h1 id="mc-title">Loading…</h1><p class="mc-prov" id="mc-prov"></p></div>
    <ol class="states" id="mc-states" aria-label="Run state"></ol>
  </div>
  <div class="card hidden" id="mc-gone"></div>
  <div class="card hidden" id="mc-plan"></div>
  <div class="card hidden mc-job" id="mc-job"></div>
  <div class="mc-grid">
    <div class="mc-left">
      <div class="card k mc-main">
        <div class="mc-stage">
          <video id="mc-video" controls muted playsinline preload="metadata" aria-label="Recorded CARLA camera"></video>
          <div id="mc-novid" class="mc-novid hidden"></div>
          <img id="mc-live" class="hidden" alt="Live CARLA chase camera (low frame rate preview)">
          <div id="mc-progress" class="mc-progress hidden"></div>
          <div class="mc-overlay" id="mc-overlay"></div>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn y" id="mc-worst" type="button">Jump to worst moment</button><button class="btn hidden" id="mc-peek" type="button">Peek live (low frame rate)</button></div>
        <p class="mc-note" id="mc-note"></p>
        <div class="mc-lost hidden" id="mc-lost"><span id="mc-lost-txt"></span><button class="btn" id="mc-reconnect" type="button">Reconnect</button></div>
        <div class="mc-timeline" id="mc-timeline" aria-label="Decision timeline"></div>
      </div>
      <div class="card">
        <div class="head"><h2>Telemetry</h2><span class="srcs">gap, TTC, speeds: simulator ground truth · criticality score: recomputed from ground truth · LiDAR gap: measured</span></div>
        <canvas id="mc-tele" class="tele" role="img" aria-label="Telemetry over simulation time; the table below lists every checkpoint"></canvas>
        <details class="mc-table" style="margin-top:12px"><summary>Checkpoint table</summary><div id="mc-rows-tbl"></div></details>
      </div>
    </div>
    <aside class="card mc-insp" id="mc-insp" aria-label="Decision inspector"></aside>
  </div>
  <div class="card" id="mc-verdict"></div>
</div>`

// ---------- state rail ----------
const ORDER: State[] = ['Ready', 'Waiting for 0G', 'Executing', 'Completed']
function paintStates() {
  if (!mc) return
  const st = mc.state, bad = st === 'Safe halt' || st === 'Interrupted', order = bad ? ['Ready', 'Waiting for 0G', 'Executing', st] : ORDER, at = order.indexOf(st)
  $('mc-states').innerHTML = order.map((x, i) => `<li class="${i < at ? 'done' : ''} ${i === at ? (bad ? 'bad' : 'cur') : ''}"${i === at ? ' aria-current="step"' : ''}>${esc(x)}</li>`).join('')
}
function setState(s: State) {
  if (!mc || mc.state === s) return
  mc.state = s; paintStates(); announce(`Run state: ${s}`)
}

// ---------- telemetry chart (ported drawTele) ----------
function drawTele(cv: HTMLCanvasElement, rows: Tick[], ds: Decision[], cursor?: number) {
  if (!cv.getBoundingClientRect().width) return // hidden: the ResizeObserver redraws once visible
  const { g, w, h } = canvas2d(cv)
  g.clearRect(0, 0, w, h)
  const T = Math.max(rows.at(-1)?.t_s ?? 1, 1), pad = 8, top = 30, X = (t: number) => pad + (t / T) * (w - pad * 2), Y = (v: number, max: number) => top + (1 - Math.min(v, max) / max) * (h - top - 18)
  g.strokeStyle = '#1111111a'; g.lineWidth = 1
  for (let i = 0; i <= 3; i++) { const y = top + i * (h - top - 18) / 3; g.beginPath(); g.moveTo(pad, y); g.lineTo(w - pad, y); g.stroke() }
  if (rows.length) {
    g.beginPath(); rows.forEach((r, i) => (i ? g.lineTo(X(r.t_s), Y(r.ccs ?? 0, 1)) : g.moveTo(X(r.t_s), Y(r.ccs ?? 0, 1))))
    g.lineTo(X(rows.at(-1)!.t_s), Y(0, 1)); g.lineTo(X(rows[0].t_s), Y(0, 1)); g.closePath(); g.fillStyle = C.pink; g.fill(); g.strokeStyle = C.ink; g.lineWidth = 1.5; g.stroke()
  }
  const line = (val: (r: Tick) => number | null, max: number, color: string, wdt: number) => {
    g.strokeStyle = color; g.lineWidth = wdt; g.beginPath(); let pen = false
    for (const r of rows) { const v = val(r); if (v == null) { pen = false; continue } pen ? g.lineTo(X(r.t_s), Y(v, max)) : g.moveTo(X(r.t_s), Y(v, max)); pen = true }
    g.stroke()
  }
  line((r) => r.gt_gap, 30, C.purple, 2.5)
  line((r) => r.gt_ttc_s, 6, C.ink, 2)
  for (const d of ds) { g.fillStyle = halted(d) ? C.hot : C.ink; g.beginPath(); g.arc(X(d.sim_time_s), h - 8, 3.5, 0, Math.PI * 2); g.fill() }
  if (cursor != null) { g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(cursor), top - 6); g.lineTo(X(cursor), h - 14); g.stroke() }
  let lx = pad; g.font = '500 12px "Space Grotesk", sans-serif'
  for (const [c, t] of [[C.pink, 'Criticality 0–1'], [C.purple, 'Gap 0–30 m'], [C.ink, 'TTC 0–6 s, capped'], [C.hot, 'Safe halt']] as const) {
    const tw = g.measureText(t).width; g.fillStyle = c; g.beginPath(); g.roundRect(lx, 4, 10, 10, 5); g.fill(); g.fillStyle = C.ink; g.fillText(t, lx + 14, 13); lx += tw + 30
  }
}
let cursorT: number | undefined
const tele = (cursor = cursorT) => { cursorT = cursor; if (mc) drawTele($<HTMLCanvasElement>('mc-tele'), mc.ticks, mc.ds, cursor) }

// ---------- timeline, overlay, inspector ----------
const decAt = (t: number) => mc?.ds.filter((d) => d.sim_time_s <= t).at(-1)
const tickAt = (t: number) => mc ? (mc.ticks.find((x) => x.t_s >= t) ?? mc.ticks.at(-1)) : undefined
// worst moment = peak criticality; runs without CCS fall back to the smallest time to collision
const worstT = () => {
  if (!mc?.ticks.length) return null
  const ccs = mc.ticks.filter((t) => t.ccs != null), ttc = mc.ticks.filter((t) => t.gt_ttc_s != null)
  if (ccs.length) return ccs.reduce((m, t) => (t.ccs! > m.ccs! ? t : m)).t_s
  return ttc.length ? ttc.reduce((m, t) => (t.gt_ttc_s! < m.gt_ttc_s! ? t : m)).t_s : null
}
function overlay(t: number) {
  if (!mc) return
  if (!$('mc-progress').classList.contains('hidden')) { $('mc-overlay').innerHTML = ''; return } // the progress panel owns the stage while running
  const d = decAt(t), k = tickAt(t)
  $('mc-overlay').innerHTML = (d ? `<span class="act-on">${esc(mc.swarm ? d.action ?? 'SAFE_HALT' : `Attacker: ${d.action ?? 'SAFE_HALT'}`)}</span>` : '<span>Run-up: no decision yet</span>') +
    (k ? `<span>t ${num(k.t_s, 1)} s</span><span>CCS ${num(k.ccs, 2)}</span><span>gap ${num(k.gt_gap, 1)} m</span>` : '')
}
function timeline() {
  if (!mc) return
  const m = mc, waiting = m.live && !m.done && m.state !== 'Safe halt' && m.state !== 'Interrupted'
  $('mc-timeline').innerHTML = (m.plan ? '<button type="button" class="plan" data-plan>PLAN<br>0G strategist</button>' : '') +
    m.ds.map((d, i) => `<button type="button" data-di="${i}" class="${i === m.sel ? 'on' : ''} ${halted(d) ? 'halt' : ''}" aria-pressed="${i === m.sel}" title="${esc(d.request_id ?? 'no request id')}">cp ${d.cp} · ${num(d.sim_time_s, 1)} s${halted(d) ? ' · safe halt' : ''}<br>${esc(label(d))}</button>`).join('') +
    (waiting ? `<span class="mc-wait">${orb('searching', 20, { dark: true })}Asking 0G…</span>` : '')
  table()
}
function table() {
  if (!mc) return
  const m = mc
  $('mc-rows-tbl').innerHTML = m.ds.length ? `<table><thead><tr><th>Checkpoint</th><th>Sim time (s)</th><th>Action</th><th>Source</th><th>Request ID</th><th>Latency (ms)</th><th>Gap (m)</th><th>TTC (s)</th><th>Criticality</th></tr></thead><tbody>${
    m.ds.map((d) => { const k = tickAt(d.sim_time_s); return `<tr><td>${d.cp}</td><td>${num(d.sim_time_s, 2)}</td><td>${esc(d.action ?? 'SAFE_HALT')}</td><td>${halted(d) ? 'safe halt' : '0G'}</td><td class="mono">${short(d.request_id)}</td><td>${esc(d.latency_ms)}</td><td>${num(k?.gt_gap, 2)}</td><td>${k?.gt_ttc_s == null ? 'no closing' : num(k.gt_ttc_s, 2)}</td><td>${num(k?.ccs, 3)}</td></tr>` }).join('')
  }</tbody></table>` : '<p class="muted">No checkpoints yet.</p>'
}
/** Select checkpoint i; t moves the cursor and the aligned video to a moment other than the checkpoint itself (worst moment). */
function select(i: number, t?: number) {
  if (!mc || !mc.ds[i]) return
  mc.sel = i; const d = mc.ds[i], at = t ?? d.sim_time_s, k = tickAt(at), r = mc.run
  timeline()
  const vid = $<HTMLVideoElement>('mc-video')
  // director cuts are not time-aligned: never seek them
  if (mc.aligned && vid.getAttribute('src')) { try { vid.currentTime = t != null ? Math.max(0, at - 1) : at; if (t != null) vid.pause() } catch { /* not loaded yet */ } }
  overlay(at); tele(at)
  const st = r?.storage, sig = st?.signaturesVerified != null && st.signatures0g ? `${st.signaturesVerified} of ${st.signatures0g} verified for this run` : st?.signaturesArchived != null ? `archived (${st.signaturesArchived}), not re-checked here` : 'not archived for this run'
  const acts = mc.swarm ? carActions(d) : null
  const nonce = (d as Decision & { nonce?: string | null }).nonce
  const name = r?.name ?? mc.id
  $('mc-insp').innerHTML = `<p class="kicker">Decision inspector</p><h2 style="margin:0 0 8px;font-size:20px">Checkpoint ${d.cp}: ${esc(mc.swarm ? d.phase ?? 'joint move' : say(d.action))}</h2>
    ${halted(d) ? '<p class="note" style="margin-top:8px">Safe halt: 0G gave no valid answer, so the attacker stopped. A fail-closed stop is a valid outcome; no move was made up.</p>' : ''}
    ${why(d) ? `<div class="why-q">“${esc(why(d))}”<br><small class="muted">the model’s stated reason</small></div>` : ''}
    <dl>
      <dt>Action</dt><dd>${esc(d.action ?? 'SAFE_HALT')}</dd>
      ${acts ? Object.entries(acts).map(([c, a]) => `<dt>Car ${esc(c)}</dt><dd>${esc(a)} · ${esc(say(a))}</dd>`).join('') : `<dt>In plain words</dt><dd>${esc(say(d.action))}</dd>`}
      ${mc.swarm ? `<dt>Phase</dt><dd>${esc(d.phase ?? '-')}</dd>` : ''}
      <dt>Source</dt><dd>${halted(d) ? esc(d.source) + ' (safe halt)' : '0G Router, private tier'}</dd><dt>Provider</dt><dd>${short(d.provider)}</dd>
      <dt>Request ID</dt><dd>${short(d.request_id, 10, 8)}</dd><dt>Latency</dt><dd>${esc(d.latency_ms)} ms (wall-clock wait on 0G)</dd>
      ${nonce ? `<dt>Nonce</dt><dd>${short(nonce)}</dd>` : ''}
      <dt>Sim time</dt><dd>${num(d.sim_time_s, 2)} s (simulated)</dd><dt>Wall clock</dt><dd>${esc(d.wall_clock_utc)}</dd>
      <dt>Signature</dt><dd>${esc(sig)}</dd>
      <dt>Gap</dt><dd>${num(k?.gt_gap, 2)} m (ground truth)</dd><dt>LiDAR gap</dt><dd>${k?.lidar_gap != null ? num(k.lidar_gap, 2) + ' m (measured)' : 'Not measured'}</dd>
      <dt>TTC</dt><dd>${k?.gt_ttc_s == null ? 'no closing' : num(k.gt_ttc_s, 2) + ' s'} (ground truth)</dd>
      <dt>Criticality</dt><dd>${num(k?.ccs, 3)} (recomputed)</dd>
      <dt>Provenance</dt><dd><a href="${href.verify(name)}">Check this run’s evidence</a></dd>
    </dl><details style="margin-top:10px"><summary>Raw response</summary><pre class="msg">${esc(d.content ?? JSON.stringify(d, null, 1))}</pre></details>`
}

// ---------- plan, paid job timeline, live progress ----------
function paintPlan(p: Plan) {
  $('mc-plan').classList.remove('hidden')
  $('mc-plan').innerHTML = `<p class="kicker">0G strategist · plan written before the first tick</p><h2 class="sec" style="margin-bottom:8px">“${esc(p.name)}”</h2>
    <p style="margin:0 0 10px">${esc(p.summary)}</p><ul class="roles">${rolesHtml(p.roles ?? {})}</ul>`
}
// Stream unreachable or no plan event: show the four recorded roles so the plan card never stays hidden on a swarm run.
function planFallback(me: Mc) {
  if (!me.swarm || me.plan || mc !== me) return
  $('mc-plan').classList.remove('hidden')
  $('mc-plan').innerHTML = `<p class="kicker">Recorded · four-car roles</p><h2 class="sec" style="margin-bottom:8px">Coordinated four-car attack</h2>
    <p style="margin:0 0 10px">The 0G strategist gives each of four cars a role before the first tick. These are the roles from the recorded run.</p><ul class="roles">${rolesHtml(ROLES)}</ul>
    <p class="srcs" style="margin:10px 0 0">Recorded · CARLA · roles as filmed, live plan unavailable</p>`
}
function jobEvent(e: any) {
  if (!mc) return
  const key = e.t === 'step' ? STEP_TO[e.id] : PHASE_TO[e.id]
  if (!key) return
  if (e.t === 'step' || e.id === 'payment') mc.paid = true // permit and commit also appear on free and unpaid anchored runs
  const d = e.data ?? {}, prev = mc.job[key]
  const link = d.hashscan ? extLink(String(d.hashscan), 'HashScan') : d.tx ? extLink(galileoTx(String(d.tx)), 'chainscan-galileo') : d.publicRoot ? `<span title="${esc(d.publicRoot)}">root ${short(String(d.publicRoot), 6, 4)}</span>` : prev?.link
  mc.job[key] = { status: e.status === 'fail' ? 'fail' : e.status === 'ok' ? 'ok' : 'run', title: String(e.title ?? ''), link }
  paintJob()
}
function paintJob() {
  if (!mc?.paid) return
  const m = mc
  $('mc-job').classList.remove('hidden')
  $('mc-job').innerHTML = `<div class="head"><h2>Paid job</h2><span class="srcs">x402 on Hedera, then the run on 0G</span></div><ol>${
    JOB.map(([k, l]) => { const r = m.job[k], na = !r && (!m.live || m.done); return `<li class="${r?.status ?? (na ? 'na' : '')}"><b>${l}</b><span>${r ? esc(r.title) : na ? 'Not recorded' : 'Waiting'}</span>${r?.link ? `<span>${r.link}</span>` : ''}</li>` }).join('')}</ol>`
}
function paintProg() {
  const m = mc
  if (!m || !m.live || m.gone) return
  const zgN = m.ds.filter((d) => !halted(d)).length, el = Math.round((performance.now() - m.t0) / 1000)
  const queued = m.state === 'Ready' && !m.ticks.length && !m.plan
  const [os, title] = m.done ? ['breathing', 'Run finished, loading the recording']
    : queued ? ['breathing', m.swarm ? 'Starting the four-car attack' : 'Starting your test']
    : m.swarm && !m.plan ? ['weaving', 'The 0G strategist is planning the attack']
    : m.state === 'Waiting for 0G' || !m.ticks.length ? ['searching', 'Asking 0G for the next move']
    : ['working', m.swarm ? 'Four cars are attacking in CARLA' : 'The attacker is driving in CARLA']
  const prog = $('mc-progress'), o = prog.querySelector<HTMLCanvasElement>('canvas.orb'); if (o) o.dataset.orb = os
  $('mc-ph').textContent = title
  $('mc-eta').textContent = `${m.queue ? m.queue + ' · ' : ''}${el} s elapsed · typical run about ${m.swarm ? 120 : 60} s · ${zgN} decisions from 0G`
  $('mc-rows').innerHTML = [
    `<li class="${queued ? 'run' : 'ok'}">${esc(m.queue || 'Queued')}</li>`,
    ...(m.swarm ? [`<li class="${m.plan ? 'ok' : 'run'}">${m.plan ? `Plan from 0G: “${esc(m.plan.name)}”` : '0G strategist writing the plan (about 30 s)'}</li>`] : []),
    `<li class="${m.ds.length ? 'ok' : m.state === 'Waiting for 0G' ? 'run' : ''}">${m.ds.length ? 'Connected to 0G (private tier)' : 'Connecting to 0G'}</li>`,
    ...m.ds.map((d) => `<li class="${halted(d) ? 'bad' : 'ok'}">Checkpoint ${d.cp + 1}: ${esc(m.swarm ? d.phase ?? d.action : say(d.action))}${why(d) ? ` · “${esc(why(d))}”` : ''}<small>${halted(d) ? 'no valid 0G answer: safe halt' : `${d.latency_ms} ms · ${esc(d.request_id)}`}</small></li>`)].join('')
}

// ---------- stream ----------
function onEvent(e: any) {
  const m = mc
  if (!m) return
  if (e.t === 'meta') {
    m.run = e.run ?? e.job?.result ?? m.run
    if (e.job?.suite === SWARM_SUITE || m.run?.family === 'swarm') m.swarm = true
    if (e.job?.mode === 'paid' || m.run?.payment) m.paid = true
    if (m.live) { $('mc-title').innerHTML = `${orb('breathing', 20, { dark: true })} ${m.swarm ? 'Live coordinated four-car attack' : 'Live cut-in test'}`; $('mc-peek').classList.toggle('hidden', m.swarm || m.done) } // only cut-in has a live camera
    else $('mc-title').textContent = runTitle(m.run?.name ?? m.id, m.swarm)
    prov(); paintJob()
  }
  if (e.t === 'plan' && e.plan) { const first = !m.plan; m.plan = e.plan; paintPlan(e.plan); timeline(); paintProg(); if (first) announce(`0G plan received: ${e.plan.name}`) }
  if (e.t === 'queue') { m.queue = e.pos > 0 ? `Queued: position ${e.pos}${e.etaS ? `, about ${Math.round(e.etaS)} s` : ''}` : 'Started'; paintProg() }
  if (e.t === 'step') jobEvent(e)
  if (e.t === 'phase') { jobEvent(e); if (e.id === 'sim' && m.state === 'Ready') setState('Waiting for 0G') }
  if (e.t === 'await0g' && m.state !== 'Safe halt') setState('Waiting for 0G')
  if (e.t === 'ticks') {
    const last = m.ticks.at(-1)?.t_s ?? -Infinity // a reconnect replays from the start: keep only new rows
    m.ticks.push(...(e.rows as Tick[]).filter((r) => r.t_s > last))
    if (m.live && m.ticks.length) { if (m.state === 'Ready' || m.state === 'Waiting for 0G') setState('Executing'); overlay(m.ticks.at(-1)!.t_s) }
  }
  if (e.t === 'decision') {
    const d = e.d as Decision
    if (m.ds.some((x) => x.cp === d.cp)) return
    m.ds.push(d)
    if (halted(d)) { setState('Safe halt'); announce('Safe halt: 0G gave no valid answer, the attacker stopped') } else if (m.state !== 'Safe halt') setState('Executing')
    if (m.live) { timeline(); paintProg() }
  }
  if (e.t === 'done' || e.t === 'error') {
    m.run = e.run ?? e.job?.result ?? m.run
    if (e.t === 'error' && /unknown (job|run)/.test(String(e.message))) { m.gone = true; return }
    if (e.t === 'error') m.error = String(e.message ?? 'error')
    m.done = true
  }
}

function prov() {
  if (!mc) return
  const r = mc.run, world = r?.world ? (/kin/i.test(r.world) ? 'kinematic' : 'CARLA') : mc.swarm || !mc.live ? 'CARLA' : 'CARLA or kinematic'
  const src = mc.live ? 'Live' : 'Replay of a recorded run'
  const anch = r?.free ? 'not paid, not anchored' : r?.chain?.commitTx ? 'on-chain link in the evidence below' : mc.paid ? 'paid job, not anchored' : !r ? 'run metadata only' : 'not paid, not anchored'
  $('mc-prov').textContent = `${src} · ${world} · ground truth telemetry · ${anch}`
}

function gone() {
  const m = mc!
  $('mc-gone').classList.remove('hidden')
  $('mc-gone').innerHTML = m.live
    ? `<h2>This live job is no longer on the runner</h2><p>Live jobs are kept in memory and disappear when the runner restarts. Finished runs stay in the library.</p><a class="btn k" href="${href.library()}">Explore runs</a>`
    : `<h2>This run was not found</h2><p>The runner has no run called <code>${esc(m.id)}</code>.</p><a class="btn k" href="${href.library()}">Explore runs</a>`
  $('mc-progress').classList.add('hidden'); $('mc-verdict').innerHTML = ''; $('mc-peek').classList.add('hidden'); $('mc-worst').classList.add('hidden')
  $('mc-video').classList.add('hidden'); $('mc-novid').classList.remove('hidden'); $('mc-novid').textContent = 'Nothing to show for this link.'
  m.state = 'Interrupted'; paintStates(); timeline()
  announce(m.live ? 'This live job is no longer on the runner' : 'This run was not found')
}

async function connect(me: Mc) {
  ctl?.abort(); ctl = new AbortController()
  $('mc-lost').classList.add('hidden'); me.lost = false
  try {
    await stream('/api/stream', me.live ? (isJob(me.id) ? { job: me.id, mode: 'live' } : { run: me.id, mode: 'live', speed: 8 }) : { run: me.id, mode: 'replay', speed: 8 }, onEvent, ctl.signal)
    if (mc === me && !me.done && !me.gone) throw new Error('the stream ended early')
  } catch (err) {
    if (mc !== me || ctl.signal.aborted) return
    me.lost = true
    planFallback(me)
    $('mc-lost').classList.remove('hidden')
    $('mc-lost-txt').textContent = `Connection lost (${(err as Error).message}). ${me.ds.length ? `Showing up to checkpoint ${me.ds.at(-1)!.cp}.` : 'No checkpoints received yet.'}`
    if (!me.live) { // a recorded run still has its camera and its other pages; only the telemetry needs the runner
      setVideo(me, me.run?.name ?? me.id)
      if (!me.ds.length) {
        const name = me.run?.name ?? me.id
        $('mc-verdict').innerHTML = `<h2 class="sec">The local runner is offline</h2><p>Telemetry and decisions load when it reconnects.</p>
          <div class="row" style="margin-top:12px"><a class="btn k" href="${href.results(name)}">See results</a><a class="btn" href="${href.verify(name)}">Check evidence</a></div>`
      }
    }
    announce('Connection to the runner lost')
    return
  }
  if (mc !== me) return
  if (me.gone) { clearInterval(progT); gone(); return }
  finish(me)
}

function finish(me: Mc) {
  clearInterval(progT)
  if (me.state === 'Ready' || me.state === 'Executing' || me.state === 'Waiting for 0G')
    me.state = me.error || (me.run?.status === 'interrupted' && !me.ds.length) ? 'Interrupted' : me.ds.some(halted) ? 'Safe halt' : me.ds.length ? 'Completed' : 'Interrupted'
  if (me.state === 'Completed' && me.run?.status === 'interrupted') me.state = 'Interrupted' // same rule as loadRun in core/run.ts
  paintStates(); planFallback(me); announce(`Run finished: ${me.state}`)
  if (me.error) $('mc-note').textContent = `Stopped: ${me.error}`
  // a finished live job becomes its run: the address bar switches to the run name so the link survives restarts
  const name = me.run?.name
  if (me.live && name && location.pathname === href.mission(me.id)) {
    history.replaceState(null, '', href.mission(name)); $('mc-title').textContent = runTitle(name, me.swarm); $('mc-kind').textContent = 'Finished live run'
    $('mc-tabs').innerHTML = runTabs(name, 'mission')
  }
  $('mc-progress').classList.add('hidden'); $('mc-peek').classList.add('hidden'); $('mc-live').classList.add('hidden'); $('mc-live').removeAttribute('src')
  setVideo(me, name ?? me.id)
  $('mc-worst').classList.toggle('hidden', !me.ticks.length)
  prov(); timeline(); verdict()
  const w = worstT(); if (w != null) { overlay(w); tele(w) } else tele()
}

// Swarm's director cut is in LITE but has no RUN_VIDEO entry, so offline (no run metadata) it needs this local fallback.
const SWARM_CUT = { path: 'runs/swarm-carla-010/director.mp4', aligned: false, note: 'Director cut with the 0G decision cards inserted, so it is not time-aligned with the timeline.' }
function setVideo(me: Mc, name: string) {
  const vid = $<HTMLVideoElement>('mc-video'), rv = videoOf(name, me.run) ?? (name === SWARM ? SWARM_CUT : null)
  if (rv) {
    if (vid.getAttribute('src') !== media(rv.path)) { vid.src = media(rv.path); vid.preload = 'auto' }
    vid.classList.remove('hidden'); $('mc-novid').classList.add('hidden'); me.aligned = rv.aligned
    $('mc-note').textContent = rv.note ?? (rv.aligned ? '' : 'Director cut, not time-aligned with the timeline.')
    if (me.live) { vid.load(); vid.play().catch(() => { /* autoplay blocked: controls stay */ }) }
  } else {
    vid.classList.add('hidden'); $('mc-novid').classList.remove('hidden')
    $('mc-novid').textContent = me.live ? 'The run finished but its recording is not available. The decisions and telemetry below are complete.' : 'No camera recording exists for this run. The decisions and telemetry below come from its recorded data.'
  }
}

function verdict() {
  if (!mc) return
  const m = mc, r = m.run, crashed = r?.collision ?? m.ticks.some((t) => t.collision), name = r?.name ?? m.id
  const empty = !m.ds.length && !m.ticks.length
  const words = empty ? 'This run did not produce any driving data.' : crashed ? 'Collision occurred in this test' : 'Avoided collision in this test'
  const chip = m.state === 'Interrupted' ? '<span class="chip bad">✕ Interrupted</span>' : m.state === 'Safe halt' ? '<span class="chip bad">■ Safe halt</span>' : '<span class="chip live">✓ Completed</span>'
  // a safe halt is also an interrupted run (PRD journey 6): say both, as Results does
  const intr = m.state === 'Safe halt' || (m.state !== 'Interrupted' && r?.status === 'interrupted') ? '<span class="pill p sm"><span aria-hidden="true">!</span>Interrupted</span>' : ''
  const hd = m.ds.find(halted), hr = hd?.reason
  const halt = m.state === 'Safe halt' ? `<p>No valid answer from 0G${hd ? ` at checkpoint ${hd.cp + 1}` : ''}${hr ? ` (${esc(hr)})` : ''}, so the attacker stopped itself. A fail-closed stop is a valid outcome: Faultline never makes up a move.</p>`
    : m.state === 'Interrupted' ? `<p>The run did not complete${m.error ? ` (${esc(m.error)})` : ''}. The numbers cover only what was recorded.</p>` : ''
  $('mc-verdict').innerHTML = `<div class="mc-out"><h2 class="sec">${esc(words)}</h2>${chip}${intr}</div>${halt}
    <div class="stats"><div><b>${num(r?.minGap, 2)} m</b><span>closest gap</span></div><div><b>${num(r?.minTtc, 2)} s</b><span>minimum time to collision</span></div>
    <div><b>${num(r?.ccs, 2)}</b><span>peak criticality score (0 to 1)</span></div><div><b>${esc(r?.decisions0g ?? m.ds.filter((d) => !halted(d)).length)} of ${esc(r?.decisions ?? m.ds.length)}</b><span>decisions from 0G</span></div></div>
    <p class="srcs" style="margin:10px 0 0" id="mc-vprov"></p>
    <div class="head" style="margin:22px 0 8px"><h2>Evidence</h2><span class="muted" style="font-size:14px">A green dot means the data proves it.</span></div>
    <div class="rail">${railHtml(trustFromRun(r, m.ds, !!r?.free))}</div>
    <div class="row" style="margin-top:16px"><a class="btn k" href="${href.results(name)}">See results</a><a class="btn" href="${href.verify(name)}">Check evidence</a><a class="btn" href="${href.lab(m.swarm ? 'swarm' : 'cut-in')}">Run your own test</a></div>`
  $('mc-vprov').textContent = $('mc-prov').textContent
}

// ---------- page ----------
function mount(root: HTMLElement) {
  root.innerHTML = html
  root.setAttribute('aria-labelledby', 'mc-title')
  const vid = $<HTMLVideoElement>('mc-video')
  vid.addEventListener('timeupdate', () => {
    if (!mc?.aligned) return
    const t = vid.currentTime; overlay(t); tele(t)
    const d = decAt(t), i = d ? mc.ds.indexOf(d) : -1 // highlight the decision in force at this moment
    $('mc-timeline').querySelectorAll<HTMLButtonElement>('[data-di]').forEach((b) => b.classList.toggle('on', Number(b.dataset.di) === i))
  })
  $('mc-timeline').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b) return
    if (b.dataset.plan != null) $('mc-plan').scrollIntoView({ block: 'center' }); else select(Number(b.dataset.di))
  })
  $('mc-worst').addEventListener('click', () => {
    if (!mc) return
    const t = worstT(); if (t == null) return
    const d = decAt(t)
    if (d) select(mc.ds.indexOf(d), t); else { overlay(t); tele(t) }
    announce(`Worst moment at ${num(t, 1)} s simulated time`)
  })
  $('mc-peek').addEventListener('click', () => {
    if (!mc?.live || mc.swarm) return
    const img = $<HTMLImageElement>('mc-live'), on = img.classList.contains('hidden')
    img.classList.toggle('hidden', !on); img.classList.add('peek')
    if (on) img.src = api(`/api/live/${encodeURIComponent(mc.id)}`); else img.removeAttribute('src')
    $('mc-peek').textContent = on ? 'Hide live preview' : 'Peek live (low frame rate)'
  })
  $('mc-reconnect').addEventListener('click', () => { if (mc) void connect(mc) })
  new ResizeObserver(() => tele()).observe($('mc-tele'))
}

function open(id: string | null) {
  leave()
  if (!id) return
  const live = isJob(id) || new URLSearchParams(location.search).has('live') // ?live=1: a paid run just launched from the Lab
  const me: Mc = mc = { id, run: null, ticks: [], ds: [], sel: -1, aligned: false, live, swarm: id.includes('swarm'), plan: null, state: 'Ready', done: false,
    paid: false, job: {}, queue: '', error: null, gone: false, lost: false, t0: performance.now() }
  cursorT = undefined
  $('mc-tabs').innerHTML = runTabs(id, 'mission')
  $('mc-title').innerHTML = live ? `${orb('breathing', 20, { dark: true })} Live test` : esc(runTitle(id, me.swarm))
  $('mc-kind').textContent = live ? 'Live run' : 'Recorded run'
  $('mc-insp').innerHTML = '<p class="kicker">Decision inspector</p><p class="muted">Select a checkpoint on the timeline to inspect it.</p>'
  $('mc-verdict').innerHTML = loading(live ? 'The verdict appears when the run ends.' : 'Loading the run…')
  $('mc-overlay').innerHTML = ''; $('mc-note').textContent = ''; $('mc-lost').classList.add('hidden')
  for (const k of ['mc-plan', 'mc-job', 'mc-gone', 'mc-novid', 'mc-live']) $(k).classList.add('hidden')
  const vid = $<HTMLVideoElement>('mc-video'), img = $<HTMLImageElement>('mc-live'), prog = $('mc-progress')
  vid.classList.toggle('hidden', live); prog.classList.toggle('hidden', !live); img.classList.remove('peek'); img.removeAttribute('src')
  vid.removeAttribute('src'); vid.load()
  $('mc-peek').classList.add('hidden'); $('mc-peek').textContent = 'Peek live (low frame rate)'; $('mc-worst').classList.toggle('hidden', live)
  // the live panel keeps one orb canvas and only changes its state, so it never flickers
  prog.innerHTML = `<div class="mc-orb-row">${orb('breathing', 64, { dark: true, label: 'Run status' })}<div><h3 id="mc-ph"></h3><p class="eta" id="mc-eta"></p></div></div><ol id="mc-rows" aria-label="Run progress"></ol>`
  paintStates(); prov(); timeline(); tele()
  if (live) { paintProg(); progT = window.setInterval(paintProg, 1000) }
  void connect(me)
}

function leave() {
  ctl?.abort(); ctl = null
  clearInterval(progT); progT = 0
  mc = null
  const vid = document.getElementById('mc-video') as HTMLVideoElement | null; vid?.pause()
  document.getElementById('mc-live')?.removeAttribute('src') // closes the MJPEG connection
}

export const page = { id: 'mission' as const, title: 'Mission Control', css, mount, open, leave }
