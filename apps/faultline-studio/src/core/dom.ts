// Small DOM and formatting helpers shared by every page.
import { orb, type OrbState } from '../orb'

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
export const esc = (s: unknown) => String(s ?? '-').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
export const num = (x: unknown, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '-')
/** Shortened ID; the full value stays in title so it shows on hover. */
export const short = (s: unknown, a = 8, b = 6) => (typeof s === 'string' && s.length > a + b + 1 ? `<span title="${esc(s)}">${esc(s.slice(0, a))}…${esc(s.slice(-b))}</span>` : esc(s))
export const kv = (rows: [string, string][]) => rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')
export const extLink = (url: string, text: string) => `<a href="${esc(url)}" target="_blank" rel="noopener">${text} ↗</a>`
export const galileoTx = (tx: string) => `https://chainscan-galileo.0g.ai/tx/${tx}`
export const galileoAddr = (a: string) => `https://chainscan-galileo.0g.ai/address/${a}`
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const copyText = async (t: string, b: HTMLElement, done = 'Copied') => { try { await navigator.clipboard.writeText(t); b.textContent = done } catch { b.textContent = 'Select and copy manually' } }
export const loading = (text: string, state: OrbState = 'breathing', dark = false) => `<div class="loading">${orb(state, state === 'solving' ? 64 : 20, { dark })}<span>${esc(text)}</span></div>`

// Canvas charts (telemetry, boundary hunt) share the palette and the HiDPI setup.
export const C = { ink: '#111111', paper: '#fbfbf6', muted: '#6b6b66', yellow: '#f3f56c', cyan: '#7cecf5', pink: '#f5a3ef', purple: '#7c5cf5', lime: '#c9f36f', hot: '#ff4fc3' }
export function canvas2d(cv: HTMLCanvasElement, hCss?: number) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, h = hCss ?? r.height
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(h * dpr))
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { g, w: r.width, h }
}
