// Faultline Studio: Home → guided test (wallet → policy → attack → live → results & proof) → Explore.
// Talks only to the agent console (packages/hedera/src/agent-console.ts); the wallet only signs a readable request (EIP-191).
type Tick = { t_s: number; ego_x: number; ego_v: number; ego_a: number; ego_lat_m: number | null; lead_x: number; lead_v: number
  adv_lat_m: number | null; gt_gap: number; gt_ttc_s: number | null; ttc_s: number | null; lidar_gap: number | null; ccs: number | null; collision: boolean }
type Decision = { cp: number; sim_time_s: number; action: string | null; source: string; reason: string; request_id: string | null
  provider: string | null; latency_ms: number; wall_clock_utc: string; content?: string | null }
type Run = { name: string; jobId: string | null; status: string; world: string | null; family: string | null; decisions: number | null
  decisions0g: number | null; ccs: number | null; minTtc: number | null; minGap: number | null; collision: boolean | null
  chain: { registry: string; commitTx: string; finalizeTx: string | null; onchainMatches: boolean | null; commitBlockTimestamp?: number | null; committedBeforeFirstCall?: boolean | null } | null
  storage: { publicRoot: string; sealedRoot: string; signaturesArchived: number | null; signatures0g: number | null; signaturesVerified?: number | null } | null
  payment: { transaction: string; payer: string; suite: string; hashscan: string } | null; episodeId: string | null; model: string | null; agentId?: number | null; arkivEntity?: string | null; free?: boolean | null; requestedBy?: string | null }

const C = { ink: '#111111', paper: '#fbfbf6', muted: '#6b6b66', yellow: '#f3f56c', cyan: '#7cecf5', pink: '#f5a3ef', purple: '#7c5cf5', lime: '#c9f36f', hot: '#ff4fc3' }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const esc = (s: unknown) => String(s ?? '—').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const num = (x: unknown, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—')
const short = (s: unknown, a = 8, b = 6) => (typeof s === 'string' && s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : esc(s))
const hbar = (tinybar: number | null | undefined) => (typeof tinybar === 'number' ? (tinybar / 1e8).toFixed(4) : '—')
const risk = (c: number | null | undefined) => (c == null ? { cls: 'l', word: '—' } : c >= 0.75 ? { cls: 'p', word: 'High risk' } : c >= 0.5 ? { cls: 'y', word: 'Medium risk' } : { cls: 'l', word: 'Low risk' })
const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')
const link = (href: string, text: string) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text} ↗</a>`
const galileoTx = (tx: string) => `https://chainscan-galileo.0g.ai/tx/${tx}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// Set at build time (esbuild --define, FAULTLINE_API_BASE); empty = same origin as the page.
declare const FAULTLINE_API_BASE: string
const API = (typeof FAULTLINE_API_BASE === 'string' ? FAULTLINE_API_BASE : '').replace(/\/$/, '')
const api = (p: string) => API + p
const getJson = (p: string) => fetch(api(p)).then((r) => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json() })
const postJson = async (p: string, body: unknown) => {
  const r = await fetch(api(p), { method: 'POST', headers: { 'content-type': 'application/json', 'x-faultline-console': '1' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `${p}: HTTP ${r.status}`)
  return j
}

async function post(path: string, body: unknown, onEvent: (e: any) => void) {
  const r = await fetch(api(path), { method: 'POST', headers: { 'content-type': 'application/json', 'x-faultline-console': '1' }, body: JSON.stringify(body) })
  if (!r.ok || !r.body) throw new Error(`${path}: HTTP ${r.status}`)
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

// ---------- navigation ----------
type View = 'home' | 'flow' | 'explore'
function show(view: View) {
  for (const v of ['home', 'flow', 'explore']) $(`v-${v}`).classList.toggle('hidden', v !== view)
  document.querySelectorAll<HTMLButtonElement>('nav.top button').forEach((b) => { b.classList.toggle('on', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false') })
  if (view === 'explore') renderExplore()
  history.replaceState(null, '', view === 'flow' ? '#run' : location.pathname)
  window.scrollTo({ top: 0 })
  requestAnimationFrame(resizeAll)
}
document.querySelectorAll<HTMLButtonElement>('nav.top button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view as View)))
$('home-link').addEventListener('click', (e) => { e.preventDefault(); show('home') })
const gotoExplore = (id: string) => { show('explore'); requestAnimationFrame(() => document.getElementById(`x-${id}`)?.scrollIntoView()) }
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-goto-explore]'); if (t) gotoExplore(t.dataset.gotoExplore!)
  if ((e.target as HTMLElement).closest('[data-back]')) step(cur - 1)
})

// ---------- media: the console serves /media/<path>; recorded clips fall back to the public repo ----------
const RAW = 'https://raw.githubusercontent.com/Soni-Shivam/Pivot_HTE/main/'
const media = (path: string) => api('/media/' + path)
const video = (path: string, label: string) => `<video controls muted playsinline preload="metadata" aria-label="${esc(label)}" src="${esc(media(path))}" data-fallback="${esc(RAW + path)}"></video>`
document.addEventListener('error', (e) => {
  const v = e.target as HTMLVideoElement
  if (v instanceof HTMLVideoElement && v.dataset.fallback && v.src !== v.dataset.fallback) v.src = v.dataset.fallback
}, true)
const HERO_VIDEO = 'videos/swarm-carla-010__stitched.mp4'
const hv = $<HTMLVideoElement>('hero-video'); hv.src = media(HERO_VIDEO); hv.dataset.fallback = RAW + HERO_VIDEO
$('cta-run').addEventListener('click', () => { show('flow'); step(wallet ? 2 : 1) })
$('cta-watch').addEventListener('click', () => { $('example').scrollIntoView({ block: 'center' }); hv.play().catch(() => { /* autoplay blocked: controls stay */ }) })

// ---------- wallet: EIP-6963 discovery, window.ethereum fallback; only eth_requestAccounts + personal_sign ----------
type Eip1193 = { request: (a: { method: string, params?: unknown[] }) => Promise<any>, on?: (ev: string, f: (x: any) => void) => void }
type WalletInfo = { uuid: string, name: string, icon: string, rdns: string }
const found: { info: WalletInfo, provider: Eip1193 }[] = []
let wallet: { address: string, provider: Eip1193, name: string } | null = null
window.addEventListener('eip6963:announceProvider', (e: any) => {
  const d = e.detail; if (!d?.provider || !d?.info || found.some((w) => w.info.uuid === d.info.uuid)) return
  found.push(d); renderWallets()
})
window.dispatchEvent(new Event('eip6963:requestProvider'))
function renderWallets() {
  const list = found.length ? found : (window as any).ethereum ? [{ info: { uuid: 'injected', name: 'Browser wallet', icon: '', rdns: '' }, provider: (window as any).ethereum as Eip1193 }] : []
  $('wallets').innerHTML = wallet
    ? `<span class="pill big l">✓ ${esc(wallet.name)} · ${short(wallet.address, 6, 4)}</span><button class="btn" id="w-disconnect">Use a different wallet</button>`
    : list.length ? list.map((w, i) => `<button class="btn ${i ? '' : 'y'}" data-w="${i}">${w.info.icon?.startsWith('data:image/') ? `<img src="${esc(w.info.icon)}" alt="">` : ''}Connect ${esc(w.info.name)}</button>`).join('')
      : `<span class="note" style="margin:0">No wallet found in this browser. Install the <a href="https://www.coinbase.com/wallet/downloads" target="_blank" rel="noopener">Coinbase Wallet extension</a> (or any browser wallet) and reload — or watch a recorded test without one.</span>`
  $('wallets').querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => b.addEventListener('click', () => connect(list[Number(b.dataset.w)])))
  document.getElementById('w-disconnect')?.addEventListener('click', () => { wallet = null; renderWallets(); paintWallet() })
}
let lastTried: { info: WalletInfo, provider: Eip1193 } | null = null
const walletErr = (e: any, what: string) => {
  const code = e?.code ?? e?.data?.originalError?.code
  return code === 4001 || /reject|denied|cancel/i.test(String(e?.message)) ? `You declined the ${what} in your wallet. Nothing was sent.`
    : code === -32002 ? 'Your wallet already has a request open — open the wallet extension to finish it.'
    : `The wallet did not complete the ${what}: ${e?.message ?? e}`
}
function showWalletErr(msg: string) {
  $('wallet-err').innerHTML = `${esc(msg)} <button class="btn" id="w-retry" style="margin-left:8px">Try again</button>`
  document.getElementById('w-retry')?.addEventListener('click', () => { if (lastTried) connect(lastTried); else { $('wallet-err').textContent = ''; window.dispatchEvent(new Event('eip6963:requestProvider')); renderWallets() } })
}
async function connect(w: { info: WalletInfo, provider: Eip1193 }) {
  $('wallet-err').textContent = ''; lastTried = w; save()
  try {
    const accts: string[] = await w.provider.request({ method: 'eth_requestAccounts' })
    if (!accts?.[0]) throw new Error('The wallet returned no account')
    wallet = { address: accts[0], provider: w.provider, name: w.info.name }
    w.provider.on?.('accountsChanged', (a: string[]) => { if (wallet) { if (a?.[0]) wallet.address = a[0]; else wallet = null; renderWallets(); paintWallet() } })
    guest = false
  } catch (e) { showWalletErr(walletErr(e, 'connection')) }
  renderWallets(); paintWallet()
}
function paintWallet() {
  $('wallet-btn').textContent = wallet ? `● ${short(wallet.address, 6, 4)}` : 'Connect wallet'
  $<HTMLButtonElement>('s1-next').disabled = !wallet && !guest
  $('guest').textContent = guest ? '✓ Continuing without a wallet' : 'Continue without a wallet'
  renderStepper(); renderSummary()
}
$('wallet-btn').addEventListener('click', () => { show('flow'); step(1) })
const hex = (s: string) => '0x' + [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('')
const message = (nonce: string, issued: string) => `Faultline test request\npolicy: ${policy}\nsuite: ${attack}\nmode: ${mode}\nnonce: ${nonce}\nissued: ${issued}`

// ---------- guided flow ----------
let cur = 1, maxStep = 1
const STEPS = ['Connect wallet', 'Driving policy', 'Attack and run type', 'Live view', 'Results and proof']
function renderStepper() {
  $('stepper').innerHTML = STEPS.map((t, i) => {
    const n = i + 1, can = n <= maxStep && (n < 2 || !!wallet || guest || n >= 4)
    return `<li><button class="${n === cur ? 'on' : ''} ${n < maxStep && n !== cur ? 'done' : ''}" data-s="${n}" ${can ? '' : 'disabled'} ${n === cur ? 'aria-current="step"' : ''}><i>${n < maxStep && n !== cur ? '✓' : n}</i><span>${t}</span></button></li>`
  }).join('')
  $('stepper').querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.s))))
}
function step(n: number) {
  if (n < 1) { history.replaceState(null, '', location.pathname); show('home'); return }
  cur = n; maxStep = Math.max(maxStep, n); save()
  if (location.hash !== '#run') history.replaceState(null, '', '#run')
  for (let i = 1; i <= 5; i++) $(`s${i}`).classList.toggle('hidden', i !== n)
  renderStepper(); if (n === 3) renderSummary()
  window.scrollTo({ top: 0 }); requestAnimationFrame(resizeAll)
}
$('s1-next').addEventListener('click', () => step(2))
$('s2-next').addEventListener('click', () => step(3))
$('again').addEventListener('click', () => step(2))

type Policy = { id: string, name: string, description: string, digest: string | null, compatible: boolean | null, paid?: boolean }
const PLAIN: Record<string, string> = {
  'pdm-lite': 'The rule-based planner from the CARLA Leaderboard. It drives on what its own LiDAR sees.',
  'idm-cautious': 'A cautious car-following model that keeps a 1.6-second gap to the car ahead.',
}
let policies: Policy[] = [
  { id: 'pdm-lite', name: 'PDM-Lite', description: '', digest: '0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba', compatible: true, paid: true },
  { id: 'idm-cautious', name: 'Cautious IDM', description: '', digest: null, compatible: true, paid: false },
]
let policy = 'pdm-lite', attack = 'cut-in-v1-kinematic', mode: 'free' | 'paid' = 'free', guest = false
// The flow survives a reload or a wallet warning page: state is saved on every change and restored on load.
const FKEY = 'faultline.flow'
function save() { try { localStorage.setItem(FKEY, JSON.stringify({ step: Math.min(cur, 3), policy, attack, mode, guest, wallet: lastTried?.info.rdns ?? null })) } catch { /* private mode */ } }
function restore(): any { try { return JSON.parse(localStorage.getItem(FKEY) ?? 'null') } catch { return null } }
$('guest').addEventListener('click', () => { guest = true; wallet = null; mode = 'free'; save(); renderWallets(); paintWallet(); renderChoices(); step(2) })
const BYO = 'https://github.com/Soni-Shivam/Pivot_HTE/blob/main/docs/INTEGRATE_YOUR_STACK.md'
$<HTMLAnchorElement>('byo').href = BYO
async function loadPolicies() {
  try { const p = await getJson('/api/policies'); if (Array.isArray(p) && p.length) policies = p } catch { /* built-in list stays */ }
  renderChoices()
}
const ATTACKS = [
  { id: 'cut-in-v1-kinematic', name: 'Cut-in (fast simulation)', line: 'The attacker swerves into your lane and brakes. Simple 2D physics, about 40 seconds.', live: true },
  { id: 'cut-in-v1-carla', name: 'Cut-in (CARLA 3D)', line: 'The same attack in the CARLA 3D simulator with real sensors. About 90 seconds.', live: true },
  { id: 'swarm', name: 'Coordinated multi-vehicle attack', line: 'Four attacker cars coordinate to box the car in. Recorded run — opens in Explore.', live: false },
]
let health: any = null
function radio(group: string, items: { id: string, html: string, disabled?: boolean }[], sel: string) {
  return items.map((i) => `<button class="choice" role="radio" aria-checked="${i.id === sel}" data-${group}="${esc(i.id)}" ${i.disabled ? 'disabled' : ''}>${i.html}</button>`).join('')
}
function renderChoices() {
  $('policies').innerHTML = radio('pol', policies.map((p) => ({ id: p.id,
    html: `<b>${esc(p.name.replace(/\s*\(.*\)$/, ''))}</b><span>${esc(PLAIN[p.id] ?? p.description)}</span><small>${p.compatible ? '✓ Passed our compatibility check' : 'Compatibility not checked'}</small>` })), policy)
  const carlaDown = health && !health.carla
  $('attacks').innerHTML = radio('atk', ATTACKS.map((a) => ({ id: a.id, disabled: a.id === 'cut-in-v1-carla' && carlaDown,
    html: `<b>${esc(a.name)}</b><span>${esc(a.line)}</span>${a.id === 'cut-in-v1-carla' && carlaDown ? '<small>CARLA is offline right now</small>' : a.live ? '' : '<small>Opens the recording →</small>'}` })), attack)
  const paidOk = policies.find((p) => p.id === policy)?.paid !== false && !guest
  $('modes').innerHTML = radio('mode', [
    { id: 'free', html: '<b>Free demo run</b><span>Real 0G decisions. Not paid and not anchored on-chain.</span>' },
    { id: 'paid', disabled: !paidOk, html: `<b>Paid run (0.001 ℏ)</b><span>Our agent pays on Hedera (x402); the result is anchored on 0G Galileo and stored on 0G Storage.</span>${paidOk ? '' : guest ? '<small>Paid runs need a wallet signature</small>' : '<small>Paid runs are bound to PDM-Lite</small>'}` },
  ], mode)
  document.querySelectorAll<HTMLButtonElement>('[data-pol]').forEach((b) => b.addEventListener('click', () => { policy = b.dataset.pol!; if (policies.find((p) => p.id === policy)?.paid === false) mode = 'free'; save(); renderChoices() }))
  document.querySelectorAll<HTMLButtonElement>('[data-atk]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.atk === 'swarm') { gotoExplore('swarm'); return } attack = b.dataset.atk!; save(); renderChoices() }))
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode as 'free' | 'paid'; save(); renderChoices() }))
  renderSummary()
}
function renderSummary() {
  const p = policies.find((x) => x.id === policy), a = ATTACKS.find((x) => x.id === attack)
  $('summary').innerHTML = kv([['Policy', esc(p?.name ?? policy)], ['Attack', esc(a?.name ?? attack)], ['Run type', mode === 'paid' ? 'Paid · our agent pays 0.001 ℏ on Hedera' : 'Free demo · not paid, not anchored'],
    ['Requested by', wallet ? `<code>${esc(wallet.address)}</code>` : guest ? 'Guest (no wallet) · free demo run' : 'connect a wallet first']])
  $('msg-preview').textContent = message('<random nonce>', '<time you click>')
  $<HTMLButtonElement>('start').disabled = (!wallet && !guest) || !online
  $('start').textContent = guest ? 'Start free guest run' : 'Sign and start test'
  $('start-err').textContent = !wallet && !guest ? 'Connect a wallet (or continue without one) in step 1 first.' : !online ? 'The live console is offline — watch a recorded test in Explore instead.' : ''
}
$('start').addEventListener('click', async () => {
  if (guest && !wallet) {
    const btn = $<HTMLButtonElement>('start'); btn.disabled = true
    try { const r = await postJson('/api/demo-run', { policy, suite: attack, mode: 'free', guest: true }); startStream(r.jobId, 'live', 'job', true) }
    catch (e) { $('start-err').textContent = `Not started: ${(e as Error).message}` } finally { btn.disabled = false }
    return
  }
  if (!wallet) return
  const btn = $<HTMLButtonElement>('start'); btn.disabled = true; $('start-err').textContent = 'Waiting for your wallet signature…'; save()
  try {
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const msg = message(nonce, new Date().toISOString())
    const signature: string = await wallet.provider.request({ method: 'personal_sign', params: [hex(msg), wallet.address] })
    $('start-err').textContent = 'Signed. Queuing your test…'
    const r = await postJson('/api/demo-run', { policy, suite: attack, mode, address: wallet.address, message: msg, signature })
    $('start-err').textContent = ''
    startStream(r.jobId, 'live', 'job', mode === 'free')
  } catch (e) { const m = (e as any)?.code != null ? walletErr(e, 'signature') : `Not started: ${(e as any)?.message ?? e}`; $('start-err').textContent = m } finally { btn.disabled = false }
})

// ---------- live ----------
let ticks: Tick[] = [], decisions: Decision[] = [], runMeta: Run | null = null, allRuns: Run[] = [], runFree = false
let waiting: { cp: number, t0: number } | null = null, flashUntil = 0, flashAction = ''
const SAY: Record<string, string> = {
  CUT_IN_AGGRESSIVE: 'Cut sharply into your lane', CUT_IN: 'Cut into your lane', BRAKE_HARD: 'Brake hard in front of you', BRAKE_SOFT: 'Brake gently',
  SLOW_DOWN: 'Slow down', ACCELERATE: 'Speed up', MAINTAIN: 'Hold speed and lane', KEEP_LANE: 'Stay in its lane', COAST: 'Coast', SAFE_HALT: 'Stop safely (no valid answer from 0G)',
}
const say = (a: string | null) => SAY[a ?? 'SAFE_HALT'] ?? String(a).toLowerCase().replace(/_/g, ' ')
function progress(id: string, status: string, title: string, detail = '') {
  let li = document.getElementById(`pg-${id}`)
  if (!li) { li = document.createElement('li'); li.id = `pg-${id}`; li.innerHTML = '<i class="ic"></i><div><div class="t"></div><div class="d"></div></div>'; $('progress').appendChild(li) }
  li.querySelector('.ic')!.className = `ic ${status}`; li.querySelector('.t')!.textContent = title
  if (detail) li.querySelector('.d')!.innerHTML = detail
}
const logLine = (s: string) => { const el = $('log'); el.textContent += s + '\n'; el.scrollTop = el.scrollHeight }
async function startStream(run: string, smode: 'live' | 'replay', by: 'run' | 'job' = 'run', free = false) {
  show('flow'); step(4)
  ticks = []; decisions = []; waiting = null; runMeta = null; runFree = free
  $('progress').innerHTML = ''; $('feed').innerHTML = ''; $('log').textContent = ''; $('to-results').classList.add('hidden')
  $('live-tag').textContent = smode === 'live' ? 'Live' : 'Replay'; $('live-tag').classList.add('live')
  $('s-job').textContent = smode === 'live' ? 'Queued' : 'Recorded test'; $('s-dec').textContent = '0'
  try {
    await post('/api/stream', { [by]: run, mode: smode, speed: smode === 'replay' ? 2 : 1 }, (e) => {
      if (e.t === 'meta') { runMeta = e.run ?? e.job?.result ?? null; if (e.job?.label) $('s-job').textContent = e.job.label }
      if (e.t === 'step') progress(`x-${e.id}`, e.status, e.title ?? e.id, e.status === 'fail' ? esc(e.detail) : '')
      if (e.t === 'phase') {
        const d = e.data ?? {}
        logLine(`${e.status === 'ok' ? '✓' : '·'} ${e.title}`)
        const det = d.hashscan ? link(d.hashscan, 'Hedera receipt') : d.tx ? link(galileoTx(d.tx), '0G Galileo transaction') :
          d.publicRoot ? `0G Storage root ${short(d.publicRoot, 8, 4)}` : ''
        progress(e.id, e.status, e.title, det)
        if (e.id === 'sim' && e.status === 'run') $('s-job').textContent = 'Running'
      }
      if (e.t === 'await0g' && (!waiting || waiting.cp !== e.cp)) { waiting = { cp: e.cp, t0: performance.now() }; renderFeed() }
      if (e.t === 'idle' && waiting) { waiting = null; renderFeed() }
      if (e.t === 'decision') {
        logLine(`0G cp${e.d.cp} ${e.d.action ?? 'SAFE_HALT'} ${e.d.latency_ms}ms ${e.d.request_id}`)
        decisions.push(e.d); waiting = null; flashUntil = performance.now() + 1200; flashAction = e.d.action ?? 'SAFE_HALT'
        $('s-dec').textContent = String(decisions.length); renderFeed(true)
      }
      if (e.t === 'ticks') { ticks.push(...e.rows); const r = ticks.at(-1)!; $('s-t').textContent = `${num(r.t_s, 1)} s`; $('s-gap').textContent = `${num(r.gt_gap, 1)} m`; $('s-ttc').textContent = r.gt_ttc_s == null ? 'safe' : `${num(r.gt_ttc_s, 1)} s` }
      if (e.t === 'log') logLine(e.line)
      if (e.t === 'queue') $('s-job').textContent = e.pos > 0 ? `#${e.pos} in line${e.etaS != null ? ` · about ${Math.round(e.etaS)} s` : ''}` : 'Starting'
      if (e.t === 'done' || e.t === 'error') {
        waiting = null; renderFeed()
        runMeta = e.run ?? e.job?.result ?? runMeta
        progress('report', e.t === 'done' ? 'ok' : 'fail', e.t === 'done' ? 'Report ready' : 'Stopped', e.t === 'done' ? '' : esc(e.message))
        $('live-tag').textContent = e.t === 'done' ? 'Done' : 'Stopped'; $('live-tag').classList.remove('live'); $('s-job').textContent = e.t === 'done' ? 'Finished' : 'Did not finish'
        $('to-results').classList.remove('hidden')
        if (e.t === 'done') setTimeout(() => openResults(), 1200)
      }
    })
  } catch (err) { logLine((err as Error).message); progress('report', 'fail', 'Could not reach the console', esc((err as Error).message)) }
}
function renderFeed(fresh = false) {
  const rows = decisions.slice().reverse().map((d, i) => `<div class="dec ${fresh && i === 0 ? 'new' : ''}">
    <div class="what">${num(d.sim_time_s, 1)} s · ${esc(say(d.action))}</div>
    <div class="meta">${d.source === '0g' ? `answered by 0G in ${d.latency_ms} ms` : `no 0G answer (${esc(d.source)}) — car stopped safely`}</div>
    <details><summary>Raw 0G answer</summary><pre>${esc(JSON.stringify(d, null, 1))}</pre></details></div>`).join('')
  $('feed').innerHTML = (waiting ? `<div class="dec wait"><div class="what">Asking 0G for the next move…</div><div class="meta" id="wait-ms">…</div></div>` : '') +
    (rows || (waiting ? '' : '<div class="meta">Decisions appear here as the attacker makes them.</div>'))
}
$('to-results').addEventListener('click', () => openResults())

// ---------- drawing ----------
function setup(cv: HTMLCanvasElement, hCss?: number) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, h = hCss ?? r.height
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(h * dpr))
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { g, w: r.width, h }
}
function carShape(g: CanvasRenderingContext2D, cx: number, cy: number, lw: number, cw: number, fill: string, ghost = false) {
  g.globalAlpha = ghost ? 0.35 : 1
  g.fillStyle = fill; g.strokeStyle = C.ink; g.lineWidth = 2
  if (lw <= 0 || cw <= 0) { g.globalAlpha = 1; return } // canvas not laid out yet
  g.beginPath(); g.roundRect(cx - lw / 2, cy - cw / 2, lw, cw, Math.min(8, cw / 2.5)); g.fill(); g.stroke()
  g.fillStyle = C.ink; g.beginPath(); g.roundRect(cx + lw * 0.08, cy - cw * 0.32, lw * 0.2, cw * 0.64, 3); g.fill()
  g.globalAlpha = 1
}
function pillAt(g: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, font = '600 12px "Space Grotesk", sans-serif') {
  g.font = font; const w = g.measureText(text).width + 20, h = 24
  g.fillStyle = fill; g.strokeStyle = C.ink; g.lineWidth = 1.5
  g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, 12); g.fill(); g.stroke()
  g.fillStyle = C.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 0.5); g.textAlign = 'left'; g.textBaseline = 'alphabetic'
}
const ttcFill = (t: number | null) => (t == null || t >= 3 ? C.lime : t >= 1.5 ? C.yellow : C.pink)
function drawScene(cv: HTMLCanvasElement, r: Tick | undefined, trail: Tick[], label?: string, pulse = 0) {
  const { g, w, h } = setup(cv)
  const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, C.cyan); bg.addColorStop(1, C.lime)
  g.fillStyle = bg; g.fillRect(0, 0, w, h)
  if (!r) { pillAt(g, w / 2, h / 2, 'Waiting for the simulation to start', C.paper); return }
  const span = 48, ppm = w / span, x0 = r.ego_x - span * 0.28, laneW = 3.5
  const vpm = Math.min(ppm * 1.6, (h - 120) / (laneW * 2)), Y = (lat: number) => h / 2 - (lat - laneW / 2) * vpm
  const X = (x: number) => (x - x0) * ppm
  const top = Y(laneW * 1.5), bot = Y(-laneW / 2)
  g.fillStyle = C.ink; g.beginPath(); g.roundRect(-10, top, w + 20, bot - top, 0); g.fill()
  g.strokeStyle = '#ffffff80'; g.lineWidth = 2; g.setLineDash([3 * ppm, 3 * ppm]); g.lineDashOffset = (r.ego_x * ppm) % (6 * ppm)
  g.beginPath(); g.moveTo(0, Y(laneW / 2)); g.lineTo(w, Y(laneW / 2)); g.stroke(); g.setLineDash([])
  g.strokeStyle = C.pink; g.lineWidth = 3; g.globalAlpha = .6; g.beginPath()
  trail.forEach((p, i) => { const x = X(p.lead_x), y = Y(p.adv_lat_m ?? 0); i ? g.lineTo(x, y) : g.moveTo(x, y) }); g.stroke(); g.globalAlpha = 1
  const egoFront = r.ego_x + 2.45, advRear = r.lead_x - 2.35
  g.strokeStyle = C.paper; g.lineWidth = 2; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(egoFront), Y(r.ego_lat_m ?? 0)); g.lineTo(X(advRear), Y(r.adv_lat_m ?? 0)); g.stroke(); g.setLineDash([])
  const lw = (len: number) => len * ppm, cw = Math.min(1.9 * vpm, lw(4.8) * 0.45)
  carShape(g, X(r.ego_x), Y(r.ego_lat_m ?? 0), lw(4.9), cw, C.purple)
  carShape(g, X(r.lead_x), Y(r.adv_lat_m ?? 0), lw(4.7), cw, r.collision ? C.hot : C.pink)
  pillAt(g, X(r.ego_x), bot + 22, `Your car · ${num(r.ego_v * 3.6, 0)} km/h`, C.paper)
  pillAt(g, X(r.lead_x), top - 22, `AI attacker · ${num(r.lead_v * 3.6, 0)} km/h`, C.pink)
  pillAt(g, w - 110, 28, `${num(r.gt_gap, 1)} m · TTC ${r.gt_ttc_s == null ? '∞' : num(r.gt_ttc_s, 2) + ' s'}`, ttcFill(r.gt_ttc_s), '600 13px "JetBrains Mono", monospace')
  if (pulse > 0 && label) { g.globalAlpha = Math.min(1, pulse * 1.6); pillAt(g, X(r.lead_x), top - 54, label, C.yellow, '700 14px "Space Grotesk", sans-serif'); g.globalAlpha = 1 }
  if (r.collision) pillAt(g, 90, 28, 'Collision', C.hot, '700 14px "Space Grotesk", sans-serif')
}
function drawTele(cv: HTMLCanvasElement, rows: Tick[], ds: Decision[], cursor?: number) {
  const { g, w, h } = setup(cv)
  g.clearRect(0, 0, w, h)
  const T = Math.max(rows.at(-1)?.t_s ?? 1, 1), pad = 8, top = 30, X = (t: number) => pad + (t / T) * (w - pad * 2), Yv = (v: number, max: number) => top + (1 - Math.min(v, max) / max) * (h - top - 18)
  g.strokeStyle = '#1111111a'; g.lineWidth = 1
  for (let i = 0; i <= 3; i++) { const y = top + i * (h - top - 18) / 3; g.beginPath(); g.moveTo(pad, y); g.lineTo(w - pad, y); g.stroke() }
  g.beginPath(); let started = false
  for (const r of rows) { const y = Yv(r.ccs ?? 0, 1); started ? g.lineTo(X(r.t_s), y) : g.moveTo(X(r.t_s), y); started = true }
  if (rows.length) { g.lineTo(X(rows.at(-1)!.t_s), Yv(0, 1)); g.lineTo(X(rows[0].t_s), Yv(0, 1)); g.closePath(); g.fillStyle = C.pink; g.fill(); g.strokeStyle = C.ink; g.lineWidth = 1.5; g.stroke() }
  const line = (val: (r: Tick) => number | null, max: number, color: string, wdt: number) => {
    g.strokeStyle = color; g.lineWidth = wdt; g.beginPath(); let pen = false
    for (const r of rows) { const v = val(r); if (v == null) { pen = false; continue } pen ? g.lineTo(X(r.t_s), Yv(v, max)) : g.moveTo(X(r.t_s), Yv(v, max)); pen = true }
    g.stroke()
  }
  line((r) => r.gt_gap, 30, C.purple, 2.5)
  line((r) => r.gt_ttc_s, 6, C.ink, 2)
  for (const d of ds) { g.fillStyle = d.source === 'none' ? C.hot : C.ink; g.beginPath(); g.arc(X(d.sim_time_s), h - 8, 3.5, 0, Math.PI * 2); g.fill() }
  if (cursor != null) { g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(cursor), top - 6); g.lineTo(X(cursor), h - 14); g.stroke() }
  let lx = pad; g.font = '500 12px "Space Grotesk", sans-serif'
  for (const [c, t] of [[C.pink, 'Danger 0–1'], [C.purple, 'Gap 0–30 m'], [C.ink, 'Time to collision 0–6 s'], [C.ink, '0G decision']] as const) {
    const tw = g.measureText(t).width; g.fillStyle = c === C.ink ? C.ink : c; g.beginPath(); g.roundRect(lx, 4, 10, 10, 5); g.fill(); g.fillStyle = C.ink; g.fillText(t, lx + 14, 13); lx += tw + 30
  }
}

// ---------- results ----------
let worstIdx = 0
const TIP = {
  ttc: 'Time to collision: seconds until the cars touch if nobody changes speed. Under 1.5 s is dangerous.',
  ccs: 'Criticality score from 0 (calm) to 1 (near-crash), computed from gap, closing speed and time to collision.',
}
function openResults() {
  step(5)
  const r = runMeta
  worstIdx = ticks.reduce((m, t, i) => ((t.ccs ?? 0) > (ticks[m]?.ccs ?? 0) ? i : m), 0)
  const at = ticks[worstIdx], cause = decisions.filter((d) => d.sim_time_s < (at?.t_s ?? 0)).at(-1)
  const crashed = r?.collision ?? ticks.some((t) => t.collision)
  const gap = r?.minGap ?? (ticks.length ? Math.min(...ticks.map((t) => t.gt_gap)) : null)
  const k = risk(r?.ccs)
  const headline = crashed ? 'Crashed — the AI attacker forced a collision.' : (r?.ccs ?? 0) >= 0.75 ? `Survived, but only just — closest gap ${num(gap, 1)} m.` : `Survived — closest gap ${num(gap, 1)} m.`
  $('verdict').className = `card verdict ${crashed ? 'p' : k.cls === 'p' ? 'y' : 'l'}`
  $('verdict').innerHTML = `<h2>${esc(headline)}</h2>
    <div class="row" style="margin-top:14px">
      <span class="pill"><span class="tip" tabindex="0" data-tip="${esc(TIP.ttc)}">Tightest time to collision</span>&nbsp;<b>${num(r?.minTtc, 1)} s</b></span>
      <span class="pill"><span class="tip" tabindex="0" data-tip="${esc(TIP.ccs)}">Danger score</span>&nbsp;<b>${num(r?.ccs, 2)} / 1</b></span>
      ${at ? `<span class="pill y">Closest call at ${num(at.t_s, 1)} s${cause ? `, after the attacker chose to “${esc(say(cause.action).toLowerCase())}”` : ''}</span>` : ''}
    </div>`
  const s = $<HTMLInputElement>('scrub'); s.max = String(Math.max(0, ticks.length - 1)); s.value = String(worstIdx)
  drawResults()
  const t = trustFromRun(r, decisions, runFree)
  $('rail-results').innerHTML = railHtml(t)
  const st = r?.storage, ch = r?.chain, p = r?.payment
  $('evidence').innerHTML = kv([
    ['Run', `<code>${esc(r?.name)}</code>`], ['Requested by (signed)', r?.requestedBy ? `<code>${esc(r.requestedBy)}</code>` : '—'],
    ['Attacker model', `<code>${esc(r?.model)}</code>`], ['AI decisions from 0G', `${decisions.filter((d) => d.source === '0g').length} of ${decisions.length}`],
    ['First 0G request ID', t.requestId ? `<code>${esc(t.requestId)}</code>` : '—'],
    ['Signatures archived', st ? `${esc(st.signaturesArchived)} of ${esc(st.signatures0g)}` : '—'],
    ['0G Storage public root', st ? `<code>${esc(st.publicRoot)}</code>` : '—'], ['0G Storage sealed root', st ? `<code>${esc(st.sealedRoot)}</code>` : '—'],
    ['Galileo commit', ch ? link(galileoTx(ch.commitTx), short(ch.commitTx, 10, 6)) : '—'],
    ['Galileo finalize', ch?.finalizeTx ? link(galileoTx(ch.finalizeTx), short(ch.finalizeTx, 10, 6)) : '—'],
    ['Hedera payment', p ? link(p.hashscan, esc(p.transaction)) : '—'],
  ])
}
function drawResults() {
  const i = Number($<HTMLInputElement>('scrub').value), r = ticks[i]
  drawScene($<HTMLCanvasElement>('rscene'), r, ticks.slice(Math.max(0, i - 120), i + 1), (() => { const d = decisions.filter((d) => d.sim_time_s <= (r?.t_s ?? 0)).at(-1); return d ? say(d.action) : undefined })(), 0.8)
  drawTele($<HTMLCanvasElement>('rtele'), ticks, decisions, r?.t_s)
  $('scrub-t').textContent = `${num(r?.t_s)} s`
}
$('scrub').addEventListener('input', drawResults)
$('worst').addEventListener('click', async () => {
  const s = $<HTMLInputElement>('scrub'), from = Math.max(0, worstIdx - 60)
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  for (let i = reduce ? worstIdx : from; i <= worstIdx; i++) { s.value = String(i); drawResults(); if (!reduce) await sleep(20) }
})

// ---------- trust rail: which network proved what (fail-closed: a dot is green only when the data proves it) ----------
type Trust = { decisions0g?: number | null; decisions?: number | null; requestId?: string | null; provider?: string | null
  sigsVerified?: number | null; sigsTotal?: number | null; sigsArchived?: number | null; publicRoot?: string | null; sealedRoot?: string | null
  commitTx?: string | null; finalizeTx?: string | null; onchainMatches?: boolean | null; commitBeforeFirst?: boolean | null; registry?: string | null
  agentId?: number | null; hedera?: { transaction: string; hashscan: string } | null; arkiv?: string | null; free?: boolean; note?: string }
const ERC8004 = '0x8004A818BFB912233c491871b3d84c89A494BD9e'
const galileoAddr = (a: string) => `https://chainscan-galileo.0g.ai/address/${a}`
function trustFromRun(r: Run | null, ds: Decision[], free = false): Trust {
  const zg = ds.filter((d) => d.source === '0g'), first = zg[0]
  const ch = r?.chain, st = r?.storage
  const cbf = ch?.committedBeforeFirstCall ?? (ch?.commitBlockTimestamp && first?.wall_clock_utc ? ch.commitBlockTimestamp * 1000 < Date.parse(first.wall_clock_utc) : null)
  return { decisions0g: zg.length || r?.decisions0g, decisions: ds.length || r?.decisions, requestId: first?.request_id, provider: first?.provider,
    sigsVerified: st?.signaturesVerified ?? null, sigsTotal: st?.signatures0g ?? null, sigsArchived: st?.signaturesArchived ?? null,
    publicRoot: st?.publicRoot, sealedRoot: st?.sealedRoot, commitTx: ch?.commitTx, finalizeTx: ch?.finalizeTx, onchainMatches: ch?.onchainMatches,
    commitBeforeFirst: cbf, registry: ch?.registry, agentId: r?.agentId ?? null, hedera: r?.payment ? { transaction: r.payment.transaction, hashscan: r.payment.hashscan } : null,
    arkiv: r?.arkivEntity ?? null, free: free || !!r?.free }
}
function railHtml(t: Trust) {
  type S = 'up' | 'part' | 'down' | ''
  const WORD: Record<S, string> = { up: 'proven', part: 'partly proven', down: 'check failed', '': 'not proven' }
  const card = (s: S, net: string, body: string, proves: string, href?: string | null) => {
    const inner = `<span class="n"><i class="dot ${s}" aria-hidden="true"></i>${net}<span class="sr"> — ${WORD[s]}</span>${href ? ' ↗' : ''}</span><span class="s">${body}</span>`
    return href ? `<a class="tp" href="${esc(href)}" target="_blank" rel="noopener" data-tip="${esc(proves)}">${inner}</a>` : `<span class="tp" tabindex="0" data-tip="${esc(proves)}">${inner}</span>`
  }
  const sigOk = t.sigsVerified != null && t.sigsTotal != null && t.sigsTotal > 0 && t.sigsVerified === t.sigsTotal
  const has0g = (t.decisions0g ?? 0) > 0 && !!t.requestId
  const freeNote = 'Free demo runs aren’t paid or anchored — run a paid test to anchor.'
  const out = [
    card(has0g ? (sigOk ? 'up' : 'part') : '', '0G Private Computer', has0g ? `${t.decisions0g} of ${t.decisions ?? '—'} moves came from 0G${sigOk ? ` · ${t.sigsVerified} signatures checked` : ' · signatures not checked here'}` : esc(t.note ?? 'No 0G decisions yet'),
      'Proves each attacker move was answered by a model running in 0G’s private (TEE) computer, with a request ID and a signed reply.'),
    card(t.publicRoot ? 'up' : '', '0G Storage', t.publicRoot ? `Run data stored · root ${short(t.publicRoot, 6, 4)}` : t.free ? freeNote : 'Not stored',
      'Proves the full decision log and results were uploaded; anyone can re-download them by this root and re-check the hash.'),
    card(t.onchainMatches === false || t.commitBeforeFirst === false ? 'down' : t.onchainMatches && t.commitBeforeFirst ? 'up' : t.commitTx ? 'part' : '', '0G Galileo chain',
      t.commitTx ? `Committed before the first move ${t.commitBeforeFirst === true ? '✓' : t.commitBeforeFirst === false ? '✗' : '—'} · result matches ${t.onchainMatches === true ? '✓' : t.onchainMatches === false ? '✗' : '—'}` : t.free ? freeNote : 'Not anchored',
      'Proves the test setup was locked on-chain before the attacker’s first move, and the final result hash matches what was stored.', t.commitTx ? galileoTx(t.commitTx) : null),
    card(t.agentId != null ? 'up' : '', 'ERC-8004 identity', t.agentId != null ? `Attacker agent #${t.agentId}` : 'Not linked to this run',
      'Proves which registered AI agent ran the attack, via the ERC-8004 agent registry on 0G Galileo.', galileoAddr(ERC8004)),
    card(t.hedera ? 'up' : '', 'Hedera payment', t.hedera ? `Paid · ${short(t.hedera.transaction, 10, 6)}` : t.free ? 'Free demo run — no payment' : 'No payment',
      'Proves our agent paid for this test with an x402 micropayment on Hedera, with no human approval step.', t.hedera?.hashscan),
    card(t.arkiv ? 'up' : '', 'Arkiv', t.arkiv ? `Public claim ${short(t.arkiv, 6, 4)}` : 'No public claim for this run',
      'Proves a queryable public claim about the result was published on Arkiv.'),
  ]
  return out.join('')
}

// ---------- explore ----------
const RID = (s: string) => `<code>${short(s, 8, 4)}</code>`
const PROVIDER = '0xf4FB8d2bD856e672b5f9848b0eD235A20079B250'
const ARENA_RECORDED = [
  { policy: 'pdm-lite', name: 'PDM-Lite', drivingScore: 60.3, ccs: 0.909, minTtc: 1.11, minGap: 3.49, collision: false },
  { policy: 'idm-cautious', name: 'Cautious IDM', drivingScore: 60.7, ccs: 0.055, minTtc: 3.12, minGap: 3.20, collision: false },
]
type ArenaRow = { policy: string; name?: string; drivingScore: number | null; ccs: number | null; minTtc: number | null; minGap?: number | null; collision: boolean | null }
const th = (label: string, tip?: string) => `<th>${tip ? `<span class="tip" tabindex="0" data-tip="${esc(tip)}">${label}</span>` : label}</th>`
function arenaTable(rows: ArenaRow[]) {
  return `<table><thead><tr>${th('Policy')}${th('Driving score', 'CARLA Leaderboard score: route progress minus penalties (higher is better).')}${th('Danger', TIP.ccs)}${th('Tightest TTC', TIP.ttc)}${th('Closest gap')}${th('Crash')}</tr></thead><tbody>${rows.map((r) =>
    `<tr><td>${esc(r.name ?? r.policy)}</td><td class="mono">${num(r.drivingScore, 1)}</td><td><span class="pill sm ${risk(r.ccs).cls}">${num(r.ccs, 2)}</span></td>
     <td class="mono">${num(r.minTtc, 1)} s</td><td class="mono">${num(r.minGap, 1)} m</td><td>${r.collision ? 'yes' : r.collision === false ? 'no' : '—'}</td></tr>`).join('')}</tbody></table>`
}
const PAID002: Trust = { decisions0g: 7, decisions: 8, requestId: '95718d4a-8007-40eb-b859-b4019ad1c70f', provider: PROVIDER, sigsVerified: 7, sigsTotal: 7,
  publicRoot: '0xc1219e48d517edabbea12db2bddf21294bcd5ddb106b00d963d8837cb75f6748', sealedRoot: '0x47b995a796e09cb39372e901b12da52edb5c4299add069416baccc440d9a71fa',
  commitTx: '0x512ead9bd41cbf78313df571195226533d7bfaaeec02501b7c8e2f7f39643372', finalizeTx: '0x1ece91e630a9dcdcd326515b57934e02c0c1c5e84e339020fe0a6819e3f7f7ab', onchainMatches: true, commitBeforeFirst: true,
  registry: '0xeE2260cE4835059F0e0f1FB9C9948Ca5a7d4b5A4', agentId: 579, hedera: { transaction: '0.0.9185802@1794006563.434123686', hashscan: 'https://hashscan.io/testnet/transaction/0.0.9185802@1794006563.434123686' } }
const section = (id: string, cls: string, title: string, why: string, body: string) =>
  `<div class="card ${cls}" id="x-${id}"><div class="head"><h2>${title}</h2></div><p class="lede" style="margin-top:-6px">${why}</p>${body}</div>`
let explored = false
function renderExplore() {
  if (explored) { loadRuns(); return }
  explored = true
  $('explore').innerHTML = [
    section('runs', '', 'Recorded tests', 'Replay any finished test decision by decision — free, no wallet needed.', `<div class="tscroll" style="margin-top:12px"><table><thead><tr>${th('Test')}${th('Simulator')}${th('AI moves from 0G')}${th('Danger', TIP.ccs)}${th('Tightest TTC', TIP.ttc)}${th('')}</tr></thead><tbody id="runs"><tr><td colspan="6">Loading…</td></tr></tbody></table></div>`),
    section('swarm', 'c', 'Coordinated multi-vehicle attack', 'One planning call to 0G assigns roles to four cars; then a 0G call every second steers all four at once to box the self-driving car in.',
      `<div class="split"><div>${video('videos/swarm-carla-010__stitched.mp4', 'Four-car swarm attack in CARLA')}</div><div><dl class="kv">${kv([['Moves from 0G', '10 of 10 (0 safe stops)'], ['Closest gap', '3.5 m'], ['Tightest TTC', '1.1 s'], ['Crash', 'none'], ['Plan request', RID('e1a9a298-520d-42bf-ad30-ad67d0cc5894')], ['Anchored on-chain', 'no (prototype run)']])}</dl></div></div>
       <div class="rail" style="margin-top:14px">${railHtml({ decisions0g: 10, decisions: 10, requestId: 'e1a9a298-520d-42bf-ad30-ad67d0cc5894', provider: PROVIDER, sigsVerified: 10, sigsTotal: 10, agentId: 579 })}</div>`),
    section('ab', 'y', 'A/B policy comparison', 'Both policies face the exact same scripted attack (replayed, no 0G calls), so the comparison is fair. Recorded at 4 sites; the result was the same at all of them.',
      `<div class="split"><div>${video('videos/arena-script-001__r4l2s24__side_by_side.mp4', 'Side-by-side: PDM-Lite vs cautious IDM under the same attack')}</div><div><div class="tscroll" id="ab-table">${arenaTable(ARENA_RECORDED)}</div>
       <p style="margin:10px 0 0">The cautious model keeps about 3 s to collision; PDM-Lite drops to about 1 s.</p>
       <div class="row" style="margin-top:14px"><button class="btn k" id="ab-run">Run the arena live (free)</button><span class="pill sm" id="ab-status" aria-live="polite">recorded result shown</span></div><p class="err" id="ab-err"></p></div></div>`),
    section('paid002', 'c', 'Paid test run', 'Our agent paid 0.001 ℏ on Hedera, got a single-use permit, locked the test setup on 0G Galileo, ran it in CARLA with 0G decisions, stored the evidence on 0G Storage, and finalized the result on-chain.',
      `<div class="split"><div>${video('videos/paid-job-002-replay-view__chase.mp4', 'Paid CARLA test 002, replayed from its recorded decisions')}</div><div><dl class="kv">${kv([['Payment', link(PAID002.hedera!.hashscan, 'Hedera receipt')], ['Setup locked (block 64245811)', link(galileoTx(PAID002.commitTx!), short(PAID002.commitTx, 8, 4))], ['Moves from 0G', '7 of 8 (one safe stop)'], ['Evidence stored', `root ${short(PAID002.publicRoot, 8, 4)}`], ['Result finalized', link(galileoTx(PAID002.finalizeTx!), short(PAID002.finalizeTx, 8, 4))], ['Permit reused?', 'refused (409)'], ['Result', 'danger 0.93 · tightest TTC 1.0 s · no crash']])}</dl></div></div>
       <div class="rail" style="margin-top:14px">${railHtml(PAID002)}</div>`),
    section('research', 'l', 'Research mission', 'The 0G agent ran experiments to find the edge between safe and unsafe settings, found a crash, and tested a proposed fix. Each dot below is one experiment it chose.',
      `<div class="split"><div>${video('videos/research-mission-001__carla-failure.mp4', 'The crash the research agent found, reproduced in CARLA')}</div><div><canvas id="hunt" style="width:100%;height:240px;display:block" aria-label="Experiments chosen by the 0G agent"></canvas></div></div>
       <dl class="kv">${kv([['Smallest failing case', 'speed 18.75 m/s · gap 25 m · reaction delay 0.6 s → crash'], ['0G’s suggested fix (min gap 3 m)', 'did not help (0.36 m)'], ['Grid-searched fix', 'safe: unsafe cases 19 → 0'], ['Self-audit of its claims', '5 supported · 2 contradicted']])}</dl>
       <details class="more"><summary>Experiment log</summary><div class="feed" id="hunt-feed" style="max-height:220px"></div></details>
       <div class="rail" style="margin-top:14px">${railHtml({ decisions0g: 9, decisions: 9, requestId: 'a00eb00f-1205-4518-ad7d-095c6e6a2ffb', provider: PROVIDER, sigsVerified: 47, sigsTotal: 47, agentId: 579 })}</div>`),
  ].join('')
  $('ab-run').addEventListener('click', runArena)
  loadRuns(); drawHunt()
}
async function loadRuns() {
  try { allRuns = await getJson('/api/runs') } catch { /* offline: keep what we have */ }
  const el = document.getElementById('runs'); if (!el) return
  el.innerHTML = allRuns.slice(0, 25).map((r) => `<tr><td><code>${short(r.name, 14, 4)}</code>${r.payment ? ' <span class="pill sm p">paid</span>' : ''}</td><td>${esc(r.world)}</td><td>${esc(r.decisions0g)} of ${esc(r.decisions)}</td>
    <td><span class="pill sm ${risk(r.ccs).cls}">${num(r.ccs, 2)}</span></td><td>${num(r.minTtc, 1)} s</td>
    <td style="text-align:right"><button class="pill sm k" data-replay="${esc(r.name)}">Replay</button></td></tr>`).join('') ||
    `<tr><td colspan="6">${online ? 'No recorded tests yet' : 'The console is offline — recorded tests load when it reconnects. The videos above still play.'}</td></tr>`
  el.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach((b) => b.addEventListener('click', () => startStream(b.dataset.replay!, 'replay')))
}
async function pollJob(id: string, onUpdate: (j: any) => void) {
  for (;;) {
    const j = await getJson(`/api/jobs/${encodeURIComponent(id)}`); onUpdate(j)
    if (['done', 'failed', 'error', 'completed'].includes(j.status)) return j
    await sleep(1500)
  }
}
async function runArena() {
  $('ab-err').textContent = ''
  const btn = $<HTMLButtonElement>('ab-run'); btn.disabled = true
  try {
    const r = await postJson('/api/arena', { policies: ['pdm-lite', 'idm-cautious'], mode: 'script' })
    const j = await pollJob(r.jobId, (j) => { $('ab-status').textContent = j.status === 'queued' ? `#${j.queuePos} in line${j.etaS != null ? ` · about ${Math.round(j.etaS)} s` : ''}` : esc(j.status) })
    const rows: ArenaRow[] = j.results ?? []
    if (!rows.length) throw new Error(j.error ?? 'arena returned no results')
    $('ab-table').innerHTML = arenaTable(rows); $('ab-status').textContent = 'live result'
  } catch (e) { $('ab-err').textContent = `${(e as Error).message}${online ? '' : ' — the console is offline; the recorded result is shown.'}` } finally { btn.disabled = false }
}

// ---------- health ----------
let online = false
async function pollHealth() {
  try {
    health = await getJson('/api/health'); online = !!health.ok
    const tip = `Test console online · 0G ${health.zg ? 'ready' : 'not configured'} · Hedera payments ${health.hedera ? 'ready' : 'offline'} · CARLA ${health.carla ? 'online' : 'offline'} · ${health.queue?.running ?? 0} running, ${health.queue?.waiting ?? 0} waiting · ${health.caps?.runs_left ?? '—'} live runs left today`
    $('console-pill').dataset.tip = tip
    $('console-txt').textContent = `Console online${health.queue?.waiting ? ` · ${health.queue.waiting} waiting` : ''}`
  } catch { online = false; health = null; $('console-pill').dataset.tip = 'The test console is unreachable. Recorded tests and videos still work.'; $('console-txt').textContent = 'Console offline' }
  $('console-dot').className = `dot ${online ? 'up' : 'down'}`
  $('offline').classList.toggle('hidden', online)
  renderSummary()
}

// ---------- loop ----------
function frame() {
  if (!$('s4').classList.contains('hidden') && !$('v-flow').classList.contains('hidden')) {
    const r = ticks.at(-1), now = performance.now()
    drawScene($<HTMLCanvasElement>('scene'), r, ticks.slice(-160), flashAction ? say(flashAction) : '', Math.max(0, (flashUntil - now) / 1200))
    drawTele($<HTMLCanvasElement>('tele'), ticks, decisions)
    const wm = document.getElementById('wait-ms'); if (wm && waiting) wm.textContent = `${((now - waiting.t0) / 1000).toFixed(1)} s`
  }
  requestAnimationFrame(frame)
}
function resizeAll() { if (!$('s5').classList.contains('hidden') && ticks.length) drawResults() }
window.addEventListener('resize', resizeAll)

async function boot() {
  const st = restore()
  if (st) { policy = st.policy ?? policy; attack = st.attack ?? attack; mode = st.mode === 'paid' ? 'paid' : 'free'; guest = !!st.guest }
  renderWallets(); paintWallet(); renderChoices(); renderStepper()
  if (location.hash === '#run') { show('flow'); step(Math.max(1, Math.min(3, st?.step ?? 1))) } else show('home')
  // Resume a wallet the user already approved (eth_accounts opens no popup)
  if (st?.wallet !== undefined && location.hash === '#run') setTimeout(async () => {
    const w = found.find((x) => x.info.rdns === st.wallet) ?? found[0] ?? ((window as any).ethereum ? { info: { uuid: 'injected', name: 'Browser wallet', icon: '', rdns: '' }, provider: (window as any).ethereum } : null)
    if (!w || wallet) return
    try { const a: string[] = await w.provider.request({ method: 'eth_accounts' }); if (a?.[0]) { wallet = { address: a[0], provider: w.provider, name: w.info.name }; lastTried = w; guest = false; renderWallets(); paintWallet(); renderChoices() } } catch { /* stays disconnected */ }
  }, 400)
  startLidar()
  requestAnimationFrame(frame)
  await Promise.all([pollHealth(), loadPolicies()])
  renderChoices()
  setInterval(pollHealth, 10000)
}
boot()
let hunt: any = null
async function drawHunt() {
  const cv = document.getElementById('hunt') as HTMLCanvasElement | null; if (!cv) return
  if (!hunt) try { hunt = await fetch('hunt.json').then((r) => r.json()) } catch { return }
  const ex: any[] = hunt.experiments, truth: [number, number][] = hunt.truth
  let n = 0
  const paint = () => {
    const { g, w, h } = setup(cv), pad = 30, X = (d: number) => pad + ((d - 0.3) / 1.2) * (w - pad * 2), Y = (gap: number) => h - pad - (gap / 80) * (h - pad * 2)
    g.clearRect(0, 0, w, h); g.fillStyle = '#ffffffa0'; g.beginPath(); g.roundRect(0, 0, w, h, 16); g.fill()
    g.strokeStyle = C.ink; g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath(); truth.forEach(([d, gap], i) => (i ? g.lineTo(X(d), Y(gap)) : g.moveTo(X(d), Y(gap)))); g.stroke(); g.setLineDash([])
    for (const e of ex.slice(0, n)) { g.fillStyle = e.safe ? C.lime : C.pink; g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(X(e.delay), Y(e.gap), 6, 0, Math.PI * 2); g.fill(); g.stroke() }
    g.fillStyle = C.ink; g.font = '500 11px "Space Grotesk", sans-serif'
    g.fillText('reaction delay 0.3 → 1.5 s', pad, h - 8); g.fillText('gap 0–80 m', 4, 14); g.fillText('green = safe · pink = crash', pad, 28); g.fillText(`--- true safe/unsafe edge · ● experiment ${n}/${ex.length}`, w / 2 - 40, 14)
  }
  const feed = $('hunt-feed')
  const step = () => {
    if (!document.body.contains(cv)) return
    n++; paint()
    const e = ex[n - 1]; if (e) feed.insertAdjacentHTML('afterbegin', `<div>#${e.n} · ${num(e.delay, 2)} s · ${num(e.gap, 1)} m · ${e.safe ? 'safe' : 'unsafe'} · ${short(e.rid, 8, 4)}<br>${esc(e.why)}</div>`)
    if (n < ex.length) setTimeout(step, 350)
  }
  step()
}

// ---------- hero background: real LiDAR point cloud captured from our CARLA Town10 run (scripts/capture_lidar_map.py) ----------
function startLidar() {
  const cv = $<HTMLCanvasElement>('lidar')
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  fetch('town10-lidar.bin').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('no map')))).then((buf) => {
    const n = new DataView(buf).getUint32(0, true), xyz = new Float32Array(buf, 4, n * 3), hc = new Uint8Array(buf, 4 + n * 12, n)
    // height colour ramp blue → green → yellow → red, as packed ABGR for ImageData
    const ramp = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      const t = i / 255, stops = [[40, 90, 255], [40, 220, 120], [250, 230, 60], [255, 60, 60]], k = Math.min(2, Math.floor(t * 3)), f = t * 3 - k
      const c = stops[k].map((a, j) => Math.round(a + (stops[k + 1][j] - a) * f))
      ramp[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]
    }
    let rx = 0; for (let i = 0; i < n; i++) rx = Math.max(rx, Math.abs(xyz[i * 3]), Math.abs(xyz[i * 3 + 1]))
    const az = new Float32Array(n); for (let i = 0; i < n; i++) az[i] = Math.atan2(xyz[i * 3 + 1], xyz[i * 3])
    let visible = true, last = 0
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible && !reduce) requestAnimationFrame(draw) }).observe(cv)
    const draw = (now: number) => {
      if (!visible) return
      if (!reduce && now - last < 33) { requestAnimationFrame(draw); return }
      last = now
      const dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.max(1, Math.round(cv.clientWidth * dpr)), H = Math.max(1, Math.round(cv.clientHeight * dpr))
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
      const g = cv.getContext('2d')!, img = g.createImageData(W, H), px = new Uint32Array(img.data.buffer)
      const a = reduce ? 0.6 : now / 1000 * 0.06, ca = Math.cos(a), sa = Math.sin(a), tilt = 0.95, ct = Math.cos(tilt), st = Math.sin(tilt)
      const sweep = ((now / 1000) * 0.9) % (Math.PI * 2), scale = Math.min(W, H) * 0.95 / rx, cam = rx * 1.6, cx = W * 0.62, cy = H * 0.52
      const sz = dpr > 1.5 ? 2 : 1
      for (let i = 0; i < n; i++) {
        const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2]
        const xr = x * ca - y * sa, yr = x * sa + y * ca
        const yv = yr * ct - z * st, zv = yr * st + z * ct + cam
        if (zv < 1) continue
        const p = cam / zv, X = (cx + xr * scale * p) | 0, Y = (cy + yv * scale * p) | 0
        if (X < 0 || Y < 0 || X >= W - sz || Y >= H - sz) continue
        let d = sweep - az[i] - a; d -= Math.floor(d / (Math.PI * 2)) * Math.PI * 2
        const col = !reduce && d < 0.25 ? 0xffffffff : ramp[hc[i]]
        const o = Y * W + X
        px[o] = col; if (sz > 1) { px[o + 1] = col; px[o + W] = col; px[o + W + 1] = col }
      }
      g.putImageData(img, 0, 0)
      if (!reduce) requestAnimationFrame(draw)
    }
    requestAnimationFrame(draw)
  }).catch(() => { $('lidar-label').textContent = '' })
}
