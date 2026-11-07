// Faultline Studio boot: register the eight pages, inject their CSS once, start orbs, route.
// Pages and links come from ./routes (one table); each page module mounts once and opens on every visit.
import { startOrbs } from './orb'
import { parse, type Page } from './routes'
import { initShell, judgeOpen, setNav } from './shell'
import { page as home } from './pages/home'
import { page as lab } from './pages/lab'
import { page as mission } from './pages/mission'
import { page as results } from './pages/results'
import { page as verify } from './pages/verify'
import { page as library } from './pages/library'
import { page as research } from './pages/research'
import { page as stack } from './pages/stack'

type PageModule = { id: Page, title: string, css: string, mount(root: HTMLElement): void, open(id: string | null, search: URLSearchParams): void, leave?(): void }
const PAGES: Record<Page, PageModule> = { home, lab, mission, results, verify, library, research, stack }

const style = document.createElement('style')
style.textContent = Object.values(PAGES).map((p) => p.css).join('\n')
document.head.append(style)

const mounted = new Set<Page>()
let current: { page: Page, id: string | null, search: string } | null = null

/** Scroll to the hash target; pages render async, so retry for up to ~2 s. */
function scrollToHash(hash: string) {
  let n = 0
  const tick = () => { const el = document.getElementById(decodeURIComponent(hash.slice(1))); if (el) el.scrollIntoView(); else if (n++ < 40) setTimeout(tick, 50) }
  requestAnimationFrame(tick)
}

function route() {
  const r = parse(location.pathname)
  if (r.canonical) history.replaceState(null, '', r.canonical + (r.canonical.includes('#') ? '' : location.search + location.hash))
  const search = location.search, hash = location.hash
  if (current && current.page === r.page && current.id === r.id && current.search === search) { if (hash) scrollToHash(hash); else window.scrollTo({ top: 0 }); return }
  if (current) { try { PAGES[current.page].leave?.() } catch (e) { console.error(`[${current.page}] leave`, e) } }
  const first = !current
  current = { page: r.page, id: r.id, search }
  for (const p of Object.keys(PAGES) as Page[]) document.getElementById(`v-${p}`)?.classList.toggle('hidden', p !== r.page)
  const m = PAGES[r.page], root = document.getElementById(`v-${r.page}`)!
  setNav(r.page)
  document.title = `${m.title} · Faultline`
  try {
    if (!mounted.has(r.page)) { mounted.add(r.page); m.mount(root) }
    m.open(r.id, new URLSearchParams(search))
  } catch (e) {
    console.error(`[${r.page}]`, e)
    root.insertAdjacentHTML('afterbegin', '<div class="card" role="alert">This page hit an error while loading. <a href="/">Back to Discover</a></div>')
  }
  if (hash) scrollToHash(hash); else window.scrollTo({ top: 0 })
  if (!first && !hash && !judgeOpen()) document.getElementById('main')?.focus({ preventScroll: true }) // move screen readers to the new page
}

initShell(route)
window.addEventListener('popstate', route)
startOrbs()
route()
