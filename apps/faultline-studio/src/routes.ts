// Every page, alias and nav item lives here; pages build links only with href.* so a button can't point anywhere else.
// Paths follow the Faultline frontend product requirements (section 3): /mission, /results, /verify, /library.
export type Page = 'home' | 'lab' | 'mission' | 'results' | 'verify' | 'library' | 'research' | 'stack'
export const FEATURED = 'paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-1794006602051' // paid test 002
export const SWARM = 'swarm-carla-010'
export const LEAD_BRAKE = 'demo-003'
export type AttackId = 'cut-in' | 'swarm'

const enc = (id: string) => id.split('/').map(encodeURIComponent).join('/') // CARLA demo run names contain one '/'
export const href = {
  home: (anchor = '') => `/${anchor ? '#' + anchor : ''}`,
  lab: (attack?: AttackId) => `/lab${attack ? `?attack=${attack}` : ''}`,
  mission: (id: string) => `/mission/${enc(id)}`,
  results: (id: string) => `/results/${enc(id)}`,
  verify: (id?: string) => `/verify${id ? '/' + enc(id) : ''}`,
  library: (anchor = '') => `/library${anchor ? '#' + anchor : ''}`,
  research: (anchor = '') => `/research${anchor ? '#' + anchor : ''}`,
  stack: () => '/stack',
  // standalone static apps built into dist/ (not SPA routes; the link handler lets them load normally)
  verifier: (root?: string) => `/verifier/index.html${root ? `?root=${encodeURIComponent(root)}` : ''}`,
  memory: () => '/memory/index.html',
}
/** Paths the SPA router must not intercept. */
export const isStaticApp = (path: string) => path.startsWith('/verifier/') || path.startsWith('/memory/') || path.startsWith('/media/') || path.startsWith('/lite/') || path.startsWith('/clips/')

export const NAV: { page: Page, label: string, path: string, also?: Page[] }[] = [
  { page: 'home', label: 'Discover', path: '/' },
  { page: 'lab', label: 'Run a test', path: '/lab', also: ['stack'] },
  { page: 'library', label: 'Explore runs', path: '/library', also: ['mission', 'results'] },
  { page: 'research', label: 'Research', path: '/research' },
  { page: 'verify', label: 'Verify', path: '/verify' },
]
/** The nav item a page lights up (Stack sits under Run a test; run pages under Explore runs). */
export const navFor = (p: Page): Page => NAV.find((n) => n.page === p || n.also?.includes(p))?.page ?? 'home'

const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
const PAGES: Record<string, Page> = { '': 'home', lab: 'lab', mission: 'mission', results: 'results', verify: 'verify', library: 'library', research: 'research', stack: 'stack' }
const NEEDS_ID: Page[] = ['mission', 'results']
// old or alternate paths from earlier builds and shared links
const ALIASES: Record<string, Page | 'attacks'> = { run: 'mission', proof: 'verify', runs: 'library', attacks: 'attacks' }

/** Resolve a pathname. canonical is set when the path is an alias (or unknown) and the address bar should change. */
export function parse(path: string): { page: Page, id: string | null, canonical: string | null } {
  const [, a = '', ...rest] = path.split('/'), raw = rest.join('/'), id = raw ? safeDecode(raw) : null
  if (Object.hasOwn(PAGES, a)) {
    const page = PAGES[a]
    if (NEEDS_ID.includes(page) && !id) return { page: 'library', id: null, canonical: '/library' }
    return { page, id: page === 'verify' || NEEDS_ID.includes(page) ? id : null, canonical: null }
  }
  const p = Object.hasOwn(ALIASES, a) ? ALIASES[a] : undefined
  if (p === 'attacks') return { page: 'home', id: null, canonical: '/#scenarios' }
  if (p === 'mission') return id ? { page: 'mission', id, canonical: href.mission(id) } : { page: 'library', id: null, canonical: '/library' }
  if (p === 'verify') return { page: 'verify', id, canonical: href.verify(id ?? undefined) }
  if (p) return { page: p, id: null, canonical: `/${p}` }
  return { page: 'home', id: null, canonical: '/' }
}
