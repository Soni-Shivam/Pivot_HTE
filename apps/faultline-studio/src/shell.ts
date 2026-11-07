// Shell: header + nav, phone menu, runner status, offline strip, SPA link interception, judge mode (PRD sections 3, 6, 8).
// The router itself lives in main.ts and registers here with initShell(route); pages call go(path).
import { FEATURED, NAV, SWARM, href, isStaticApp, navFor, type Page } from './routes'
import { $, esc, sleep } from './core/dom'
import { connect, health, onHealth, onWallet, resumeWallet, wallet, walletErr, walletOptions } from './core/state'

let router: () => void = () => {}
/** Navigate inside the SPA (pushState + route). */
export function go(path: string) { history.pushState(null, '', path); router() }

const STATUS_TIP_OFF = 'The local test runner is unreachable. Recorded clips, the run library and the independent verifier still work.'

export function initShell(route: () => void) {
  router = route
  $('hdr').innerHTML = `
    <a class="brand" href="${href.home()}">faultline<i>.</i></a>
    <button id="menu-btn" aria-expanded="false" aria-controls="nav">Menu</button>
    <nav class="top" aria-label="Main" id="nav">${NAV.map((n) => `<a href="${n.path}" data-nav="${n.page}">${esc(n.label)}</a>`).join('')}</nav>
    <div class="hdr-right">
      <span class="pill sm" id="status-pill" role="status" tabindex="0" data-tip="Checking the local test runner"><i class="dot" id="status-dot"></i><span id="status-txt">Checking runner…</span></span>
      <a class="btn y" href="${href.lab()}" id="run-cta">Run a test</a>
      <button class="pill" id="wallet-btn" data-tip="Connects your browser wallet here. It only ever signs a readable test request.">Connect wallet</button>
    </div>`

  // phone menu: labelled button, aria-expanded, Escape closes and returns focus
  const menu = $('menu-btn'), nav = $('nav')
  const setMenu = (open: boolean, focusBack = false) => {
    nav.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); menu.textContent = open ? 'Close' : 'Menu' // short: the phone header is one row; aria-expanded carries the state
    if (focusBack) menu.focus()
  }
  menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; setMenu(open); if (open) nav.querySelector('a')?.focus() })
  nav.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) setMenu(false, true) })
  nav.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) setMenu(false) })

  // SPA links: same-origin a[href^="/"], except static apps, new-tab targets, downloads and modifier clicks
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]')
    if (!a || e.defaultPrevented || e.button !== 0 || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const path = a.getAttribute('href')!
    if (path.startsWith('//') || isStaticApp(new URL(path, location.origin).pathname)) return
    e.preventDefault(); go(path)
  })

  // status: header pill + non-blocking offline strip
  const paintHealth = () => {
    const h = health, txt = $('status-txt'), pill = $('status-pill')
    if (!h.checked) return
    $('status-dot').className = `dot ${!h.online ? 'down' : h.carla ? 'up' : 'part'}`
    txt.textContent = h.online ? `Local runner online · CARLA ${h.carla ? 'online' : 'offline'}` : 'Recorded content available'
    pill.dataset.tip = h.online
      ? `0G ${h.zg ? 'ready' : 'not configured'} · Hedera payments ${h.hedera ? 'ready' : 'offline'} · ${h.queue?.running ?? 0} running, ${h.queue?.waiting ?? 0} waiting · ${h.caps?.runs_left ?? '-'} live runs left today`
      : STATUS_TIP_OFF
    $('offline-strip').classList.toggle('hidden', h.online)
  }
  onHealth(paintHealth); paintHealth()

  // wallet: connects in place, never navigates
  const wb = $('wallet-btn')
  const paintWallet = () => { wb.textContent = wallet.current ? `● ${wallet.current.address.slice(0, 6)}…${wallet.current.address.slice(-4)}` : 'Connect wallet' }
  onWallet(paintWallet); paintWallet()
  const flash = (text: string, tip: string) => { wb.textContent = text; wb.dataset.tip = tip; setTimeout(() => { if (!wallet.current) wb.textContent = 'Connect wallet' }, 3000) }
  wb.addEventListener('click', async () => {
    if (wallet.current) return
    if (!walletOptions().length) { flash('No wallet found', 'Install a browser wallet such as Coinbase Wallet and reload. Free runs work without one.'); return }
    try { await connect() } // still inside the click: the wallet popup needs a user gesture
    catch (e) { flash('Not connected', walletErr(e, 'connection')) }
  })
  setTimeout(resumeWallet, 400) // reconnect a wallet the visitor already approved (no popup)

  // judge mode: any [data-judge] button opens it
  document.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-judge]'); if (b) { e.preventDefault(); openJudge(b as HTMLElement) } })
  $('j-prev').addEventListener('click', () => judge(jstep - 1))
  $('j-next').addEventListener('click', () => { if (jstep === JUDGE.length - 1) closeJudge(); else judge(jstep + 1) })
  $('j-close').addEventListener('click', closeJudge)
  $('judge').addEventListener('keydown', trap)
  document.addEventListener('focusin', (e) => { if (judgeOpen() && !$('judge').contains(e.target as Node)) $('j-title').focus() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && judgeOpen()) closeJudge() })
}

/** Light the nav item and the header CTA for the current page. */
export function setNav(p: Page) {
  const key = navFor(p)
  document.querySelectorAll<HTMLAnchorElement>('#nav a').forEach((a) => {
    const on = a.dataset.nav === key
    a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current')
  })
  document.getElementById('run-cta')?.classList.toggle('on', p === 'lab')
}

// ---------- judge mode: a 6-step, 3-minute path through the real pages (PRD section 8) ----------
const visible = (sel: string) => { const el = document.querySelector<HTMLElement>(sel); return el && el.offsetParent !== null ? el : null }
const waitFor = async (sel: string, ms = 8000) => { const t = Date.now(); while (!visible(sel) && Date.now() - t < ms) await sleep(150); return visible(sel) }
const visit = async (path: string, sel: string) => { if (location.pathname !== path.split(/[?#]/)[0]) go(path); return waitFor(sel) }

const JUDGE: { title: string, text: string, run: () => Promise<HTMLElement | null> }[] = [
  { title: 'Who tested the tester?', text: 'AV safety results usually come from someone with a stake in the answer. Here an independent AI adversary drives four cars against the vehicle under test, in CARLA.', run: () => visit(href.home(), '#scenarios') },
  { title: 'The 0G plan', text: 'Before the first tick, the 0G strategist writes a plan for all four cars, then steers them every checkpoint. Each decision carries a 0G request ID.', run: () => visit(href.mission(SWARM), '#mc-plan') },
  { title: 'The measured result', text: 'Paid test 002 on PDM-Lite: the outcome and the closest approach, measured in this test. It is a test result, not a safety certificate.', run: async () => {
    // the verdict card shows a loader first and the video grows above it: wait for the real verdict, seek, then highlight last
    await visit(href.mission(FEATURED), '#mc-verdict .mc-out')
    visible('#mc-worst')?.click()
    await sleep(50)
    return visible('#mc-verdict')
  } },
  { title: 'The evidence', text: 'Committed on 0G Galileo before the first 0G call; decision records and archived signatures in 0G Storage. Every check names how it was checked. Open the independent verifier to check the root yourself.', run: async () => {
    const el = await visit(href.verify(FEATURED), '#vf-ladder')
    const v = document.querySelector<HTMLAnchorElement>('#v-verify a[href^="/verifier/"]')
    $('j-text').insertAdjacentHTML('beforeend', ` <a href="${esc(v?.getAttribute('href') ?? href.verifier())}" target="_blank" rel="noopener">Open the independent verifier ↗</a>`)
    return el
  } },
  { title: 'Agentic payment', text: 'The tester signs a readable request. The buyer agent then pays 0.001 HBAR on Hedera testnet through x402, under a spending cap, for one run.', run: () => visit(href.verify(FEATURED), '#vf-payment') },
  { title: 'Research, audited', text: 'The 0G planner proposes experiments; classical search does the hunting; each claim is checked. Where bisection or random search won, the page says so.', run: () => visit(href.research(), '#claims') },
]
let jstep = 0, opener: HTMLElement | null = null, seq = 0
export const judgeOpen = () => !$('judge').classList.contains('hidden')
const clearHl = () => document.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl'))

function openJudge(from: HTMLElement) { opener = from; judge(0) }
async function judge(i: number) {
  const my = ++seq
  jstep = Math.max(0, Math.min(JUDGE.length - 1, i)); const j = JUDGE[jstep]
  $('judge').classList.remove('hidden')
  $('j-step').textContent = `Judge mode · ${jstep + 1} of ${JUDGE.length}`; $('j-title').textContent = j.title; $('j-text').textContent = j.text
  $<HTMLButtonElement>('j-prev').disabled = jstep === 0; $('j-next').textContent = jstep === JUDGE.length - 1 ? 'Finish' : 'Next'
  $('j-title').focus()
  clearHl()
  const el = await j.run()
  if (my !== seq || !judgeOpen()) return // a newer step or a close won
  if (el) { el.classList.add('hl'); el.scrollIntoView({ block: el.offsetHeight > innerHeight ? 'start' : 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }
  if (!$('judge').contains(document.activeElement)) $('j-title').focus()
}
function closeJudge() {
  const hl = document.querySelector<HTMLElement>('.hl')
  seq++; $('judge').classList.add('hidden'); clearHl()
  // the opener may sit on a page the tour left: fall back to the highlight (if focusable), the page's heading, then main
  const back = [opener, hl && hl.tabIndex >= 0 ? hl : null, document.querySelector<HTMLElement>('main > section:not(.hidden) h1'), $('main')]
    .find((el) => el?.isConnected && el.offsetParent !== null)
  if (back?.matches('h1:not([tabindex])')) back.tabIndex = -1
  back?.focus(); opener = null
}
function trap(e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  const f = [...$('judge').querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]')]
  if (!f.length) return
  const first = f[0], last = f[f.length - 1], a = document.activeElement
  if (e.shiftKey && (a === first || a === $('j-title'))) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus() }
}
