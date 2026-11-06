import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPublic, recomputeMetrics } from '../src/check.ts'
import { publicJson, readRun } from '../src/bundle.ts'
import { verifySignatures } from '../src/verify.ts'

const run = readRun(new URL('./fixtures/run-kinematic', import.meta.url).pathname)
const pub = JSON.parse(new TextDecoder().decode(publicJson(run)))

test('metrics recompute from the LiDAR fields and catch an edited ccs', () => {
  const c = checkPublic(pub)
  assert.equal(c.metricsRecomputedOk, true)
  assert.equal(c.filesOk, true)
  assert.equal(c.decisionsOk, true)
  const lines = pub.trajectory_jsonl.trim().split('\n').map((l: string) => JSON.parse(l))
  const i = lines.findIndex((l: { ccs: number | null }) => l.ccs !== null && l.ccs > 0.01)
  lines[i].ccs += 1e-6
  assert.equal(recomputeMetrics(lines).ok, false)
  const edited = { ...pub, trajectory_jsonl: lines.map((l: unknown) => JSON.stringify(l)).join('\n') + '\n' }
  const c2 = checkPublic(edited)
  assert.equal(c2.metricsRecomputedOk, false)
  assert.equal(c2.filesOk, false) // the raw bytes no longer hash to manifest.files
})

test('signatures mirror processResponse, errors become null', async () => {
  const answers: (boolean | null | Error)[] = [true, false, null, new Error('rpc down')]
  let n = 0
  const sigs = await verifySignatures(pub.decisions.slice(0, 4), async () => {
    const a = answers[n++]
    if (a instanceof Error) throw a
    return a
  })
  assert.deepEqual(sigs.map((s) => s.verified), [true, false, null, null])
  assert.equal(sigs[0].request_id, pub.decisions[0].request_id)
})
