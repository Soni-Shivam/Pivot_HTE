// Discover (PRD 4.1): one annotated real outcome, the four-step trust diagram, attack catalogue, the four-car showcase,
// what is and is not proven, the judge path, research and stack entries. Copy ported from 0f00ef3 #v-home.
import { getJson } from '../core/api'
import { esc } from '../core/dom'
import { CATALOGUE, attackChip, attackMedia, previewTag, rolesHtml, type Attack } from '../core/catalogue'
import { FEATURED, SWARM, href, type Page } from '../routes'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const atkCard = (a: Attack) => `<article class="atk" id="atk-${a.id}"><figure${a.run ? ` data-run="${esc(a.run)}"` : ''}>${attackMedia(a)}${previewTag(a).replace('class="chip dev"', 'class="chip dev tag"')}</figure>
  <div class="atk-body">${attackChip(a)}<h3>${esc(a.title)}</h3><p>${esc(a.line)}</p>
  ${a.actions.length ? `<div class="row">${a.actions.map(([t, u, k]) => `<a class="btn ${k ?? ''}" href="${u}">${esc(t)}</a>`).join('')}</div>` : ''}</div></article>`

const HTML = () => `<div class="grid">
  <div class="card k hero2">
    <div>
      <p class="kicker">Autonomous vehicle red-teaming</p>
      <h1 id="home-h">Your autonomous car passed the test. Who tested the tester?</h1>
      <p class="lede">Faultline points an AI attacker running on 0G at a driving policy in CARLA, then publishes evidence of every decision and outcome that anyone can check.</p>
      <div class="outcome">
        <p class="prov">Recorded · CARLA Town10 · LiDAR-tracked metrics · paid test 002</p>
        <p class="verdict"><span aria-hidden="true">✓</span> Avoided collision in this test <span class="pill sm y">⏸ Interrupted · safe halt</span></p>
        <dl>
          <div><dt>Policy</dt><dd>PDM-Lite</dd></div>
          <div><dt>Suite</dt><dd class="mono">cut-in-v1-carla</dd></div>
          <div><dt>Min time to collision</dt><dd>1.03 s</dd></div>
          <div><dt>Peak criticality score</dt><dd>0.93</dd></div>
          <div><dt>Run status</dt><dd>Interrupted (safe halt at checkpoint 8), paid and anchored</dd></div>
          <div><dt>Attacker</dt><dd>0G private inference</dd></div>
        </dl>
      </div>
      <div class="row cta-row">
        <a class="btn y big" href="${href.mission(FEATURED)}">Explore real attack</a>
        <a class="btn" href="${href.verify(FEATURED)}">Verify evidence</a>
        <a class="btn" href="${href.lab()}">Run a test</a>
        <button class="btn" type="button" data-judge>Judge mode (3 min)</button>
      </div>
    </div>
    <figure class="hero-clip" data-run="${esc(FEATURED)}">
      <video src="/hero-loop.mp4" poster="/stills/paid.jpg" muted loop playsinline preload="metadata" aria-label="Recorded CARLA chase camera of paid test 002"></video>
      <figcaption>Recorded · Paid test 002 · CARLA Town10</figcaption>
    </figure>
  </div>

  <div class="card" id="how">
    <h2 class="sec">How one test runs</h2>
    <p class="lede">Four steps, each on its own system. Each label says what that system proves and where its proof stops.</p>
    <ol class="flow4">
      <li class="y"><span class="n">1</span><b>Request</b><span>The tester signs a readable request. For a paid test our agent pays 0.001 HBAR through x402. A signature is not a payment.</span><em>Hedera testnet · payment</em></li>
      <li class="p"><span class="n">2</span><b>0G decision</b><span>The attacker model picks each move on the 0G Router private tier. Every answer has a request ID and a provider signature.</span><em>0G mainnet · private inference</em></li>
      <li class="l"><span class="n">3</span><b>Local simulation</b><span>CARLA runs the physics; the policy under test drives on its own sensors; a controller enforces limits and the safe halt.</span><em>Local · not attested</em></li>
      <li class="c"><span class="n">4</span><b>Commit and storage</b><span>Paid runs commit the scenario before the first decision, store public and sealed bundles, and finalize after. Claims go to Arkiv.</span><em>0G Galileo testnet · commitments and storage roots · Arkiv claims</em></li>
    </ol>
  </div>

  <div class="card" id="scenarios">
    <h2 class="sec">Attacks</h2>
    <p class="lede">Two attacks run live against your policy today. One more is recorded, and three are in development.</p>
    <div class="atks">${CATALOGUE.map(atkCard).join('')}</div>
  </div>

  <div class="card" id="example">
    <p class="kicker">Coordinated four-car attack · ${esc(SWARM)} · CARLA Town10 · Recorded</p>
    <h2 class="sec">One attack, four AI-controlled cars</h2>
    <p class="lede">Before the first tick, the 0G strategist wrote a plan named “Staggered Cut-in”: B and C cut into the lane ahead one after the other while A brakes in steps, shrinking the space in front of the car under test.</p>
    <ul class="roles" data-roles>${rolesHtml()}</ul>
    <ol class="moments">
      <li><img src="/stills/cutin.jpg" alt="Chase camera: the yellow taxi cuts in ahead of the car under test" loading="lazy" width="960" height="540"><b>3 s</b><span>B cuts in ahead while A holds speed.</span></li>
      <li><img src="/stills/compress.jpg" alt="Chase camera: the blue car alongside, the gap ahead closing" loading="lazy" width="960" height="540"><b>5 s</b><span>A brakes to compress the gap; C waits alongside.</span></li>
      <li><img src="/stills/squeeze.jpg" alt="Chase camera: blue car left, taxi right, red car braking ahead" loading="lazy" width="960" height="540"><b>7 s</b><span>A and B brake together; the car under test is boxed in.</span></li>
      <li><img src="/stills/box.jpg" alt="Drone view: four attacker cars around the car under test" loading="lazy" width="960" height="540"><b>11 s</b><span>C cuts in; the car under test stops behind B.</span></li>
    </ol>
    <p class="prov">Recorded · CARLA · PDM-Lite on LiDAR · 10 of 10 moves from 0G</p>
    <div class="row"><a class="btn k" href="${href.mission(SWARM)}">Watch this run</a><a class="btn" href="${href.lab('swarm')}">Run it live</a></div>
  </div>

  <div class="card" id="proven">
    <h2 class="sec">What a paid test proves</h2>
    <div class="pair">
      <div class="yes"><h3><span aria-hidden="true">✓</span> What is proven</h3><ul>
        <li>Each attacker move came from 0G private inference: a request ID per move, and paid test 002 archived 7 of 7 provider signatures.</li>
        <li>The scenario was committed on 0G Galileo before the first decision and finalized after the last.</li>
        <li>The public bundle matches its 0G Storage root; anyone can recompute it in the independent verifier.</li>
        <li>Our agent paid 0.001 HBAR on Hedera testnet, one payment for one run. New Lab runs also carry a request signed by the tester.</li>
      </ul></div>
      <div class="no"><h3><span aria-hidden="true">✕</span> What is not proven</h3><ul>
        <li>That the car is safe. One test is one measured sample, not a certificate.</li>
        <li>The simulator and the reference driving policies run locally and are not attested.</li>
        <li>A 0G signature identifies the provider’s signed encrypted turn; it does not bind the visible plaintext answer.</li>
        <li>The criticality score is a measure of how close the moment was, not a crash probability.</li>
        <li>Free runs are not paid and not anchored.</li>
      </ul></div>
    </div>
    <div class="row"><a class="btn y" href="${href.verify(FEATURED)}">Check the evidence</a></div>
  </div>

  <div class="card k" id="judge-path">
    <h2 class="sec">Judge path, about 3 minutes</h2>
    <ol class="jpath">
      <li><a href="${href.mission(SWARM)}"><b>Watch the four-car attack</b><span>Recorded CARLA clip of ${esc(SWARM)}</span></a></li>
      <li><a href="${href.mission(SWARM)}"><b>Read the 0G plan and one decision</b><span>Plan, request ID, action</span></a></li>
      <li><a href="${href.results(FEATURED)}"><b>Open the paid result</b><span>Paid test 002, worst moment</span></a></li>
      <li><a href="${href.verify(FEATURED)}"><b>Check the evidence</b><span>Commitments, storage root, signatures</span></a></li>
      <li><a href="${href.verify(FEATURED)}#vf-payment"><b>See the payment</b><span>x402 on Hedera testnet, one-run permit</span></a></li>
      <li><a href="${href.research('claims')}"><b>See where the model lost</b><span>Research and claim audit</span></a></li>
    </ol>
    <div class="row"><button class="btn y" type="button" data-judge>Start judge mode</button></div>
  </div>

  <div class="card" id="findings">
    <h2 class="sec">Research findings, including where the model lost</h2>
    <div class="cards3">
      <div><b>Bisection found the boundary better</b><span>Safety boundary error: per-delay bisection 0.57 m, 0G with tools 0.73 m (6 calls instead of 25).</span></div>
      <div><b>Random search found more failure types</b><span>On the open benchmark, random search found 7 distinct failure fingerprints; 0G with tools found 4.</span></div>
      <div><b>Claims are audited</b><span>The agent blamed friction-limited braking; the run shows the car peaked at 5.76 m/s² against a 6.28 m/s² limit. Claim contradicted.</span></div>
    </div>
    <p class="prov">Recorded · kinematic research runs · checked by runner</p>
    <div class="row"><a class="btn k" href="${href.research()}">See the research</a></div>
  </div>

  <div class="card y" id="stack-cta">
    <h2 class="sec">Test your own stack</h2>
    <p class="lede">Python, CARLA Leaderboard and ROS 2 adapters, a compatibility check, then a free run or a paid anchored test.</p>
    <div class="row"><a class="btn k big" href="${href.stack()}">Connect your stack</a></div>
  </div>
</div>`

/** Broken or blocked media: keep the poster and give a way to the run's page. */
function onMediaFail(v: HTMLVideoElement) {
  const fig = v.closest('figure'); if (!fig || fig.dataset.failed) return
  fig.dataset.failed = '1'
  const run = fig.dataset.run
  const img = `<img src="${esc(v.poster)}" alt="${esc(v.getAttribute('aria-label') ?? '')}" width="960" height="540">`
  v.outerHTML = img + (run ? `<a class="btn fail-link" href="${href.mission(run)}">Open run details</a>` : '')
}

let root: HTMLElement | null = null, loopObs: IntersectionObserver | null = null
export const page: { id: Page, title: string, css: string, mount(root: HTMLElement): void, open(id: string | null, search: URLSearchParams): void, leave?(): void } = {
  id: 'home',
  title: 'Discover',
  css: CSS(),
  mount(el) {
    root = el
    el.innerHTML = HTML()
    el.querySelectorAll('video').forEach((v) => {
      v.addEventListener('error', () => onMediaFail(v))
      // WCAG 2.2.2: every looping clip gets a visible Pause / Play; the name starts with the visible word (2.5.3)
      const b = document.createElement('button'), stopped = () => !!v.dataset.held || (reduced() && !v.dataset.wanted)
      const sync = () => { b.textContent = stopped() ? 'Play' : 'Pause'; b.setAttribute('aria-label', `${b.textContent}: ${v.getAttribute('aria-label') ?? 'clip'}`) }
      b.type = 'button'; b.className = 'btn sm vid-toggle'
      b.addEventListener('click', () => {
        if (stopped()) { delete v.dataset.held; v.dataset.wanted = '1'; if (v.dataset.loop && !v.getAttribute('src')) v.src = v.dataset.loop; v.play().catch(() => {}) }
        else { v.dataset.held = '1'; delete v.dataset.wanted; v.pause() }
        sync()
      })
      sync(); v.closest('figure')?.append(b)
    })
    loopObs = new IntersectionObserver((es) => es.forEach((e) => {
      const v = e.target as HTMLVideoElement
      if (e.isIntersecting && !v.dataset.held && (!reduced() || v.dataset.wanted)) { if (v.dataset.loop && !v.getAttribute('src')) v.src = v.dataset.loop; v.play().catch(() => { /* autoplay blocked: poster stays */ }) } else v.pause()
    }))
    el.querySelectorAll<HTMLVideoElement>('video').forEach((v) => loopObs!.observe(v))
    getJson('/api/showcase').then((sc) => {
      const sw = (Array.isArray(sc?.items) ? sc.items : []).find((x: any) => x?.id === 'swarm')
      if (sw?.plan?.roles && typeof sw.plan.roles === 'object') el.querySelectorAll('[data-roles]').forEach((r) => { r.innerHTML = rolesHtml(sw.plan.roles) })
    }).catch(() => { /* console offline: the recorded plan stays */ })
  },
  open() { /* static page; main.ts handles #scenarios scrolling */ },
  leave() { root?.querySelectorAll('video').forEach((v) => v.pause()) },
}

function CSS() { return `
#v-home .hero2 { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 32px; align-items: center; padding: 40px }
#v-home .hero2 h1 { font-size: clamp(28px, 3.2vw, 44px); line-height: 1.12; font-weight: 600; color: var(--paper) }
#v-home .hero-clip { margin: 0; position: relative }
#v-home .hero-clip video, #v-home .hero-clip img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; border-radius: 20px; border: 1.5px solid #333; background: #000 }
#v-home .hero-clip figcaption { position: absolute; left: 12px; top: 12px; font: 12px var(--mono); background: #000000b0; color: #fff; padding: 4px 8px; border-radius: 8px }
#v-home .fail-link { position: absolute; right: 12px; bottom: 12px; min-height: 44px }
#v-home .vid-toggle { position: absolute; right: 10px; bottom: 10px; min-height: 44px; min-width: 64px; justify-content: center; background: #000000b0; color: #fff !important; border-color: #fff }
#v-home figure[data-failed] .vid-toggle { display: none }
#v-home .outcome { margin-top: 20px; border: 1px solid #333; border-radius: 18px; padding: 16px; background: #1f1f1f }
#v-home .outcome .verdict { color: var(--lime); font-size: 20px; font-weight: 600; margin: 4px 0 10px }
#v-home .outcome .verdict .pill { color: var(--ink); vertical-align: middle; margin-left: 8px }
#v-home .outcome dl { margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px 16px }
#v-home .outcome dt { font: 12px var(--mono); color: #9a9a94 } #v-home .outcome dd { margin: 2px 0 0; color: var(--paper); font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere }
#v-home .prov { font: 12px/1.4 var(--mono); color: var(--muted); margin: 14px 0 0 } #v-home .card.k .prov { color: #9a9a94 } #v-home .outcome .prov { margin: 0 }
#v-home .row { margin-top: 18px } #v-home .card.k button.btn:not(.k) { color: var(--ink) }
#v-home .flow4 { list-style: none; padding: 0; margin: 20px 0 0; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 28px; counter-reset: none }
#v-home .flow4 li { position: relative; border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; background: var(--paper) }
#v-home .flow4 li.y { background: #fbfcd0 } #v-home .flow4 li.p { background: #fde4fa } #v-home .flow4 li.l { background: #eefbd6 } #v-home .flow4 li.c { background: #e6fbfd }
#v-home .flow4 li + li::before { content: '→'; position: absolute; left: -23px; top: 50%; transform: translateY(-50%); font-weight: 700 }
#v-home .flow4 .n { font: 600 12px var(--mono); width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid var(--ink); display: inline-flex; align-items: center; justify-content: center; background: var(--paper) }
#v-home .flow4 b { font-size: 17px } #v-home .flow4 span:not(.n) { font-size: 15px; color: #333 }
#v-home .flow4 em { font: normal 600 12px/1.4 var(--mono); margin-top: auto; padding-top: 8px; border-top: 1px dashed #11111155 }
#v-home .chip { display: inline-flex; align-items: center; gap: 5px; font: 600 12px var(--mono); padding: 4px 10px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--paper); white-space: nowrap; color: var(--ink) }
#v-home .chip.live { background: var(--lime) } #v-home .chip.rec { background: var(--cyan) } #v-home .chip.dev { background: #e9e9e2; color: #3d3d38 }
#v-home .atks { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 16px; margin-top: 18px }
#v-home .atk { display: flex; flex-direction: column; gap: 12px; min-width: 0 }
#v-home .atk figure { margin: 0; position: relative }
#v-home .atk video, #v-home .atk img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 16px; border: 1.5px solid var(--line); display: block; background: #000 }
#v-home .atk .tag { position: absolute; left: 10px; top: 10px }
#v-home .atk h3 { font-size: 20px; font-weight: 600; margin: 8px 0 4px } #v-home .atk p { margin: 0; color: var(--muted); font-size: 16px; line-height: 1.45 }
#v-home .atk .row { margin-top: 12px }
#v-home .roles { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px 20px }
#v-home .roles li { display: flex; gap: 8px; align-items: center; font-size: 15px } #v-home .roles i { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--ink); flex: none }
#v-home .moments { list-style: none; padding: 0; margin: 20px 0 0; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px }
#v-home .moments img { width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; display: block; border-radius: 14px; border: 1px solid var(--line) }
#v-home .moments li { display: flex; flex-direction: column; gap: 4px } #v-home .moments b { font: 600 13px var(--mono); margin-top: 6px } #v-home .moments span { font-size: 15px }
#v-home .pair { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; margin-top: 8px }
#v-home .pair > div { border: 1.5px solid var(--line); border-radius: 18px; padding: 18px }
#v-home .pair .yes { background: #eefbd6 } #v-home .pair .no { background: #fde4fa }
#v-home .pair h3 { font-size: 19px; margin: 0 0 8px } #v-home .pair ul { margin: 0; padding-left: 20px; display: grid; gap: 8px; line-height: 1.45 }
#v-home .jpath { list-style: none; padding: 0; margin: 8px 0 0; display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; counter-reset: j }
#v-home .jpath a { counter-increment: j; display: flex; flex-direction: column; gap: 4px; min-height: 44px; padding: 14px 16px; border: 1px solid #333; border-radius: 16px; background: #1f1f1f; color: var(--paper); text-decoration: none; transition: transform .2s var(--ease), border-color .2s var(--ease) }
#v-home .jpath a:hover { transform: translateY(-2px); border-color: var(--yellow) }
#v-home .jpath b::before { content: counter(j) '. '; color: var(--yellow) } #v-home .jpath span { font-size: 14px; color: #d0d0ca }
#v-home .cards3 { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; margin-top: 8px }
#v-home .cards3 div { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 4px }
#v-home .cards3 b { font-size: 17px } #v-home .cards3 span { font-size: 15px; color: #333; line-height: 1.45 }
@media (max-width: 1000px) {
  #v-home .hero2, #v-home .pair { grid-template-columns: minmax(0,1fr) }
  #v-home .atks, #v-home .jpath { grid-template-columns: repeat(2, minmax(0,1fr)) }
  #v-home .flow4 { grid-template-columns: repeat(2, minmax(0,1fr)) } #v-home .flow4 li:nth-child(3)::before { display: none }
}
@media (max-width: 640px) {
  #v-home .hero2 { padding: 20px; gap: 20px }
  #v-home .outcome dl { grid-template-columns: repeat(2, minmax(0,1fr)) }
  #v-home .atks, #v-home .jpath, #v-home .cards3, #v-home .roles, #v-home .flow4 { grid-template-columns: minmax(0,1fr) }
  #v-home .flow4 { gap: 28px } #v-home .flow4 li + li::before, #v-home .flow4 li:nth-child(3)::before { display: block; content: '↓'; left: 50%; top: -24px; transform: translateX(-50%) }
  #v-home .moments { grid-template-columns: repeat(2, minmax(0,1fr)) }
  #v-home .cta-row .btn { flex: 1 1 auto; justify-content: center }
}
@media (prefers-reduced-motion: reduce) { #v-home * { transition: none !important } }
` }
