// Every page, alias and nav item lives here; pages build links only with href.* so a button can't point anywhere else.
export type Page = 'home' | 'attacks' | 'lab' | 'run' | 'runs' | 'proof' | 'research' | 'stack'
export const FEATURED = 'paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-1794006602051' // paid test 002
export const SWARM = 'swarm-carla-010'
export type AttackId = 'cut-in' | 'swarm'

const enc = (id: string) => id.split('/').map(encodeURIComponent).join('/') // CARLA demo run names contain one '/'
export const href = {
  home: (anchor = '') => `/${anchor ? '#' + anchor : ''}`,
  attacks: () => '/attacks',
  lab: (attack?: AttackId) => `/lab${attack ? `?attack=${attack}` : ''}`,
  run: (id: string) => `/run/${enc(id)}`,
  runs: () => '/runs',
  proof: (id?: string) => `/proof${id ? '/' + enc(id) : ''}`,
  research: (anchor = '') => `/research${anchor ? '#' + anchor : ''}`,
  stack: () => '/stack',
}

export const NAV: { page: Page, label: string, path: string }[] = [
  { page: 'home', label: 'Overview', path: '/' }, { page: 'attacks', label: 'Attacks', path: '/attacks' }, { page: 'runs', label: 'Runs', path: '/runs' },
  { page: 'proof', label: 'Proof', path: '/proof' }, { page: 'research', label: 'Research', path: '/research' },
]

const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
const PAGES: Record<string, Page> = { '': 'home', attacks: 'attacks', lab: 'lab', run: 'run', runs: 'runs', proof: 'proof', research: 'research', stack: 'stack' }
// old paths from earlier builds and shared links: page + the segment that replaces them
const ALIASES: Record<string, Page> = { mission: 'run', results: 'run', verify: 'proof', library: 'runs' }

/** Resolve a pathname. canonical is set when the path is an alias (or unknown) and the address bar should change. */
export function parse(path: string): { page: Page, id: string | null, canonical: string | null } {
  const [, a = '', ...rest] = path.split('/'), raw = rest.join('/'), id = raw ? safeDecode(raw) : null
  if (Object.hasOwn(PAGES, a)) {
    if (PAGES[a] === 'run' && !id) return { page: 'runs', id: null, canonical: '/runs' }
    return { page: PAGES[a], id, canonical: null }
  }
  const p = Object.hasOwn(ALIASES, a) ? ALIASES[a] : undefined
  if (p === 'run') return id ? { page: 'run', id, canonical: href.run(id) } : { page: 'runs', id: null, canonical: '/runs' }
  if (p) return { page: p, id, canonical: p === 'proof' ? href.proof(id ?? undefined) : `/${p}` }
  return { page: 'home', id: null, canonical: '/' }
}
