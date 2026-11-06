// Keyless checks of a public episode JSON. No Node or ethers imports, so the static verifier page can bundle it.
// The metric formulas are ports of faultline/metrics (MIT, vendored from MBRDI): ttc_1d, thw, drac, CCS v2.
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

type Line = { lidar_gap: number | null; lidar_closing: number | null; ego_v: number; ttc_s: number | null
  thw_s: number | null; drac_mps2: number | null; ccs: number | null; applicable: boolean }

const clip = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)
export const ttc1d = (gap: number, vRel: number, max = 60) => {
  if (!(vRel > 1e-3)) return max
  const raw = gap / vRel
  return clip(Number.isFinite(raw) && raw >= 0 ? raw : max, 0, max)
}
export const thw = (gap: number, v: number, max = 10) => {
  if (!(v > 0.5)) return max
  const raw = gap / v
  return Number.isFinite(raw) && raw >= 0 ? clip(raw, 0, max) : max
}
export const drac = (gap: number, vRel: number, max = 20) =>
  clip(vRel > 1e-3 && gap > 1e-3 ? vRel ** 2 / (2 * gap) : 0, 0, max)
const logistic = (e: number) => (e >= 60 ? 0 : e <= -60 ? 1 : 1 / (1 + Math.exp(e)))
const falling = (v: number | null, mid: number, k: number) =>
  v === null || !Number.isFinite(v) ? 0 : v <= 0 ? 1 : logistic(k * (v - mid))
const rising = (v: number | null, mid: number, k: number) =>
  v === null || !Number.isFinite(v) || v <= 0 ? 0 : logistic(-k * (v - mid))
export const ccs = (d: number | null, t: number | null, h: number | null) =>
  1 - [rising(d, 4.0, 1.5), falling(t, 1.5, 4.0), falling(h, 1.0, 3.0)].reduce((s, m) => s * (1 - clip(m, 0, 1)), 1)

const close = (a: number | null, b: number | null, tol = 1e-9) => (a === null || b === null ? a === b : Math.abs(a - b) <= tol)

export function recomputeMetrics(lines: Line[]): { ok: boolean; mismatches: number[] } {
  const mismatches: number[] = []
  lines.forEach((l, i) => {
    if (l.lidar_gap === null) {
      if (l.applicable || l.ttc_s !== null || l.ccs !== null) mismatches.push(i)
      return
    }
    const t = l.lidar_closing === null ? null : ttc1d(l.lidar_gap, l.lidar_closing)
    const d = l.lidar_closing === null ? null : drac(l.lidar_gap, l.lidar_closing)
    const h = thw(l.lidar_gap, l.ego_v)
    if (!l.applicable || !close(t, l.ttc_s) || !close(d, l.drac_mps2) || !close(h, l.thw_s) || !close(ccs(d, t, h), l.ccs))
      mismatches.push(i)
  })
  return { ok: mismatches.length === 0, mismatches }
}

const hex = (s: string) => bytesToHex(sha256(new TextEncoder().encode(s)))

export function checkPublic(pub: any) {
  const m = pub.manifest
  const lines = (pub.trajectory_jsonl as string).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return {
    filesOk: hex(pub.trajectory_jsonl) === m.files['trajectory.jsonl'] && hex(pub.metrics_json) === m.files['metrics.json'],
    decisionsOk: pub.decisions.length === m.decisions_total &&
      pub.decisions.every((d: any, i: number) => d.cp === i && /^[0-9a-f]{64}$/.test(d.observation_sha256)) &&
      pub.decisions.filter((d: any) => d.source === '0g').length === m.decisions_0g &&
      pub.decisions.filter((d: any) => d.source === '0g').every((d: any) => d.request_id && d.provider && d.zg_res_key),
    metricsRecomputedOk: recomputeMetrics(lines).ok,
    trajectory: lines,
    metrics: JSON.parse(pub.metrics_json),
  }
}

/** Hash chain over the raw decisions.jsonl lines (same rule as faultline/log.py verify_chain). */
export function chainOk(jsonl: string, head: string): boolean {
  let h = '0'.repeat(64)
  const lines = jsonl.split('\n').filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const e = JSON.parse(lines[i])
    if (e.i !== i || e.prev_hash !== h) return false
    h = bytesToHex(sha256(new TextEncoder().encode(lines[i])))
  }
  return h === head
}
