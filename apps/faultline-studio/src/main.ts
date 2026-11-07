// Faultline Studio. Pages and links come from ./routes (one table); every button goes where its label says.
// Talks only to the agent console (packages/hedera/src/agent-console.ts); the wallet only signs a readable request (EIP-191).
import { orb, startOrbs } from './orb'
import { FEATURED, NAV, SWARM, href, parse, type AttackId, type Page } from './routes'

type Tick = { t_s: number; ego_x: number; ego_v: number; ego_a: number; ego_lat_m: number | null; lead_x: number; lead_v: number
  adv_lat_m: number | null; gt_gap: number; gt_ttc_s: number | null; ttc_s: number | null; lidar_gap: number | null; ccs: number | null; collision: boolean
  cars?: Record<string, { mode?: string }> | null }
type Decision = { cp: number; sim_time_s: number; action: string | null; source: string; reason: string; request_id: string | null
  provider: string | null; latency_ms: number; wall_clock_utc: string; content?: string | null; phase?: string | null }
type Run = { name: string; jobId: string | null; status: string; world: string | null; family: string | null; decisions: number | null
  decisions0g: number | null; ccs: number | null; minTtc: number | null; minGap: number | null; collision: boolean | null
  chain: { registry: string; commitTx: string; finalizeTx: string | null; onchainMatches: boolean | null; commitBlockTimestamp?: number | null; committedBeforeFirstCall?: boolean | null } | null
  storage: { publicRoot: string; sealedRoot: string; signaturesArchived: number | null; signatures0g: number | null; signaturesVerified?: number | null } | null
  payment: { transaction: string; payer: string; suite: string; hashscan: string } | null; episodeId: string | null; model: string | null; agentId?: number | null
  arkivEntity?: string | null; free?: boolean | null; requestedBy?: string | null; video?: string | null; mtime?: number }
type Plan = { name: string, summary: string, roles: Record<string, string>, phases?: unknown }

const C = { ink: '#111111', paper: '#fbfbf6', muted: '#6b6b66', yellow: '#f3f56c', cyan: '#7cecf5', pink: '#f5a3ef', purple: '#7c5cf5', lime: '#c9f36f', hot: '#ff4fc3' }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const esc = (s: unknown) => String(s ?? '-').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const num = (x: unknown, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '-')
const short = (s: unknown, a = 8, b = 6) => (typeof s === 'string' && s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : esc(s))
const risk = (c: number | null | undefined) => (c == null ? { cls: 'l', word: '-' } : c >= 0.75 ? { cls: 'p', word: 'High risk' } : c >= 0.5 ? { cls: 'y', word: 'Medium risk' } : { cls: 'l', word: 'Low risk' })
const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')
const link = (url: string, text: string) => `<a href="${esc(url)}" target="_blank" rel="noopener">${text} ↗</a>`
const galileoTx = (tx: string) => `https://chainscan-galileo.0g.ai/tx/${tx}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const loading = (text: string, state: 'breathing' | 'solving' = 'breathing', dark = false) => `<div class="loading">${orb(state, state === 'solving' ? 64 : 20, { dark })}<span>${esc(text)}</span></div>`
// Set at build time (esbuild --define, FAULTLINE_API_BASE); empty = same origin as the page.
declare const FAULTLINE_API_BASE: string
const API = (typeof FAULTLINE_API_BASE === 'string' ? FAULTLINE_API_BASE : '').replace(/\/$/, '')
const api = (p: string) => API + p
// Videos with a web-sized copy in public/lite (scripts/lite_videos.sh) come from the CDN; any other run video streams from the console.
const LITE = new Set(['videos/video-swarm-fog-001__stitched.mp4', 'videos/arena-live0g-video-001__r7l-2s3__side_by_side.mp4', 'videos/paid-job-002-replay-view__chase.mp4',
  'videos/research-mission-001__carla-failure.mp4', 'videos/research-mission-001__carla-fix-baseline.mp4', 'runs/paid-job-002-replay-view/screen.mp4', 'runs/swarm-carla-010/director.mp4'])
const media = (p: string) => (LITE.has(p) ? '/lite/' + p : api('/media/' + p))
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

// ---------- navigation: one route table (./routes), one view per page ----------
const VIEWS: Page[] = ['home', 'attacks', 'lab', 'run', 'runs', 'proof', 'research', 'stack']
$('nav').innerHTML = NAV.map((n) => `<a href="${n.path}" data-nav="${n.page}">${esc(n.label)}</a>`).join('')
function go(path: string) { history.pushState(null, '', path); route() }
function route() {
  const r = parse(location.pathname)
  if (r.canonical) history.replaceState(null, '', r.canonical + location.search + location.hash)
  const navKey = r.page === 'run' ? 'runs' : r.page
  document.querySelectorAll<HTMLAnchorElement>('nav.top a').forEach((a) => a.classList.toggle('on', a.dataset.nav === navKey))
  $('run-cta').classList.toggle('on', r.page === 'lab')
  for (const v of VIEWS) $(`v-${v}`).classList.toggle('hidden', v !== r.page)
  window.scrollTo({ top: 0 })
  if (r.page === 'lab') openLab()
  else if (r.page === 'run') openRun(r.id!)
  else if (r.page === 'proof') openProof(r.id ?? FEATURED)
  else if (r.page === 'runs') renderRuns()
  else if (r.page === 'research') renderResearch()
  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView())
}
window.addEventListener('popstate', route)
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]')
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || a.getAttribute('href')!.startsWith('/media/')) return
  e.preventDefault(); go(a.getAttribute('href')!)
})
document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-back]')) step(cur - 1) })

// ---------- recorded CARLA clips: CDN copy or the console at /media/<path>, falling back to the public repo ----------
const RAW = 'https://raw.githubusercontent.com/Soni-Shivam/Pivot_HTE/main/'
const armClips = (root: ParentNode) => root.querySelectorAll<HTMLVideoElement>('video[data-src]').forEach((v) => { if (!v.getAttribute('src')) v.src = media(v.dataset.src!) })
document.addEventListener('error', (e) => {
  const v = e.target as HTMLVideoElement
  if (v instanceof HTMLVideoElement && v.dataset.src && !v.src.startsWith(RAW)) v.src = RAW + v.dataset.src
}, true)

// ---------- attacks: one catalogue for the Attacks page and the home strip ----------
// live = runs from the Lab now; recorded = a real 0G run exists but it is not a Lab option yet; dev = preview of the situation only
type Attack = { id: string, title: string, line: string, status: 'live' | 'recorded' | 'dev', media: string, actions: [string, string, string?][] }
const CATALOGUE: Attack[] = [
  { id: 'cut-in', title: 'Cut-in', status: 'live', media: 'clip:cut-in', line: 'One 0G-controlled car overtakes and cuts in ahead of your car, timing the move to your gap and speed.',
    actions: [['Run it live', href.lab('cut-in'), 'k'], ['Watch a recorded run', href.run(FEATURED)]] },
  { id: 'swarm', title: 'Coordinated four-car attack', status: 'live', media: 'img:/stills/box.jpg', line: 'The 0G strategist writes a plan and gives each of four cars a role, then steers all four every second to box your car in.',
    actions: [['Run it live', href.lab('swarm'), 'k'], ['Watch a recorded run', href.run(SWARM)]] },
  { id: 'lead-brake', title: 'Lead vehicle brakes', status: 'recorded', media: 'clip:lead-brake', line: 'The car ahead brakes hard at a moment the 0G attacker picks. Recorded in CARLA and in our research runs; not yet a Lab option.',
    actions: [['Watch a recorded run', href.run('demo-003'), 'k'], ['See the research', href.research('counterfactual')]] },
  { id: 'pedestrian', title: 'Pedestrian steps out', status: 'dev', media: 'clip:pedestrian', line: 'A pedestrian walks out from between parked vehicles into your lane.', actions: [] },
  { id: 'lidar-dropout', title: 'LiDAR dropout', status: 'dev', media: 'clip:lidar-dropout', line: 'The attacker blinds the part of your LiDAR that sees the obstacle for about a second.', actions: [] },
  { id: 'intersection', title: 'Intersection conflict', status: 'dev', media: 'clip:intersection', line: 'A car pulls out of a side street late and fast, across your path.', actions: [] },
]
const STATUS = { live: ['live', 'Runs live'], recorded: ['', 'Recorded run'], dev: ['dev', 'In development'] } as const
const status = (a: Attack) => `<span class="chip ${STATUS[a.status][0]}">${STATUS[a.status][1]}</span>`
const isClip = (a: Attack) => a.media.startsWith('clip:')
const atkMedia = (a: Attack) => isClip(a)
  ? `<video muted loop playsinline preload="none" poster="/clips/${a.media.slice(5)}.jpg" data-loop="/clips/${a.media.slice(5)}.mp4" aria-label="${esc(a.title)}${a.id === 'cut-in' ? '' : ' (preview)'}"></video>`
  : `<img src="${a.media.slice(4)}" alt="${esc(a.title)}" loading="lazy" width="960" height="540">`
// the cut-in clip shows the live attack's situation; the other clips only preview a situation, so they say so
const previewTag = (a: Attack) => isClip(a) && a.id !== 'cut-in' ? '<span class="chip dev">Preview</span>' : ''
$('atk-list').innerHTML = CATALOGUE.map((a) => `<div class="card atk" id="atk-${a.id}"><figure>${atkMedia(a)}${previewTag(a)}</figure>
  <div>${status(a)}<h2>${esc(a.title)}</h2><p>${esc(a.line)}</p>${a.actions.length ? `<div class="row" style="margin-top:16px">${a.actions.map(([t, u, k]) => `<a class="btn ${k ?? ''}" href="${u}">${esc(t)}</a>`).join('')}</div>` : ''}</div></div>`).join('')
document.querySelectorAll('[data-families]').forEach((el) => { el.innerHTML = CATALOGUE.map((a) => `<figure>${atkMedia(a)}<b>${esc(a.title)}</b>${status(a)}</figure>`).join('') })
const loopObs = new IntersectionObserver((es) => es.forEach((e) => {
  const v = e.target as HTMLVideoElement
  if (e.isIntersecting && !matchMedia('(prefers-reduced-motion: reduce)').matches) { if (!v.getAttribute('src')) v.src = v.dataset.loop!; v.play().catch(() => { /* blocked */ }) } else v.pause()
}))
document.querySelectorAll<HTMLVideoElement>('video[data-loop]').forEach((v) => loopObs.observe(v))
document.querySelectorAll<HTMLElement>('[data-orb-slot]').forEach((el) => { el.outerHTML = orb(el.dataset.orbSlot as 'working', 20) })

// ---------- swarm roles: from the run's plan (stream 'plan' event); the home section uses /api/showcase ----------
let ROLES: Record<string, string> = { A: 'Lead vehicle, progressive braking', B: 'Front cut-in, block right lane', C: 'Rear cut-in, compress gap', D: 'Rear guard, maintain safe distance' }
const ROLE_CAR: Record<string, [string, string]> = { A: ['#e5484d', 'red car'], B: ['#f3c623', 'yellow taxi'], C: ['#3b82f6', 'blue car'], D: ['#d63384', 'magenta car'] }
const rolesHtml = (roles = ROLES) => Object.entries(roles).map(([k, v]) => `<li><i style="background:${ROLE_CAR[k]?.[0] ?? '#999'}"></i><b>${esc(k)}</b> ${esc(ROLE_CAR[k]?.[1] ?? '')}: ${esc(v)}</li>`).join('')
const paintRoles = () => document.querySelectorAll('#v-home [data-roles]').forEach((el) => { el.innerHTML = rolesHtml() })
getJson('/api/showcase').then((sc) => { const sw = (Array.isArray(sc?.items) ? sc.items : []).find((x: any) => x.id === 'swarm'); if (sw?.plan?.roles) { ROLES = sw.plan.roles; paintRoles() } }).catch(() => { /* fallback stays */ })
paintRoles()

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
setTimeout(() => { window.dispatchEvent(new Event('eip6963:requestProvider')); renderWallets() }, 500) // late-injecting extensions
window.addEventListener('ethereum#initialized', () => renderWallets())
const walletName = (p: any) => (p?.isCoinbaseWallet ? 'Coinbase Wallet' : p?.isMetaMask ? 'MetaMask' : p?.isRabby ? 'Rabby' : 'Browser wallet')
/** EIP-6963 wallets first, then legacy injection: window.ethereum.providers[] (several wallets), coinbaseWalletExtension, window.ethereum. */
function candidates() {
  const out = [...found], w = window as any
  const add = (p: any) => {
    if (!p || typeof p.request !== 'function' || out.some((x) => x.provider === p || x.info.name === walletName(p))) return
    out.push({ info: { uuid: `legacy-${out.length}`, name: walletName(p), icon: '', rdns: '' }, provider: p })
  }
  for (const p of Array.isArray(w.ethereum?.providers) ? w.ethereum.providers : []) add(p)
  add(w.coinbaseWalletExtension); if (!Array.isArray(w.ethereum?.providers) || !w.ethereum.providers.length) add(w.ethereum) // a multi-wallet shim only proxies providers[]
  return out
}
function renderWallets() {
  const list = candidates()
  $('wallets').innerHTML = wallet
    ? `<span class="pill big l">✓ ${esc(wallet.name)} · ${short(wallet.address, 6, 4)}</span><button class="btn" id="w-disconnect">Use a different wallet</button>`
    : list.length ? list.map((w, i) => `<button class="btn ${i ? '' : 'y'}" data-w="${i}">${w.info.icon?.startsWith('data:image/') ? `<img src="${esc(w.info.icon)}" alt="">` : ''}Connect ${esc(w.info.name)}</button>`).join('')
      : `<span class="note" style="margin:0">No wallet found in this browser. Install the <a href="https://www.coinbase.com/wallet/downloads" target="_blank" rel="noopener">Coinbase Wallet extension</a> (or any browser wallet) and reload, or continue without a wallet for a free run.</span>`
  $('wallets').querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => b.addEventListener('click', () => connect(list[Number(b.dataset.w)])))
  document.getElementById('w-disconnect')?.addEventListener('click', () => { wallet = null; renderWallets(); paintWallet() })
}
let lastTried: { info: WalletInfo, provider: Eip1193 } | null = null, rejects = 0
const walletErr = (e: any, what: string) => {
  const code = e?.code ?? e?.data?.originalError?.code
  console.warn('[wallet]', what, code, e?.message ?? e)
  const rejected = code === 4001 || /reject|denied|cancel/i.test(String(e?.message))
  // Coinbase Wallet rejects the first request from a new site with a one-time warning; only a second rejection is the user's
  if (rejected && what === 'connection' && rejects++ === 0) return 'Coinbase Wallet shows a one-time warning for new sites. Choose Continue in the wallet, then press Connect again.'
  return rejected ? (what === 'connection' ? 'You declined the connection.' : 'You declined the signature in your wallet. Nothing was sent.')
    : code === -32002 ? 'Your wallet already has a request open. Open the wallet extension to finish it.'
    : `The wallet did not complete the ${what}${code != null ? ` (code ${code})` : ''}: ${e?.message ?? e}`
}
function showWalletErr(msg: string) {
  $('wallet-err').innerHTML = `${esc(msg)} <button class="btn y" id="w-retry" style="margin-left:8px">Connect again</button>`
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
  renderWallets(); paintWallet(); renderChoices()
}
function paintWallet() {
  $('wallet-btn').textContent = wallet ? `● ${short(wallet.address, 6, 4)}` : 'Connect wallet'
  $('guest').textContent = guest ? '✓ Continuing without a wallet' : 'Continue without a wallet'
  renderStepper(); renderSummary()
}
// The header button connects in place; it never changes page.
$('wallet-btn').addEventListener('click', () => {
  if (wallet) return
  const c = candidates()
  if (c.length) { connect(c[0]); return } // still inside the click: the wallet popup needs a user gesture
  const b = $('wallet-btn'); b.textContent = 'No wallet found'; b.dataset.tip = 'Install a browser wallet such as Coinbase Wallet and reload. Free runs work without one.'
  setTimeout(() => { if (!wallet) b.textContent = 'Connect wallet' }, 3000)
})
const hex = (s: string) => '0x' + [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('')
const message = (nonce: string, issued: string) => `Faultline test request\npolicy: ${policy}\nsuite: ${attack}\nmode: ${mode}\nnonce: ${nonce}\nissued: ${issued}`

// ---------- Lab: policy → attack → run type → authorize; steps never leave /lab ----------
let cur = 1, maxStep = 1
const STEPS = ['What you test', 'Attack', 'Run type', 'Authorize and start']
function renderStepper() {
  $('stepper').innerHTML = STEPS.map((t, i) => {
    const n = i + 1, can = n <= maxStep
    return `<li><button class="${n === cur ? 'on' : ''} ${n < maxStep && n !== cur ? 'done' : ''}" data-s="${n}" ${can ? '' : 'disabled'} ${n === cur ? 'aria-current="step"' : ''}><i>${n < maxStep && n !== cur ? '✓' : n}</i><span>${t}</span></button></li>`
  }).join('')
  $('stepper').querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.s))))
}
function step(n: number) {
  if (n < 1) { go('/'); return }
  cur = Math.min(4, n); maxStep = Math.max(maxStep, cur); save()
  for (let i = 1; i <= 4; i++) $(`s${i}`).classList.toggle('hidden', i !== cur)
  renderStepper(); if (cur === 4) { renderSummary(); loadPending() }
  window.scrollTo({ top: 0 })
}
$('s1-next').addEventListener('click', () => step(2))
$('s2-next').addEventListener('click', () => step(3))
$('s3-next').addEventListener('click', () => step(4))

type Policy = { id: string, name: string, description: string, digest: string | null, compatible: boolean | null, paid?: boolean }
const PLAIN: Record<string, string> = {
  'pdm-lite': 'The rule-based planner from the CARLA Leaderboard. It drives on what its own LiDAR sees.',
  'idm-cautious': 'A cautious car-following model that keeps a 1.6-second gap to the car ahead.',
}
let policies: Policy[] = [
  { id: 'pdm-lite', name: 'PDM-Lite', description: '', digest: '0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba', compatible: true, paid: true },
  { id: 'idm-cautious', name: 'Cautious IDM', description: '', digest: null, compatible: true, paid: false },
]
const ATTACKS: { id: string, key: AttackId, name: string, line: string }[] = [
  { id: 'cut-in-v1-carla', key: 'cut-in', name: 'Cut-in', line: 'One 0G-controlled car cuts in ahead of yours in CARLA. About 90 seconds.' },
  { id: 'swarm-v1-carla', key: 'swarm', name: 'Coordinated four-car attack', line: '0G writes a plan, then steers four cars every second to box your car in. About 2 minutes.' },
]
const SWARM_SUITE = 'swarm-v1-carla'
let policy = 'pdm-lite', attack = 'cut-in-v1-carla', mode: 'free' | 'paid' = 'free', guest = false
// The Lab survives a reload or a wallet warning page: state is saved on every change and restored on load.
const FKEY = 'faultline.flow'
function save() { try { localStorage.setItem(FKEY, JSON.stringify({ step: cur, policy, attack, mode, guest, wallet: lastTried?.info.rdns ?? null })) } catch { /* private mode */ } }
function restore(): any { try { return JSON.parse(localStorage.getItem(FKEY) ?? 'null') } catch { return null } }
$('guest').addEventListener('click', () => { guest = true; wallet = null; mode = 'free'; save(); renderWallets(); paintWallet(); renderChoices() })
const swarmOk = () => policy === 'pdm-lite'
const paidOk = () => policies.find((p) => p.id === policy)?.paid !== false && attack !== SWARM_SUITE && !guest
/** Keep the three choices consistent: swarm needs PDM-Lite, paid needs cut-in + PDM-Lite + wallet. */
function normalize() { if (attack === SWARM_SUITE && !swarmOk()) attack = 'cut-in-v1-carla'; if (mode === 'paid' && !paidOk()) mode = 'free' }
function openLab() {
  const q = new URLSearchParams(location.search).get('attack')
  if (q === 'swarm' || q === 'cut-in') {
    attack = q === 'swarm' ? SWARM_SUITE : 'cut-in-v1-carla'
    if (q === 'swarm') policy = 'pdm-lite'
    history.replaceState(null, '', '/lab'); cur = 1; save()
  }
  renderChoices(); step(cur)
}
let health: any = null
function radio(group: string, items: { id: string, html: string, disabled?: boolean }[], sel: string) {
  return items.map((i) => `<button class="choice" role="radio" aria-checked="${i.id === sel}" data-${group}="${esc(i.id)}" ${i.disabled ? 'disabled' : ''}>${i.html}</button>`).join('')
}
function renderChoices() {
  normalize()
  $('policies').innerHTML = radio('pol', policies.map((p) => ({ id: p.id,
    html: `<b>${esc(p.name.replace(/\s*\(.*\)$/, ''))}</b><span>${esc(PLAIN[p.id] ?? p.description)}</span><small>${p.compatible ? '✓ Passed our compatibility check' : 'Compatibility not checked'}</small><span class="iface">interface: Python AVStack · LiDAR + speed</span>` })), policy)
  const carlaOk = !!health?.carla
  $('attacks').innerHTML = radio('atk', ATTACKS.map((a) => ({ id: a.id, disabled: a.id === SWARM_SUITE && !swarmOk(),
    html: `<b>${esc(a.name)}</b><span>${esc(a.line)}</span>${a.id === SWARM_SUITE && !swarmOk() ? '<small>Runs against PDM-Lite only. Pick PDM-Lite in step 1.</small>' : ''}` })), attack)
  $('exec-lede').textContent = health ? (carlaOk ? 'CARLA is online: live runs are available.' : 'CARLA is offline right now, so live runs are paused. Recorded runs still play on the Runs page.') : 'Checking CARLA availability…'
  const paidWhy = guest ? 'Paid tests need a wallet signature' : attack === SWARM_SUITE ? 'Paid tests cover the cut-in attack' : policies.find((p) => p.id === policy)?.paid === false ? 'Paid tests are bound to PDM-Lite' : ''
  $('modes').innerHTML = radio('mode', [
    { id: 'free', disabled: !carlaOk, html: '<b>Live demo run</b><span>Real 0G decisions in CARLA now. Free: not paid and not anchored on-chain.</span>' },
    { id: 'paid', disabled: !paidOk() || !carlaOk, html: `<b>Paid anchored test (0.001 HBAR)</b><span>Our agent pays on Hedera (x402); the result is anchored on 0G Galileo and stored on 0G Storage.</span>${paidWhy ? `<small>${esc(paidWhy)}</small>` : ''}` },
  ], mode)
  document.querySelectorAll<HTMLButtonElement>('[data-pol]').forEach((b) => b.addEventListener('click', () => { policy = b.dataset.pol!; save(); renderChoices() }))
  document.querySelectorAll<HTMLButtonElement>('[data-atk]').forEach((b) => b.addEventListener('click', () => { attack = b.dataset.atk!; save(); renderChoices() }))
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode as 'free' | 'paid'; save(); renderChoices() }))
  renderSummary()
}
let startBusy = false
function renderSummary() {
  const p = policies.find((x) => x.id === policy), a = ATTACKS.find((x) => x.id === attack)
  $('pay-line').textContent = mode === 'paid' ? 'Our agent pays 0.001 HBAR through x402 under its spending limit and receives a one-run permit. You never pay.' : 'This live demo run is free: nothing is paid and nothing is anchored.'
  $('summary').innerHTML = kv([['Policy', esc(p?.name ?? policy)], ['Attack', esc(a?.name ?? attack)], ['Run type', mode === 'paid' ? 'Anchored test · our agent pays 0.001 HBAR on Hedera testnet' : 'Live demo · not paid, not anchored'], ...(mode === 'paid' ? [['Spending limit', catalogCap ? `${catalogCap} HBAR per day (agent policy)` : 'agent spending policy'] as [string, string], ['Payment chain', 'Hedera testnet (x402)'] as [string, string]] : []),
    ['Requested by', wallet ? `<code>${esc(wallet.address)}</code>` : guest ? 'Guest (no wallet) · free demo run' : 'connect a wallet or continue without one']])
  $('msg-preview').textContent = message('<random nonce>', '<time you click>')
  $<HTMLButtonElement>('start').disabled = (!wallet && !guest) || !online || startBusy
  $('start').textContent = wallet ? 'Sign and start test' : 'Start free run'
  if (!startBusy) $('start-err').textContent = !wallet && !guest ? 'Connect a wallet above, or continue without one for a free run.' : !online ? 'The live console is offline. Recorded runs are on the Runs page.' : ''
}
const startStatus = (text: string) => { $('start-err').innerHTML = `<span class="note-start">${orb('connecting', 20)}${esc(text)}</span>` }
$('start').addEventListener('click', async () => {
  if (!wallet && !guest) return
  const btn = $<HTMLButtonElement>('start'); btn.disabled = true; startBusy = true; save()
  try {
    let body: Record<string, unknown> = { policy, suite: attack, mode: 'free', guest: true }
    if (wallet) {
      startStatus('Waiting for your wallet signature…')
      const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
      const msg = message(nonce, new Date().toISOString())
      const signature: string = await wallet.provider.request({ method: 'personal_sign', params: [hex(msg), wallet.address] })
      body = { policy, suite: attack, mode, address: wallet.address, message: msg, signature }
    }
    startStatus('Queuing your test…')
    const r = await postJson('/api/demo-run', body)
    startBusy = false; $('start-err').textContent = ''
    go(href.run(r.jobId))
  } catch (e) { startBusy = false; $('start-err').textContent = (e as any)?.code != null ? walletErr(e, 'signature') : `Not started: ${(e as any)?.message ?? e}` } finally { startBusy = false; btn.disabled = false }
})
async function loadPolicies() {
  try { const p = await getJson('/api/policies'); if (Array.isArray(p) && p.length) policies = p } catch { /* built-in list stays */ }
  renderChoices()
}
// never pay twice: paid jobs whose run never started stay launchable
let catalogCap: string | null = null
async function loadPending() {
  try {
    const c = await getJson('/api/catalog'); catalogCap = c.cap ? (Number(c.cap) / 1e8).toString() : null
    const list: any[] = c.pending ?? []
    $('pending-box').innerHTML = list.length ? `<div class="note"><b>Paid but not started.</b> These tests were paid and not run yet; launch one instead of paying again.${list.map((j) => `<div class="row" style="margin-top:8px"><code>${short(j.jobId, 8, 4)}</code> ${link(j.hashscan, 'payment')} <button class="btn" data-launch="${esc(j.jobId)}">Launch</button></div>`).join('')}</div>` : ''
    $('pending-box').querySelectorAll<HTMLButtonElement>('[data-launch]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true
      try { const r = await postJson('/api/launch', { jobId: b.dataset.launch }); go(href.run(String(r.run))) } catch (e) { $('start-err').textContent = (e as Error).message; b.disabled = false }
    }))
    renderSummary()
  } catch { /* console offline */ }
}

// ---------- telemetry chart ----------
function setup(cv: HTMLCanvasElement, hCss?: number) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, h = hCss ?? r.height
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(h * dpr))
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { g, w: r.width, h }
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
  for (const [c, t] of [[C.pink, 'CCS 0–1 (recomputed)'], [C.purple, 'Gap 0–30 m (ground truth)'], [C.ink, 'TTC 0–6 s, capped (ground truth)'], [C.ink, '0G decision']] as const) {
    const tw = g.measureText(t).width; g.fillStyle = c; g.beginPath(); g.roundRect(lx, 4, 10, 10, 5); g.fill(); g.fillStyle = C.ink; g.fillText(t, lx + 14, 13); lx += tw + 30
  }
}

// ---------- trust rail: which network proved what (fail-closed: a dot is green only when the data proves it) ----------
const TIP = {
  ttc: 'Time to collision: seconds until the cars touch if nobody changes speed. Under 1.5 s is dangerous.',
  ccs: 'Criticality score from 0 (calm) to 1 (near-crash), computed from gap, closing speed and time to collision.',
}
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
  type S = 'up' | 'part' | 'down' | 'id' | ''
  const WORD: Record<S, string> = { up: 'proven', part: 'partly proven', down: 'check failed', id: 'identity information', '': 'not proven' }
  const card = (s: S, net: string, body: string, proves: string, url?: string | null) => {
    const inner = `<span class="n"><i class="dot ${s}" aria-hidden="true"></i>${net}<span class="sr">: ${WORD[s]}</span>${url ? ' ↗' : ''}</span><span class="s">${body}</span>`
    return url ? `<a class="tp" href="${esc(url)}" target="_blank" rel="noopener" data-tip="${esc(proves)}">${inner}</a>` : `<span class="tp" tabindex="0" data-tip="${esc(proves)}">${inner}</span>`
  }
  const sigOk = t.sigsVerified != null && t.sigsTotal != null && t.sigsTotal > 0 && t.sigsVerified === t.sigsTotal
  const has0g = (t.decisions0g ?? 0) > 0 && !!t.requestId
  const freeNote = 'Free demo runs aren’t paid or anchored. Run a paid test to anchor.'
  return [
    card(has0g ? (sigOk ? 'up' : 'part') : '', '0G Private Computer', has0g ? `${t.decisions0g} of ${t.decisions ?? '-'} moves came from 0G${sigOk ? ` · ${t.sigsVerified} signatures checked` : ' · signatures not checked here'}` : esc(t.note ?? 'No 0G decisions yet'),
      'Proves each attacker move was answered by a model running in 0G’s private (TEE) computer, with a request ID and a signed reply.'),
    card(t.publicRoot ? 'up' : '', '0G Storage', t.publicRoot ? `Run data stored · root ${short(t.publicRoot, 6, 4)}` : t.free ? freeNote : 'Not stored',
      'Proves the full decision log and results were uploaded; anyone can re-download them by this root and re-check the hash.'),
    card(t.onchainMatches === false || t.commitBeforeFirst === false ? 'down' : t.onchainMatches && t.commitBeforeFirst ? 'up' : t.commitTx ? 'part' : '', '0G Galileo chain',
      t.commitTx ? `Committed before the first move ${t.commitBeforeFirst === true ? '✓' : t.commitBeforeFirst === false ? '✗' : '-'} · result matches ${t.onchainMatches === true ? '✓' : t.onchainMatches === false ? '✗' : '-'}` : t.free ? freeNote : 'Not anchored',
      'Proves the test setup was locked on-chain before the attacker’s first move, and the final result hash matches what was stored.', t.commitTx ? galileoTx(t.commitTx) : null),
    card('id', 'ERC-8004 identity', `Attacker agent #${t.agentId ?? 579} (identity on 0G Galileo)`,
      'The attacker’s registered identity in the ERC-8004 agent registry on 0G Galileo. Identity information, not a per-run proof.', galileoAddr(ERC8004)),
    card(t.hedera ? 'up' : '', 'Hedera payment', t.hedera ? `Paid · ${short(t.hedera.transaction, 10, 6)}` : t.free ? 'Free demo run, no payment' : 'No payment',
      'Proves our agent paid for this test with an x402 micropayment on Hedera, with no human approval step.', t.hedera?.hashscan),
    card(t.arkiv ? 'up' : '', 'Arkiv', t.arkiv ? `Public claim ${short(t.arkiv, 6, 4)}` : 'No public claim for this run',
      'Proves a queryable public claim about the result was published on Arkiv.'),
  ].join('')
}

// ---------- Runs: featured, A/B comparison, the full list ----------
const ARENA_RECORDED = [
  { policy: 'pdm-lite', name: 'PDM-Lite', drivingScore: 60.3, ccs: 0.909, minTtc: 1.11, minGap: 3.49, collision: false },
  { policy: 'idm-cautious', name: 'Cautious IDM', drivingScore: 60.7, ccs: 0.055, minTtc: 3.12, minGap: 3.20, collision: false },
]
type ArenaRow = { policy: string; name?: string; drivingScore: number | null; ccs: number | null; minTtc: number | null; minGap?: number | null; collision: boolean | null }
const th = (label: string, tip?: string) => `<th>${tip ? `<span class="tip" tabindex="0" data-tip="${esc(tip)}">${label}</span>` : label}</th>`
function arenaTable(rows: ArenaRow[]) {
  return `<table><thead><tr>${th('Policy')}${th('Driving score', 'CARLA Leaderboard score: route progress minus penalties (higher is better).')}${th('Danger', TIP.ccs)}${th('Tightest TTC', TIP.ttc)}${th('Closest gap')}${th('Crash')}</tr></thead><tbody>${rows.map((r) =>
    `<tr><td>${esc(r.name ?? r.policy)}</td><td class="mono">${num(r.drivingScore, 1)}</td><td><span class="pill sm ${risk(r.ccs).cls}">${num(r.ccs, 2)}</span></td>
     <td class="mono">${num(r.minTtc, 1)} s</td><td class="mono">${num(r.minGap, 1)} m</td><td>${r.collision ? 'yes' : r.collision === false ? 'no' : '-'}</td></tr>`).join('')}</tbody></table>`
}
$('ab-table').innerHTML = arenaTable(ARENA_RECORDED)
$('ab-run').addEventListener('click', runArena)
const FAMILY: Record<string, string> = { swarm: 'Four-car', lead_brake: 'Lead brake', cut_in: 'Cut-in' }
const attackOf = (r: Run) => FAMILY[r.family ?? ''] ?? (r.name.includes('swarm') ? 'Four-car' : 'Cut-in')
let allRuns: Run[] = []
async function renderRuns() {
  armClips($('v-runs'))
  const el = $('runs')
  if (!allRuns.length) el.innerHTML = `<tr><td colspan="6">${loading('Loading runs…')}</td></tr>`
  try { allRuns = await getJson('/api/runs') } catch { /* offline: keep what we have */ }
  // presentable runs only: paid, demo, swarm and featured runs that finished; no debug, stale or empty rows
  const ok = (r: Run) => /^(paid-|demo-free-|demo-00[1-3]$|cutin-00[12]$|swarm-carla-0(08|10)$)/.test(r.name) && r.decisions != null && r.ccs != null && !r.name.includes('replay')
    && !(r.status === 'running' && Date.now() - (r.mtime ?? 0) > 10 * 60_000)
  el.innerHTML = allRuns.filter(ok).slice(0, 30).map((r) => `<tr><td><a href="${href.run(r.name)}"><code>${short(r.name, 14, 4)}</code></a>${r.payment ? ' <span class="pill sm p">paid</span>' : ''}</td><td>${attackOf(r)}</td><td>${esc(r.decisions0g)} of ${esc(r.decisions)}</td>
    <td><span class="pill sm ${risk(r.ccs).cls}">${num(r.ccs, 2)}</span></td><td>${num(r.minTtc, 1)} s</td>
    <td style="text-align:right"><a class="pill sm k" href="${href.run(r.name)}">Open run</a></td></tr>`).join('') ||
    `<tr><td colspan="6">${online ? 'No recorded runs yet.' : 'The console is offline. The run list loads when it reconnects; the featured runs above still play.'}</td></tr>`
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
    const j = await pollJob(r.jobId, (j) => { $('ab-status').innerHTML = `${orb('working', 20)} ${j.status === 'queued' ? `#${j.queuePos} in line${j.etaS != null ? ` · about ${Math.round(j.etaS)} s` : ''}` : esc(j.status)}` })
    const rows: ArenaRow[] = j.results ?? []
    if (!rows.length) throw new Error(j.error ?? 'the comparison returned no results')
    $('ab-table').innerHTML = arenaTable(rows); $('ab-status').textContent = 'live result'
  } catch (e) { $('ab-status').textContent = 'recorded result shown'; $('ab-err').textContent = `${(e as Error).message}${online ? '' : '. The console is offline, so the recorded result is shown.'}` } finally { btn.disabled = false }
}

// ---------- health ----------
let online = false
async function pollHealth() {
  try {
    health = await getJson('/api/health'); online = !!health.ok
    const tip = `Test console online · 0G ${health.zg ? 'ready' : 'not configured'} · Hedera payments ${health.hedera ? 'ready' : 'offline'} · CARLA ${health.carla ? 'online' : 'offline'} · ${health.queue?.running ?? 0} running, ${health.queue?.waiting ?? 0} waiting · ${health.caps?.runs_left ?? '-'} live runs left today`
    $('console-pill').dataset.tip = tip
    $('console-txt').textContent = `Console online${health.queue?.waiting ? ` · ${health.queue.waiting} waiting` : ''}`
  } catch { online = false; health = null; $('console-pill').dataset.tip = 'The test console is unreachable. Recorded runs and videos still work.'; $('console-txt').textContent = 'Console offline' }
  $('console-dot').className = `dot ${online ? 'up' : 'down'}`
  $('offline').classList.toggle('hidden', online)
  renderChoices()
}

// ---------- Run page (/run/:id): live job or recorded run; plan, stage, decision timeline, inspector, telemetry, verdict ----------
// Recorded camera for runs whose own folder has none (paid test 002 was replayed in CARLA from its decisions; same trajectory)
const RUN_VIDEO: Record<string, { path: string, aligned: boolean, note?: string }> = {
  [FEATURED]: { path: 'runs/paid-job-002-replay-view/screen.mp4', aligned: true, note: 'Camera from an exact CARLA replay of this paid run (same decisions, same trajectory hash).' },
}
const DIRECTOR_NOTE = 'Director cut with the 0G decision cards inserted, so it is not time-aligned with the timeline.'
const videoOf = (name: string, r: Run | null) => RUN_VIDEO[name] ?? (r?.video ? (r.video.endsWith('director.mp4') ? { path: r.video, aligned: false, note: DIRECTOR_NOTE } : { path: r.video, aligned: true }) : null)
const runTitle = (id: string, swarm = false) => id === FEATURED ? 'Paid test 002' : id === SWARM ? 'Coordinated four-car attack · swarm-carla-010' : swarm ? `Coordinated four-car attack · ${id}` : id
const WHY_SAY: Record<string, string> = {
  CUT_IN_AGGRESSIVE: 'Cut sharply into your lane', CUT_IN: 'Cut into your lane', BRAKE_HARD: 'Brake hard in front of you', BRAKE_SOFT: 'Brake gently',
  SLOW_DOWN: 'Slow down', ACCELERATE: 'Speed up', MAINTAIN: 'Hold speed and lane', KEEP_LANE: 'Stay in its lane', COAST: 'Coast', SAFE_HALT: 'Stop safely (no valid answer from 0G)',
}
const say = (a: string | null) => WHY_SAY[a ?? 'SAFE_HALT'] ?? String(a).replace(/_/g, ' ').toLowerCase()
const why = (d: Decision) => { try { return String(JSON.parse(d.content ?? '').why ?? '') } catch { return '' } }
type Mc = { id: string, run: Run | null, ticks: Tick[], ds: Decision[], sel: number, aligned: boolean, live: boolean, swarm: boolean, plan: Plan | null, state: string, done: boolean }
let mc: Mc | null = null
const MC_STATES = ['Ready', 'Waiting for 0G', 'Executing', 'Completed']
function mcStates(state: string) {
  const bad = state === 'Safe halt' || state === 'Interrupted'
  const order = bad ? ['Ready', 'Waiting for 0G', 'Executing', state] : MC_STATES
  const at = order.indexOf(state)
  $('mc-states').innerHTML = order.map((x, i) => `<li class="${i < at ? 'done' : ''} ${i === at ? (bad ? 'bad' : 'cur') : ''}">${esc(x)}</li>`).join('')
}
function renderPlan(p: Plan) {
  $('mc-plan').classList.remove('hidden')
  $('mc-plan').innerHTML = `<p class="kicker">0G strategist · plan written before the first tick</p><h2 class="sec" style="margin-bottom:8px">“${esc(p.name)}”</h2>
    <p style="margin:0 0 10px">${esc(p.summary)}</p><ul class="roles">${rolesHtml(p.roles)}</ul>`
}
async function openRun(id: string) {
  const live = /^[0-9a-f]{16}$/.test(id)
  mc = { id, run: null, ticks: [], ds: [], sel: -1, aligned: false, live, swarm: id === SWARM, plan: null, state: 'Ready', done: false }
  const me = mc
  $('mc-title').innerHTML = live ? `${orb('breathing', 20, { dark: true })} Live test` : esc(runTitle(id))
  $('mc-kind').textContent = live ? 'Live run' : 'Recorded run'
  $('mc-timeline').innerHTML = ''; $('mc-insp').innerHTML = '<p class="muted">Select a decision on the timeline to inspect it.</p>'; $('mc-verdict').innerHTML = loading(live ? 'The verdict appears when the run ends.' : 'Loading the run…')
  $('mc-overlay').innerHTML = ''; $('mc-note').textContent = ''
  $('mc-plan').classList.add('hidden'); mcStates('Ready')
  const vid = $<HTMLVideoElement>('mc-video'), img = $<HTMLImageElement>('mc-live'), prog = $('mc-progress')
  vid.classList.toggle('hidden', live); prog.classList.toggle('hidden', !live); img.classList.add('hidden'); img.classList.remove('peek'); img.removeAttribute('src')
  $('mc-peek').classList.toggle('hidden', !live); $('mc-worst').classList.toggle('hidden', live)
  vid.removeAttribute('src'); vid.load()
  // the live panel keeps one orb canvas and only changes its state, so it never flickers
  prog.innerHTML = `<div class="mc-orb-row">${orb('breathing', 64, { dark: true, label: 'Run status' })}<div><h3 id="mc-ph"></h3><p class="eta" id="mc-eta"></p></div></div><ol id="mc-rows"></ol>`
  const t0 = performance.now()
  const paintProg = () => {
    if (mc !== me || !me.live) return
    const zgN = me.ds.filter((d) => d.source === '0g').length, el = Math.round((performance.now() - t0) / 1000)
    const queued = me.state === 'Ready' && !me.ticks.length && !me.plan
    const [os, title] = me.done ? ['breathing', 'Run finished, loading the recording']
      : queued ? ['breathing', me.swarm ? 'Starting the four-car attack' : 'Starting your test']
      : me.swarm && !me.plan ? ['weaving', 'The 0G strategist is planning the attack']
      : me.state === 'Waiting for 0G' || !me.ticks.length ? ['searching', 'Asking 0G for the next move']
      : ['working', me.swarm ? 'Four cars are attacking in CARLA' : 'The attacker is driving in CARLA']
    const o = prog.querySelector<HTMLCanvasElement>('canvas.orb'); if (o) o.dataset.orb = os
    $('mc-ph').textContent = title
    $('mc-eta').textContent = `${el} s elapsed · typical run about ${me.swarm ? 120 : 60} s · ${zgN} decisions from 0G`
    $('mc-rows').innerHTML = [
      `<li class="${queued ? 'run' : 'ok'}">${esc($('mc-note').textContent || 'Queued')}</li>`,
      ...(me.swarm ? [`<li class="${me.plan ? 'ok' : 'run'}">${me.plan ? `Plan from 0G: “${esc(me.plan.name)}”` : '0G strategist writing the plan (about 30 s)'}</li>`] : []),
      `<li class="${me.ds.length ? 'ok' : me.state === 'Waiting for 0G' ? 'run' : ''}">${me.ds.length ? 'Connected to 0G (private tier)' : 'Connecting to 0G'}</li>`,
      ...me.ds.map((d) => `<li class="${d.source === '0g' ? 'ok' : 'bad'}">Checkpoint ${d.cp + 1}: ${esc(me.swarm ? d.phase ?? d.action : say(d.action))}${why(d) ? ` · “${esc(why(d))}”` : ''}<small>${d.source === '0g' ? `${d.latency_ms} ms · ${esc(d.request_id)}` : 'no valid 0G answer: safe stop'}</small></li>`)].join('')
  }
  const progT = live ? window.setInterval(paintProg, 1000) : 0
  if (live) paintProg()
  try {
    await post('/api/stream', live ? { job: id, mode: 'live' } : { run: id, mode: 'replay', speed: 8 }, (e) => {
      if (mc !== me) return
      if (e.t === 'meta') {
        me.run = e.run ?? e.job?.result ?? null
        if (e.job?.suite === SWARM_SUITE || me.run?.family === 'swarm') me.swarm = true
        if (live) { $('mc-title').innerHTML = `${orb('breathing', 20, { dark: true })} ${me.swarm ? 'Live coordinated four-car attack' : 'Live cut-in test'}`; $('mc-peek').classList.toggle('hidden', me.swarm) } // swarm runs have no live camera
        else $('mc-title').textContent = runTitle(me.run?.name ?? id, me.swarm)
      }
      if (e.t === 'plan') { me.plan = e.plan; renderPlan(e.plan); if (live) { mcTimeline(); paintProg() } }
      if (e.t === 'queue') { $('mc-note').textContent = e.pos > 0 ? `Queued: position ${e.pos}${e.etaS != null ? `, about ${Math.round(e.etaS)} s` : ''}` : 'Started'; mcStates('Ready') }
      if (e.t === 'phase' && e.id === 'sim' && me.state === 'Ready') { me.state = 'Waiting for 0G'; mcStates(me.state) }
      if (e.t === 'await0g') mcStates(me.state = 'Waiting for 0G')
      if (e.t === 'ticks') { me.ticks.push(...e.rows); if (me.live) { mcStates(me.state = me.state === 'Ready' || me.state === 'Waiting for 0G' ? 'Executing' : me.state); mcOverlay(me.ticks.at(-1)!.t_s) } }
      if (e.t === 'decision') { me.ds.push(e.d); if (e.d.source !== '0g') me.state = 'Safe halt'; else if (me.state !== 'Safe halt') me.state = 'Executing'; if (me.live) { mcStates(me.state); mcTimeline(); paintProg() } }
      if (e.t === 'done' || e.t === 'error') {
        me.run = e.run ?? e.job?.result ?? me.run
        me.state = e.t === 'error' || me.run?.status === 'interrupted' && !me.ds.length ? 'Interrupted' : me.state === 'Safe halt' ? 'Safe halt' : 'Completed'
        if (e.t === 'error') $('mc-note').textContent = `Stopped: ${e.message ?? 'error'}`
      }
    })
  } catch (err) { $('mc-note').textContent = `Could not load this run: ${(err as Error).message}` }
  clearInterval(progT)
  if (mc !== me) return
  me.done = true
  if (me.state === 'Ready' || me.state === 'Executing' || me.state === 'Waiting for 0G') me.state = me.ds.some((d) => d.source !== '0g') ? 'Safe halt' : me.ds.length ? 'Completed' : 'Interrupted'
  mcStates(me.state)
  // a finished live job becomes its run: the address bar switches to the run name so the link survives restarts
  const name = me.run?.name
  if (me.live && name && location.pathname === href.run(id)) { history.replaceState(null, '', href.run(name)); $('mc-title').textContent = runTitle(name, me.swarm); $('mc-kind').textContent = 'Finished live run' }
  const rv = videoOf(name ?? id, me.run)
  if (rv) {
    vid.src = media(rv.path); vid.preload = 'auto'; vid.classList.remove('hidden'); img.classList.add('hidden'); prog.classList.add('hidden'); me.aligned = rv.aligned
    $('mc-peek').classList.add('hidden'); $('mc-worst').classList.remove('hidden'); $('mc-note').textContent = rv.note ?? ''
    if (me.live) { vid.load(); vid.play().catch(() => { /* autoplay blocked: controls stay */ }) }
  } else {
    prog.classList.add('hidden'); vid.classList.remove('hidden'); $('mc-peek').classList.add('hidden')
    $('mc-note').textContent = me.live ? 'The run finished but its recording is not available.' : 'No camera recording exists for this run; the timeline and telemetry come from its recorded data.'
  }
  mcTimeline(); mcTele(); mcVerdict()
  const worst = me.ticks.reduce((m, t, i) => (t.gt_gap < (me.ticks[m]?.gt_gap ?? Infinity) ? i : m), 0)
  mcOverlay(me.ticks[worst]?.t_s ?? 0)
}
const decAt = (t: number) => mc ? mc.ds.filter((d) => d.sim_time_s <= t).at(-1) : undefined
const tickAt = (t: number) => mc ? (mc.ticks.find((x) => x.t_s >= t) ?? mc.ticks.at(-1)) : undefined
function mcOverlay(t: number) {
  if (!mc) return
  if (!$('mc-progress').classList.contains('hidden')) { $('mc-overlay').innerHTML = ''; return } // the progress panel owns the stage while running
  const d = decAt(t), k = tickAt(t)
  $('mc-overlay').innerHTML = (d ? `<span class="act-on">${esc(mc.swarm ? d.action ?? 'SAFE_HALT' : `Attacker: ${d.action ?? 'SAFE_HALT'}`)}</span>` : '<span>Run-up: no decision yet</span>') +
    (k ? `<span>t ${num(k.t_s, 1)} s</span><span>CCS ${num(k.ccs, 2)}</span><span>gap ${num(k.gt_gap, 1)} m</span>` : '')
}
function mcTimeline() {
  if (!mc) return
  const items = mc.ds.map((d, i) => `<button role="listitem" data-di="${i}" class="${i === mc!.sel ? 'on' : ''} ${d.source !== '0g' ? 'halt' : ''}">cp ${d.cp} · ${num(d.sim_time_s, 1)} s<br>${esc(mc!.swarm ? d.phase ?? d.action ?? 'SAFE_HALT' : d.action ?? 'SAFE_HALT')}</button>`)
  const waiting = mc.live && !mc.done && mc.state !== 'Safe halt' && mc.state !== 'Interrupted'
  $('mc-timeline').innerHTML = (mc.plan ? '<button class="plan" data-plan>PLAN<br>0G strategist</button>' : '') + items.join('') +
    (waiting ? `<span class="mc-wait">${orb('searching', 20, { dark: true })}Asking 0G…</span>` : '')
  $('mc-timeline').querySelectorAll<HTMLButtonElement>('[data-di]').forEach((b) => b.addEventListener('click', () => mcSelect(Number(b.dataset.di))))
  $('mc-timeline').querySelector('[data-plan]')?.addEventListener('click', () => $('mc-plan').scrollIntoView({ block: 'center' }))
}
function mcSelect(i: number) {
  if (!mc) return
  mc.sel = i; const d = mc.ds[i], k = tickAt(d.sim_time_s), r = mc.run
  mcTimeline()
  const vid = $<HTMLVideoElement>('mc-video')
  if (mc.aligned && vid.getAttribute('src')) { try { vid.currentTime = d.sim_time_s } catch { /* not loaded yet */ } }
  mcOverlay(d.sim_time_s); mcTele(d.sim_time_s)
  const st = r?.storage, sig = st?.signaturesVerified != null && st.signatures0g ? `${st.signaturesVerified} of ${st.signatures0g} verified for this run` : st?.signaturesArchived != null ? `archived (${st.signaturesArchived}), not re-checked here` : 'not archived for this run'
  const cars = k?.cars ? Object.entries(k.cars).map(([c, v]) => `${c} ${v?.mode ?? '-'}`).join(' · ') : null
  $('mc-insp').innerHTML = `<p class="kicker">Decision inspector</p><h3 style="margin:0 0 8px">Checkpoint ${d.cp}: ${esc(mc.swarm ? d.phase ?? 'joint move' : say(d.action))}</h3>
    ${why(d) ? `<div class="why-q">“${esc(why(d))}”<br><small class="muted">the model’s stated reason</small></div>` : ''}
    <dl>
      <dt>Sim time</dt><dd>${num(d.sim_time_s, 2)} s</dd><dt>Action</dt><dd>${esc(d.action ?? 'SAFE_HALT')}</dd>${cars ? `<dt>Cars</dt><dd>${esc(cars)}</dd>` : ''}
      <dt>Source</dt><dd>${d.source === '0g' ? '0G Router, private tier' : esc(d.source) + ' (safe stop)'}</dd><dt>Latency</dt><dd>${esc(d.latency_ms)} ms</dd>
      <dt>Request ID</dt><dd>${esc(d.request_id)}</dd><dt>Provider</dt><dd>${esc(d.provider)}</dd><dt>Signature</dt><dd>${esc(sig)}</dd>
      <dt>LiDAR gap</dt><dd>${k?.lidar_gap != null ? num(k.lidar_gap, 2) + ' m (measured)' : '-'}</dd><dt>Gap</dt><dd>${num(k?.gt_gap, 2)} m (ground truth)</dd>
      <dt>TTC</dt><dd>${k?.gt_ttc_s == null ? 'no closing' : num(k.gt_ttc_s, 2) + ' s'} (ground truth)</dd><dt>Speeds</dt><dd>car ${num(k?.ego_v, 1)} m/s · nearest attacker ${num(k?.lead_v, 1)} m/s</dd>
      <dt>CCS</dt><dd>${num(k?.ccs, 3)} (recomputed)</dd>
    </dl><details style="margin-top:10px"><summary>Raw response</summary><pre class="msg">${esc(d.content ?? JSON.stringify(d, null, 1))}</pre></details>`
}
function mcTele(cursor?: number) { if (mc) drawTele($<HTMLCanvasElement>('mc-tele'), mc.ticks, mc.ds, cursor) }
function mcVerdict() {
  if (!mc) return
  const r = mc.run, crashed = r?.collision ?? mc.ticks.some((t) => t.collision)
  const words = !mc.ds.length && !mc.ticks.length ? 'This run did not produce any driving data.' : crashed ? 'The vehicle collided with an attacker.' : `The vehicle avoided collision.${r?.minTtc != null ? ` The minimum time to collision was ${num(r.minTtc, 2)} s.` : ''}`
  const name = r?.name ?? mc.id
  $('mc-verdict').innerHTML = `<h2 class="sec">${esc(words)}</h2>
    <div class="stats"><div><b>${num(r?.minGap, 2)} m</b><span>closest gap</span></div><div><b>${num(r?.minTtc, 2)} s</b><span>minimum time to collision</span></div>
    <div><b>${num(r?.ccs, 2)}</b><span>peak criticality (CCS, 0 to 1)</span></div><div><b>${esc(r?.decisions0g ?? mc.ds.filter((d) => d.source === '0g').length)} of ${esc(r?.decisions ?? mc.ds.length)}</b><span>decisions from 0G</span></div></div>
    <div class="head" style="margin:22px 0 8px"><h2>Evidence</h2><span class="muted" style="font-size:14px">A green dot means the data proves it.</span></div>
    <div class="rail">${railHtml(trustFromRun(r, mc.ds, !!r?.free))}</div>
    <div class="row" style="margin-top:16px"><a class="btn k" href="${href.proof(name)}">Check the evidence</a><a class="btn y" href="${href.lab(mc.swarm ? 'swarm' : 'cut-in')}">Run your own test</a><a class="btn" href="${href.runs()}">All runs</a></div>`
}
$<HTMLVideoElement>('mc-video').addEventListener('timeupdate', () => {
  if (!mc?.aligned) return
  const t = $<HTMLVideoElement>('mc-video').currentTime; mcOverlay(t); mcTele(t)
  const d = decAt(t), i = d ? mc.ds.indexOf(d) : -1 // highlight the decision in force at this moment
  $('mc-timeline').querySelectorAll<HTMLButtonElement>('[data-di]').forEach((b) => b.classList.toggle('on', Number(b.dataset.di) === i))
})
$('mc-worst').addEventListener('click', () => {
  if (!mc) return
  const w = mc.ticks.reduce((m, t, i) => (t.gt_gap < (mc!.ticks[m]?.gt_gap ?? Infinity) ? i : m), 0), t = mc.ticks[w]?.t_s ?? 0
  const vid = $<HTMLVideoElement>('mc-video'); if (mc.aligned && vid.getAttribute('src')) { vid.currentTime = Math.max(0, t - 1); vid.pause() }
  mcOverlay(t); mcTele(t)
})
$('mc-peek').addEventListener('click', () => {
  if (!mc?.live) return
  const img = $<HTMLImageElement>('mc-live'), on = img.classList.contains('hidden')
  img.classList.toggle('hidden', !on); img.classList.add('peek')
  if (on) img.src = api(`/api/live/${encodeURIComponent(mc.id)}`); else img.removeAttribute('src')
  $('mc-peek').textContent = on ? 'Hide live preview' : 'Peek live (low frame rate)'
})
window.addEventListener('resize', () => { if (mc && !$('v-run').classList.contains('hidden')) mcTele() })

// ---------- Proof (/proof/:id): three questions, five honest statuses ----------
type PS = 'verified' | 'failed' | 'unavailable' | 'notchecked' | 'na'
const PS_WORD: Record<PS, string> = { verified: 'Verified', failed: 'Failed', unavailable: 'Unavailable', notchecked: 'Not checked', na: 'Not applicable' }
const proof = (st: PS, title: string, guarantee: string, artifact: string, how: string) =>
  `<details class="proof"><summary><b>${esc(title)}</b><span class="st ${st}">${PS_WORD[st]}</span></summary><div class="body"><p>${guarantee}</p><p><b>Artifact:</b> ${artifact}</p><p class="muted">${how}</p><button class="btn" data-recheck>Check again</button></div></details>`
let proofSeq = 0
async function openProof(id: string) {
  const seq = ++proofSeq
  $<HTMLInputElement>('vf-in').value = id
  $('vf-groups').innerHTML = `<div class="card">${loading('Checking the evidence…', 'solving')}</div>`; $('vf-timeline').innerHTML = ''
  let runs: Run[] = []
  try { runs = await getJson('/api/runs') } catch { /* offline */ }
  let r: Run | null = runs.find((x) => x.name === id || x.storage?.publicRoot === id) ?? (mc?.run?.name === id ? mc.run : null)
  if (!r) try { r = /^[0-9a-f]{16}$/.test(id) ? (await getJson(`/api/jobs/${id}`)).result : await getJson(`/api/run?name=${encodeURIComponent(id)}`) } catch { /* not found */ }
  if (seq !== proofSeq) return
  if (!r) { $('vf-groups').innerHTML = `<div class="card">No finished run matches <code>${esc(id)}</code>${online ? '' : ' (the console is offline)'}. Try <a href="${href.proof(FEATURED)}">paid test 002</a>.</div>`; return }
  const ds: Decision[] = []
  try { await post('/api/stream', { run: r.name, mode: 'replay', speed: 8 }, (e) => { if (e.t === 'decision') ds.push(e.d) }) } catch { /* summary only */ }
  if (seq !== proofSeq) return
  const zg = ds.filter((d) => d.source === '0g'), first = zg[0], last = zg.at(-1), ch = r.chain, st = r.storage, p = r.payment
  const cbf = ch?.committedBeforeFirstCall ?? (ch?.commitBlockTimestamp && first?.wall_clock_utc ? ch.commitBlockTimestamp * 1000 < Date.parse(first.wall_clock_utc) : null)
  const runName = r.name
  const ts = (n?: number | null) => (n ? new Date(n * 1000).toISOString().replace('.000', '') : '-')
  $('vf-timeline').innerHTML = `<div class="head"><h2 class="sec" style="margin:0">Timeline: ${esc(runTitle(r.name))}</h2><a class="btn" href="${href.run(r.name)}">Open run</a></div><ol class="vtl">
    <li class="${ch ? 'ok' : 'na'}"><b>Scenario committed</b><span>${ch ? `0G Galileo block time ${ts(ch.commitBlockTimestamp)}` : 'not anchored (free run)'}</span></li>
    <li class="${first ? 'ok' : 'na'}"><b>First 0G decision</b><span>${first ? esc(first.wall_clock_utc) : '-'}</span></li>
    <li class="${last ? 'ok' : 'na'}"><b>Last 0G decision</b><span>${last ? esc(last.wall_clock_utc) : '-'}</span></li>
    <li class="${ch?.finalizeTx ? 'ok' : 'na'}"><b>Result finalized</b><span>${ch?.finalizeTx ? link(galileoTx(ch.finalizeTx), short(ch.finalizeTx, 10, 6)) : 'not finalized'}</span></li></ol>`
  const sigSt: PS = st?.signaturesVerified != null && st.signatures0g ? (st.signaturesVerified === st.signatures0g ? 'verified' : 'failed') : st?.signaturesArchived ? 'notchecked' : zg.length ? 'unavailable' : 'na'
  const g1 = [
    proof(zg.length ? 'verified' : 'unavailable', '0G Router private inference', 'Every attacker move came from the 0G Router on the private tier, which refuses to fall back to another tier.',
      `${zg.length} of ${ds.length} decisions with request IDs${first ? `, first <code>${esc(first.request_id)}</code>` : ''}`, 'Checked here: each decision record names its source and carries a request ID.'),
    proof(sigSt, 'Archived provider signatures', 'The provider’s signature on each response proves which 0G provider answered.', st ? `${esc(st.signaturesArchived ?? 0)} archived, ${esc(st.signaturesVerified ?? 'not')} verified of ${esc(st.signatures0g ?? '-')}` : 'no archive for this run', 'Signatures are archived at publish time because providers drop them after about 20 minutes.'),
    proof('notchecked', 'Attacker identity (ERC-8004 #579)', 'The attacker is registered as agent #579 in the ERC-8004 registry on 0G Galileo.', link(galileoAddr(ERC8004), 'ERC-8004 registry'), 'Not read from the chain by this page; open the registry to check.'),
  ]
  const g2 = [
    proof(st?.publicRoot ? 'notchecked' : 'na', '0G Storage roots', 'The public log and the sealed bundle are stored on 0G Storage; downloading by root and re-hashing proves they are unchanged.', st ? `public <code>${esc(st.publicRoot)}</code><br>sealed <code>${esc(st.sealedRoot)}</code>` : 'Not applicable: free demo runs aren’t anchored or stored', 'Download and re-hash with the verifier CLI (scripts in packages/episode).'),
    proof(cbf === true ? 'verified' : cbf === false ? 'failed' : ch ? 'unavailable' : 'na', 'Committed before the first decision', 'The scenario was locked on-chain before the attacker’s first call, so it could not be picked after seeing results.', ch ? `${link(galileoTx(ch.commitTx), short(ch.commitTx, 10, 6))} at ${ts(ch.commitBlockTimestamp)} vs first decision ${esc(first?.wall_clock_utc ?? '-')}` : 'not anchored', 'Checked here: commit block time compared with the first 0G call.'),
    proof(ch?.onchainMatches === true ? 'verified' : ch?.onchainMatches === false ? 'failed' : ch ? 'unavailable' : 'na', 'Result finalized after the last decision', 'The roots and result hash were written on-chain after the run and match the stored record.', ch?.finalizeTx ? link(galileoTx(ch.finalizeTx), short(ch.finalizeTx, 10, 6)) : 'not finalized', 'Checked by the runner when it finalized: the on-chain record matches the published roots.'),
  ]
  const g3 = [
    proof(p ? 'verified' : 'na', 'Hedera x402 payment', 'Our agent paid for this test on Hedera (quote, spending-policy approval, settlement, one-run permit). The tester only signed the request.', p ? `${link(p.hashscan, esc(p.transaction))} · suite <code>${esc(p.suite)}</code> · payer <code>${esc(p.payer)}</code>` : 'free run: no payment', p ? 'Checked at purchase: the settlement was confirmed on the Hedera mirror node.' : 'Free demo runs are not paid.'),
    proof(r.requestedBy ? 'verified' : 'na', 'Signed test request', 'A wallet signed a readable test request (EIP-191); the console verified it before queuing.', r.requestedBy ? `<code>${esc(r.requestedBy)}</code>` : 'not recorded for this run', 'Checked by the console when the run was requested.'),
  ]
  const grp = (t: string, sub: string, items: string[]) => `<div class="card"><h2 class="sec" style="margin-bottom:4px">${t}</h2><p class="muted" style="margin:0 0 6px">${sub}</p>${items.join('')}</div>`
  $('vf-groups').innerHTML = grp('Who made the decisions?', '0G Router (inference)', g1) + grp('Can the evidence be altered?', '0G Storage and 0G Galileo (storage and chain)', g2) + grp('Who requested and paid?', 'Hedera', g3)
  $('vf-groups').querySelectorAll('[data-recheck]').forEach((b) => b.addEventListener('click', () => openProof(runName)))
}
$('vf-go').addEventListener('click', () => go(href.proof($<HTMLInputElement>('vf-in').value.trim() || FEATURED)))
$('vf-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('vf-go').click() })

// ---------- Research: boundary hunt and claim audit ----------
const CLAIMS: { claim: string, who: string, st: PS, check: string }[] = [
  { claim: 'The crash was caused by friction-limited braking.', who: 'research-mission-001 report', st: 'failed', check: 'In run 21 the car peaked at 5.76 m/s² against a friction limit of 6.28 m/s²: it never used the available grip. The measured mechanism is delayed, under-braking IDM.' },
  { claim: 'Runs are safe above about 30 m.', who: 'research run 003 report', st: 'failed', check: 'Runs 4 and 10 were unsafe above 30 m; the audit marks the claim contradicted.' },
  { claim: 'At 1.5 s reaction delay the boundary is 61.0 m.', who: 'old 0G designer', st: 'failed', check: 'Unsafe outcomes at gaps 61.0 m and 65.0 m are at or above the claimed boundary; the true boundary is 73.63 m.' },
  { claim: 'At 0.3 s reaction delay the boundary is about 29.19 m.', who: 'old 0G designer', st: 'verified', check: 'The ground-truth boundary at 0.3 s is 29.10 m: supported.' },
  { claim: 'Reducing delay from 0.6 s to 0.4 s fixes the case.', who: '0G + tools, open benchmark', st: 'failed', check: 'The model read a counterfactual delta (+0.2 s) as an absolute value; the audit flagged the claim as contradicted.' },
]
function renderResearch() {
  $('claims').innerHTML = CLAIMS.map((c) => `<details class="claim"><summary><span>“${esc(c.claim)}” <small class="muted">· ${esc(c.who)}</small></span><span class="st ${c.st}">${c.st === 'failed' ? 'Contradicted' : 'Supported'}</span></summary><div class="body">${esc(c.check)}</div></details>`).join('')
  armClips($('v-research')); drawHunt()
}
let hunt: any = null, huntRun = 0
async function drawHunt() {
  const cv = document.getElementById('hunt') as HTMLCanvasElement | null; if (!cv) return
  const me = ++huntRun
  if (!hunt) try { hunt = await fetch('/hunt.json').then((r) => r.json()) } catch { return }
  const ex: any[] = hunt.experiments, truth: [number, number][] = hunt.truth
  let n = 0
  const paint = () => {
    const { g, w, h } = setup(cv), pad = 30, X = (d: number) => pad + ((d - 0.3) / 1.2) * (w - pad * 2), Y = (gap: number) => h - pad - (gap / 80) * (h - pad * 2)
    g.clearRect(0, 0, w, h); g.fillStyle = '#ffffffa0'; g.beginPath(); g.roundRect(0, 0, w, h, 16); g.fill()
    g.strokeStyle = C.ink; g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath(); truth.forEach(([d, gap], i) => (i ? g.lineTo(X(d), Y(gap)) : g.moveTo(X(d), Y(gap)))); g.stroke(); g.setLineDash([])
    for (const e of ex.slice(0, n)) { g.fillStyle = e.safe ? C.lime : C.pink; g.strokeStyle = C.ink; g.lineWidth = 1.5; g.beginPath(); g.arc(X(e.delay), Y(e.gap), 6, 0, Math.PI * 2); g.fill(); g.stroke() }
    g.fillStyle = C.ink; g.font = '500 11px "Space Grotesk", sans-serif'
    g.fillText('reaction delay 0.3 → 1.5 s', pad, h - 8); g.fillText('gap 0–80 m', 4, 14); g.fillText('green = no crash · pink = crash', pad, 28); g.fillText(`--- true boundary · ● experiment ${n}/${ex.length}`, w / 2 - 40, 14)
  }
  const feed = $('hunt-feed'); feed.innerHTML = ''
  const next = () => {
    if (me !== huntRun || $('v-research').classList.contains('hidden')) return // a newer visit restarted the animation
    n++; paint()
    const e = ex[n - 1]; if (e) feed.insertAdjacentHTML('afterbegin', `<div>#${e.n} · ${num(e.delay, 2)} s · ${num(e.gap, 1)} m · ${e.safe ? 'no crash' : 'crash'} · ${short(e.rid, 8, 4)}<br>${esc(e.why)}</div>`)
    if (n < ex.length) setTimeout(next, 350)
  }
  next()
}

// ---------- Your stack: tabs, copy buttons, onboarding request (copied to the clipboard; nothing is sent or stored) ----------
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((x) => { x.classList.toggle('on', x === b); $(x.dataset.tab!).classList.toggle('hidden', x !== b) })
}))
const copyText = async (t: string, b: HTMLElement, done = 'Copied') => { try { await navigator.clipboard.writeText(t); b.textContent = done } catch { b.textContent = 'Select and copy manually' } }
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText($(b.dataset.copy!).textContent ?? '', b)))
$('onboard').addEventListener('click', () => copyText(`Faultline onboarding request
Stack name:
Adapter (python | leaderboard | ros2):
Sensors (type, count, mount):
Control interface (Control / Ackermann / Twist):
Checker result (python -m faultline.stack check stack.yaml):
Contact:`, $('onboard-msg'), 'Copied. Paste it into a message to the Faultline team.'))

// ---------- Judge mode: a 6-step, 3-minute path through the real pages ----------
const JUDGE: { title: string, text: string, run: () => Promise<string | null> }[] = [
  { title: 'The problem', text: 'AV safety results are run by someone with a stake in the answer. Faultline makes the attacker independent and the record public.', run: async () => { go('/'); return '#problem' } },
  { title: 'A physical AI agent', text: 'The 0G strategist plans a four-car attack before the first tick, then steers all four cars every second in CARLA. You can run it live from the Lab.', run: async () => { go(href.run(SWARM)); await waitFor(() => !$('mc-plan').classList.contains('hidden')); return '#mc-plan' } },
  { title: 'The safety result', text: 'Paid test 002: the car avoided collision; the minimum time to collision was 1.03 s. We jump to the closest approach.', run: async () => { go(href.run(FEATURED)); await waitFor(() => !!mc && mc.done); $('mc-worst').click(); return '#mc-verdict' } },
  { title: 'The Web3 proof', text: 'Committed on 0G Galileo before the first 0G decision, finalized after the last; each decision has a 0G request ID and an archived provider signature.', run: async () => { go(href.proof(FEATURED)); await waitFor(() => !!document.querySelector('#vf-groups .proof')); return '#vf-timeline' } },
  { title: 'Agentic payment', text: 'The tester signs a request; our agent pays 0.001 HBAR on Hedera through x402 under a spending limit, with no human approval step.', run: async () => { if (!location.pathname.startsWith('/proof')) { go(href.proof(FEATURED)); await waitFor(() => !!document.querySelector('#vf-groups .proof')) } const g = [...document.querySelectorAll<HTMLElement>('#vf-groups .card')].at(-1); g?.querySelector('details')?.setAttribute('open', ''); return g ? '#vf-groups .card:last-child' : null } },
  { title: 'The research vision', text: '0G plans experiments and states hypotheses; classical tools do search; every claim is audited. Where bisection or random search won, we say so.', run: async () => { go(href.research()); return '#claims' } },
]
let jstep = 0
const waitFor = async (f: () => boolean, ms = 15000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(200) }
async function judge(i: number) {
  jstep = Math.max(0, Math.min(JUDGE.length - 1, i)); const j = JUDGE[jstep]
  $('judge').classList.remove('hidden'); $('j-step').textContent = `Judge mode · ${jstep + 1} of ${JUDGE.length}`; $('j-title').textContent = j.title; $('j-text').textContent = j.text
  $<HTMLButtonElement>('j-prev').disabled = jstep === 0; $('j-next').textContent = jstep === JUDGE.length - 1 ? 'Finish' : 'Next →'
  document.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl'))
  const sel = await j.run(); await sleep(300)
  const el = sel ? document.querySelector<HTMLElement>(sel) : null
  if (el) { el.classList.add('hl'); el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }
}
const closeJudge = () => { $('judge').classList.add('hidden'); document.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl')) }
$('judge-btn').addEventListener('click', () => judge(0))
$('j-prev').addEventListener('click', () => judge(jstep - 1))
$('j-next').addEventListener('click', () => { if (jstep === JUDGE.length - 1) closeJudge(); else judge(jstep + 1) })
$('j-close').addEventListener('click', closeJudge)

// ---------- boot ----------
async function boot() {
  const st = restore()
  if (st) { policy = st.policy ?? policy; attack = ATTACKS.some((a) => a.id === st.attack) ? st.attack : attack; mode = st.mode === 'paid' ? 'paid' : 'free'; guest = !!st.guest; cur = Math.max(1, Math.min(4, st.step ?? 1)) }
  startOrbs(); armClips(document)
  renderWallets(); paintWallet(); renderChoices(); renderStepper()
  route()
  // Resume a wallet the user already approved (eth_accounts opens no popup)
  if (st?.wallet != null) setTimeout(async () => {
    const w = found.find((x) => x.info.rdns === st.wallet) ?? found[0] ?? ((window as any).ethereum ? { info: { uuid: 'injected', name: 'Browser wallet', icon: '', rdns: '' }, provider: (window as any).ethereum } : null)
    if (!w || wallet) return
    try { const a: string[] = await w.provider.request({ method: 'eth_accounts' }); if (a?.[0]) { wallet = { address: a[0], provider: w.provider, name: w.info.name }; lastTried = w; guest = false; renderWallets(); paintWallet(); renderChoices() } } catch { /* stays disconnected */ }
  }, 400)
  await Promise.all([pollHealth(), loadPolicies()])
  setInterval(pollHealth, 10000)
}
boot()
