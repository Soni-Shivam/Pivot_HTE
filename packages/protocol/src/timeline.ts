// Hash-chained job timeline (PROTOCOL §8). The receipt commits to the head hash, so a report's decision log can't be
// edited after the fact without breaking the chain.
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { canonical } from './canonical.ts'

export type TimelineKind = 'plan' | 'policy_reject' | 'train_start' | 'train_end' | 'metrics' | 'decision' | 'finish' | 'holdout' | 'error'
export type TimelineEvent = { i: number; prevHash: string; ts: number; kind: TimelineKind; data: unknown; requestId?: string }

export const GENESIS = `0x${'00'.repeat(32)}`
export const hashEvent = (e: TimelineEvent) => `0x${bytesToHex(keccak_256(canonical(e)))}`

export class Timeline {
  readonly events: TimelineEvent[] = []
  head = GENESIS
  constructor(private clock: () => number = Date.now) {}

  append(kind: TimelineKind, data: unknown, requestId?: string) {
    const e: TimelineEvent = { i: this.events.length, prevHash: this.head, ts: this.clock(), kind, data: JSON.parse(JSON.stringify(data ?? null)) }
    if (requestId) e.requestId = requestId
    this.events.push(e)
    this.head = hashEvent(e)
    return e
  }
}

export function verifyTimeline(events: TimelineEvent[], expectedHead?: string) {
  let head = GENESIS
  events.forEach((e, i) => {
    if (e.i !== i || e.prevHash !== head) throw new Error(`timeline broken at event ${i}`)
    head = hashEvent(e)
  })
  if (expectedHead !== undefined && head !== expectedHead) throw new Error('timeline head mismatch')
  return head
}
