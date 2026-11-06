// Episode bundles (plan Task 10): the public JSON (no observations, history or model text; anchored runs reveal
// scenario.json and the salt, audit R7) and the sealed tar of the run's evidence files. Hashes are always over raw bytes written by Python: JCS (canonical.ts) prints 35.0
// as 35, Python prints 35.0, so nothing Python hashed is ever re-serialized here.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { canonical, packTar, seal } from '@sealedai/protocol'
import { EPISODE_KEY_VERSION, episodeKey } from './key.ts'

export type Decision = Record<string, unknown> & {
  cp: number; source: string; reason: string; action: string | null; request_id: string | null
  provider: string | null; zg_res_key: string | null; obs_sha256?: string
}
export type Run = {
  dir: string; manifest: Record<string, any>; decisions: Decision[]; decisionLines: string[]
  trajectoryJsonl: string; metricsJson: string
}

export const PUBLIC_FIELDS = ['cp', 'sim_time_s', 'wall_clock_utc', 'action', 'control_decel_mps2', 'source', 'reason', 'model',
  'request_id', 'provider', 'zg_res_key', 'latency_ms', 'http_status', 'raw_sha256', 'nonce'] as const
// Sealed: exactly these files when present (audit R12: no stale extras such as an old verification.json, no subdirs).
export const SEALED_FILES = ['manifest.json', 'scenario.json', 'decisions.jsonl', 'trajectory.jsonl', 'metrics.json', 'anchor.json', 'recorder.log'] as const

const text = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8')

export function readRun(dir: string): Run {
  const decisionLines = text(dir, 'decisions.jsonl').split('\n').filter(Boolean)
  return {
    dir, manifest: JSON.parse(text(dir, 'manifest.json')), decisionLines,
    decisions: decisionLines.map((l) => JSON.parse(l)),
    trajectoryJsonl: text(dir, 'trajectory.jsonl'), metricsJson: text(dir, 'metrics.json'),
  }
}

/** sha256 of the observation exactly as Python serialized it inside the (canonical, key-sorted) log line. */
export function obsSha256(line: string): string {
  const start = line.indexOf('"observation":{') + '"observation":'.length
  if (start < '"observation":'.length) throw new Error('log line has no observation')
  let depth = 0, i = start, inStr = false
  for (; i < line.length; i++) {
    const c = line[i]
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false }
    else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) break
  }
  return bytesToHex(sha256(new TextEncoder().encode(line.slice(start, i + 1))))
}

/** Anchored runs: scenario.json (raw bytes as text) and the commitment salt, so anyone can recompute the scenario and
 *  result commitments and replay the episode (audit R7/B2). Unanchored runs reveal nothing. */
export function revealOf(dir: string): { scenario_json: string; salt: string } | undefined {
  if (!existsSync(join(dir, 'anchor.json'))) return undefined
  return { scenario_json: text(dir, 'scenario.json'), salt: JSON.parse(text(dir, 'anchor.json')).salt }
}

/** `tee` = archived provider signatures + service records + TDX quotes (verify.ts archiveTee). */
export function publicJson(run: Run, tee?: unknown, reveal?: { scenario_json: string; salt: string }): Uint8Array {
  return canonical({
    schema: 'faultline.public/v1',
    manifest: run.manifest,
    prompt_hash: run.manifest.prompt_hash,
    decisions: run.decisions.map((d, i) => ({
      ...Object.fromEntries(PUBLIC_FIELDS.map((k) => [k, d[k] ?? null])),
      observation_sha256: d.obs_sha256 ?? obsSha256(run.decisionLines[i]),
    })),
    trajectory_jsonl: run.trajectoryJsonl,
    metrics_json: run.metricsJson,
    ...(tee ? { tee } : {}),
    ...(reveal ? { reveal } : {}),
  })
}

export function sealedTar(dir: string): Uint8Array {
  const names = SEALED_FILES.filter((n) => existsSync(join(dir, n)))
  return packTar(names.map((name) => ({ name, data: new Uint8Array(readFileSync(join(dir, name))) })))
}

/** Sealed with the per-episode key derived from the tenant key (key.ts); open with openEpisode. */
export function sealRun(tar: Uint8Array, tenantKey: Uint8Array, episodeId: string): Uint8Array {
  return seal(tar, { objectType: 'episode', objectId: episodeId, version: EPISODE_KEY_VERSION }, episodeKey(tenantKey, episodeId)).blob
}
