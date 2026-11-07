// Run a test (/lab): policy → attack → run type → review and start. Steps never leave /lab (PRD §4.2, §4.3, §5).
// Talks only to the agent console: GET /api/policies, /api/catalog; POST /api/demo-run, /api/launch. The wallet only signs (EIP-191).
import { orb } from '../orb'
import { href, FEATURED, SWARM, LEAD_BRAKE } from '../routes'
import { getJson, postJson } from '../core/api'
import { $, esc, short, kv } from '../core/dom'
import { radioGroup, announce } from '../core/a11y'
import { health, onHealth, refreshHealth, walletOptions, wallet, connect, disconnect, signMessage, walletErr, onWallet, lastJob } from '../core/state'
import { go } from '../shell'

type Policy = { id: string, name: string, description: string, digest: string | null, compatible: boolean | null, paid?: boolean }
type Mode = 'replay' | 'free' | 'paid'
const CUT_IN = 'cut-in-v1-carla', SWARM_SUITE = 'swarm-v1-carla'
const STEPS = ['Policy', 'Attack', 'Run type', 'Review and start']
const PLAIN: Record<string, string> = {
  'pdm-lite': 'The rule-based planner from the CARLA Leaderboard. It drives on what its own LiDAR sees.',
  'idm-cautious': 'A cautious car-following model that keeps a 1.6-second gap to the car ahead.',
}
let policies: Policy[] = [
  { id: 'pdm-lite', name: 'PDM-Lite', description: '', digest: '0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba', compatible: true, paid: true },
  { id: 'idm-cautious', name: 'Cautious IDM', description: '', digest: null, compatible: true, paid: false },
]
const ATTACKS = [
  { id: CUT_IN, name: 'Cut-in', line: 'One 0G-controlled car cuts in ahead of yours in CARLA.', dur: 'About 90 s', cost: 'Free demo, or 0.001 HBAR paid by our agent', run: FEATURED },
  { id: SWARM_SUITE, name: 'Coordinated four-car attack', line: '0G writes a plan, then steers four cars every second to box your car in.', dur: 'About 2 min', cost: 'Free demo only', run: SWARM },
]

// ---------- state: choices persist in localStorage so a reload or a wallet warning page keeps them ----------
const FKEY = 'faultline.flow'
let cur = 1, maxStep = 1, policy = 'pdm-lite', attack = CUT_IN, mode: Mode = 'replay', guest = false
let note = '', busy = false, catalog: { cap: string | null, merchant: string | null, pending: { jobId: string, suite: string, hashscan: string }[] } | null = null
function save() { try { localStorage.setItem(FKEY, JSON.stringify({ step: cur, policy, attack, mode, guest })) } catch { /* private mode */ } }
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(FKEY) ?? 'null'); if (!s) return
    policy = typeof s.policy === 'string' ? s.policy : policy; attack = ATTACKS.some((a) => a.id === s.attack) ? s.attack : attack
    mode = ['replay', 'free', 'paid'].includes(s.mode) ? s.mode : mode; guest = !!s.guest; cur = maxStep = Math.max(1, Math.min(4, Number(s.step) || 1))
  } catch { /* corrupt entry: start fresh */ }
}

// ---------- availability: every disabled option says why ----------
const pol = () => policies.find((p) => p.id === policy)
const atk = () => ATTACKS.find((a) => a.id === attack) ?? ATTACKS[0]
const swarmWhy = () => policy === 'pdm-lite' ? '' : 'Runs against PDM-Lite only. Pick PDM-Lite in step 1.'
/** null = available; string = the reason it is not (or "Checking runner…" while health is unknown). */
function liveWhy(): string | null {
  if (!health.checked) return 'Checking runner…'
  if (!health.online) return 'The local runner is offline. Replay a recorded run instead.'
  if (!health.carla) return 'CARLA is offline on the runner, so live runs are paused.'
  if (!health.zg) return '0G Router is not configured on the runner.'
  if (health.caps?.runs_left != null && health.caps.runs_left < 1) return 'Live runs are used up for today.'
  return null
}
function paidWhy(): string | null {
  const l = liveWhy(); if (l) return l
  if (attack !== CUT_IN) return 'Paid tests cover the cut-in attack only.'
  if (pol()?.paid === false) return 'Paid tests are bound to PDM-Lite.'
  if (guest) return 'Paid tests need a wallet signature. Connect a wallet in step 4.'
  if (!health.hedera) return 'The Hedera payment service is offline.'
  if (health.caps?.buys_left != null && health.caps.buys_left < 1) return 'Paid tests are used up for today.'
  return null
}
const modeWhy = (m: Mode) => (m === 'replay' ? null : m === 'free' ? liveWhy() : paidWhy())
/** Keep the choices consistent: swarm needs PDM-Lite; an unavailable live mode falls back to Replay once health is known. */
function normalize() {
  if (attack === SWARM_SUITE && swarmWhy()) { attack = CUT_IN; note = 'The coordinated four-car attack runs against PDM-Lite only, so the attack switched to Cut-in.'; announce(note) }
  if (mode !== 'replay' && health.checked && modeWhy(mode)) { mode = 'replay'; announce('That run type is not available right now, so Replay is selected.') }
}

// ---------- rendering ----------
const chip = (why: string | null) => why === 'Checking runner…' ? `<span class="chip dev">${orb('connecting', 20)} Checking runner…</span>` : why ? '<span class="chip dev">Unavailable</span>' : '<span class="chip live">Available</span>'
const facts = (rows: [string, string][]) => `<dl class="lab-facts">${kv(rows.map(([k, v]) => [k, esc(v)]))}</dl>`
function radio(group: string, items: { id: string, html: string, why?: string | null }[], sel: string) {
  return items.map((i) => `<button type="button" class="choice" role="radio" aria-checked="${i.id === sel}" data-${group}="${esc(i.id)}" ${i.why ? `disabled aria-describedby="why-${group}-${esc(i.id)}"` : ''}>${i.html}${i.why ? `<small class="why" id="why-${group}-${esc(i.id)}">${esc(i.why)}</small>` : ''}</button>`).join('')
}

function renderStepper() {
  $('lab-count').textContent = `Step ${cur} of 4`
  $('lab-stepper').innerHTML = STEPS.map((t, i) => {
    const n = i + 1, done = n < maxStep && n !== cur
    return `<li><button type="button" class="${n === cur ? 'on' : ''} ${done ? 'done' : ''}" data-s="${n}" ${n <= maxStep ? '' : 'disabled'} ${n === cur ? 'aria-current="step"' : ''}><i>${done ? '✓' : n}</i><span>${t}</span></button></li>`
  }).join('')
}

function renderChoices() {
  normalize()
  // re-renders (health poll every 10 s) replace the radios; keep keyboard focus on the same option
  const f = document.activeElement as HTMLElement | null, fsel = f?.closest('#v-lab .choice') ? ['pol', 'atk', 'mode'].map((k) => f.dataset[k] ? `[data-${k}="${f.dataset[k]}"]` : '').join('') : ''
  $('lab-policies').innerHTML = radio('pol', policies.map((p) => ({ id: p.id,
    html: `<b>${esc(p.name.replace(/\s*\(.*\)$/, ''))}</b><span>${esc(PLAIN[p.id] ?? p.description)}</span>${facts([['World', 'CARLA'], ['Ego sensors', 'LiDAR and speed (Python AVStack)'], ['Paid tests', p.paid ? 'Supported' : 'Free runs only']])}<small>${p.compatible ? '✓ Passed our compatibility check' : 'Compatibility not checked yet'}</small><small class="mono">${p.digest ? `digest ${short(p.digest, 10, 6)}` : 'digest pending'}</small>` })), policy)
  $('lab-attacks').innerHTML = radio('atk', ATTACKS.map((a) => {
    const why = a.id === SWARM_SUITE ? swarmWhy() || null : null
    return { id: a.id, why, html: `<b>${esc(a.name)}</b><span>${esc(a.line)}</span>${facts([['World', 'CARLA, Town10'], ['Ego', 'Your policy, LiDAR and speed'], ['Duration', a.dur], ['Cost', a.cost], ['Evidence', a.id === CUT_IN ? 'Live run; anchored when paid' : 'Live run, not paid, not anchored'], ['Availability', a.id === SWARM_SUITE ? 'Live, PDM-Lite only' : 'Live']])}` }
  }), attack)
  $('lab-atk-note').textContent = note
  const lw = liveWhy(), pw = paidWhy(), a = atk()
  $('lab-modes').innerHTML = radio('mode', [
    { id: 'replay', html: `<b>Replay a recorded run</b><span>Watch a real recorded ${esc(a.name.toLowerCase())} run with its 0G decisions.</span>${facts([['World', 'CARLA (recorded)'], ['Duration', 'Plays now'], ['Cost', 'None'], ['Evidence', 'Existing recorded evidence'], ['Availability', 'Always']])}${chip(null)}` },
    { id: 'free', why: lw, html: `<b>Free live demo</b><span>Real 0G decisions in CARLA now.</span>${facts([['World', 'CARLA (live)'], ['Duration', a.dur], ['Cost', 'None'], ['Evidence', 'Live, not paid, not anchored'], ['Needs', 'Local runner and CARLA']])}${chip(lw)}` },
    { id: 'paid', why: pw, html: `<b>Paid anchored test</b><span>Our agent pays 0.001 HBAR on Hedera testnet (x402). The result is anchored on 0G Galileo and stored on 0G Storage.</span>${facts([['World', 'CARLA (live)'], ['Duration', 'About 90 s plus publishing'], ['Cost', '0.001 HBAR, paid by our agent'], ['Evidence', 'Paid, anchored, stored'], ['Needs', 'Wallet signature, cut-in, PDM-Lite, CARLA']])}${chip(pw)}` },
  ], mode)
  const carlaDown = health.checked && health.online && !health.carla, offline = health.checked && !health.online
  $('lab-health').innerHTML = !health.checked ? `<span class="note-start">${orb('connecting', 20)}Checking runner…</span>`
    : carlaDown || offline ? `<span>${esc(offline ? 'The local runner is unreachable, so live runs are paused. Recorded runs still play.' : 'CARLA is offline on the runner, so live runs are paused. Recorded runs still play.')}</span> <button type="button" class="btn" id="lab-recheck">Check again</button>`
    : '<span>Runner online · CARLA online. Live runs are available.</span>'
  for (const id of ['lab-policies', 'lab-attacks', 'lab-modes']) radioGroup($(id))
  if (fsel) document.querySelector<HTMLElement>(`#v-lab ${fsel}`)?.focus()
  renderReview()
}

// The console verifies exactly these lines (verifyRunRequest in packages/hedera); same format as commit 0f00ef3.
const message = (nonce: string, issued: string) => `Faultline test request\npolicy: ${policy}\nsuite: ${attack}\nmode: ${mode}\nnonce: ${nonce}\nissued: ${issued}`
const capText = () => (catalog?.cap ? `${Number(catalog.cap) / 1e8} HBAR per day (agent spending policy)` : 'Agent spending policy (cap not loaded)')

function renderReview() {
  const p = pol(), a = atk(), replay = mode === 'replay', paid = mode === 'paid', w = wallet.current
  $('lab-replay').classList.toggle('hidden', !replay); $('lab-live').classList.toggle('hidden', replay)
  if (replay) {
    $('lab-replay-sum').innerHTML = kv([['Policy', esc(p?.name ?? policy)], ['Attack', esc(a.name)], ['Run', `<code>${short(a.run, 14, 8)}</code>`], ['Mode', 'Recorded replay · nothing new runs']])
    return
  }
  $('lab-summary').innerHTML = kv([
    ['Policy', `${esc(p?.name ?? policy)} <code class="mono">${p?.digest ? short(p.digest, 10, 6) : 'digest pending'}</code>`],
    ['Suite', `<code>${esc(attack)}</code> (version v1)`],
    ['Mode', paid ? 'Paid anchored test' : 'Free live demo · not paid, not anchored'],
    ['Estimated testnet charge', paid ? '0.001 HBAR on Hedera testnet for one cut-in run' : 'None'],
    ['Payer', paid ? 'Faultline agent (pays from its own key; you never pay)' : 'Nobody: free run'],
    ...(paid ? [['Merchant', catalog?.merchant ? `<code>${esc(catalog.merchant)}</code>` : 'Faultline test service'] as [string, string], ['Spending cap', esc(capText())] as [string, string]] : []),
    ['Request signer', w ? `<code>${esc(w.address)}</code>` : guest ? 'Guest (no wallet)' : 'Connect a wallet or continue without one'],
    ['Data visibility', paid ? 'Public evidence bundle and an encrypted sealed bundle on 0G Storage; commitments on 0G Galileo' : 'Run files stay on the local runner; nothing is published or anchored'],
  ])
  $('lab-msg').textContent = message('<random nonce>', '<time you click>')
  $('lab-msg-box').classList.toggle('hidden', !w)
  const list = walletOptions()
  $('lab-wallets').innerHTML = w
    ? `<span class="pill">✓ ${esc(w.name)} · ${short(w.address, 6, 4)}</span><button type="button" class="btn" id="lab-w-other">Use a different wallet</button>`
    : list.length ? list.map((x, i) => `<button type="button" class="btn" data-w="${i}">${x.info.icon?.startsWith('data:image/') ? `<img src="${esc(x.info.icon)}" alt="">` : ''}Connect ${esc(x.info.name)}</button>`).join('')
      : '<span class="lab-muted">No wallet found in this browser. Install a browser wallet and reload, or continue without a wallet for a free run.</span>'
  $('lab-guest').textContent = guest && !w ? '✓ Continuing without a wallet' : 'Continue without a wallet'
  const pending = catalog?.pending ?? []
  $('lab-pending').innerHTML = pending.length ? `<div class="note"><b>Paid but not started.</b> These tests are already paid. Launch one instead of paying again.${pending.map((j) => `<div class="row lab-pend"><code>${short(j.jobId, 8, 4)}</code> <span>${esc(j.suite)}</span> <a href="${esc(j.hashscan)}" target="_blank" rel="noopener">payment ↗</a> <button type="button" class="btn" data-launch="${esc(j.jobId)}">Launch</button></div>`).join('')}</div>` : ''
  const why = paid && pending.length ? 'A paid test is waiting above. Launch it instead of starting a new paid test.'
    : modeWhy(mode) ?? (!w && !guest ? 'Connect a wallet, or continue without one for a free run.' : paid && !w ? 'Connect a wallet to sign the paid test request.' : '')
  const btn = $<HTMLButtonElement>('lab-start')
  btn.textContent = w ? 'Sign test request and start' : 'Start free guest run'
  btn.disabled = busy || !!why
  if (!busy) $('lab-start-why').textContent = why
}

// ---------- steps ----------
function step(n: number, focus = true) {
  cur = Math.max(1, Math.min(4, n)); maxStep = Math.max(maxStep, cur); save()
  for (let i = 1; i <= 4; i++) $(`lab-s${i}`).classList.toggle('hidden', i !== cur)
  renderStepper(); if (cur === 4) { renderReview(); loadCatalog() }
  if (focus) $(`lab-s${cur}`).querySelector<HTMLElement>('h2')?.focus()
}
async function loadPolicies() {
  try { const p = await getJson('/api/policies'); if (Array.isArray(p) && p.length) policies = p } catch { /* built-in list stays */ }
  renderChoices()
}
async function loadCatalog() {
  try { const c = await getJson('/api/catalog'); catalog = { cap: c.cap ?? null, merchant: c.merchant ?? null, pending: Array.isArray(c.pending) ? c.pending : [] } } catch { /* console offline: review shows "cap not loaded" */ }
  renderReview()
}
function renderResume() {
  const j = lastJob.get()
  const fresh = j && Date.now() - j.startedAt < 15 * 60_000
  $('lab-resume').classList.toggle('hidden', !fresh)
  if (fresh) $('lab-resume').innerHTML = `<b>You have a test in progress.</b> <span class="lab-muted">${esc(j!.suite)} · started ${new Date(j!.startedAt).toLocaleTimeString()}</span> <a class="btn" href="${href.mission(j!.jobId)}">Open it</a>`
}

const status = (text: string) => { $('lab-start-why').innerHTML = `<span class="note-start">${orb('connecting', 20)}${esc(text)}</span>` }
async function start() {
  const w = wallet.current
  if (busy || (!w && !guest)) return
  busy = true; $<HTMLButtonElement>('lab-start').disabled = true // set before any await: a double click starts one job
  try {
    let body: Record<string, unknown> = { policy, suite: attack, mode: 'free', guest: true }
    if (w) {
      status('Waiting for your wallet signature… (a signature is not a payment)')
      const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
      const msg = message(nonce, new Date().toISOString())
      const signature = await signMessage(msg)
      body = { policy, suite: attack, mode, address: w.address, message: msg, signature }
    }
    status('Queuing your test…')
    const r = await postJson('/api/demo-run', body)
    lastJob.set({ jobId: r.jobId, mode: body.mode as 'free' | 'paid', suite: attack, startedAt: Date.now() })
    busy = false; $('lab-start-why').textContent = ''
    go(href.mission(r.jobId))
  } catch (e) {
    busy = false
    $('lab-start-why').textContent = (e as any)?.code != null ? walletErr(e, 'signature') : `Not started: ${(e as Error)?.message ?? e}. Your choices are kept.`
    $<HTMLButtonElement>('lab-start').disabled = false
  }
}

export const page = {
  id: 'lab' as const,
  title: 'Run a test',
  css: `
#v-lab .lab-top { display: flex; justify-content: space-between; align-items: end; gap: 12px; flex-wrap: wrap; margin-bottom: 14px }
#v-lab .lab-top h1 { color: var(--paper); font-size: clamp(28px, 3vw, 40px) } #v-lab .lab-count { font: 600 14px var(--mono); color: #b8b8b2 }
#v-lab .stepper { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 16px; padding: 0; list-style: none }
#v-lab .stepper button { min-height: 44px; padding: 0 16px 0 6px; border-radius: 999px; background: #1a1a1a; color: #b8b8b2; font-weight: 500; display: inline-flex; gap: 8px; align-items: center; border: 0 }
#v-lab .stepper button i { font-style: normal; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: #2a2a2a; font-weight: 700; font-size: 14px }
#v-lab .stepper button.on { background: var(--paper); color: var(--ink) } #v-lab .stepper button.on i { background: var(--ink); color: var(--paper) }
#v-lab .stepper button.done i { background: var(--lime); color: var(--ink) } #v-lab .stepper button:disabled { opacity: .5; cursor: not-allowed }
#v-lab .step h2 { font-size: 30px; font-weight: 700; outline: none }
#v-lab .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 14px; margin-top: 18px }
#v-lab .choice { text-align: left; border: 1.5px solid var(--line); border-radius: 24px; padding: 20px; background: var(--paper); color: var(--ink); font: inherit; transition: transform .16s var(--ease), box-shadow .16s var(--ease); display: flex; flex-direction: column; gap: 6px; min-width: 0; cursor: pointer }
#v-lab .choice:active:not(:disabled) { transform: scale(.985) } #v-lab .choice:focus-visible { outline: 3px solid var(--purple); outline-offset: 3px }
#v-lab .choice[aria-checked="true"] { box-shadow: 0 0 0 4px var(--ink); background: var(--lime) }
#v-lab .choice[aria-checked="true"] b::before { content: "✓ " }
#v-lab .choice:disabled { opacity: .6; cursor: not-allowed }
#v-lab .choice b { font-size: 20px } #v-lab .choice > span { color: var(--muted) } #v-lab .choice small { color: var(--muted); font-size: 13px }
#v-lab .choice small.why { color: #9c005d; font-weight: 600; font-size: 14px } #v-lab .choice .chip { align-self: flex-start; gap: 6px }
#v-lab .mono, #v-lab code { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere }
#v-lab .lab-facts { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 8px 0 4px; font-size: 14px }
#v-lab .lab-facts dt { color: var(--muted) } #v-lab .lab-facts dd { margin: 0; font-weight: 500 }
#v-lab .nav-btns { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 22px; align-items: center }
#v-lab .lab-links { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 14px }
#v-lab .lab-health { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 12px }
#v-lab .lab-resume { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 0 0 16px }
#v-lab .wallets { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px } #v-lab .wallets img { width: 24px; height: 24px; border-radius: 6px }
#v-lab .summary { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: 8px 16px; margin: 18px 0 0 }
#v-lab .summary dt { color: var(--muted) } #v-lab .summary dd { margin: 0; font-weight: 600; min-width: 0; overflow-wrap: anywhere }
#v-lab .auth2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 12px; margin-top: 12px }
#v-lab .auth-box { border: 1px solid var(--line); border-radius: 16px; padding: 14px; background: #fff; display: flex; flex-direction: column; gap: 4px }
#v-lab .auth-box span, #v-lab .lab-muted { font-size: 14px; color: var(--muted) }
#v-lab details.more > summary { cursor: pointer; font-weight: 600; min-height: 44px; display: flex; align-items: center }
#v-lab pre.msg { background: var(--ink); color: var(--paper); border-radius: 16px; padding: 14px; font: 13px/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0 0 }
#v-lab .lab-pend { margin-top: 8px }
@media (max-width: 640px) { #v-lab .step h2 { font-size: 24px } #v-lab .stepper button span { display: none } #v-lab .stepper button { padding: 0 6px } #v-lab .summary { grid-template-columns: minmax(0, 1fr) } #v-lab .summary dd { margin-bottom: 6px } }
@media (prefers-reduced-motion: reduce) { #v-lab .choice { transition: none } }
`,
  mount(root: HTMLElement) {
    root.innerHTML = `
<div class="lab-top"><h1 id="lab-h">Run a test</h1><span class="lab-count" id="lab-count" aria-live="polite">Step 1 of 4</span></div>
<ol class="stepper" id="lab-stepper" aria-label="Test steps"></ol>
<div class="card lab-resume hidden" id="lab-resume" role="status"></div>

<div class="card step" id="lab-s1">
  <h2 tabindex="-1">What are you testing?</h2>
  <p class="lede">The self-driving policy that has to survive the attack.</p>
  <div class="choices" role="radiogroup" aria-label="Driving policy" id="lab-policies"></div>
  <div class="nav-btns"><button type="button" class="btn k" data-next="2">Next: choose challenge</button><a class="btn" href="${href.stack()}">Connect your own stack</a></div>
</div>

<div class="card step hidden" id="lab-s2">
  <h2 tabindex="-1">How to challenge it</h2>
  <p class="lede">A model on 0G controls the other traffic and tries to force a crash.</p>
  <div class="choices" role="radiogroup" aria-label="Attack" id="lab-attacks"></div>
  <p class="err" id="lab-atk-note" role="status"></p>
  <div class="lab-links"><a href="${href.research('counterfactual')}">Explore lead-brake research</a><a href="${href.mission(LEAD_BRAKE)}">Watch the recorded lead-brake run</a></div>
  <div class="nav-btns"><button type="button" class="btn" data-next="1">Back</button><button type="button" class="btn k" data-next="3">Next: choose run type</button></div>
</div>

<div class="card step hidden" id="lab-s3">
  <h2 tabindex="-1">How to run it</h2>
  <p class="lede">Live runs need the local runner and the CARLA simulator. Replay works any time.</p>
  <div class="lab-health" id="lab-health" role="status"></div>
  <div class="choices" role="radiogroup" aria-label="Run type" id="lab-modes"></div>
  <div class="nav-btns"><button type="button" class="btn" data-next="2">Back</button><button type="button" class="btn k" data-next="4">Next: review and start</button></div>
</div>

<div class="card step hidden" id="lab-s4">
  <h2 tabindex="-1">Review and start</h2>
  <div id="lab-replay" class="hidden">
    <dl class="summary" id="lab-replay-sum"></dl>
    <p class="lab-muted">This opens a recorded run. Nothing new runs and nothing is charged.</p>
    <div class="nav-btns"><button type="button" class="btn" data-next="3">Back</button><button type="button" class="btn k big" id="lab-open-rec">Open recorded run</button></div>
  </div>
  <div id="lab-live">
    <div class="auth2">
      <div class="auth-box"><b>You sign a test request</b><span>Your wallet signs one readable message. No transaction, no token approval, no gas. A signature is never a payment.</span></div>
      <div class="auth-box"><b>Our agent pays for paid tests</b><span>The Faultline agent pays 0.001 HBAR on Hedera testnet through x402 under its spending cap. Free runs are not paid and not anchored.</span></div>
    </div>
    <dl class="summary" id="lab-summary"></dl>
    <div class="wallets" id="lab-wallets"></div>
    <div class="err" id="lab-wallet-err" role="alert"></div>
    <div class="nav-btns"><button type="button" class="btn" id="lab-guest">Continue without a wallet</button><a class="btn" href="${href.library()}">Watch a recorded test</a></div>
    <details class="more" id="lab-msg-box"><summary>Show exact message</summary><pre class="msg" id="lab-msg"></pre></details>
    <div id="lab-pending"></div>
    <p class="err" id="lab-start-why" role="status"></p>
    <div class="nav-btns"><button type="button" class="btn" data-next="3">Back</button><button type="button" class="btn k big" id="lab-start">Start free guest run</button></div>
  </div>
</div>`
    // one delegated listener: re-renders replace the buttons, not the root
    root.addEventListener('click', async (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!t || t.hasAttribute('disabled')) return
      const d = t.dataset
      if (d.s) step(Number(d.s))
      else if (d.next) step(Number(d.next))
      else if (d.pol) { policy = d.pol; note = ''; save(); renderChoices() }
      else if (d.atk) { attack = d.atk; note = ''; save(); renderChoices() }
      else if (d.mode) { mode = d.mode as Mode; save(); renderChoices() }
      else if (d.w) { $('lab-wallet-err').textContent = ''; try { await connect(walletOptions()[Number(d.w)]); guest = false; save() } catch (err) { $('lab-wallet-err').textContent = walletErr(err, 'connection') } renderChoices() }
      else if (d.launch) {
        t.setAttribute('disabled', '')
        try { const r = await postJson('/api/launch', { jobId: d.launch }); go(href.mission(String(r.run)) + '?live=1') } catch (err) { $('lab-start-why').textContent = `Not launched: ${(err as Error).message}. The paid test stays launchable; nothing was paid again.`; t.removeAttribute('disabled') }
      } else if (t.id === 'lab-w-other') { disconnect(); renderChoices() }
      else if (t.id === 'lab-guest') { guest = true; disconnect(); if (mode === 'paid') mode = 'free'; save(); renderChoices() }
      else if (t.id === 'lab-recheck') { $('lab-health').innerHTML = `<span class="note-start">${orb('connecting', 20)}Checking runner…</span>`; await refreshHealth() }
      else if (t.id === 'lab-open-rec') go(href.mission(atk().run))
      else if (t.id === 'lab-start') start()
    })
    onHealth(() => renderChoices())
    onWallet(() => renderChoices())
    restore()
    renderChoices()
    loadPolicies()
  },
  open(_id: string | null, search: URLSearchParams) {
    const q = search.get('attack')
    if (q === 'swarm' || q === 'cut-in') {
      attack = q === 'swarm' ? SWARM_SUITE : CUT_IN
      if (q === 'swarm') policy = 'pdm-lite'
      note = ''; cur = 1; save()
      history.replaceState(null, '', href.lab())
    }
    renderResume(); renderChoices(); step(cur, false)
  },
}
