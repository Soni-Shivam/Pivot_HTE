// Faultline Studio: Home → guided test (wallet → policy → attack → live → results and proof) → test library.
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
const esc = (s: unknown) => String(s ?? '-').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const num = (x: unknown, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '-')
const short = (s: unknown, a = 8, b = 6) => (typeof s === 'string' && s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : esc(s))
const hbar = (tinybar: number | null | undefined) => (typeof tinybar === 'number' ? (tinybar / 1e8).toFixed(4) : '-')
const risk = (c: number | null | undefined) => (c == null ? { cls: 'l', word: '-' } : c >= 0.75 ? { cls: 'p', word: 'High risk' } : c >= 0.5 ? { cls: 'y', word: 'Medium risk' } : { cls: 'l', word: 'Low risk' })
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
type View = 'home' | 'flow' | 'explore' | 'stack' | 'mission' | 'verify' | 'results2' | 'research'
function show(view: View) {
  for (const v of ['home', 'flow', 'explore', 'stack', 'mission', 'verify', 'results2', 'research']) $(`v-${v}`).classList.toggle('hidden', v !== view)
  if (view === 'explore') renderExplore()
  window.scrollTo({ top: 0 })
  requestAnimationFrame(resizeAll)
}
$('home-link').setAttribute('href', '/')
const gotoExplore = (id: string) => { if (location.pathname !== '/library') history.pushState(null, '', '/library'); show('explore'); requestAnimationFrame(() => document.getElementById(`x-${id}`)?.scrollIntoView()) }
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-goto-explore]'); if (t) gotoExplore(t.dataset.gotoExplore!)
  if ((e.target as HTMLElement).closest('[data-back]')) step(cur - 1)
})

// ---------- recorded CARLA clips: served by the console at /media/<path>, falling back to the public repo ----------
const RAW = 'https://raw.githubusercontent.com/Soni-Shivam/Pivot_HTE/main/'
const clip = (path: string, poster: string, label: string) => `<video class="clip" controls muted playsinline preload="none" poster="stills/${poster}.jpg" data-src="${esc(path)}" aria-label="${esc(label)}"></video>`
const armClips = (root: ParentNode) => root.querySelectorAll<HTMLVideoElement>('video[data-src]').forEach((v) => { if (!v.getAttribute('src')) v.src = api('/media/' + v.dataset.src) })
document.addEventListener('error', (e) => {
  const v = e.target as HTMLVideoElement
  if (v instanceof HTMLVideoElement && v.dataset.src && !v.src.startsWith(RAW)) v.src = RAW + v.dataset.src
}, true)
armClips(document)

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
      : `<span class="note" style="margin:0">No wallet found in this browser. Install the <a href="https://www.coinbase.com/wallet/downloads" target="_blank" rel="noopener">Coinbase Wallet extension</a> (or any browser wallet) and reload, or watch a recorded test without one.</span>`
  $('wallets').querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => b.addEventListener('click', () => connect(list[Number(b.dataset.w)])))
  document.getElementById('w-disconnect')?.addEventListener('click', () => { wallet = null; renderWallets(); paintWallet() })
}
let lastTried: { info: WalletInfo, provider: Eip1193 } | null = null, rejects = 0
const walletErr = (e: any, what: string) => {
  const code = e?.code ?? e?.data?.originalError?.code
  console.warn('[wallet]', what, code, e?.message ?? e)
  const rejected = code === 4001 || /reject|denied|cancel/i.test(String(e?.message))
  // a 4001 faster than any human could click means the wallet refused the site itself (Coinbase Wallet flags new domains)
  // Coinbase Wallet rejects the first request from a new site with a one-time warning; only a second rejection is the user's
  if (rejected && what === 'connection' && rejects++ === 0) return 'Coinbase Wallet shows a one-time warning for new sites. Choose Continue in the wallet, then press Connect again.'
  return rejected ? (what === 'connection' ? 'You declined the connection.' : 'You declined the signature in your wallet. Nothing was sent.')
    : code === -32002 ? 'Your wallet already has a request open. Open the wallet extension to finish it.'
    : `The wallet did not complete the ${what}${code != null ? ` (code ${code})` : ''}: ${e?.message ?? e}`
}
function showWalletErr(msg: string) {
  $('wallet-err').innerHTML = `${esc(msg)} <button class="btn y" id="w-retry" style="margin-left:8px">Connect again</button>`
  document.getElementById('w-retry')?.focus()
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
  $('guest').textContent = guest ? '✓ Continuing without a wallet' : 'Continue without a wallet'
  renderStepper(); renderSummary()
}
$('wallet-btn').addEventListener('click', () => {
  go('/lab'); step(4)
  const c = candidates()
  if (!wallet && c.length === 1) connect(c[0]) // still inside the click: the wallet popup needs a user gesture
})
const hex = (s: string) => '0x' + [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('')
const message = (nonce: string, issued: string) => `Faultline test request\npolicy: ${policy}\nsuite: ${attack}\nmode: ${mode}\nnonce: ${nonce}\nissued: ${issued}`

// ---------- guided flow ----------
let cur = 1, maxStep = 1
const STEPS = ['What you test', 'How to challenge it', 'How to run it', 'Authorize', 'Launch']
function renderStepper() {
  $('stepper').innerHTML = STEPS.map((t, i) => {
    const n = i + 1, can = n <= maxStep && n <= 4
    return `<li><button class="${n === cur ? 'on' : ''} ${n < maxStep && n !== cur ? 'done' : ''}" data-s="${n}" ${can ? '' : 'disabled'} ${n === cur ? 'aria-current="step"' : ''}><i>${n < maxStep && n !== cur ? '✓' : n}</i><span>${t}</span></button></li>`
  }).join('')
  $('stepper').querySelectorAll<HTMLButtonElement>('[data-s]').forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.s))))
}
function step(n: number) {
  if (n < 1) { go('/'); return }
  cur = n; maxStep = Math.max(maxStep, n); save()
  if (location.pathname !== '/lab') history.replaceState(null, '', '/lab')
  for (let i = 1; i <= 4; i++) $(`s${i}`).classList.toggle('hidden', i !== n)
  renderStepper(); if (n === 4) { renderSummary(); loadPending() }
  window.scrollTo({ top: 0 }); requestAnimationFrame(resizeAll)
}
$('s1-next').addEventListener('click', () => step(2))
$('s2-next').addEventListener('click', () => step(3))
$('s3-next').addEventListener('click', () => { if (mode === 'replay') { go('/library'); return } step(4) })

// Swarm roles: one source, the run's plan.json via /api/showcase (fallback = the same plan text)
let ROLES: Record<string, string> = { A: 'Lead vehicle, progressive braking', B: 'Front cut-in, block right lane', C: 'Rear cut-in, compress gap', D: 'Rear guard, maintain safe distance' }
const ROLE_CAR: Record<string, [string, string]> = { A: ['#e5484d', 'red car'], B: ['#f3c623', 'yellow taxi'], C: ['#3b82f6', 'blue car'], D: ['#d63384', 'magenta car'] }
const rolesHtml = () => Object.entries(ROLES).map(([k, v]) => `<li><i style="background:${ROLE_CAR[k]?.[0] ?? '#999'}"></i><b>${esc(k)}</b> ${esc(ROLE_CAR[k]?.[1] ?? '')}: ${esc(v)}</li>`).join('')
const paintRoles = () => document.querySelectorAll('[data-roles]').forEach((el) => { el.innerHTML = rolesHtml() })
getJson('/api/showcase').then((sc) => { const sw = (Array.isArray(sc) ? sc : []).find((x: any) => x.id === 'swarm'); if (sw?.plan?.roles) { ROLES = sw.plan.roles; paintRoles() } }).catch(() => { /* fallback stays */ })
paintRoles()
type Policy = { id: string, name: string, description: string, digest: string | null, compatible: boolean | null, paid?: boolean }
const PLAIN: Record<string, string> = {
  'pdm-lite': 'The rule-based planner from the CARLA Leaderboard. It drives on what its own LiDAR sees.',
  'idm-cautious': 'A cautious car-following model that keeps a 1.6-second gap to the car ahead.',
}
let policies: Policy[] = [
  { id: 'pdm-lite', name: 'PDM-Lite', description: '', digest: '0x537db480f1840d95832fa2b2bd855075ad45b5f4cafb7b64f9eed6c2dd266bba', compatible: true, paid: true },
  { id: 'idm-cautious', name: 'Cautious IDM', description: '', digest: null, compatible: true, paid: false },
]
let policy = 'pdm-lite', attack = 'cut-in-v1-carla', mode: 'free' | 'paid' | 'replay' = 'free', guest = false
// The flow survives a reload or a wallet warning page: state is saved on every change and restored on load.
const FKEY = 'faultline.flow'
function save() { try { localStorage.setItem(FKEY, JSON.stringify({ step: Math.min(cur, 4), policy, attack, mode, guest, wallet: lastTried?.info.rdns ?? null })) } catch { /* private mode */ } }
function restore(): any { try { return JSON.parse(localStorage.getItem(FKEY) ?? 'null') } catch { return null } }
$('guest').addEventListener('click', () => { guest = true; wallet = null; mode = 'free'; save(); renderWallets(); paintWallet(); renderChoices(); renderSummary() })
$('byo').addEventListener('click', () => show('stack'))
// ---------- your stack: tabs, copy buttons, onboarding request (copied to the clipboard; nothing is sent or stored) ----------
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
async function loadPolicies() {
  try { const p = await getJson('/api/policies'); if (Array.isArray(p) && p.length) policies = p } catch { /* built-in list stays */ }
  renderChoices()
}
const ATTACKS = [
  { id: 'cut-in-v1-carla', name: 'Cut-in (CARLA 3D)', line: 'The same attack in the CARLA 3D simulator with real sensors. About 90 seconds.', live: true },
  { id: 'swarm', name: 'Coordinated multi-vehicle attack', line: 'Four attacker cars coordinate to box the car in. Recorded only, opens in the test library.', live: false },
  { id: 'lead-brake', name: 'Lead vehicle brakes', line: 'The car ahead brakes hard at a chosen moment. Recorded only (research runs).', live: false },
]
let health: any = null
function radio(group: string, items: { id: string, html: string, disabled?: boolean }[], sel: string) {
  return items.map((i) => `<button class="choice" role="radio" aria-checked="${i.id === sel}" data-${group}="${esc(i.id)}" ${i.disabled ? 'disabled' : ''}>${i.html}</button>`).join('')
}
function renderChoices() {
  $('policies').innerHTML = radio('pol', policies.map((p) => ({ id: p.id,
    html: `<b>${esc(p.name.replace(/\s*\(.*\)$/, ''))}</b><span>${esc(PLAIN[p.id] ?? p.description)}</span><small>${p.compatible ? '✓ Passed our compatibility check' : 'Compatibility not checked'}</small><span class="iface">interface: Python AVStack · LiDAR + speed · modes: replay, live demo${p.paid !== false ? ', paid anchored test' : ''}</span>` })), policy)
  const carlaDown = health && !health.carla
  $('attacks').innerHTML = radio('atk', ATTACKS.map((a) => ({ id: a.id, disabled: a.id === 'cut-in-v1-carla' && carlaDown,
    html: `<b>${esc(a.name)}</b><span>${esc(a.line)}</span>${a.id === 'cut-in-v1-carla' && carlaDown ? '<small>CARLA is offline right now</small>' : a.live ? '' : '<small>Recorded only →</small>'}` })), attack)
  const paidOk = policies.find((p) => p.id === policy)?.paid !== false && !guest
  const carlaOk = !!health?.carla
  $('exec-lede').textContent = health ? (carlaOk ? 'CARLA is online: live runs are available.' : 'CARLA is offline right now: live runs are disabled, recorded replays still work.') : 'Checking CARLA availability…'
  $('modes').innerHTML = radio('mode', [
    { id: 'replay', html: '<b>Replay a recorded test</b><span>Free, instant. Real recorded runs with every 0G decision.</span>' },
    { id: 'free', disabled: !carlaOk, html: '<b>Live demo run</b><span>Real 0G decisions in CARLA now. Not paid and not anchored on-chain.</span>' },
    { id: 'paid', disabled: !paidOk || !carlaOk, html: `<b>Purchase an anchored test (0.001 HBAR)</b><span>Our agent pays on Hedera (x402); the result is anchored on 0G Galileo and stored on 0G Storage.</span>${!paidOk ? (guest ? '<small>Paid runs need a wallet signature</small>' : '<small>Paid runs are bound to PDM-Lite</small>') : ''}` },
  ], mode)
  document.querySelectorAll<HTMLButtonElement>('[data-pol]').forEach((b) => b.addEventListener('click', () => { policy = b.dataset.pol!; if (policies.find((p) => p.id === policy)?.paid === false) mode = 'free'; save(); renderChoices() }))
  document.querySelectorAll<HTMLButtonElement>('[data-atk]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.atk === 'swarm') { gotoExplore('swarm'); return } if (b.dataset.atk === 'lead-brake') { go('/research'); return } attack = b.dataset.atk!; save(); renderChoices() }))
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode as 'free' | 'paid' | 'replay'; save(); renderChoices() }))
  renderSummary()
}
function renderSummary() {
  const p = policies.find((x) => x.id === policy), a = ATTACKS.find((x) => x.id === attack)
  $('pay-line').textContent = mode === 'paid' ? 'Our agent pays 0.001 HBAR through x402 under its spending limit and receives a one-run permit. You never pay.' : 'This live demo run is free: nothing is paid and nothing is anchored.'
  $('summary').innerHTML = kv([['Policy', esc(p?.name ?? policy)], ['Attack', esc(a?.name ?? attack)], ['Run type', mode === 'paid' ? 'Anchored test · our agent pays 0.001 HBAR on Hedera testnet' : 'Live demo · not paid, not anchored'], ...(mode === 'paid' ? [['Spending limit', catalogCap ? `${catalogCap} HBAR per day (agent policy)` : 'agent spending policy'] as [string, string], ['Payment chain', 'Hedera testnet (x402)'] as [string, string]] : []),
    ['Requested by', wallet ? `<code>${esc(wallet.address)}</code>` : guest ? 'Guest (no wallet) · free demo run' : 'connect a wallet first']])
  $('msg-preview').textContent = message('<random nonce>', '<time you click>')
  $<HTMLButtonElement>('start').disabled = (!wallet && !guest) || !online
  $('start').textContent = guest ? 'Start free guest run' : 'Sign and start test'
  $('start-err').textContent = !wallet && !guest ? 'Connect a wallet (or continue without one) in step 1 first.' : !online ? 'The live console is offline. Watch a recorded test in the test library instead.' : ''
}
$('start').addEventListener('click', async () => {
  if (guest && !wallet) {
    const btn = $<HTMLButtonElement>('start'); btn.disabled = true
    try { const r = await postJson('/api/demo-run', { policy, suite: attack, mode: 'free', guest: true }); go('/mission/' + r.jobId) }
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
    go('/mission/' + r.jobId)
  } catch (e) { const m = (e as any)?.code != null ? walletErr(e, 'signature') : `Not started: ${(e as any)?.message ?? e}`; $('start-err').textContent = m } finally { btn.disabled = false }
})

// ---------- never pay twice: paid jobs whose run never started stay launchable ----------
let catalogCap: string | null = null
async function loadPending() {
  try {
    const c = await getJson('/api/catalog'); catalogCap = c.cap ? (Number(c.cap) / 1e8).toString() : null
    const list: any[] = c.pending ?? []
    $('pending-box').innerHTML = list.length ? `<div class="note"><b>Paid but not started.</b> These tests were paid and not run yet; launch one instead of paying again.${list.map((j) => `<div class="row" style="margin-top:8px"><code>${short(j.jobId, 8, 4)}</code> ${link(j.hashscan, 'payment')} <button class="btn" data-launch="${esc(j.jobId)}">Launch</button></div>`).join('')}</div>` : ''
    $('pending-box').querySelectorAll<HTMLButtonElement>('[data-launch]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true
      try { const r = await postJson('/api/launch', { jobId: b.dataset.launch }); go('/mission/' + String(r.run).split('/').map(encodeURIComponent).join('/')) } catch (e) { $('start-err').textContent = (e as Error).message; b.disabled = false }
    }))
    renderSummary()
  } catch { /* console offline */ }
}

// ---------- live ----------
let ticks: Tick[] = [], decisions: Decision[] = [], runMeta: Run | null = null, allRuns: Run[] = [], runFree = false
let waiting: { cp: number, t0: number } | null = null, flashUntil = 0, flashAction = ''
const SAY: Record<string, string> = {
  CUT_IN_AGGRESSIVE: 'Cut sharply into your lane', CUT_IN: 'Cut into your lane', BRAKE_HARD: 'Brake hard in front of you', BRAKE_SOFT: 'Brake gently',
  SLOW_DOWN: 'Slow down', ACCELERATE: 'Speed up', MAINTAIN: 'Hold speed and lane', KEEP_LANE: 'Stay in its lane', COAST: 'Coast', SAFE_HALT: 'Stop safely (no valid answer from 0G)',
}
const why = (d: Decision) => { try { return String(JSON.parse(d.content ?? '').why ?? '') } catch { return '' } }
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
  const cam = $<HTMLImageElement>('live-cam'), carla = by === 'job' && attack === 'cut-in-v1-carla'
  // no 2-D simulator view: the live CARLA camera for running jobs, the recorded clip for replays
  cam.classList.toggle('hidden', !carla); $('scene').classList.add('hidden'); $('replay-vid').classList.add('hidden'); $('no-cam').classList.add('hidden')
  if (carla) cam.src = api(`/api/live/${encodeURIComponent(run)}`); else cam.removeAttribute('src')
  $('progress').innerHTML = ''; $('feed').innerHTML = ''; $('log').textContent = ''; $('to-results').classList.add('hidden')
  $('live-tag').textContent = smode === 'live' ? 'Live' : 'Replay'; $('live-tag').classList.add('live')
  $('s-job').textContent = smode === 'live' ? 'Queued' : 'Recorded test'; $('s-dec').textContent = '0'
  try {
    await post('/api/stream', { [by]: run, mode: smode, speed: smode === 'replay' ? 2 : 1 }, (e) => {
      if (e.t === 'meta' && smode === 'replay') {
        const v = $<HTMLVideoElement>('replay-vid'), src = e.run?.video
        v.classList.toggle('hidden', !src); $('no-cam').classList.toggle('hidden', !!src)
        if (src) { v.src = api('/media/' + src); v.play().catch(() => { /* controls stay */ }) } else v.removeAttribute('src')
      }
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
      if (e.t === 'await0g' && !decisions.length) progress('zg', 'run', 'Connecting to 0G')
      if (e.t === 'await0g' && (!waiting || waiting.cp !== e.cp)) { waiting = { cp: e.cp, t0: performance.now() }; renderFeed() }
      if (e.t === 'idle' && waiting) { waiting = null; renderFeed() }
      if (e.t === 'decision') {
        progress('zg', 'ok', 'Connected to 0G (private tier)')
        progress('cp', 'run', `Checkpoint ${decisions.length + 1}: ${say(e.d.action)}`, e.d.source === '0g' ? `answered in ${e.d.latency_ms} ms` : '')
        if (e.d.source !== '0g') progress('halt', 'fail', 'Safe stop: no valid 0G answer, the car stopped safely')
        logLine(`0G cp${e.d.cp} ${e.d.action ?? 'SAFE_HALT'} ${e.d.latency_ms}ms ${e.d.request_id}`)
        decisions.push(e.d); waiting = null; flashUntil = performance.now() + 1200; flashAction = e.d.action ?? 'SAFE_HALT'
        $('s-dec').textContent = String(decisions.length); renderFeed(true)
      }
      if (e.t === 'ticks') { ticks.push(...e.rows); const r = ticks.at(-1)!; $('s-t').textContent = `${num(r.t_s, 1)} s`; $('s-gap').textContent = `${num(r.gt_gap, 1)} m`; $('s-ttc').textContent = r.gt_ttc_s == null ? 'safe' : `${num(r.gt_ttc_s, 1)} s` }
      if (e.t === 'log') logLine(e.line)
      if (e.t === 'queue') progress('queue', e.pos > 0 ? 'run' : 'ok', e.pos > 0 ? `Queued: position ${e.pos}${e.etaS != null ? `, about ${Math.round(e.etaS)} s` : ''}` : 'Started')
      if (e.t === 'queue') $('s-job').textContent = e.pos > 0 ? `#${e.pos} in line${e.etaS != null ? ` · about ${Math.round(e.etaS)} s` : ''}` : 'Starting'
      if (e.t === 'done' || e.t === 'error') {
        waiting = null; renderFeed()
        runMeta = e.run ?? e.job?.result ?? runMeta
        if (document.getElementById('pg-cp')) progress('cp', 'ok', `${decisions.length} checkpoints answered`)
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
    <div class="what">${num(d.sim_time_s, 1)} s · ${esc(say(d.action))}</div>${why(d) ? `<div class="why-line">“${esc(why(d))}”</div>` : ''}
    <div class="meta">${d.source === '0g' ? `answered by 0G in ${d.latency_ms} ms` : `no 0G answer (${esc(d.source)}) so the car stopped safely`}</div>
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
  pillAt(g, X(r.lead_x), top - 22, `Attacker · ${num(r.lead_v * 3.6, 0)} km/h`, C.pink)
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
  for (const [c, t] of [[C.pink, 'CCS 0–1 (recomputed)'], [C.purple, 'Gap 0–30 m (ground truth)'], [C.ink, 'TTC 0–6 s, capped (ground truth)'], [C.ink, '0G decision']] as const) {
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
  // one definition everywhere: the closest approach (minimum ground-truth gap); headline numbers come from the run's metrics
  worstIdx = ticks.reduce((m, t, i) => (t.gt_gap < (ticks[m]?.gt_gap ?? Infinity) ? i : m), 0)
  const at = ticks[worstIdx], cause = decisions.filter((d) => d.sim_time_s < (at?.t_s ?? 0)).at(-1)
  const crashed = r?.collision ?? ticks.some((t) => t.collision)
  const gap = r?.minGap ?? (ticks.length ? Math.min(...ticks.map((t) => t.gt_gap)) : null)
  const k = risk(r?.ccs)
  const headline = crashed ? 'Crashed: the attacker forced a collision.' : (r?.ccs ?? 0) >= 0.75 ? `Survived, but only just. Closest gap ${num(gap, 1)} m.` : `Survived. Closest gap ${num(gap, 1)} m.`
  $('verdict').className = `card verdict ${crashed ? 'p' : k.cls === 'p' ? 'y' : 'l'}`
  $('verdict').innerHTML = `<h2>${esc(headline)}</h2>
    <div class="row" style="margin-top:14px">
      <span class="pill"><span class="tip" tabindex="0" data-tip="${esc(TIP.ttc)}">Tightest time to collision</span>&nbsp;<b>${num(r?.minTtc, 1)} s</b></span>
      <span class="pill"><span class="tip" tabindex="0" data-tip="${esc(TIP.ccs)}">Danger score</span>&nbsp;<b>${num(r?.ccs, 2)} / 1</b></span>
      ${at ? `<span class="pill y">Closest approach at ${num(at.t_s, 1)} s${cause ? `, after the attacker chose to “${esc(say(cause.action).toLowerCase())}”` : ''}</span>` : ''}
    </div>`
  const vid = $<HTMLVideoElement>('rvideo'), rv = (r as any)?.video as string | undefined
  vid.classList.toggle('hidden', !rv); $('rscene').classList.add('hidden')
  if (rv) { vid.src = api('/media/' + rv); vid.onloadedmetadata = () => { vid.currentTime = Math.max(0, (at?.t_s ?? 0) - 1) } } else vid.removeAttribute('src')
  const s = $<HTMLInputElement>('scrub'); s.max = String(Math.max(0, ticks.length - 1)); s.value = String(worstIdx)
  drawResults()
  const t = trustFromRun(r, decisions, runFree)
  $('rail-results').innerHTML = railHtml(t)
  const st = r?.storage, ch = r?.chain, p = r?.payment
  $('evidence').innerHTML = kv([
    ['Run', `<code>${esc(r?.name)}</code>`], ['Requested by (signed)', r?.requestedBy ? `<code>${esc(r.requestedBy)}</code>` : '-'],
    ['Attacker model', `<code>${esc(r?.model)}</code>`], ['AI decisions from 0G', `${decisions.filter((d) => d.source === '0g').length} of ${decisions.length}`],
    ['First 0G request ID', t.requestId ? `<code>${esc(t.requestId)}</code>` : '-'],
    ['Signatures archived', st ? `${esc(st.signaturesArchived)} of ${esc(st.signatures0g)}` : '-'],
    ['0G Storage public root', st ? `<code>${esc(st.publicRoot)}</code>` : '-'], ['0G Storage sealed root', st ? `<code>${esc(st.sealedRoot)}</code>` : '-'],
    ['Galileo commit', ch ? link(galileoTx(ch.commitTx), short(ch.commitTx, 10, 6)) : '-'],
    ['Galileo finalize', ch?.finalizeTx ? link(galileoTx(ch.finalizeTx), short(ch.finalizeTx, 10, 6)) : '-'],
    ['Hedera payment', p ? link(p.hashscan, esc(p.transaction)) : '-'],
  ])
}
function drawResults() {
  const i = Number($<HTMLInputElement>('scrub').value), r = ticks[i]
  const vid = $<HTMLVideoElement>('rvideo'); if (vid.getAttribute('src') && r && Number.isFinite(vid.duration)) vid.currentTime = Math.min(vid.duration, r.t_s)
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
  type S = 'up' | 'part' | 'down' | 'id' | ''
  const WORD: Record<S, string> = { up: 'proven', part: 'partly proven', down: 'check failed', id: 'identity information', '': 'not proven' }
  const card = (s: S, net: string, body: string, proves: string, href?: string | null) => {
    const inner = `<span class="n"><i class="dot ${s}" aria-hidden="true"></i>${net}<span class="sr">: ${WORD[s]}</span>${href ? ' ↗' : ''}</span><span class="s">${body}</span>`
    return href ? `<a class="tp" href="${esc(href)}" target="_blank" rel="noopener" data-tip="${esc(proves)}">${inner}</a>` : `<span class="tp" tabindex="0" data-tip="${esc(proves)}">${inner}</span>`
  }
  const sigOk = t.sigsVerified != null && t.sigsTotal != null && t.sigsTotal > 0 && t.sigsVerified === t.sigsTotal
  const has0g = (t.decisions0g ?? 0) > 0 && !!t.requestId
  const freeNote = 'Free demo runs aren’t paid or anchored. Run a paid test to anchor.'
  const out = [
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
     <td class="mono">${num(r.minTtc, 1)} s</td><td class="mono">${num(r.minGap, 1)} m</td><td>${r.collision ? 'yes' : r.collision === false ? 'no' : '-'}</td></tr>`).join('')}</tbody></table>`
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
    section('runs', '', 'Recorded tests', 'Replay any finished test decision by decision. Free, no wallet needed.', `<div class="tscroll" style="margin-top:12px"><table><thead><tr>${th('Test')}${th('Simulator')}${th('AI moves from 0G')}${th('Danger', TIP.ccs)}${th('Tightest TTC', TIP.ttc)}${th('')}</tr></thead><tbody id="runs"><tr><td colspan="6">Loading…</td></tr></tbody></table></div>`),
    section('swarm', 'c', 'Coordinated multi-vehicle attack', 'One planning call to 0G assigns roles to four cars; then a 0G call every second steers all four at once to box the self-driving car in.',
      `${clip('videos/video-swarm-fog-001__stitched.mp4', 'squeeze', 'Coordinated multi-vehicle attack in fog, CARLA')}<div class="split"><div class="plan"><b>Plan from 0G: “Staggered cut-in”</b><ul data-roles>${rolesHtml()}</ul><pre class="msg">{"actions": {"A": "SLOW_DOWN", "B": "KEEP_LANE", "C": "KEEP_LANE", "D": "KEEP_LANE"},\n "phase": "Gap Compression",\n "why": "A slows to compress gap; B holds; C waits for gap to open for cut-in."}</pre></div><div><dl class="kv">${kv([['Moves from 0G', '10 of 10 (0 safe stops)'], ['Closest gap', '3.5 m'], ['Tightest TTC', '1.1 s'], ['Crash', 'none'], ['Plan request', RID('e1a9a298-520d-42bf-ad30-ad67d0cc5894')], ['Anchored on-chain', 'no (prototype run)']])}</dl></div></div>
       <div class="rail" style="margin-top:14px">${railHtml({ decisions0g: 10, decisions: 10, requestId: 'e1a9a298-520d-42bf-ad30-ad67d0cc5894', provider: PROVIDER, sigsVerified: 10, sigsTotal: 10, agentId: 579 })}</div>`),
    section('ab', 'y', 'A/B policy comparison', 'Both policies face the exact same scripted attack (replayed, no 0G calls), so the comparison is fair. Recorded at 4 sites; the result was the same at all of them.',
      `${clip('videos/arena-live0g-video-001__r7l-2s3__side_by_side.mp4', 'ab', 'PDM-Lite and cautious IDM side by side against a live 0G attacker')}<div><div><div class="tscroll" id="ab-table">${arenaTable(ARENA_RECORDED)}</div>
       <p style="margin:10px 0 0">The cautious model keeps about 3 s to collision; PDM-Lite drops to about 1 s.</p>
       <div class="row" style="margin-top:14px"><button class="btn k" id="ab-run">Run the arena live (free)</button><span class="pill sm" id="ab-status" aria-live="polite">recorded result shown</span></div><p class="err" id="ab-err"></p></div></div>`),
    section('paid002', 'c', 'Paid test run', 'Our agent paid 0.001 ℏ on Hedera, got a single-use permit, locked the test setup on 0G Galileo, ran it in CARLA with 0G decisions, stored the evidence on 0G Storage, and finalized the result on-chain.',
      `<div class="split"><div>${clip('videos/paid-job-002-replay-view__chase.mp4', 'paid', 'Chase camera of paid test 002 in CARLA')}</div><div><dl class="kv">${kv([['Payment', link(PAID002.hedera!.hashscan, 'Hedera receipt')], ['Setup locked (block 64245811)', link(galileoTx(PAID002.commitTx!), short(PAID002.commitTx, 8, 4))], ['Moves from 0G', '7 of 8 (one safe stop)'], ['Evidence stored', `root ${short(PAID002.publicRoot, 8, 4)}`], ['Result finalized', link(galileoTx(PAID002.finalizeTx!), short(PAID002.finalizeTx, 8, 4))], ['Permit reused?', 'refused (409)'], ['Result', 'danger 0.93 · tightest TTC 1.0 s · no crash']])}</dl></div></div>
       <div class="rail" style="margin-top:14px">${railHtml(PAID002)}</div>`),
  ].join('')
  $('ab-run').addEventListener('click', runArena)
  loadRuns(); armClips($('explore'))
}
async function loadRuns() {
  try { allRuns = await getJson('/api/runs') } catch { /* offline: keep what we have */ }
  const el = document.getElementById('runs'); if (!el) return
  // presentable runs only: paid, demo and featured runs that finished; no debug, stale or empty rows
  const ok = (r: Run & { mtime?: number }) => /^(paid-|demo-free-|demo-00[1-3]$|cutin-00[12]$|swarm-carla-0(08|10)$)/.test(r.name) && r.decisions != null && r.ccs != null && !r.name.includes('replay')
    && !(r.status === 'running' && Date.now() - (r.mtime ?? 0) > 10 * 60_000)
  el.innerHTML = allRuns.filter(ok).slice(0, 25).map((r) => `<tr><td><code>${short(r.name, 14, 4)}</code>${r.payment ? ' <span class="pill sm p">paid</span>' : ''}</td><td>${esc(r.world)}</td><td>${esc(r.decisions0g)} of ${esc(r.decisions)}</td>
    <td><span class="pill sm ${risk(r.ccs).cls}">${num(r.ccs, 2)}</span></td><td>${num(r.minTtc, 1)} s</td>
    <td style="text-align:right"><button class="pill sm k" data-replay="${esc(r.name)}">Replay</button></td></tr>`).join('') ||
    `<tr><td colspan="6">${online ? 'No recorded tests yet' : 'The console is offline. Recorded tests load when it reconnects.'}</td></tr>`
  el.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach((b) => b.addEventListener('click', () => go('/mission/' + encodeURIComponent(b.dataset.replay!))))
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
  } catch (e) { $('ab-err').textContent = `${(e as Error).message}${online ? '' : '. The console is offline, so the recorded result is shown.'}` } finally { btn.disabled = false }
}

// ---------- health ----------
let online = false
async function pollHealth() {
  try {
    health = await getJson('/api/health'); online = !!health.ok
    const tip = `Test console online · 0G ${health.zg ? 'ready' : 'not configured'} · Hedera payments ${health.hedera ? 'ready' : 'offline'} · CARLA ${health.carla ? 'online' : 'offline'} · ${health.queue?.running ?? 0} running, ${health.queue?.waiting ?? 0} waiting · ${health.caps?.runs_left ?? '-'} live runs left today`
    $('console-pill').dataset.tip = tip
    $('console-txt').textContent = `Console online${health.queue?.waiting ? ` · ${health.queue.waiting} waiting` : ''}`
  } catch { online = false; health = null; $('console-pill').dataset.tip = 'The test console is unreachable. Recorded tests and videos still work.'; $('console-txt').textContent = 'Console offline' }
  $('console-dot').className = `dot ${online ? 'up' : 'down'}`
  $('offline').classList.toggle('hidden', online)
  renderSummary()
}

// ---------- loop ----------
function frame() {
  if (!$('oldlive').classList.contains('hidden') && !$('v-flow').classList.contains('hidden')) {
    const r = ticks.at(-1), now = performance.now()
    drawScene($<HTMLCanvasElement>('scene'), r, ticks.slice(-160), flashAction ? say(flashAction) : '', Math.max(0, (flashUntil - now) / 1200))
    drawTele($<HTMLCanvasElement>('tele'), ticks, decisions)
    const wm = document.getElementById('wait-ms'); if (wm && waiting) wm.textContent = `${((now - waiting.t0) / 1000).toFixed(1)} s`
  }
  requestAnimationFrame(frame)
}
function resizeAll() { if (!$('oldres').classList.contains('hidden') && ticks.length) drawResults() }
window.addEventListener('resize', resizeAll)

async function boot() {
  const st = restore()
  if (st) { policy = st.policy ?? policy; attack = st.attack === 'cut-in-v1-carla' ? st.attack : attack; mode = st.mode === 'paid' ? 'paid' : 'free'; guest = !!st.guest }
  renderWallets(); paintWallet(); renderChoices(); renderStepper()
  if (location.hash === '#run') history.replaceState(null, '', '/lab')
  cur = Math.max(1, Math.min(4, st?.step ?? 1))
  route()
  // Resume a wallet the user already approved (eth_accounts opens no popup)
  if (st?.wallet != null) setTimeout(async () => {
    const w = found.find((x) => x.info.rdns === st.wallet) ?? found[0] ?? ((window as any).ethereum ? { info: { uuid: 'injected', name: 'Browser wallet', icon: '', rdns: '' }, provider: (window as any).ethereum } : null)
    if (!w || wallet) return
    try { const a: string[] = await w.provider.request({ method: 'eth_accounts' }); if (a?.[0]) { wallet = { address: a[0], provider: w.provider, name: w.info.name }; lastTried = w; guest = false; renderWallets(); paintWallet(); renderChoices() } } catch { /* stays disconnected */ }
  }, 400)
  requestAnimationFrame(frame)
  await Promise.all([pollHealth(), loadPolicies()])
  renderChoices()
  setInterval(pollHealth, 10000)
}
let hunt: any = null
async function drawHunt() {
  const cv = document.getElementById('hunt') as HTMLCanvasElement | null; if (!cv) return
  if (!hunt) try { hunt = await fetch('/hunt.json').then((r) => r.json()) } catch { return }
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


// ---------- routes: / /lab /mission/:id /research /verify[/:id] /stack /library (Vercel and the console fall back to index.html) ----------
const FEATURED = 'paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-1794006602051'
// Recorded camera for runs whose own folder has none (paid test 002 was replayed in CARLA from its decisions; same trajectory)
const RUN_VIDEO: Record<string, { path: string, aligned: boolean, note?: string }> = {
  [FEATURED]: { path: 'runs/paid-job-002-replay-view/screen.mp4', aligned: true, note: 'Camera from an exact CARLA replay of this paid run (same decisions, same trajectory hash).' },
  'swarm-carla-010': { path: 'runs/swarm-carla-010/director.mp4', aligned: false, note: 'Director cut with the 0G decision cards inserted, so it is not time-aligned with the timeline.' },
}
function go(path: string) { history.pushState(null, '', path); route() }
function route() {
  const [, a = '', ...rest] = location.pathname.split('/'), b = rest.join('/') // run names can contain '/' (CARLA demo runs)
  const navKey = a === '' ? 'home' : a === 'lab' ? 'flow' : a
  document.querySelectorAll<HTMLAnchorElement>('nav.top a').forEach((x) => x.classList.toggle('on', x.dataset.nav === navKey || ((navKey === 'library' || navKey === 'results') && x.dataset.nav === 'research')))
  if (a === 'lab') { show('flow'); step(Math.max(1, Math.min(4, cur))) }
  else if (a === 'mission') { show('mission'); openMission(decodeURIComponent(b || FEATURED)) }
  else if (a === 'verify') { show('verify'); openVerify(decodeURIComponent(b || FEATURED)) }
  else if (a === 'stack') show('stack')
  else if (a === 'results') { show('results2'); openResults2(decodeURIComponent(b || FEATURED)) }
  else if (a === 'research') { show('research'); renderResearch() }
  else if (a === 'library') show('explore')
  else show('home')
}
window.addEventListener('popstate', route)
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]')
  if (!a || a.target || e.metaKey || e.ctrlKey || a.getAttribute('href')!.startsWith('/media/')) return
  e.preventDefault(); go(a.getAttribute('href')!)
})

// ---------- Mission Control: recorded CARLA video or the live MJPEG stream, decision timeline, inspector, telemetry ----------
let mc: { id: string, run: Run | null, ticks: Tick[], ds: Decision[], sel: number, aligned: boolean, live: boolean, state: string } | null = null
const MC_STATES = ['Ready', 'Waiting for 0G', 'Executing', 'Completed']
function mcStates(state: string) {
  const bad = state === 'Safe halt' || state === 'Interrupted'
  const order = bad ? ['Ready', 'Waiting for 0G', 'Executing', state] : MC_STATES
  const at = order.indexOf(state)
  $('mc-states').innerHTML = order.map((x, i) => `<li class="${i < at ? 'done' : ''} ${i === at ? (bad ? 'bad' : 'cur') : ''}">${esc(x)}</li>`).join('')
}
async function openMission(id: string) {
  const live = /^[0-9a-f]{16}$/.test(id)
  mc = { id, run: null, ticks: [], ds: [], sel: -1, aligned: false, live, state: 'Ready' }
  const me = mc
  $('mc-title').textContent = live ? `Live test ${id}` : id === FEATURED ? 'Paid test 002' : id
  $('mc-kind').textContent = live ? 'Mission Control · live run' : 'Mission Control · recorded run'
  $('mc-timeline').innerHTML = ''; $('mc-insp').innerHTML = '<p class="muted">Select a decision on the timeline to inspect it.</p>'; $('mc-verdict').innerHTML = ''; $('mc-overlay').innerHTML = ''; $('mc-note').textContent = ''
  $('mc-plan').classList.add('hidden'); mcStates('Ready')
  // run, then reveal: a live job shows progress and real 0G decisions; the 20 fps recording plays once the run ends
  const vid = $<HTMLVideoElement>('mc-video'), img = $<HTMLImageElement>('mc-live'), prog = $('mc-progress')
  vid.classList.toggle('hidden', live); prog.classList.toggle('hidden', !live); img.classList.add('hidden'); img.classList.remove('peek'); img.removeAttribute('src')
  $('mc-peek').classList.toggle('hidden', !live); $('mc-worst').classList.toggle('hidden', live)
  if (!live) vid.removeAttribute('src')
  const t0 = performance.now()
  const paintProg = () => {
    if (mc !== me || !me.live) return
    const zgN = me.ds.filter((d) => d.source === '0g').length, el = Math.round((performance.now() - t0) / 1000)
    const rows = [
      `<li class="${me.state === 'Ready' ? 'run' : 'ok'}">${esc($('mc-note').textContent || 'Queued')}</li>`,
      `<li class="${me.ds.length ? 'ok' : me.state === 'Waiting for 0G' ? 'run' : ''}">${me.ds.length ? 'Connected to 0G (private tier)' : 'Connecting to 0G'}</li>`,
      ...me.ds.map((d) => `<li class="${d.source === '0g' ? 'ok' : 'bad'}">Checkpoint ${d.cp + 1}/10: ${esc(say(d.action))}${why(d) ? ` · “${esc(why(d))}”` : ''}<small>${d.source === '0g' ? `${d.latency_ms} ms · ${esc(d.request_id)}` : 'no valid 0G answer: safe stop'}</small></li>`)]
    prog.innerHTML = `<h3>${me.state === 'Completed' || me.state === 'Safe halt' ? 'Run finished, loading the recording' : 'Test running in CARLA'}</h3><p class="eta">${el} s elapsed · typical run about 60 s · ${zgN} decisions from 0G</p><ol>${rows.join('')}</ol>`
  }
  const progT = live ? window.setInterval(paintProg, 1000) : 0
  if (id === 'swarm-carla-010') renderPlan()
  try {
    await post('/api/stream', live ? { job: id, mode: 'live' } : { run: id, mode: 'replay', speed: 8 }, (e) => {
      if (mc !== me) return
      if (e.t === 'meta') me.run = e.run ?? e.job?.result ?? null
      if (e.t === 'queue') { $('mc-note').textContent = e.pos > 0 ? `Queued: position ${e.pos}${e.etaS != null ? `, about ${Math.round(e.etaS)} s` : ''}` : 'Starting'; mcStates('Ready') }
      if (e.t === 'await0g') mcStates(me.state = 'Waiting for 0G')
      if (e.t === 'ticks') { me.ticks.push(...e.rows); if (me.live) { mcStates(me.state = me.state === 'Ready' ? 'Executing' : me.state); mcOverlay(me.ticks.at(-1)!.t_s) } }
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
  if (me.state === 'Ready' || me.state === 'Executing' || me.state === 'Waiting for 0G') me.state = me.ds.some((d) => d.source !== '0g') ? 'Safe halt' : 'Completed'
  mcStates(me.state)
  // after a live run, switch to the recorded camera of the finished run
  const rv = RUN_VIDEO[me.run?.name ?? id] ?? ((me.run as any)?.video ? { path: (me.run as any).video, aligned: true } : null)
  if (rv) {
    vid.src = api('/media/' + rv.path); vid.preload = 'auto'; vid.classList.remove('hidden'); img.classList.add('hidden'); prog.classList.add('hidden'); me.aligned = rv.aligned
    $('mc-peek').classList.add('hidden'); $('mc-worst').classList.remove('hidden'); $('mc-note').textContent = rv.note ?? ''
    if (me.live) { vid.load(); vid.play().catch(() => { /* autoplay blocked: controls stay */ }) }
  } else if (me.live) { prog.classList.add('hidden'); vid.classList.remove('hidden'); $('mc-note').textContent = 'The run finished but its recording is not available.' }
  else if (!me.live) $('mc-note').textContent = 'No camera recording exists for this run; the timeline and telemetry come from its recorded data.'
  mcTimeline(); mcTele(); mcVerdict()
  const worst = me.ticks.reduce((m, t, i) => (t.gt_gap < (me.ticks[m]?.gt_gap ?? Infinity) ? i : m), 0)
  mcOverlay(me.ticks[worst]?.t_s ?? 0)
}
function renderPlan() {
  $('mc-plan').classList.remove('hidden')
  $('mc-plan').innerHTML = `<p class="kicker">0G strategist · plan written before the first tick</p><h2 class="sec" style="margin-bottom:8px">“Staggered Cut-in”</h2>
    <p style="margin:0 0 10px">B and C sequentially cut into the ego lane ahead, while A progressively brakes. This compresses the ego’s forward space, forcing emergency deceleration.</p><ul class="roles" data-roles>${rolesHtml()}</ul>`
}
const decAt = (t: number) => mc ? mc.ds.filter((d) => d.sim_time_s <= t).at(-1) : undefined
const tickAt = (t: number) => mc ? (mc.ticks.find((x) => x.t_s >= t) ?? mc.ticks.at(-1)) : undefined
function mcOverlay(t: number) {
  if (!mc) return
  if (!$('mc-progress').classList.contains('hidden')) { $('mc-overlay').innerHTML = ''; return } // progress panel owns the stage while running
  const d = decAt(t), k = tickAt(t), acts = d && (d as any).actions ? Object.entries((d as any).actions as Record<string, string>).map(([car, a]) => `${car} ${a}`).join(' · ') : null
  $('mc-overlay').innerHTML = (d ? `<span class="act-on">${esc(acts ?? `Attacker: ${d.action ?? 'SAFE_HALT'}`)}</span>` : '<span>Run-up: no decision yet</span>') +
    (k ? `<span>t ${num(k.t_s, 1)} s</span><span>CCS ${num(k.ccs, 2)}</span><span>gap ${num(k.gt_gap, 1)} m</span>` : '')
}
function mcTimeline() {
  if (!mc) return
  const items = mc.ds.map((d, i) => `<button role="listitem" data-di="${i}" class="${i === mc!.sel ? 'on' : ''} ${d.source !== '0g' ? 'halt' : ''}">cp ${d.cp} · ${num(d.sim_time_s, 1)} s<br>${esc((d as any).actions ? Object.values((d as any).actions).join('/') : d.action ?? 'SAFE_HALT')}</button>`)
  $('mc-timeline').innerHTML = (mc.id === 'swarm-carla-010' ? '<button class="plan" data-plan>PLAN<br>0G strategist</button>' : '') + items.join('')
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
  $('mc-insp').innerHTML = `<p class="kicker">Decision inspector</p><h3 style="margin:0 0 8px">Checkpoint ${d.cp}: ${esc(say(d.action))}</h3>
    ${why(d) ? `<div class="why-q">“${esc(why(d))}”<br><small class="muted">the model’s stated reason</small></div>` : ''}
    <dl>
      <dt>Sim time</dt><dd>${num(d.sim_time_s, 2)} s</dd><dt>Action</dt><dd>${esc((d as any).actions ? JSON.stringify((d as any).actions) : d.action ?? 'SAFE_HALT')}</dd>
      <dt>Source</dt><dd>${d.source === '0g' ? '0G Router, private tier' : esc(d.source) + ' (safe stop)'}</dd><dt>Latency</dt><dd>${esc(d.latency_ms)} ms</dd>
      <dt>Request ID</dt><dd>${esc(d.request_id)}</dd><dt>Provider</dt><dd>${esc(d.provider)}</dd><dt>Signature</dt><dd>${esc(sig)}</dd>
      <dt>LiDAR gap</dt><dd>${k?.lidar_gap != null ? num(k.lidar_gap, 2) + ' m (measured)' : '-'}</dd><dt>Gap</dt><dd>${num(k?.gt_gap, 2)} m (ground truth)</dd>
      <dt>TTC</dt><dd>${k?.gt_ttc_s == null ? 'no closing' : num(k.gt_ttc_s, 2) + ' s'} (ground truth)</dd><dt>Speeds</dt><dd>car ${num(k?.ego_v, 1)} m/s · attacker ${num(k?.lead_v, 1)} m/s</dd>
      <dt>CCS</dt><dd>${num(k?.ccs, 3)} (recomputed)</dd>
    </dl><details style="margin-top:10px"><summary>Raw response</summary><pre class="msg">${esc(d.content ?? JSON.stringify(d, null, 1))}</pre></details>`
}
function mcTele(cursor?: number) {
  if (!mc) return
  const cv = $<HTMLCanvasElement>('mc-tele'); drawTele(cv, mc.ticks, mc.ds, cursor)
}
function mcVerdict() {
  if (!mc) return
  const r = mc.run, crashed = r?.collision ?? mc.ticks.some((t) => t.collision)
  const words = crashed ? 'The vehicle collided with the attacker.' : `The vehicle avoided collision.${r?.minTtc != null ? ` The minimum TTC was ${num(r.minTtc, 2)} s.` : ''}`
  const name = r?.name ?? mc.id
  $('mc-verdict').innerHTML = `<h2 class="sec">${esc(words)}</h2>
    <div class="stats"><div><b>${num(r?.minGap, 2)} m</b><span>closest gap</span></div><div><b>${num(r?.minTtc, 2)} s</b><span>minimum time to collision</span></div>
    <div><b>${num(r?.ccs, 2)}</b><span>peak criticality (CCS, 0 to 1)</span></div><div><b>${esc(r?.decisions0g ?? mc.ds.filter((d) => d.source === '0g').length)} of ${esc(r?.decisions ?? mc.ds.length)}</b><span>decisions from 0G</span></div></div>
    <div class="row" style="margin-top:14px"><a class="btn k" href="/verify/${name.split('/').map(encodeURIComponent).join('/')}">Check the evidence for this run</a><a class="btn" href="/results/${name.split('/').map(encodeURIComponent).join('/')}">See the results</a><a class="btn" href="/lab">Run your own test</a></div>`
}
$<HTMLVideoElement>('mc-video').addEventListener('timeupdate', () => {
  if (!mc?.aligned) return
  const t = $<HTMLVideoElement>('mc-video').currentTime; mcOverlay(t); mcTele(t)
  const d = decAt(t), i = d ? mc.ds.indexOf(d) : -1  // highlight the decision in force at this moment
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

// ---------- Proof Explorer: three questions, five honest statuses ----------
type PS = 'verified' | 'failed' | 'unavailable' | 'notchecked' | 'na'
const PS_WORD: Record<PS, string> = { verified: 'Verified', failed: 'Failed', unavailable: 'Unavailable', notchecked: 'Not checked', na: 'Not applicable' }
const proof = (st: PS, title: string, guarantee: string, artifact: string, how: string) =>
  `<details class="proof"><summary><b>${esc(title)}</b><span class="st ${st}">${PS_WORD[st]}</span></summary><div class="body"><p>${guarantee}</p><p><b>Artifact:</b> ${artifact}</p><p class="muted">${how}</p><button class="btn" data-recheck>Check again</button></div></details>`
async function openVerify(id: string) {
  $<HTMLInputElement>('vf-in').value = id
  $('vf-groups').innerHTML = '<div class="card">Loading…</div>'; $('vf-timeline').innerHTML = ''
  let runs: Run[] = []
  try { runs = await getJson('/api/runs') } catch { /* offline */ }
  let r: Run | null = runs.find((x) => x.name === id || x.storage?.publicRoot === id) ?? (mc?.run?.name === id ? mc.run : null)
  if (!r) try { r = /^[0-9a-f]{16}$/.test(id) ? (await getJson(`/api/jobs/${id}`)).result : await getJson(`/api/run?name=${encodeURIComponent(id)}`) } catch { /* not found */ }
  if (!r) { $('vf-groups').innerHTML = `<div class="card">No run matches <code>${esc(id)}</code>${online ? '' : ' (the console is offline)'}. Try <a href="/verify/${FEATURED}">paid test 002</a>.</div>`; return }
  let ds: Decision[] = []
  try { await post('/api/stream', { run: r.name, mode: 'replay', speed: 8 }, (e) => { if (e.t === 'decision') ds.push(e.d) }) } catch { /* summary only */ }
  const zg = ds.filter((d) => d.source === '0g'), first = zg[0], last = zg.at(-1), ch = r.chain, st = r.storage, p = r.payment
  const cbf = ch?.committedBeforeFirstCall ?? (ch?.commitBlockTimestamp && first?.wall_clock_utc ? ch.commitBlockTimestamp * 1000 < Date.parse(first.wall_clock_utc) : null)
  const runName = r.name
  const ts = (n?: number | null) => (n ? new Date(n * 1000).toISOString().replace('.000', '') : '-')
  $('vf-timeline').innerHTML = `<h2 class="sec">Timeline: ${esc(r.name === FEATURED ? 'paid test 002' : r.name)}</h2><ol class="vtl">
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
    proof((r as any).requestedBy ? 'verified' : 'na', 'Signed test request', 'A wallet signed a readable test request (EIP-191); the console verified it before queuing.', (r as any).requestedBy ? `<code>${esc((r as any).requestedBy)}</code>` : 'not recorded for this run', 'Checked by the console when the run was requested.'),
  ]
  const grp = (t: string, sub: string, items: string[]) => `<div class="card"><h2 class="sec" style="margin-bottom:4px">${t}</h2><p class="muted" style="margin:0 0 6px">${sub}</p>${items.join('')}</div>`
  $('vf-groups').innerHTML = grp('Who made the decisions?', '0G Router (inference)', g1) + grp('Can the evidence be altered?', '0G Storage and 0G Galileo (storage and chain)', g2) + grp('Who requested and paid?', 'Hedera', g3)
  $('vf-groups').querySelectorAll('[data-recheck]').forEach((b) => b.addEventListener('click', () => openVerify(runName)))
}
$('vf-go').addEventListener('click', () => go(`/verify/${encodeURIComponent($<HTMLInputElement>('vf-in').value.trim() || FEATURED)}`))

// ---------- Results (/results/:id): verdict and worst moment first, then tabs ----------
async function loadRun(id: string) {
  let run: Run | null = null; const ticks: Tick[] = [], ds: Decision[] = []
  await post('/api/stream', /^[0-9a-f]{16}$/.test(id) ? { job: id, mode: 'live' } : { run: id, mode: 'replay', speed: 8 }, (e) => {
    if (e.t === 'meta') run = e.run ?? e.job?.result ?? null
    if (e.t === 'ticks') ticks.push(...e.rows)
    if (e.t === 'decision') ds.push(e.d)
    if (e.t === 'done' || e.t === 'error') run = e.run ?? e.job?.result ?? run
  })
  return { run: run as Run | null, ticks, ds }
}
let rs: { id: string, run: Run | null, ticks: Tick[], ds: Decision[] } | null = null
async function openResults2(id: string) {
  $('rs-verdict').textContent = 'Loading…'; $('rs-body').innerHTML = ''
  try { const d = await loadRun(id); rs = { id, ...d } } catch (e) { $('rs-verdict').textContent = `Could not load this run: ${(e as Error).message}`; return }
  const { run: r, ticks } = rs!, name = r?.name ?? id, path = name.split('/').map(encodeURIComponent).join('/')
  const crashed = r?.collision ?? ticks.some((t) => t.collision)
  const w = ticks.reduce((m, t, i) => (t.gt_gap < (ticks[m]?.gt_gap ?? Infinity) ? i : m), 0), wt = ticks[w]?.t_s ?? 0
  $('rs-kind').textContent = `Results · ${name === FEATURED ? 'paid test 002' : name}`
  $('rs-verdict').textContent = crashed ? 'The vehicle collided with the attacker.' : `The vehicle avoided collision. The minimum TTC was ${num(r?.minTtc, 2)} s.`
  $('rs-sub').textContent = `Closest approach ${num(r?.minGap, 2)} m at ${num(wt, 1)} s · peak CCS ${num(r?.ccs, 2)} · ${r?.decisions0g ?? '-'} of ${r?.decisions ?? '-'} decisions from 0G`
  $<HTMLAnchorElement>('rs-mission').href = `/mission/${path}`; $<HTMLAnchorElement>('rs-verify').href = `/verify/${path}`
  const rv = RUN_VIDEO[name] ?? ((r as any)?.video ? { path: (r as any).video, aligned: true } : null)
  const fr = $<HTMLVideoElement>('rs-frame')
  if (rv?.aligned) { fr.src = api('/media/' + rv.path); fr.onloadedmetadata = () => { fr.currentTime = Math.min(fr.duration, wt) }; $('rs-frame-cap').textContent = `Recorded frame at ${num(wt, 1)} s, the closest approach` }
  else { fr.removeAttribute('src'); $('rs-frame-cap').textContent = 'No time-aligned recording for this run' }
  rsTab('replay')
}
function rsTab(t: string) {
  document.querySelectorAll<HTMLButtonElement>('[data-rtab]').forEach((b) => b.classList.toggle('on', b.dataset.rtab === t))
  if (!rs) return
  const { run: r, ds } = rs, name = r?.name ?? rs.id, path = name.split('/').map(encodeURIComponent).join('/'), rv = RUN_VIDEO[name] ?? ((r as any)?.video ? { path: (r as any).video, aligned: true } : null)
  let h = ''
  if (t === 'replay') h = rv ? `<video class="clip" controls muted playsinline preload="metadata" src="${esc(api('/media/' + rv.path))}" aria-label="Recorded CARLA camera"></video>${rv.note ? `<p class="muted">${esc(rv.note)}</p>` : ''}<p><a class="btn k" href="/mission/${path}">Replay with the decision timeline</a></p>` : '<p>No camera recording exists for this run.</p>'
  if (t === 'metrics') h = `<div class="stats"><div><b>${r?.collision ? 'Yes' : 'No'}</b><span>collision</span></div><div><b>${num(r?.minGap, 2)} m</b><span>closest gap (ground truth)</span></div><div><b>${num(r?.minTtc, 2)} s</b><span>minimum time to collision</span></div><div><b>${num(r?.ccs, 3)}</b><span>peak CCS (0 to 1, recomputed)</span></div></div>
    <dl class="kv" style="max-width:640px">${kv([['World', esc(r?.world)], ['Scenario family', esc(r?.family)], ['Attacker model', `<code>${esc(r?.model)}</code>`], ['Status', esc(r?.status)]])}</dl>`
  if (t === 'reasoning') h = (name === 'swarm-carla-010' ? `<p><b>Plan:</b> “Staggered Cut-in”</p><ul class="roles" data-roles>${rolesHtml()}</ul>` : '') +
    `<ol class="reason">${ds.map((d) => `<li><b>${num(d.sim_time_s, 1)} s · ${esc(say(d.action))}</b>${why(d) ? `<span>“${esc(why(d))}”</span>` : ''}<small>${d.source === '0g' ? `0G request ${esc(d.request_id)} · ${d.latency_ms} ms` : 'no valid 0G answer: safe stop'}</small></li>`).join('')}</ol>
    <p class="muted">Claim audits for research runs are on the <a href="/research">research page</a>.</p>`
  if (t === 'compare') h = `<p><b>Scripted replay:</b> both policies face the identical recorded attacker script (no fresh 0G calls), so differences come from the policy.</p><div class="tscroll">${arenaTable(ARENA_RECORDED)}</div>
    <p style="margin-top:14px"><b>Fresh 0G loop:</b> each policy faces a live 0G attacker, so the attacks differ between the two runs.</p>${clip('videos/arena-live0g-video-001__r7l-2s3__side_by_side.mp4', 'ab', 'Both policies against a live 0G attacker')}`
  if (t === 'evidence') { const tr = trustFromRun(r, ds, !!r?.free); h = `<div class="rail">${railHtml(tr)}</div><p style="margin-top:14px"><a class="btn k" href="/verify/${path}">Open the Proof Explorer</a></p>` }
  $('rs-body').innerHTML = h; armClips($('rs-body'))
}
document.querySelectorAll<HTMLButtonElement>('[data-rtab]').forEach((b) => b.addEventListener('click', () => rsTab(b.dataset.rtab!)))

// ---------- Research: claim audit ----------
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


// ---------- Judge mode: a 6-step, 3-minute path that drives the pages ----------
const JUDGE: { title: string, text: string, run: () => Promise<string | null> }[] = [
  { title: 'The problem', text: 'AV safety results are run by someone with a stake in the answer. Faultline makes the attacker independent and the record public.', run: async () => { go('/'); return '#problem' } },
  { title: 'A physical AI agent', text: 'The 0G strategist plans a four-car attack before the first tick, then steers all four cars every second in CARLA.', run: async () => { go('/mission/swarm-carla-010'); return '#mc-plan' } },
  { title: 'The safety result', text: 'Paid test 002: the car avoided collision; the minimum time to collision was 1.03 s. We jump to the closest approach.', run: async () => { go('/mission/' + FEATURED); await waitFor(() => !!mc && mc.ds.length > 0 && mc.state !== 'Ready'); $('mc-worst').click(); return '#mc-verdict' } },
  { title: 'The Web3 proof', text: 'Committed on 0G Galileo before the first 0G decision, finalized after the last; each decision has a 0G request ID and an archived provider signature.', run: async () => { go('/verify/' + FEATURED); await waitFor(() => !!document.querySelector('#vf-groups .proof')); return '#vf-timeline' } },
  { title: 'Agentic payment', text: 'The tester signs a request; our agent pays 0.001 HBAR on Hedera through x402 under a spending limit, with no human approval step.', run: async () => { if (!location.pathname.startsWith('/verify')) { go('/verify/' + FEATURED); await waitFor(() => !!document.querySelector('#vf-groups .proof')) } const g = [...document.querySelectorAll<HTMLElement>('#vf-groups .card')].at(-1); g?.querySelector('details')?.setAttribute('open', ''); return g ? '#vf-groups .card:last-child' : null } },
  { title: 'The research vision', text: '0G plans experiments and states hypotheses; classical tools do search; every claim is audited. Where bisection or random search won, we say so.', run: async () => { go('/research'); return '#claims' } },
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
$('judge-btn').addEventListener('click', () => judge(0))
$('j-prev').addEventListener('click', () => judge(jstep - 1))
$('j-next').addEventListener('click', () => { if (jstep === JUDGE.length - 1) { $('judge').classList.add('hidden'); document.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl')) } else judge(jstep + 1) })
$('j-close').addEventListener('click', () => { $('judge').classList.add('hidden'); document.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl')) })

// ---------- scenario families: scripted illustration clips (scripts/clips/make_clips.py: no 0G decisions drive them) ----------
const FAMILIES = [['cut-in', 'Cut-in', 'live with 0G (cut-in suite)'], ['lead-brake', 'Lead vehicle brakes', 'scripted clip'], ['pedestrian', 'Pedestrian crossing', 'scripted clip'],
  ['lidar-dropout', 'LiDAR dropout', 'scripted clip'], ['intersection', 'Intersection conflict', 'scripted clip']]
document.querySelectorAll('[data-families]').forEach((el) => {
  el.innerHTML = FAMILIES.map(([f, t, st]) => `<figure><video muted loop playsinline preload="none" poster="/clips/${f}.jpg" data-loop="/clips/${f}.mp4" aria-label="${esc(t)}: scripted CARLA scenario clip"></video><b>${esc(t)}</b><small>${esc(st)}</small></figure>`).join('')
})
// play loops only while visible (and never under reduced motion)
const famObs = new IntersectionObserver((es) => es.forEach((e) => {
  const v = e.target as HTMLVideoElement
  if (e.isIntersecting && !matchMedia('(prefers-reduced-motion: reduce)').matches) { if (!v.getAttribute('src')) v.src = v.dataset.loop!; v.play().catch(() => { /* blocked */ }) } else v.pause()
}))
document.querySelectorAll<HTMLVideoElement>('video[data-loop]').forEach((v) => famObs.observe(v))
boot()
