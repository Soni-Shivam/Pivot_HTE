// Explore runs (PRD 4.7): featured runs, filterable recorded-run table from /api/runs, and the A/B policy comparison.
import { getJson, postJson, media, type Run } from '../core/api'
import { $, esc, num, short, loading, sleep } from '../core/dom'
import { announce } from '../core/a11y'
import { orb } from '../orb'
import { href, FEATURED, SWARM, LEAD_BRAKE, type Page } from '../routes'

const TIP = {
  ttc: 'Time to collision: seconds until the cars touch if nobody changes speed. Under 1.5 s is dangerous.',
  ccs: 'Criticality score from 0 (calm) to 1 (near-crash), computed from gap, closing speed and time to collision. Not a crash probability.',
}
const th = (label: string, tip?: string) => `<th scope="col">${tip ? `<span class="tip" tabindex="0" data-tip="${esc(tip)}" title="${esc(tip)}">${label}</span>` : label}</th>`
const risk = (c: number | null | undefined) => (c == null ? '' : c >= 0.75 ? 'p' : c >= 0.5 ? 'y' : 'l')
const ttc = (s: number | null | undefined) => (s == null ? 'Not measured' : `${num(s, 2)} s`)
const crit = (c: number | null | undefined) => (c == null ? 'Not measured' : `<span class="pill sm ${risk(c)}">${num(c, 2)}</span>`)

// ---------- labels for each filter, derived from the /api/runs summary (packages/hedera/src/agent-console.ts runSummary) ----------
const FAMILY: Record<string, string> = { swarm: 'Four-car', swarm_box: 'Four-car', lead_brake: 'Lead brake', cut_in: 'Cut-in' }
// demo-001..003 are lead_brake in their scenario.json; the summary only lacks family for older runs
const attackOf = (r: Run) => FAMILY[r.family ?? ''] ?? (/^demo-00\d$/.test(r.name) ? 'Lead brake' : r.name.includes('swarm') ? 'Four-car' : 'Cut-in')
const worldOf = (r: Run) => (r.world?.startsWith('kinematic') ? 'Kinematic' : r.world?.startsWith('carla') ? 'CARLA' : 'Not recorded')
// shortcut: the summary has no policy field, so this reads manifest.ego facts encoded in run names; switch to a summary field when the console adds one
const policyOf = (r: Run) => /__pdm_lite$|^paid-|^cutin-00|^swarm-carla-/.test(r.name) ? 'PDM-Lite' : /__idm_lidar$/.test(r.name) ? 'Cautious IDM' : r.name === LEAD_BRAKE ? 'IDM' : 'Not recorded'
const statusOf = (r: Run) => (r.status === 'interrupted' ? 'Interrupted' : r.status === 'completed' ? 'Completed' : 'Running')
const evidenceOf = (r: Run) => (r.payment ? 'Paid and anchored' : r.chain || r.storage ? 'Anchored on 0G' : 'Not paid, not anchored')
const FILTERS: { key: string, label: string, of: (r: Run) => string, options: string[] }[] = [
  { key: 'attack', label: 'Attack', of: attackOf, options: ['Cut-in', 'Four-car', 'Lead brake'] },
  { key: 'world', label: 'World', of: worldOf, options: ['CARLA', 'Kinematic'] },
  { key: 'policy', label: 'Policy', of: policyOf, options: ['PDM-Lite', 'Cautious IDM', 'IDM', 'Not recorded'] },
  { key: 'status', label: 'Status', of: statusOf, options: ['Completed', 'Interrupted'] },
  { key: 'evidence', label: 'Evidence level', of: evidenceOf, options: ['Paid and anchored', 'Anchored on 0G', 'Not paid, not anchored'] },
]
// presentable runs only: paid, demo, swarm and featured runs that finished; no debug, replay, stale or empty rows (0f00ef3 allowlist)
const presentable = (r: Run) => /^(paid-|demo-free-|demo-00[1-3]$|cutin-00[12]$|swarm-carla-0(08|10)$)/.test(r.name) && r.decisions != null && r.ccs != null && !r.name.includes('replay')
  && !(r.status === 'running' && Date.now() - (r.mtime ?? 0) > 10 * 60_000)

// ---------- featured runs (recorded numbers from runs/<name>/metrics.json and manifest.json; they play with the console offline) ----------
const FEATURED_CARDS = [
  { id: FEATURED, kicker: 'Cut-in · paid and anchored', title: 'Paid test 002', img: '/stills/paid.jpg', alt: 'Chase camera of paid test 002', cls: 'c',
    outcome: 'Avoided collision in this test', interrupted: true, stats: [['Tightest TTC', '1.03 s'], ['Criticality', '0.93'], ['Moves from 0G', '7 of 8']],
    prov: 'Recorded · CARLA · run metrics · on-chain link',
    line: 'Our agent paid 0.001 HBAR on Hedera, the setup was locked on 0G Galileo before the first decision, and the evidence is on 0G Storage.' },
  { id: SWARM, kicker: 'Coordinated four-car attack · free run', title: 'swarm-carla-010', img: '/stills/box.jpg', alt: 'Drone view of four attacker cars around the car under test', cls: '',
    outcome: 'Avoided collision in this test', interrupted: false, stats: [['Tightest TTC', '1.13 s'], ['Criticality', '1.00'], ['Moves from 0G', '10 of 10']],
    prov: 'Recorded · CARLA · ground truth · not paid, not anchored',
    line: 'The 0G strategist planned a staggered cut-in, then steered four cars for 10 checkpoints against PDM-Lite.' },
  { id: LEAD_BRAKE, kicker: 'Lead vehicle brakes · anchored on 0G', title: 'Lead brake demo-003', img: '', alt: '', cls: 'l',
    outcome: 'Avoided collision in this test', interrupted: false, stats: [['Tightest TTC', '0.50 s'], ['Closest gap', '1.53 m'], ['Moves from 0G', '8 of 8']],
    prov: 'Recorded · CARLA · run metrics · on-chain link',
    line: 'The car ahead brakes hard at moments the 0G attacker picks. The IDM follower kept 1.53 m at the closest point.' },
]
const featuredCard = (f: typeof FEATURED_CARDS[number]) => `<article class="card ${f.cls}">
  ${f.img ? `<img src="${f.img}" alt="${esc(f.alt)}" loading="lazy" width="960" height="540">`
    : `<div class="lib-stat" aria-hidden="true"><b>${esc(f.stats[0][1])}</b><span>${esc(f.stats[0][0])}</span></div>`}
  <p class="kicker">${esc(f.kicker)}</p><h3>${esc(f.title)}</h3>
  <p class="lib-out"><span class="pill sm k">✓ ${esc(f.outcome)}</span>${f.interrupted ? '<span class="pill sm y">⏸ Interrupted · safe halt</span>' : ''}</p>
  <p>${esc(f.line)}</p>
  <dl class="lib-kv">${f.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  <p class="lib-prov">${esc(f.prov)}</p>
  <div class="row"><a class="btn k" href="${href.mission(f.id)}">Open run</a><a class="btn" href="${href.results(f.id)}">Results</a><a class="btn" href="${href.verify(f.id)}">Evidence</a></div>
</article>`

// ---------- A/B arena (recorded: runs/arena-script-001/compare.json, fixed script replayed from cutin-002, site r4l2s24; video and poster are the same site) ----------
const AB_VIDEO = 'runs/arena-script-001/r4l2s24__side_by_side.mp4'
type ArenaRow = { policy: string, name?: string, drivingScore: number | null, ccs: number | null, minTtc: number | null, minGap?: number | null, collision: boolean | null }
const ARENA_RECORDED: ArenaRow[] = [
  { policy: 'pdm-lite', name: 'PDM-Lite', drivingScore: 60.3, ccs: 0.909, minTtc: 1.11, minGap: 3.49, collision: false },
  { policy: 'idm-cautious', name: 'Cautious IDM', drivingScore: 60.7, ccs: 0.055, minTtc: 3.12, minGap: 3.20, collision: false },
]
const arenaTable = (rows: ArenaRow[]) => `<table><thead><tr>${th('Policy')}${th('Driving score', 'CARLA Leaderboard score: route progress minus penalties (higher is better).')}${th('Criticality', TIP.ccs)}${th('Tightest TTC', TIP.ttc)}${th('Closest gap')}${th('Outcome')}</tr></thead><tbody>${rows.map((r) =>
  `<tr><td>${esc(r.name ?? r.policy)}</td><td class="mono">${r.drivingScore == null ? 'Not measured' : num(r.drivingScore, 1)}</td><td>${crit(r.ccs)}</td>
   <td class="mono">${ttc(r.minTtc)}</td><td class="mono">${r.minGap == null ? 'Not measured' : `${num(r.minGap, 2)} m`}</td>
   <td>${r.collision ? 'Collision occurred' : r.collision === false ? 'Avoided collision' : 'Not measured'}</td></tr>`).join('')}</tbody></table>`

let allRuns: Run[] = [], offline = false, loaded = false, ctl: AbortController | null = null

function renderTable() {
  const el = $('lib-runs')
  if (!loaded) { el.innerHTML = `<tr><td colspan="8">${loading('Loading runs…')}</td></tr>`; return }
  const sel = Object.fromEntries(FILTERS.map((f) => [f.key, $<HTMLSelectElement>(`lib-f-${f.key}`).value]))
  const rows = allRuns.filter(presentable).filter((r) => FILTERS.every((f) => !sel[f.key] || f.of(r) === sel[f.key])).slice(0, 30)
  const filtered = Object.values(sel).some(Boolean)
  $('lib-count').textContent = offline ? '' : `${rows.length} run${rows.length === 1 ? '' : 's'}`
  el.innerHTML = rows.map((r) => `<tr><td class="lr-run"><a href="${href.mission(r.name)}"><code>${short(r.name, 14, 4)}</code></a>${r.status === 'interrupted' ? ' <span class="pill sm y">⏸ Interrupted</span>' : ''}</td>
    <td class="lr-m">${esc(attackOf(r))}<br><small class="lr-w">${esc(worldOf(r))}</small></td><td class="lr-m">${esc(policyOf(r))}</td><td class="lr-m">${esc(evidenceOf(r))}</td>
    <td class="mono lr-m lr-n" data-l="0G moves">${r.decisions0g == null ? 'Not measured' : `${esc(r.decisions0g)} of ${esc(r.decisions)}`}</td><td class="lr-m lr-n" data-l="Criticality">${crit(r.ccs)}</td><td class="mono lr-m lr-n" data-l="TTC">${ttc(r.minTtc)}</td>
    <td class="lr-act"><a class="pill sm k lib-replay" href="${href.mission(r.name)}" aria-label="Replay ${esc(r.name)}">Replay</a></td></tr>`).join('')
    || `<tr><td colspan="8">${offline ? 'The live runner is offline; featured runs above still play.'
      : filtered ? 'No recorded runs match. <button class="btn lib-reset" type="button">Reset filters</button>' : 'No recorded runs match.'}</td></tr>`
}

async function loadRuns() {
  try { allRuns = await getJson('/api/runs'); offline = false } catch { offline = !allRuns.length }
  loaded = true; renderTable()
}

async function runArena() {
  const btn = $<HTMLButtonElement>('lib-ab-run'), st = $('lib-ab-status'), err = $('lib-ab-err')
  if (btn.disabled) return
  btn.disabled = true; err.textContent = ''
  ctl?.abort(); const c = ctl = new AbortController()
  st.innerHTML = `${orb('connecting', 20)} Asking the runner`
  try {
    const r = await postJson('/api/arena', { policies: ['pdm-lite', 'idm-cautious'], mode: 'script' })
    announce('Comparison queued')
    let j: any
    for (;;) {
      if (c.signal.aborted) return
      try { j = await getJson(`/api/jobs/${encodeURIComponent(r.jobId)}`) } catch (e) {
        if (/HTTP 404/.test((e as Error).message)) throw new Error('This live job is no longer on the runner')
        throw e
      }
      if (c.signal.aborted) return
      st.innerHTML = `${orb('working', 20)} ${j.status === 'queued' ? `#${esc(j.queuePos + 1)} in line${j.etaS != null ? ` · about ${Math.round(j.etaS)} s` : ''}` : 'CARLA is running both policies'}`
      if (j.status === 'done' || j.status === 'error') break
      await sleep(1500)
    }
    const rows: ArenaRow[] = j.results ?? []
    if (j.status === 'error' || !rows.length) throw new Error(j.error ?? 'The comparison returned no results')
    $('lib-ab-table').innerHTML = arenaTable(rows)
    if (j.video) { const v = $<HTMLVideoElement>('lib-ab-vid'); v.removeAttribute('poster'); v.preload = 'metadata'; v.src = media(j.video) }
    $('lib-ab-prov').textContent = 'Live · CARLA · ground truth · checked by local runner · replayed attack, no new 0G calls'
    st.textContent = 'Live result'; announce('Live comparison finished')
  } catch (e) {
    if (c.signal.aborted) return
    st.textContent = 'Recorded result shown'
    err.textContent = (e as Error).message + (offline || /fetch|network/i.test((e as Error).message) ? '. The live runner is offline, so the recorded result is shown.' : '')
  } finally { if (!c.signal.aborted) btn.disabled = false }
}

export const page = {
  id: 'library' as Page,
  title: 'Explore runs',
  css: `
#v-library .lib-featured { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px }
#v-library .lib-featured .card { display: flex; flex-direction: column; gap: 10px; min-width: 0 }
#v-library .lib-featured h3 { font-size: 22px; margin: 0; overflow-wrap: anywhere }
#v-library .lib-featured p { margin: 0 }
#v-library .lib-featured img, #v-library .lib-stat { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 16px; border: 1px solid var(--line, #111) }
#v-library .lib-stat { display: flex; flex-direction: column; justify-content: center; align-items: center; background: var(--ink, #111); color: var(--paper, #fbfbf6) }
#v-library .lib-stat b { font: 600 48px var(--mono, monospace) } #v-library .lib-stat span { font: 14px var(--mono, monospace); opacity: .8 }
#v-library .lib-out { display: flex; gap: 6px; flex-wrap: wrap }
#v-library .lib-kv { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0 }
#v-library .lib-kv dt { font: 12px var(--mono, monospace); color: var(--muted, #6b6b66) } #v-library .lib-kv dd { margin: 0; font: 600 16px var(--mono, monospace) }
#v-library .explore-nav .pill { color: var(--ink, #111); min-height: 44px }
#v-library .lib-prov { font: 13px var(--mono, monospace); color: var(--muted, #6b6b66) }
#v-library .lib-featured .row { margin-top: auto }
#v-library .lib-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 14px }
#v-library .lib-filters label { display: flex; flex-direction: column; gap: 4px; font: 13px var(--mono, monospace); color: var(--muted, #6b6b66) }
#v-library .lib-filters select { min-height: 44px; padding: 0 12px; border-radius: 12px; border: 1.5px solid var(--line, #111); background: var(--paper, #fbfbf6); font: 15px inherit; color: var(--ink, #111) }
#v-library table td small { color: var(--muted, #6b6b66) }
#v-library .lib-replay { min-height: 44px; padding: 0 16px }
#v-library .lib-reset { margin-left: 8px; min-height: 44px }
#v-library #lib-ab-vid { width: 100%; aspect-ratio: 32 / 9; object-fit: cover; background: #000; border-radius: 16px; display: block; margin-top: 14px }
#v-library .lib-ab-status { display: inline-flex; align-items: center; gap: 8px }
@media (max-width: 1100px) { #v-library .lib-featured { grid-template-columns: 1fr 1fr } }
@media (max-width: 720px) { #v-library .lib-featured { grid-template-columns: 1fr } }
@media (max-width: 640px) {
  #v-library .lib-filters { display: grid; grid-template-columns: 1fr 1fr } #v-library .lib-filters select { width: 100% }
  #v-library .lib-filters .lib-reset { margin-left: 0 }
  #v-library #x-runs table, #v-library #x-runs tbody { display: block } #v-library #x-runs thead { display: none }
  #v-library #x-runs tr { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 12px 0; border-bottom: 1px solid #11111120 }
  #v-library #x-runs td { display: block; padding: 0; border: 0 } #v-library #x-runs td[colspan] { flex: 1 1 100% }
  #v-library #x-runs .lr-run { flex: 1 1 calc(100% - 140px); min-width: 0; overflow-wrap: anywhere } #v-library #x-runs .lr-act { order: 1 }
  #v-library #x-runs .lr-m { order: 2; font-size: 13px; color: var(--muted, #6b6b66) } #v-library #x-runs .lr-m br { display: none }
  #v-library #x-runs .lr-n { order: 3 } #v-library #x-runs .lr-w::before { content: '\\00a0· ' } #v-library #x-runs .lr-n::before { content: attr(data-l) ' ' }
}
`,
  mount(root: HTMLElement) {
    root.setAttribute('aria-labelledby', 'lib-title')
    root.innerHTML = `<div class="grid">
  <div class="card k"><p class="kicker">Explore runs</p><h1 class="sec" id="lib-title" style="color:var(--paper)">Every recorded test, decision by decision</h1>
    <p class="lede">Open any run to replay it with its 0G decisions, telemetry and evidence. Free, no wallet needed.</p>
    <nav class="explore-nav" aria-label="On this page" style="margin-top:14px"><a class="pill" href="${href.library('x-featured')}">Featured runs</a><a class="pill" href="${href.library('x-runs')}">All runs</a><a class="pill" href="${href.library('x-ab')}">A/B policy comparison</a></nav></div>
  <section class="lib-featured" id="x-featured" aria-label="Featured runs">${FEATURED_CARDS.map(featuredCard).join('')}</section>
  <section class="card" id="x-runs" aria-labelledby="lib-runs-h"><div class="head"><h2 id="lib-runs-h">All recorded runs</h2><span class="pill sm" id="lib-count" aria-live="polite"></span></div>
    <div class="lib-filters" id="lib-filters" role="group" aria-label="Filter runs">${FILTERS.map((f) => `<label>${esc(f.label)}<select id="lib-f-${f.key}"><option value="">All</option>${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>`).join('')}
      <button class="btn lib-reset" type="button">Reset filters</button></div>
    <div class="tscroll"><table><thead><tr>${th('Run')}${th('Attack')}${th('Policy')}${th('Evidence')}${th('Moves from 0G')}${th('Criticality', TIP.ccs)}${th('Tightest TTC', TIP.ttc)}<th scope="col"><span class="sr">Replay</span></th></tr></thead><tbody id="lib-runs"></tbody></table></div>
    <p class="lib-prov">Recorded · CARLA or kinematic · run metrics · from the local runner</p></section>
  <section class="card y" id="x-ab" aria-labelledby="lib-ab-h"><div class="head"><h2 id="lib-ab-h">A/B policy comparison</h2></div>
    <p class="lede" style="margin-top:-6px">Both policies face the same recorded attack, replayed with no new 0G calls, so the only difference is the policy. Recorded at 4 sites; the result was the same at all of them. Shown: site r4l2s24.</p>
    <video id="lib-ab-vid" controls muted playsinline preload="none" poster="/stills/ab.jpg" src="${media(AB_VIDEO)}" aria-label="PDM-Lite and Cautious IDM side by side, site r4l2s24"></video>
    <div class="tscroll" id="lib-ab-table" style="margin-top:12px">${arenaTable(ARENA_RECORDED)}</div>
    <p style="margin:10px 0 0">The cautious model keeps about 3 s to collision; PDM-Lite drops to about 1 s.</p>
    <p class="lib-prov" id="lib-ab-prov">Recorded · CARLA · ground truth · replayed attack, no new 0G calls · site r4l2s24</p>
    <div class="row" style="margin-top:14px"><button class="btn k" type="button" id="lib-ab-run">Run the comparison live (free)</button><span class="pill sm lib-ab-status" id="lib-ab-status" aria-live="polite">Recorded result shown</span></div>
    <p class="err" id="lib-ab-err" role="alert"></p></section>
</div>`
    const reset = () => { FILTERS.forEach((f) => { $<HTMLSelectElement>(`lib-f-${f.key}`).value = '' }); renderTable() }
    root.addEventListener('change', (e) => { if ((e.target as HTMLElement).closest('#lib-filters')) renderTable() })
    root.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.lib-reset')) reset() })
    $('lib-ab-run').addEventListener('click', runArena)
    // the clip is served by the local runner only (not in the CDN set); say so instead of a dead player
    $<HTMLVideoElement>('lib-ab-vid').addEventListener('error', () => { $('lib-ab-err').textContent = 'The clip plays when the local runner is online. The still and the table are from the same recorded run.' })
    renderTable()
  },
  open(_id: string | null, _search: URLSearchParams) {
    renderTable()
    loadRuns()
  },
  leave() { ctl?.abort(); ctl = null; const b = document.getElementById('lib-ab-run') as HTMLButtonElement | null; if (b) b.disabled = false; const s = document.getElementById('lib-ab-status'); if (s && s.querySelector('canvas')) s.textContent = 'Recorded result shown' },
}
