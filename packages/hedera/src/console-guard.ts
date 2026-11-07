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

// ---------- wallet-signed run requests (EIP-191 personal_sign; the page asks only for eth_requestAccounts + personal_sign) ----------
export const REQUEST_MAX_AGE_MS = 5 * 60_000
/** The exact text the studio asks the wallet to sign. */
export const requestMessage = (r: { policy: string, suite: string, mode: string, nonce: string, issued: string }) =>
  `Faultline test request\npolicy: ${r.policy}\nsuite: ${r.suite}\nmode: ${r.mode}\nnonce: ${r.nonce}\nissued: ${r.issued}`

/** Check a signed request: shape, fields match the body, fresh (≤ 5 min), nonce single-use, signature recovers `address`.
 *  Returns the lower-cased signer or an error string for the 4xx response. */
export async function verifyRunRequest(body: any, want: { policy: string, suite: string, mode: string }, seen: Map<string, number>,
  verify: (a: { address: `0x${string}`, message: string, signature: `0x${string}` }) => Promise<boolean>, now = Date.now()): Promise<{ address: string } | { error: string }> {
  const { address, message, signature } = body ?? {}
  if (typeof address !== 'string' || typeof message !== 'string' || typeof signature !== 'string') return { error: 'Connect a wallet and sign the request first (unsigned requests are refused)' }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !/^0x[0-9a-fA-F]{130}$/.test(signature) || message.length > 400) return { error: 'malformed signed request' }
  const m = /^Faultline test request\npolicy: (\S+)\nsuite: (\S+)\nmode: (\S+)\nnonce: ([0-9a-f]{16,64})\nissued: (\S+)$/.exec(message)
  if (!m) return { error: 'signed message is not a Faultline test request' }
  const [, policy, suite, mode, nonce, issued] = m
  if (policy !== want.policy || suite !== want.suite || mode !== want.mode) return { error: 'signed message does not match the request (policy/suite/mode)' }
  const t = Date.parse(issued)
  if (!Number.isFinite(t) || now - t > REQUEST_MAX_AGE_MS || t - now > 60_000) return { error: 'signed request expired — sign again (valid 5 minutes)' }
  for (const [k, exp] of seen) if (exp < now) seen.delete(k)
  if (seen.has(nonce)) return { error: 'this signed request was already used — sign a new one' }
  let ok = false
  try { ok = await verify({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }) } catch { ok = false }
  if (!ok) return { error: 'signature does not match the wallet address' }
  seen.set(nonce, t + REQUEST_MAX_AGE_MS + 60_000)
  return { address: address.toLowerCase() }
}

/** Live runs per wallet per UTC day (in memory; the global DailyCaps still bounds total spend). */
export class WalletCaps {
  private day = ''; private m = new Map<string, number>()
  constructor(public max: number, private now = () => new Date()) {}
  take(addr: string): boolean {
    const d = this.now().toISOString().slice(0, 10); if (d !== this.day) { this.day = d; this.m.clear() }
    const n = this.m.get(addr) ?? 0; if (n >= this.max) return false
    this.m.set(addr, n + 1); return true
  }
}
