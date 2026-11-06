import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey } from 'eciesjs'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { bytesToHex } from 'viem'
import { sealRequest, openRequest, sealReply, openReply, packTar, unpackTar, ChannelError } from '../src/index.ts'

const worker = new PrivateKey()
const wPub = `0x${worker.publicKey.toHex()}` as const
const wPriv = bytesToHex(worker.secret)
const alice = privateKeyToAccount(generatePrivateKey())
const reply = new PrivateKey()
const replyPub = `0x${reply.publicKey.toHex()}` as const

test('requestRoundTripRecoversSigner', async () => {
  const body = await sealRequest(wPub, '/v1/release', { role: 2, big: 10n }, alice, replyPub)
  const r = await openRequest(wPriv, body, '/v1/release', new Set())
  assert.equal(r.from, alice.address)
  assert.deepEqual(r.payload, { role: 2, big: '10' })
  assert.equal(r.replyTo, replyPub)
})

test('wrongWorkerKeyRejected', async () => {
  const body = await sealRequest(wPub, '/v1/run', {}, alice, replyPub)
  await assert.rejects(openRequest(bytesToHex(new PrivateKey().secret), body, '/v1/run', new Set()), ChannelError)
})

test('replayRejected', async () => {
  const seen = new Set<string>()
  const body = await sealRequest(wPub, '/v1/run', {}, alice, replyPub)
  await openRequest(wPriv, body, '/v1/run', seen)
  await assert.rejects(openRequest(wPriv, body, '/v1/run', seen), /replayed/)
})

test('staleRejected', async () => {
  const body = await sealRequest(wPub, '/v1/run', {}, alice, replyPub)
  await assert.rejects(openRequest(wPriv, body, '/v1/run', new Set(), Math.floor(Date.now() / 1000) + 600), /stale/)
})

test('wrongEndpointRejected', async () => {
  const body = await sealRequest(wPub, '/v1/run', {}, alice, replyPub)
  await assert.rejects(openRequest(wPriv, body, '/v1/release', new Set()), /another endpoint/)
})

test('forgedFromRejected', async () => {
  // a sender claiming to be someone else: sign with alice, claim bob
  const bob = privateKeyToAccount(generatePrivateKey())
  const liar = { address: bob.address, signMessage: alice.signMessage }
  const body = await sealRequest(wPub, '/v1/run', {}, liar, replyPub)
  await assert.rejects(openRequest(wPriv, body, '/v1/run', new Set()), /bad request signature/)
})

test('replyOnlyForRecipient', () => {
  const sealed = sealReply(replyPub, { ok: true, n: 5n })
  assert.deepEqual(openReply(bytesToHex(reply.secret), sealed), { ok: true, n: '5' })
  assert.throws(() => openReply(wPriv, sealed))
})

test('tarDeterministicRoundTrip', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const a = packTar([{ name: 'b.json', data: enc('{}') }, { name: 'a.txt', data: enc('x'.repeat(700)) }])
  const b = packTar([{ name: 'a.txt', data: enc('x'.repeat(700)) }, { name: 'b.json', data: enc('{}') }])
  assert.deepEqual(a, b)
  assert.deepEqual(unpackTar(a).map((f) => f.name), ['a.txt', 'b.json'])
  assert.equal(unpackTar(a)[0].data.length, 700)
})

test('tarRejectsPathTraversal', () => {
  assert.throws(() => packTar([{ name: '../etc/passwd', data: new Uint8Array() }]))
  const t = packTar([{ name: 'ok.txt', data: new Uint8Array([1]) }])
  t.set(new TextEncoder().encode('../evil\0'), 0)
  assert.throws(() => unpackTar(t), /refusing/)
})
