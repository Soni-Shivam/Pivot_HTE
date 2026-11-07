import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { registerNegotiator, negotiate } from '../src/a2a.ts'

test('A2A provider offers terms, buyer accepts, and a low budget cannot pass', async () => {
  const app = express()
  app.use(express.json())
  registerNegotiator(app, { amount: '5', asset: '0.0.77', suites: ['carla'], port: 0 })
  const server = app.listen(0, '127.0.0.1')
  try {
    if (!server.listening) await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test port')
    const base = `http://127.0.0.1:${address.port}`
    assert.equal(await negotiate(base, ['carla'], '5', '0.0.77'), 'carla')
    await assert.rejects(() => negotiate(base, ['carla'], '4', '0.0.77'), /outside buyer policy/)
    const direct = await fetch(`${base}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user',
        parts: [{ kind: 'data', data: { phase: 'accept', suites: ['carla'], selectedSuite: 'carla',
          maxAmount: '5', asset: '0.0.77' } }] } } }) })
    const body = await direct.json() as { result: { parts: Array<{ data: { phase: string } }> } }
    assert.equal(body.result.parts[0].data.phase, 'rejected')
  } finally { server.close() }
})
