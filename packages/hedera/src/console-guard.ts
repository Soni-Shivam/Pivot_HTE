// Guards for the public agent console (docs/BACKEND.md): daily caps, per-IP rate limit, CORS allowlist, media allowlist.
// Pure helpers so packages/hedera/test/console-guard.test.ts can check them without starting the server.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'

/** Daily counters (UTC day), persisted so a console restart does not reset the caps. */
export class DailyCaps {
  private s = { day: '', buys: 0, runs: 0 }
  constructor(private file: string, public maxBuys: number, public maxRuns: number, private now = () => new Date()) {
    try { this.s = JSON.parse(readFileSync(file, 'utf8')) } catch { /* first start */ }
  }
  private roll() { const d = this.now().toISOString().slice(0, 10); if (this.s.day !== d) this.s = { day: d, buys: 0, runs: 0 } }
  left() { this.roll(); return { buys_left: Math.max(0, this.maxBuys - this.s.buys), runs_left: Math.max(0, this.maxRuns - this.s.runs) } }
  /** Reserve one unit; false when today's cap is used up. */
  take(kind: 'buys' | 'runs'): boolean {
    this.roll()
    if (this.s[kind] >= (kind === 'buys' ? this.maxBuys : this.maxRuns)) return false
    this.s[kind]++
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.s))
    return true
  }
}

/** Fixed-window counter per key. */
export class RateLimit {
  private m = new Map<string, { n: number, reset: number }>()
  constructor(private max: number, private windowMs: number, private now = () => Date.now()) {}
  allow(key: string): boolean {
    const t = this.now(), e = this.m.get(key)
    if (!e || t >= e.reset) { this.m.set(key, { n: 1, reset: t + this.windowMs }); if (this.m.size > 10_000) this.m.clear(); return true }
    return ++e.n <= this.max
  }
}

export const parseOrigins = (v: string | undefined) => new Set((v ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean))

/** Funnel proxies from loopback; then the client address is the first X-Forwarded-For entry. */
export function clientIp(remote: string | undefined, xff: string | undefined) {
  const loop = !remote || remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  return loop ? (xff?.split(',')[0].trim() || 'local') : remote
}

// Only rendered media; never JSON (anchor.json salt, permits), sealed.bin, logs or dotfiles.
const MEDIA_EXT = new Set(['.mp4', '.png', '.svg'])
const MEDIA_HTML = new Set(['decisions.html', 'console.html'])
/** Absolute path for /media/<rel> if allowlisted, else null. Roots: videos/ and runs/. */
export function mediaPath(root: string, rel: string): string | null {
  if (!rel || rel.includes('\0') || rel.split(/[\\/]/).some((p) => p === '..' || p.startsWith('.'))) return null
  const abs = resolve(root, rel), r = relative(root, abs)
  if (!(r.startsWith(`videos${sep}`) || r.startsWith(`runs${sep}`))) return null
  const base = abs.slice(abs.lastIndexOf(sep) + 1)
  if (/salt|permit|sealed|anchor|\.env/i.test(base)) return null
  if (!MEDIA_EXT.has(extname(base).toLowerCase()) && !MEDIA_HTML.has(base)) return null
  return existsSync(abs) ? abs : null
}
