// Results (/results/:id), PRD §4.5: status and outcome first, then the measured numbers with provenance, the worst moment,
// and tabs for replay, driving metrics, reasoning, the controlled A/B comparison and the evidence.
import { href, type Page } from '../routes'
import { media, armClips, type Run, type Tick } from '../core/api'
import { esc, num, short, copyText, loading } from '../core/dom'
import { tabs, announce } from '../core/a11y'
import { loadRun, videoOf, runTitle, say, why, runTabs, isJob, type LoadedRun } from '../core/run'
import { trustFromRun, railHtml } from '../core/trust'


const CCS_HELP = 'Criticality score from 0 (calm) to 1 (near crash), computed from gap, closing speed and time to collision. It shows how tight the moment got, not the chance of a crash.'
// Fixed-script A/B: both policies replay the same recorded attack with no new 0G calls (recorded at 4 sites, same result at each).
const AB = [
  { name: 'PDM-Lite', score: 60.3, ccs: 0.909, ttc: 1.11, gap: 3.49 },
  { name: 'Cautious IDM', score: 60.7, ccs: 0.055, ttc: 3.12, gap: 3.20 },
]
const AB_SITES = 4

const minOf = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)); return v.length ? Math.min(...v) : null }
const maxOf = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)); return v.length ? Math.max(...v) : null }
const measured = (x: number | null | undefined, d: number, unit: string) => (typeof x === 'number' && Number.isFinite(x) ? `${num(x, d)}${unit ? ' ' + unit : ''}` : 'Not measured')
/** Policy is not a run field: paid runs and four-car runs are PDM-Lite only (backend facts); CARLA demo names end in `__<stack>`. */
const policyOf = (r: Run | null, name: string) => (r?.payment || r?.family === 'swarm' || name.includes('swarm') ? 'PDM-Lite' : name.match(/__([\w.-]+)$/)?.[1] ?? 'Not recorded')
/** The stream sends gt_in_path (agent-console TICK_FIELDS); null on runs recorded without ground truth. */
type GtTick = Tick & { gt_in_path?: boolean | null }
/** Most critical moment: the tick with the highest criticality score, else (no score recorded) the closest ground-truth gap. */
const criticalTick = (ticks: Tick[]): Tick | undefined => ticks.some((t) => t.ccs != null)
  ? ticks.reduce((m, t) => ((t.ccs ?? -1) > (m.ccs ?? -1) ? t : m))
  : ticks.reduce<Tick | undefined>((m, t) => (!m || t.gt_gap < m.gt_gap ? t : m), undefined)
/** Ground truth as faultline/episode.py ground_truth_metrics: only ticks where the adversary is in the ego's path; none when not recorded. */
const groundTruth = (ticks: Tick[]) => {
  const has = (ticks as GtTick[]).some((t) => t.gt_in_path != null), path = (ticks as GtTick[]).filter((t) => t.gt_in_path)
  return has ? { ttc: minOf(path.map((t) => t.gt_ttc_s)), gap: minOf(path.map((t) => Math.max(t.gt_gap, 0))) } : { ttc: null, gap: null }
}
const ATTACK: Record<string, string> = { swarm: 'Coordinated four-car attack', cut_in: 'Cut-in', lead_brake: 'Lead brake' }

const CHIP: Record<string, [string, string, string]> = {
  Completed: ['l', '✓', 'Completed'], Interrupted: ['p', '!', 'Interrupted'], 'Safe halt': ['y', '■', 'Safe halt'],
}
const chip = (s: string) => { const [c, i, t] = CHIP[s] ?? CHIP.Completed; return `<span class="pill ${c}"><span aria-hidden="true">${i}</span>${t}</span>` }

let root: HTMLElement
let ctl: AbortController | null = null

function shell(body: string) { root.innerHTML = `<div class="rs-wrap">${body}</div>` }

function render(id: string, d: LoadedRun) {
  const r = d.run, name = r?.name ?? id, live = d.live, ticks = d.ticks, ds = d.ds
  const swarm = d.swarm || r?.family === 'swarm' || name.includes('swarm') || !!d.plan
  const status = d.state === 'Safe halt' ? 'Safe halt' : d.interrupted ? 'Interrupted' : 'Completed'
  const noData = !ticks.length && !ds.length && r?.collision == null && r?.minGap == null
  const crashed = r?.collision ?? ticks.some((t) => t.collision)
  const outcome = noData ? 'No driving data in this run' : crashed ? 'Collision occurred in this test' : 'Avoided collision in this test'
  // ground truth from in-path ticks; the run record's top-level numbers (r.minTtc/minGap/ccs) come from the LiDAR tracker (ledger.py ccs_source)
  const gt = groundTruth(ticks), lsrc = ticks.length ? 'LiDAR tracker' : 'run metrics (LiDAR tracker)'
  const lidarTtc = ticks.length ? minOf(ticks.map((t) => t.ttc_s)) : r?.minTtc ?? null
  const lidarGap = ticks.length ? minOf(ticks.map((t) => t.lidar_gap)) : r?.minGap ?? null
  const ccs = ticks.length ? maxOf(ticks.map((t) => t.ccs)) : r?.ccs ?? null
  const minTtc = gt.ttc ?? lidarTtc, ttcSrc = gt.ttc != null ? 'ground truth' : lsrc
  const minGap = gt.gap ?? lidarGap, gapSrc = gt.gap != null ? 'ground truth' : lsrc
  const zg = r?.decisions0g ?? ds.filter((x) => x.source === '0g').length, total = r?.decisions ?? ds.length
  const world = r?.world === 'kinematic' ? 'kinematic' : 'CARLA'
  const root0g = r?.storage?.publicRoot ?? null, free = !!r?.free
  const suite = r?.payment?.suite ?? ATTACK[r?.family ?? ''] ?? (swarm ? ATTACK.swarm : 'Cut-in')
  const prov = [live ? 'Live' : 'Recorded', world, gt.gap != null ? 'gap and TTC from ground truth' : 'no ground-truth gap recorded', 'criticality from the LiDAR tracker', free ? 'free run, not paid, not anchored' : root0g ? 'stored on 0G Storage' : 'not stored'].join(' · ')

  const w = criticalTick(ticks) as GtTick | undefined
  const wd = w ? ds.filter((x) => x.sim_time_s <= w.t_s).at(-1) : undefined
  const vid = videoOf(name, r)
  const frame = w && vid?.aligned
    ? `<video class="rs-frame" controls muted playsinline preload="metadata" src="${esc(media(vid.path))}#t=${Math.max(0, w.t_s).toFixed(1)}" aria-label="Camera at the most critical moment, t ${num(w.t_s, 1)} s"></video>`
    : `<div class="rs-noframe">No time-aligned recording</div>`

  const tab = (k: string, label: string, on = false) => `<button role="tab" id="rs-t-${k}" aria-controls="rs-p-${k}" aria-selected="${on}" class="btn">${label}</button>`
  const panel = (k: string, html: string, on = false) => `<div role="tabpanel" id="rs-p-${k}" aria-labelledby="rs-t-${k}" tabindex="0" class="${on ? '' : 'hidden'}">${html}</div>`

  const metricRows: [string, string, string][] = [
    ['Collision', noData ? 'Not measured' : crashed ? 'Yes' : 'No', 'CARLA collision sensor'],
    ['Minimum time to collision', measured(gt.ttc, 2, 's'), 'ground truth, ticks with the attacker in the path'],
    ['Minimum time to collision (LiDAR)', measured(lidarTtc, 2, 's'), lsrc],
    ['Closest gap', measured(gt.gap, 2, 'm'), 'ground truth, ticks with the attacker in the path'],
    ['Closest gap (LiDAR)', measured(lidarGap, 2, 'm'), lsrc],
    ['Peak criticality score', measured(ccs, 3, ''), lsrc],
    ['Top speed of the car under test', measured(maxOf(ticks.map((t) => t.ego_v)), 1, 'm/s'), 'ground truth'],
    ['Hardest braking', measured(minOf(ticks.map((t) => t.ego_a)), 2, 'm/s²'), 'ground truth'],
    ['Test length', measured(ticks.at(-1)?.t_s, 1, 's'), 'sim time'],
    ['Driving score', 'Not measured', 'CARLA Leaderboard score is only computed in the A/B comparison'],
  ]

  const roles = d.plan ? Object.entries(d.plan.roles ?? {}).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('') : ''
  const reasoning = (d.plan ? `<div class="rs-plan"><p class="kicker">0G strategist · plan written before the first tick</p><h3>“${esc(d.plan.name)}”</h3><p>${esc(d.plan.summary)}</p>${roles ? `<ul>${roles}</ul>` : ''}</div>` : '') +
    (ds.length ? `<ol class="rs-dec">${ds.map((x) => `<li class="${x.source === '0g' ? '' : 'halt'}"><p class="rs-dh"><b>Checkpoint ${x.cp + 1} · ${num(x.sim_time_s, 1)} s</b> ${esc(swarm ? x.phase ?? x.action ?? 'SAFE_HALT' : say(x.action))}</p>
      ${why(x) ? `<p class="rs-why">“${esc(why(x))}”</p>` : x.source !== '0g' ? `<p class="rs-why">${esc(x.reason || 'No valid answer from 0G, so the attacker stopped safely.')}</p>` : ''}
      <p class="rs-meta">${x.source === '0g' ? `0G Router, private tier · ${esc(x.latency_ms)} ms · request <span class="mono">${short(x.request_id, 10, 6)}</span>` : 'Safe halt: no valid 0G answer'}</p></li>`).join('')}</ol>`
      : '<p>No decisions were recorded for this run.</p>')

  const compare = `<p class="kicker">Fixed-script comparison · controlled</p>
    <p>Both policies face the same recorded attack, replayed with no new 0G calls, so the only difference is the policy. Sample: ${AB_SITES} sites per policy, one recorded attack; the result was the same at every site.</p>
    <video class="rs-clip" controls muted playsinline preload="metadata" data-src="videos/arena-script-001__r4l2s24__side_by_side.mp4" aria-label="PDM-Lite and Cautious IDM side by side on the same recorded attack"></video>
    <div class="tscroll"><table class="rs-table"><caption class="sr">Fixed-script A/B result</caption><thead><tr><th scope="col">Policy</th><th scope="col">Driving score</th><th scope="col"><span title="${esc(CCS_HELP)}">Criticality score</span></th><th scope="col">Min TTC</th><th scope="col">Closest gap</th><th scope="col">Sites</th></tr></thead>
    <tbody>${AB.map((a) => `<tr><th scope="row">${a.name}</th><td class="mono">${num(a.score, 1)}</td><td class="mono">${num(a.ccs, 3)}</td><td class="mono">${num(a.ttc, 2)} s</td><td class="mono">${num(a.gap, 2)} m</td><td class="mono">${AB_SITES}</td></tr>`).join('')}</tbody></table></div>
    <p class="rs-prov">Recorded · CARLA · ground truth · driving score from the CARLA Leaderboard</p>
    <div class="rs-sep"><p class="kicker">Fresh 0G attacks · not controlled</p>
    <p>Every live run asks 0G for new moves, so two fresh runs face different attacks. This run is one fresh attack (sample of 1); compare fresh runs only as separate tests.</p>
    <a class="btn" href="${href.library()}">Explore recorded runs</a></div>`

  const sig = r?.storage?.signaturesVerified != null && r.storage.signatures0g ? `${r.storage.signaturesVerified} of ${r.storage.signatures0g} archived signatures checked by the runner` : null
  const evidence = `<p>A green dot means the data proves it.${sig ? ` ${esc(sig)}.` : ''}</p>
    <div class="rail">${railHtml(trustFromRun(r, ds, free))}</div>
    <div class="row rs-row"><a class="btn k" href="${href.verify(name)}">Open Proof Explorer</a>${root0g ? `<a class="btn" href="${href.verifier(root0g)}">Open in the independent verifier</a>` : ''}</div>`

  shell(`${runTabs(name, 'results')}
    <div class="card rs-top">
      <p class="kicker">${live ? 'Live run' : 'Recorded run'} · results</p>
      <h1 id="rs-title">${esc(runTitle(name, swarm))}</h1>
      <div class="rs-outcome">${chip(status)}<h2>${esc(outcome)}</h2>${status === 'Safe halt' ? '<span class="pill p sm"><span aria-hidden="true">!</span>Interrupted</span>' : ''}</div>
      ${d.interrupted ? `<p class="rs-reason">${esc(d.reason ?? 'The run did not complete.')} The numbers cover only the part that ran.</p>` : ''}
      <div class="rs-stats">
        <div><b>${measured(minTtc, 2, 's')}</b><span>minimum time to collision · ${ttcSrc}</span></div>
        <div><b>${measured(minGap, 2, 'm')}</b><span>closest gap · ${gapSrc}${gt.gap != null && lidarGap != null ? ` (LiDAR ${num(lidarGap, 2)} m)` : ''}</span></div>
        <div><b>${measured(ccs, 2, '')}</b><span>peak criticality score, 0 to 1 · ${lsrc}</span></div>
        <div><b>${esc(zg ?? 0)} of ${esc(total ?? 0)}</b><span>decisions from 0G (completeness)</span></div>
      </div>
      <p class="rs-help">${esc(CCS_HELP)}</p>
      <dl class="rs-kv"><dt>Policy</dt><dd>${esc(policyOf(r, name))}</dd><dt>Suite</dt><dd>${esc(suite)}</dd><dt>World</dt><dd>${world}</dd></dl>
      <p class="rs-prov">${esc(prov)}</p>
      <div class="row rs-row"><a class="btn k" href="${href.mission(name)}">Open in Mission Control</a><a class="btn" href="${href.verify(name)}">Check the evidence</a>
        <button class="btn" id="rs-copy" type="button">Copy result link</button>${root0g ? `<a class="btn" href="${href.verifier(root0g)}">Open in the independent verifier</a>` : ''}</div>
    </div>
    <div class="card rs-worst"><h2>Most critical moment</h2>
      ${w ? `<p>${w.ccs != null
        ? `Peak criticality ${num(w.ccs, 2)} at t ${num(w.t_s, 1)} s: LiDAR gap ${measured(w.lidar_gap, 2, 'm')}, LiDAR time to collision ${w.ttc_s == null ? 'no closing' : num(w.ttc_s, 2) + ' s'}${w.gt_in_path ? `; ground truth gap ${num(w.gt_gap, 2)} m, time to collision ${w.gt_ttc_s == null ? 'no closing' : num(w.gt_ttc_s, 2) + ' s'}` : ''}`
        : `Closest approach at t ${num(w.t_s, 1)} s: ground truth gap ${num(w.gt_gap, 2)} m, no criticality score recorded`}${wd ? `, during “${esc(swarm ? wd.phase ?? wd.action ?? 'SAFE_HALT' : say(wd.action))}”` : ''}.</p>` : '<p>No telemetry was recorded, so there is no critical moment to show.</p>'}
      ${frame}
      <p class="rs-prov">${vid?.aligned ? 'Camera time-aligned with the telemetry' : esc(vid?.note ?? 'Telemetry only')} · the tick with the highest criticality score</p>
    </div>
    <div class="card rs-tabs">
      <div role="tablist" aria-label="Result details" class="rs-tl">${tab('replay', 'Replay', true)}${tab('metrics', 'Driving metrics')}${tab('reasoning', 'Reasoning')}${tab('compare', 'Compare')}${tab('evidence', 'Evidence')}</div>
      ${panel('replay', `<p>Watch the run with every 0G decision on a timeline, the telemetry chart and the decision inspector.</p><a class="btn k" href="${href.mission(name)}">Replay with decision timeline</a>`, true)}
      ${panel('metrics', `<div class="tscroll"><table class="rs-table"><caption class="sr">Driving metrics</caption><thead><tr><th scope="col">Metric</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody>${metricRows.map(([k, v, s]) => `<tr><th scope="row">${esc(k)}</th><td class="mono">${esc(v)}</td><td>${esc(s)}</td></tr>`).join('')}</tbody></table></div>`)}
      ${panel('reasoning', reasoning)}
      ${panel('compare', compare)}
      ${panel('evidence', evidence)}
    </div>`)

  tabs(root.querySelector<HTMLElement>('[role=tablist]')!)
  armClips(root.querySelector('#rs-p-compare')!) // shortcut: arms the clip at render (preload=none), not on first tab show
  const copy = root.querySelector<HTMLButtonElement>('#rs-copy')!
  copy.addEventListener('click', () => copyText(location.origin + href.results(name), copy, 'Link copied'))
  announce(`Results loaded: ${outcome}`)
}

async function open(id: string | null) {
  ctl?.abort(); const c = ctl = new AbortController()
  if (!id) { shell(`<div class="card"><h1 id="rs-title">No run selected</h1><p>Pick a run to see its results.</p><a class="btn k" href="${href.library()}">Explore runs</a></div>`); return }
  const live = isJob(id)
  shell(`<div class="card"><h1 id="rs-title">${esc(runTitle(id))}</h1>${loading(live ? 'Waiting for the run to finish' : 'Loading the result', live ? 'working' : 'breathing')}
    ${live ? `<p><a class="btn" href="${href.mission(id)}">Watch it in Mission Control</a></p>` : ''}</div>`)
  const d = await loadRun(id, undefined, c.signal)
  if (c.signal.aborted) return
  if (d.notFound) {
    shell(`<div class="card"><h1 id="rs-title">Run not found</h1><p>${esc(d.note || (live ? 'This live job is no longer on the runner.' : 'No recorded run has this name.'))}</p><a class="btn k" href="${href.library()}">Explore runs</a></div>`)
    return
  }
  if (!d.run && !d.ticks.length && !d.ds.length) {
    // stream or network error, not a missing run: keep the run's tabs and offer the pages that work without the runner
    shell(`${runTabs(id, 'results')}<div class="card"><h1 id="rs-title">${esc(runTitle(id))}</h1><p class="pill p sm"><span aria-hidden="true">!</span>Runner offline</p>
      <p>The local runner is offline, so this run's results cannot load right now.</p>
      <div class="row rs-row"><a class="btn k" href="${href.verify(id)}">Check the evidence</a><a class="btn" href="${href.mission(id)}">Open in Mission Control</a><a class="btn" href="${href.verifier()}">Open the independent verifier</a></div>
      ${d.note ? `<p class="rs-prov">${esc(d.note)}</p>` : ''}</div>`)
    announce('Results unavailable: the local runner is offline')
    return
  }
  // a finished live job becomes its run name so the link survives a console restart
  if (live && d.run?.name && location.pathname === href.results(id)) history.replaceState(null, '', href.results(d.run.name))
  render(id, d)
}

const css = `
#v-results .rs-wrap { display: flex; flex-direction: column; gap: 16px; max-width: 1280px; margin: 0 auto }
#v-results .runtabs { display: flex; gap: 8px; flex-wrap: wrap }
#v-results .runtabs a { min-height: 44px; display: inline-flex; align-items: center; padding: 0 18px; border-radius: 999px; border: 1.5px solid #fbfbf655; color: var(--paper); text-decoration: none; font-weight: 600 }
#v-results .runtabs a.on { background: var(--paper); color: var(--ink) }
#v-results h1 { font-size: clamp(26px, 4vw, 40px); line-height: 1.1; margin: 4px 0 14px; overflow-wrap: anywhere }
#v-results .rs-outcome { display: flex; flex-wrap: wrap; align-items: center; gap: 10px }
#v-results .rs-outcome h2 { margin: 0; font-size: clamp(20px, 3vw, 28px) }
#v-results .rs-reason { margin: 10px 0 0 }
#v-results .rs-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 18px }
#v-results .rs-stats div { border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; background: var(--paper) }
#v-results .rs-stats b { font-size: 22px; font-variant-numeric: tabular-nums }
#v-results .rs-stats span, #v-results .rs-help, #v-results .rs-prov, #v-results .rs-meta { font-size: 14px; color: var(--muted) }
#v-results .rs-help { margin: 10px 0 0 }
#v-results .rs-kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 14px 0 0 }
#v-results .rs-kv dt { color: var(--muted) } #v-results .rs-kv dd { margin: 0; overflow-wrap: anywhere }
#v-results .rs-prov { margin: 12px 0 0 }
#v-results .rs-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px }
#v-results .btn { min-height: 44px }
#v-results .rs-worst h2, #v-results .rs-plan h3 { margin: 0 0 8px }
#v-results .rs-frame, #v-results .rs-clip { width: 100%; aspect-ratio: 16 / 9; border-radius: 16px; border: 1px solid var(--line); background: var(--ink); display: block; margin-top: 8px }
#v-results .rs-noframe { display: grid; place-items: center; min-height: 120px; border-radius: 16px; border: 1.5px dashed var(--line); color: var(--muted); margin-top: 8px; padding: 16px; text-align: center }
#v-results .rs-tl { display: flex; gap: 8px; overflow-x: auto; padding: 4px; margin: -4px -4px 14px }
#v-results .rs-tl [role=tab] { flex: 0 0 auto; transition: background .2s var(--ease, ease), color .2s var(--ease, ease) }
#v-results .rs-tl [aria-selected=true] { background: var(--ink); color: var(--paper) }
#v-results [role=tabpanel] > p:first-child { margin-top: 0 }
#v-results .rs-table { width: 100%; border-collapse: collapse; font-size: 15px }
#v-results .rs-table th, #v-results .rs-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #0002; vertical-align: top }
#v-results .rs-table thead th { font-size: 14px; color: var(--muted); font-weight: 500 }
#v-results .tscroll { overflow-x: auto }
#v-results .rs-dec { list-style: none; padding: 0; margin: 14px 0 0; display: flex; flex-direction: column; gap: 10px }
#v-results .rs-dec li { border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px }
#v-results .rs-dec li.halt { background: #fff3c4 }
#v-results .rs-dec p { margin: 0 } #v-results .rs-why { margin: 6px 0 !important; font-style: italic } #v-results .rs-meta { overflow-wrap: anywhere }
#v-results .rs-plan { border: 1.5px solid var(--line); border-radius: 18px; padding: 14px; background: var(--cyan) }
#v-results .rs-plan ul { margin: 8px 0 0; padding-left: 20px }
#v-results .rs-sep { margin-top: 20px; padding-top: 16px; border-top: 1.5px dashed var(--line) }
@media (max-width: 760px) { #v-results .rs-stats { grid-template-columns: 1fr 1fr } #v-results .rs-stats b { font-size: 19px } }
@media (prefers-reduced-motion: reduce) { #v-results .rs-tl [role=tab] { transition: none } }
`

export const page = {
  id: 'results' as Page,
  title: 'Results',
  css,
  mount(r: HTMLElement) { root = r; root.setAttribute('aria-labelledby', 'rs-title') },
  open(id: string | null, _search: URLSearchParams) { void open(id) },
  leave() { ctl?.abort(); ctl = null },
}
