// Research: measured boundary hunt and benchmarks, then the model's claims audited against them, then the counterfactual.
// Numbers come from docs/evidence/faultline-hunt.md and docs/evidence/faultline-research.md (runs of 2026-11-07).
import { href, FEATURED, type Page } from '../routes'
import { esc, num, short, loading, C, canvas2d } from '../core/dom'
import { media } from '../core/api'

type Exp = { n: number, delay: number, gap: number, safe: boolean, rid: string, why: string }
type Hunt = { truth: [number, number][], experiments: Exp[] }

const CLAIMS: { claim: string, who: string, src: string, ok: boolean, check: string }[] = [
  { claim: 'The crash was caused by friction-limited braking.', who: '0G agent, final report', src: 'research-mission-001', ok: false, check: 'In run 21 the car peaked at 5.76 m/s² against a friction limit of 6.28 m/s². It never used the available grip. The measured mechanism is a delayed, under-braking IDM controller.' },
  { claim: 'Runs are safe above about 30 m.', who: '0G + tools, run 003 report', src: 'research-bench-g1-003', ok: false, check: 'Runs 4 and 10 were unsafe above 30 m, so the audit marks the claim contradicted.' },
  { claim: 'At 1.5 s reaction delay the boundary is 61.0 m.', who: 'Old 0G designer, final report', src: 'hunt-bench-002', ok: false, check: 'Unsafe outcomes at gaps 61.0 m and 65.0 m are at or above the claimed boundary. The ground-truth boundary is 73.63 m.' },
  { claim: 'Reducing delay from 0.6 s to 0.4 s fixes the case.', who: '0G + tools, open benchmark', src: 'research-bench-g2', ok: false, check: 'The model read a counterfactual change (+0.2 s) as an absolute value. The audit flagged the claim as contradicted.' },
  { claim: 'At 0.3 s reaction delay the boundary is about 29.19 m.', who: 'Old 0G designer, final report', src: 'hunt-bench-002', ok: true, check: 'The ground-truth boundary at 0.3 s is 29.10 m, so the claim is supported.' },
]
const chip = (ok: boolean) => ok ? '<span class="rs-chip ok">✓ Supported</span>' : '<span class="rs-chip bad">✕ Contradicted</span>'
const prov = (t: string) => `<p class="rs-prov">${t}</p>`
const CLIPS: [string, string, string, string][] = [
  ['videos/research-mission-001__carla-failure.mp4', 'Failing case', 'Collision, minimum gap −0.008 m', 'CARLA: the smallest failing case, ending in a collision'],
  ['videos/research-mission-001__carla-fix-baseline.mp4', 'Grid-searched fix', 'No crash, minimum gap 4.74 m', 'CARLA: the same case with the grid-searched fix, no crash'],
]

const html = () => `<div class="grid">
  <div class="card k"><p class="kicker">Research</p><h1 class="sec" id="h-research" style="color:var(--paper)">What the agent found, and where it lost</h1>
    <p class="lede">0G plans experiments and states hypotheses. Classical tools do the search. Every claim the model makes is checked against the measured runs, and where bisection or random search won, we say so.</p>
    <div class="row" style="margin-top:14px"><a class="btn y" href="${href.results(FEATURED)}">Open featured result</a><a class="btn" href="${href.library()}">All recorded tests</a></div></div>

  <div class="card" id="hunt-card">
    <span class="rs-tag m">Measured experiment</span>
    <h2 class="sec">Finding the boundary</h2>
    <p class="lede rs-lede">Where does a car-following controller go from no crash to crash as its reaction delay grows? Each dot is one experiment the old 0G designer chose. The dashed line is the true boundary.</p>
    <dl class="rs-facts"><dt>Samples</dt><dd>24 experiments, one run, one seed</dd><dt>Method</dt><dd>Old 0G designer, budget 24, 25 model calls</dd><dt>True boundary</dt><dd>Bisection to 0.25 m or better at 25 delays</dd><dt>Outcome rule</dt><dd>No crash means no collision and a gap of at least 2 m</dd></dl>
    <div id="hunt-body">${loading('Loading the boundary hunt')}</div>
    ${prov('Recorded · kinematic runner · ground truth · runs/hunt-bench-002')}
  </div>

  <div class="card">
    <span class="rs-tag m">Measured experiment</span>
    <h2 class="sec">Benchmark: the honest result</h2>
    <div class="rs-split">
      <div class="tscroll"><table><caption>Boundary search, budget 24</caption><thead><tr><th>Method</th><th>Boundary error</th><th>Model calls</th></tr></thead><tbody>
        <tr><td>Grid 6×4</td><td class="mono">5.87 m</td><td class="mono">0</td></tr>
        <tr><td>Random</td><td class="mono">6.84 m</td><td class="mono">0</td></tr>
        <tr class="win"><td><b>Per-delay bisection</b> (best)</td><td class="mono"><b>0.57 m</b></td><td class="mono">0</td></tr>
        <tr><td>Old 0G designer</td><td class="mono">5.57 m</td><td class="mono">25</td></tr>
        <tr><td>0G + tools (final)</td><td class="mono">0.73 m</td><td class="mono">6</td></tr></tbody></table></div>
      <div class="tscroll"><table><caption>Open discovery, budget 16</caption><thead><tr><th>Method</th><th>Failure mechanisms</th><th>Coverage</th></tr></thead><tbody>
        <tr class="win"><td><b>Random</b> (best)</td><td class="mono"><b>7</b></td><td class="mono">0.93</td></tr>
        <tr><td>Old 0G designer</td><td class="mono">3</td><td class="mono">0.47</td></tr>
        <tr><td>0G + tools</td><td class="mono">4</td><td class="mono">0.50</td></tr></tbody></table></div>
    </div>
    <p style="margin:12px 0 0">Bisection beats every model-driven search on boundary accuracy, and random search found more failure mechanisms. The model's value is cheaper strategy (6 calls instead of 25) and hypotheses, which we then check.</p>
    ${prov('Recorded · kinematic runner · one run per method, seed 0 · runs/hunt-bench-002, runs/research-bench-g1-003')}
  </div>

  <div class="card" id="claims">
    <span class="rs-tag c">Model claim, checked</span>
    <h2 class="sec">Claim audit</h2>
    <p class="rs-count"><b>${CLAIMS.filter((c) => !c.ok).length} of ${CLAIMS.length}</b> claims below are contradicted by the measured runs.</p>
    <p class="lede rs-lede">Open a claim to see the experiment that checks it.</p>
    <div class="rs-claims">${CLAIMS.map((c) => `<details class="rs-claim${c.ok ? '' : ' bad'}"><summary><span>“${esc(c.claim)}”<small>${esc(c.who)}</small></span>${chip(c.ok)}</summary>
      <div class="rs-cbody"><p>${esc(c.check)}</p><p class="rs-prov">Recorded 2026-11-07 · kinematic runner · source runs/${esc(c.src)}</p></div></details>`).join('')}</div>
  </div>

  <div class="card" id="counterfactual">
    <span class="rs-tag m">Measured experiment</span>
    <h2 class="sec">Counterfactual: the failure and the fix</h2>
    <p class="lede rs-lede">The smallest failing case the agent found (18.75 m/s, gap 25 m, reaction delay 0.6 s) ends in a collision. The model's fix avoided the collision but kept only 0.36 m, under the 2 m margin. A 240-point grid search found a fix that keeps 4.74 m and clears every unsafe suite case (19 → 0).</p>
    <div class="rs-split" style="margin-top:12px">${CLIPS.map(([src, b, s, label]) => `<figure class="still"><video class="clip" controls muted playsinline preload="metadata" data-rs-src="${esc(src)}" aria-label="${esc(label)}"></video><figcaption><b>${esc(b)}</b><span>${esc(s)}</span></figcaption></figure>`).join('')}</div>
    ${prov('Recorded · CARLA 0.10 Town10, same parameters as the kinematic runner, which agrees exactly · ground truth · runs/research-mission-001')}
  </div>

  <div class="card c">
    <h2 class="sec">Safety Memory</h2>
    <p class="lede rs-lede" style="color:inherit">Compare aggregate claims across stack versions. Claims are owner filtered on Arkiv and anchored on 0G Galileo. A research surface, not a certificate.</p>
    <p style="margin:12px 0 0"><a href="${href.memory()}">Open Safety Memory</a></p>
  </div>
</div>`

let hunt: Hunt | null = null, failed = false, ctl: AbortController | null = null

function paint(cv: HTMLCanvasElement, h: Hunt, n: number) {
  const { g, w, h: H } = canvas2d(cv), pad = 34
  const X = (d: number) => pad + ((d - 0.3) / 1.2) * (w - pad * 1.5), Y = (gap: number) => H - pad - (gap / 80) * (H - pad * 2)
  g.clearRect(0, 0, w, H)
  g.strokeStyle = '#d8d8d0'; g.lineWidth = 1
  for (const gap of [0, 20, 40, 60, 80]) { g.beginPath(); g.moveTo(pad, Y(gap)); g.lineTo(w - pad / 2, Y(gap)); g.stroke() }
  g.strokeStyle = C.ink; g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath()
  h.truth.forEach(([d, gap], i) => (i ? g.lineTo(X(d), Y(gap)) : g.moveTo(X(d), Y(gap)))); g.stroke(); g.setLineDash([])
  for (const e of h.experiments.slice(0, n)) { g.fillStyle = e.safe ? C.lime : C.pink; g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(X(e.delay), Y(e.gap), 6, 0, Math.PI * 2); g.fill(); g.stroke() }
  g.fillStyle = C.ink; g.font = '500 11px "JetBrains Mono", monospace'
  for (const gap of [0, 40, 80]) g.fillText(`${gap} m`, 2, Y(gap) + 4)
  g.fillText('0.3 s', pad, H - 10); g.fillText('reaction delay', w / 2 - 40, H - 10); g.fillText('1.5 s', w - pad - 10, H - 10)
}

function renderHunt(signal: AbortSignal) {
  const body = document.getElementById('hunt-body')!
  if (!hunt) { body.innerHTML = failed ? '<p class="rs-empty">The boundary hunt data (hunt.json) is not available in this build. The benchmark tables below come from the same recorded run.</p>' : loading('Loading the boundary hunt'); return }
  const h = hunt, ex = h.experiments
  body.innerHTML = `<canvas id="hunt" role="img" aria-label="${ex.length} experiments chosen by the old 0G designer, plotted as gap against reaction delay, with the true boundary as a dashed line. The table below lists every experiment."></canvas>
    <p class="rs-legend"><span><i class="dot l"></i>No crash</span><span><i class="dot p"></i>Crash or gap under 2 m</span><span><i class="dash"></i>True boundary</span><span id="hunt-n" aria-hidden="true"></span></p>
    <details class="more"><summary>Show the ${ex.length} experiments as a table</summary><div class="tscroll"><table class="rs-tbl"><thead><tr><th>#</th><th>Delay</th><th>Gap</th><th>Outcome</th><th>0G request</th><th>Why the model chose it</th></tr></thead><tbody>
    ${ex.map((e) => `<tr><td class="mono">${e.n}</td><td class="mono">${num(e.delay, 2)} s</td><td class="mono">${num(e.gap, 1)} m</td><td>${e.safe ? 'No crash' : 'Crash or gap under 2 m'}</td><td class="mono">${short(e.rid, 8, 4)}</td><td>${esc(e.why)}</td></tr>`).join('')}</tbody></table></div></details>`
  const cv = document.getElementById('hunt') as HTMLCanvasElement, label = document.getElementById('hunt-n')!
  let n = matchMedia('(prefers-reduced-motion: reduce)').matches ? ex.length : 0
  const step = () => {
    if (signal.aborted) return
    paint(cv, h, n); label.textContent = `Experiment ${n} of ${ex.length}`
    if (n++ < ex.length) setTimeout(step, 300)
  }
  step()
}

export const page = {
  id: 'research' as Page,
  title: 'Research',
  css: `
#v-research .rs-tag { display: inline-flex; font: 600 12px var(--mono); padding: 4px 10px; border-radius: 999px; border: 1.5px solid var(--line); margin-bottom: 10px }
#v-research .rs-tag.m { background: var(--lime) } #v-research .rs-tag.c { background: var(--pink) }
#v-research .rs-lede { margin-top: -6px }
#v-research .rs-prov { font: 13px/1.45 var(--mono); color: var(--muted); margin: 12px 0 0; overflow-wrap: anywhere }
#v-research .rs-facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 12px 0; font-size: 15px }
#v-research .rs-facts dt { font-weight: 600 } #v-research .rs-facts dd { margin: 0 }
#v-research #hunt { width: 100%; height: 280px; display: block; margin-top: 8px; background: #fff; border: 1px solid var(--line); border-radius: 16px }
#v-research .rs-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 14px; margin: 8px 0 0 }
#v-research .rs-legend span { display: inline-flex; gap: 6px; align-items: center }
#v-research .dot { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--ink); display: inline-block } #v-research .dot.l { background: var(--lime) } #v-research .dot.p { background: var(--pink) }
#v-research .dash { width: 20px; border-top: 2px dashed var(--ink); display: inline-block }
#v-research .rs-tbl td:last-child { min-width: 260px }
#v-research .rs-split { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 14px; align-items: start }
#v-research caption { text-align: left; font-weight: 600; padding-bottom: 6px }
#v-research tr.win td { background: #eefbe6 }
#v-research .rs-count { font-size: 18px; margin: 0 0 8px }
#v-research .rs-claims { display: grid; gap: 8px }
#v-research .rs-claim { border: 1.5px solid #ddd; border-radius: 14px; background: #fff }
#v-research .rs-claim.bad { border-color: #c92a2a; border-left-width: 6px }
#v-research .rs-claim summary { cursor: pointer; min-height: 44px; padding: 12px 14px; display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap }
#v-research .rs-claim summary small { display: block; color: var(--muted); font-size: 14px; margin-top: 2px }
#v-research .rs-cbody { padding: 0 14px 14px } #v-research .rs-cbody p { margin: 0 }
#v-research .rs-chip { font: 600 13px var(--mono); padding: 4px 10px; border-radius: 999px; border: 1.5px solid currentColor; white-space: nowrap }
#v-research .rs-chip.bad { color: #b02020; background: #fde8e8 } #v-research .rs-chip.ok { color: #2b6a2e; background: #eefbe6 }
#v-research .rs-empty { padding: 16px; border: 1.5px dashed var(--line); border-radius: 14px; margin: 8px 0 0 }
@media (max-width: 760px) { #v-research .rs-split { grid-template-columns: 1fr } #v-research #hunt { height: 240px } }
`,
  mount(root: HTMLElement) { root.setAttribute('aria-labelledby', 'h-research'); root.innerHTML = html() },
  open(_id: string | null, _search: URLSearchParams) {
    ctl?.abort(); ctl = new AbortController()
    const signal = ctl.signal
    document.querySelectorAll<HTMLVideoElement>('#v-research video[data-rs-src]').forEach((v) => { if (!v.getAttribute('src')) v.src = media(v.dataset.rsSrc!) })
    if (hunt || failed) return renderHunt(signal)
    renderHunt(signal)
    fetch('/hunt.json', { signal }).then((r) => { if (!r.ok) throw new Error(`hunt.json: HTTP ${r.status}`); return r.json() })
      .then((j: Hunt) => { if (!Array.isArray(j?.experiments) || !Array.isArray(j?.truth)) throw new Error('hunt.json: bad shape'); hunt = j })
      .catch(() => { if (!signal.aborted) failed = true })
      .finally(() => { if (!signal.aborted) renderHunt(signal) })
  },
  leave() { ctl?.abort(); ctl = null; document.querySelectorAll<HTMLVideoElement>('#v-research video').forEach((v) => v.pause()) },
}
