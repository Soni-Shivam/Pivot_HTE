// Shared stores: console health (polled), the browser wallet (EIP-6963 + legacy injection) and the last job this visitor started.
import { getJson } from './api'

// ---------- health: GET /api/health every 10 s (agent-console.ts: { ok, carla, zg, hedera, queue, caps }) ----------
export type Health = { online: boolean; carla: boolean; zg: boolean; hedera: boolean; queue: { running: number; waiting: number }
  caps: { runs_left: number | null; buys_left: number | null } | null; checked: boolean }
export const health: Health = { online: false, carla: false, zg: false, hedera: false, queue: { running: 0, waiting: 0 }, caps: null, checked: false }
const healthFns = new Set<(h: Health) => void>()
let polling = 0
export async function refreshHealth() {
  try {
    const h = await getJson('/api/health')
    Object.assign(health, { online: !!h.ok, carla: !!h.carla, zg: !!h.zg, hedera: !!h.hedera,
      queue: { running: h.queue?.running ?? 0, waiting: h.queue?.waiting ?? 0 }, caps: h.caps ?? null })
  } catch { Object.assign(health, { online: false, carla: false, zg: false, hedera: false, queue: { running: 0, waiting: 0 }, caps: null }) }
  health.checked = true
  for (const f of healthFns) f(health)
  return health
}
/** Subscribe to health changes (called now if already checked); starts the 10 s poll on first use. Returns an unsubscribe. */
export function onHealth(fn: (h: Health) => void) {
  healthFns.add(fn)
  if (health.checked) fn(health)
  if (!polling) { polling = window.setInterval(refreshHealth, 10_000); refreshHealth() }
  return () => { healthFns.delete(fn) }
}

// ---------- wallet: only eth_requestAccounts, eth_accounts and personal_sign ----------
export type Eip1193 = { request: (a: { method: string, params?: unknown[] }) => Promise<any>, on?: (ev: string, f: (x: any) => void) => void }
export type WalletInfo = { uuid: string, name: string, icon: string, rdns: string }
export type WalletOption = { info: WalletInfo, provider: Eip1193 }
export type Wallet = { address: string, provider: Eip1193, name: string, rdns: string }
const found: WalletOption[] = []
/** The connected wallet, or null. */
export const wallet: { current: Wallet | null } = { current: null }
const walletFns = new Set<(w: Wallet | null) => void>()
const emitWallet = () => { for (const f of walletFns) f(wallet.current) }
/** Subscribe to wallet changes (connect, account switch, disconnect, newly discovered wallets). Returns an unsubscribe. */
export function onWallet(fn: (w: Wallet | null) => void) { walletFns.add(fn); return () => { walletFns.delete(fn) } }

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e: any) => {
    const d = e.detail; if (!d?.provider || !d?.info || found.some((w) => w.info.uuid === d.info.uuid)) return
    found.push(d); emitWallet()
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  setTimeout(() => { window.dispatchEvent(new Event('eip6963:requestProvider')); emitWallet() }, 500) // late-injecting extensions
  window.addEventListener('ethereum#initialized', emitWallet)
}
const walletName = (p: any) => (p?.isCoinbaseWallet ? 'Coinbase Wallet' : p?.isMetaMask ? 'MetaMask' : p?.isRabby ? 'Rabby' : 'Browser wallet')
/** EIP-6963 wallets first, then legacy injection: window.ethereum.providers[], coinbaseWalletExtension, window.ethereum. */
export function walletOptions(): WalletOption[] {
  const out = [...found], w = window as any
  const add = (p: any) => {
    if (!p || typeof p.request !== 'function' || out.some((x) => x.provider === p || x.info.name === walletName(p))) return
    out.push({ info: { uuid: `legacy-${out.length}`, name: walletName(p), icon: '', rdns: '' }, provider: p })
  }
  for (const p of Array.isArray(w.ethereum?.providers) ? w.ethereum.providers : []) add(p)
  add(w.coinbaseWalletExtension); if (!Array.isArray(w.ethereum?.providers) || !w.ethereum.providers.length) add(w.ethereum) // a multi-wallet shim only proxies providers[]
  return out
}
const WKEY = 'faultline.wallet'
/** Connect (call inside the click: the wallet popup needs a user gesture). Throws the wallet's error; show it with walletErr(e, 'connection'). */
export async function connect(w: WalletOption | undefined = walletOptions()[0]): Promise<Wallet> {
  if (!w) throw new Error('No wallet found in this browser')
  try { localStorage.setItem(WKEY, w.info.rdns || w.info.name) } catch { /* private mode */ }
  const accts: string[] = await w.provider.request({ method: 'eth_requestAccounts' })
  if (!accts?.[0]) throw new Error('The wallet returned no account')
  wallet.current = { address: accts[0], provider: w.provider, name: w.info.name, rdns: w.info.rdns }
  w.provider.on?.('accountsChanged', (a: string[]) => { if (wallet.current?.provider !== w.provider) return; if (a?.[0]) wallet.current.address = a[0]; else wallet.current = null; emitWallet() })
  emitWallet()
  return wallet.current
}
export function disconnect() { wallet.current = null; try { localStorage.removeItem(WKEY) } catch { /* private mode */ } emitWallet() }
/** Reconnect a wallet the visitor already approved (eth_accounts opens no popup). */
export async function resumeWallet() {
  let key: string | null = null
  try { key = localStorage.getItem(WKEY) } catch { /* private mode */ }
  if (!key || wallet.current) return
  const w = walletOptions().find((x) => x.info.rdns === key || x.info.name === key); if (!w) return
  try { const a: string[] = await w.provider.request({ method: 'eth_accounts' }); if (a?.[0]) { wallet.current = { address: a[0], provider: w.provider, name: w.info.name, rdns: w.info.rdns }; emitWallet() } } catch { /* stays disconnected */ }
}
const hex = (s: string) => '0x' + [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('')
/** EIP-191 personal_sign of a readable message with the connected wallet. Throws the wallet's error (walletErr(e, 'signature')). */
export async function signMessage(message: string): Promise<string> {
  const w = wallet.current; if (!w) throw new Error('Connect a wallet first')
  return w.provider.request({ method: 'personal_sign', params: [hex(message), w.address] })
}
let rejects = 0
/** Plain-language wallet error. what: 'connection' | 'signature'. */
export function walletErr(e: any, what: string) {
  const code = e?.code ?? e?.data?.originalError?.code
  console.warn('[wallet]', what, code, e?.message ?? e)
  const rejected = code === 4001 || /reject|denied|cancel/i.test(String(e?.message))
  // Coinbase Wallet rejects the first request from a new site with a one-time warning; only a second rejection is the user's
  if (rejected && what === 'connection' && rejects++ === 0) return 'Coinbase Wallet shows a one-time warning for new sites. Choose Continue in the wallet, then press Connect again.'
  return rejected ? (what === 'connection' ? 'You declined the connection.' : 'You declined the signature in your wallet. Nothing was sent.')
    : code === -32002 ? 'Your wallet already has a request open. Open the wallet extension to finish it.'
    : `The wallet did not complete the ${what}${code != null ? ` (code ${code})` : ''}: ${e?.message ?? e}`
}

// ---------- last job this visitor started (survives reload; localStorage may throw or be empty) ----------
export type LastJob = { jobId: string, runName?: string, mode: 'free' | 'paid', suite: string, startedAt: number }
const JKEY = 'faultline.lastJob'
export const lastJob = {
  get(): LastJob | null { try { const j = JSON.parse(localStorage.getItem(JKEY) ?? 'null'); return j && typeof j.jobId === 'string' ? j : null } catch { return null } },
  set(j: LastJob) { try { localStorage.setItem(JKEY, JSON.stringify(j)) } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem(JKEY) } catch { /* private mode */ } },
}
