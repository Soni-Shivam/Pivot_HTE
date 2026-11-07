// Thinking orbs (vendored engine in ./orbs): orb() returns a canvas tag; startOrbs() draws every canvas[data-orb] on one
// shared clock, skips offscreen ones and hidden tabs, and paints one still frame under reduced motion.
import { MODE_DRAWS } from './orbs/engine/registry'
import { resolvePreset } from './orbs/presets'
import type { OrbSize, OrbState } from './orbs/types'

export type { OrbState }
const LABEL: Record<OrbState, string> = { working: 'Working', searching: 'Searching', solving: 'Checking', listening: 'Listening', connecting: 'Connecting',
  weaving: 'Planning', composing: 'Composing', breathing: 'Loading', shaping: 'Shaping' }

/** dark = drawn on a dark surface (light ink). */
export const orb = (state: OrbState, size: OrbSize, o: { dark?: boolean, label?: string } = {}) =>
  `<canvas class="orb" data-orb="${state}" data-size="${size}" data-dark="${o.dark ? 1 : 0}" width="${size * 2}" height="${size * 2}" style="width:${size}px;height:${size}px" role="img" aria-label="${o.label ?? LABEL[state]}"></canvas>`

const visible = new Set<HTMLCanvasElement>()
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
function paint(c: HTMLCanvasElement, tSec: number) {
  const size = Number(c.dataset.size) as OrbSize, ctx = c.getContext('2d'); if (!ctx) return
  const { mode, speed, opts } = resolvePreset(c.dataset.orb as OrbState, size), dpr = c.width / size
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size)
  MODE_DRAWS[mode](ctx, size, reduced() ? 0.6 : tSec * speed, c.dataset.dark === '1', opts)
}
let started = false
export function startOrbs() {
  if (started) return; started = true
  const io = new IntersectionObserver((es) => es.forEach((e) => { const c = e.target as HTMLCanvasElement; if (e.isIntersecting) { visible.add(c); paint(c, performance.now() / 1000) } else visible.delete(c) }))
  const watch = (root: ParentNode) => root.querySelectorAll<HTMLCanvasElement>('canvas[data-orb]').forEach((c) => { if (!c.dataset.watched) { c.dataset.watched = '1'; io.observe(c) } })
  new MutationObserver(() => { watch(document); for (const c of visible) if (!c.isConnected) visible.delete(c) }).observe(document.body, { childList: true, subtree: true })
  watch(document)
  const loop = () => { if (!reduced() && document.visibilityState !== 'hidden') { const t = performance.now() / 1000; for (const c of visible) paint(c, t) } requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
}
