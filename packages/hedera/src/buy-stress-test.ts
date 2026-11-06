import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import { PrivateKey } from '@hiero-ledger/sdk'
import { x402Client } from '@x402/core/client'
import { createClientHederaSigner } from '@x402/hedera'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { wrapFetchWithPayment } from '@x402/fetch'
import { authorizePayment, type HederaExactRequirements } from './spending-policy.ts'
import { requestHash as hashRequest, suiteOf } from './suites.ts'

const base = `http://127.0.0.1:${process.env.HEDERA_DEMO_PORT ?? '8787'}`
const payer = process.env.HEDERA_PAYER_ACCOUNT_ID
const key = process.env.HEDERA_PAYER_PRIVATE_KEY?.replace(/^0x/, '')
const merchant = process.env.HEDERA_MERCHANT_ACCOUNT_ID
const cap = process.env.HEDERA_PAYMENT_AMOUNT
if (!payer || !key || !/^[0-9a-fA-F]{64}$/.test(key) || !merchant || !cap || !/^[1-9][0-9]*$/.test(cap)) {
  throw new Error('Valid Hedera payer, ECDSA key, merchant, and payment cap are required')
}
if (BigInt(cap) > 100_000n) throw new Error('Demo buyer cap is 0.001 HBAR')
const manifestResponse = await fetch(`${base}/.well-known/faultline-service.json`)
if (!manifestResponse.ok) throw new Error('Service discovery failed')
const manifest = await manifestResponse.json() as { network: string, asset: string, merchant: string, price: string, suites: Array<{ id: string, simulator: string }> }
const { suite, simulator } = suiteOf(process.argv[3])
if (manifest.network !== 'hedera:testnet' || manifest.asset !== '0.0.0' ||
    manifest.merchant !== merchant || BigInt(manifest.price) > BigInt(cap) ||
    !manifest.suites.some(x => x.id === suite && x.simulator === simulator)) throw new Error('Service manifest outside buyer policy')
const policyCommitment = process.argv[2]
const recoveryTx = process.argv[4]
if (!/^0x[0-9a-fA-F]{64}$/.test(policyCommitment ?? '')) throw new Error('Pass a 0x-prefixed 32-byte policy commitment')
if (recoveryTx && !/^0\.0\.[0-9]+@[0-9]+\.[0-9]+$/.test(recoveryTx)) throw new Error('Invalid recovery transaction')
const request = { suite, maxRuns: 1, policyCommitment,
  idempotencyKey: randomBytes(16).toString('hex') }
const url = `${base}/v1/stress-tests`
const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }
let paymentResponse: string | null = null
let intent: { intentToken?: string, requestHash?: string } = {}
if (recoveryTx) {
  paymentResponse = Buffer.from(JSON.stringify({ success: true, payer, transaction: recoveryTx, network: 'hedera:testnet' })).toString('base64')
} else {
const quoteResponse = await fetch(url, init)
if (quoteResponse.status !== 402) throw new Error(`Expected payment quote, got HTTP ${quoteResponse.status}`)
const header = quoteResponse.headers.get('payment-required')
if (!header) throw new Error('Missing x402 quote')
const quote = (JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { accepts: HederaExactRequirements[] })
  .accepts.find(x => x.network === 'hedera:testnet' && x.scheme === 'exact')
if (!quote) throw new Error('No Hedera exact quote')
const facilitator = process.env.HEDERA_FACILITATOR_URL ?? 'https://x402.org/facilitator'
const supportedResponse = await fetch(`${facilitator}/supported`)
if (!supportedResponse.ok) throw new Error('Facilitator unavailable')
const supported = await supportedResponse.json() as { kinds?: Array<{ network?: string, scheme?: string, extra?: { feePayer?: string } }> }
authorizePayment(quote, { network: 'hedera:testnet', asset: '0.0.0', merchantAccounts: [merchant],
  feePayerAccounts: supported.kinds?.filter(x => x.network === 'hedera:testnet' && x.scheme === 'exact')
    .map(x => x.extra?.feePayer).filter((x): x is string => Boolean(x)) ?? [],
  maxPerJob: BigInt(cap), maxTotal: BigInt(cap), alreadySpent: 0n, maxTimeoutSeconds: 180 })
const signer = createClientHederaSigner(payer, PrivateKey.fromStringECDSA(key), { network: 'hedera:testnet' })
const client = x402Client.fromConfig({ schemes: [{ network: 'hedera:testnet', client: new ExactHederaScheme(signer) }],
  spendControls: { allowedAssets: [{ network: 'hedera:testnet', asset: '0.0.0', maxAmountPerPayment: cap }] } })
const paid = await wrapFetchWithPayment(fetch, client)(url, init)
if (!paid.ok) throw new Error(`Paid request failed: HTTP ${paid.status}`)
intent = await paid.json() as { intentToken: string, requestHash: string }
paymentResponse = paid.headers.get('payment-response')
if (!paymentResponse || !intent.intentToken) throw new Error('Missing settlement receipt or paid intent')
}
const receipt = JSON.parse(Buffer.from(paymentResponse!, 'base64').toString('utf8')) as { transaction: string }
const requestHash = hashRequest(suite, policyCommitment, request.idempotencyKey)
if (intent.requestHash && intent.requestHash !== requestHash) throw new Error('Service bound a different request than the one paid for')
const payerSignature = await privateKeyToAccount(`0x${key}`).signMessage({ message: `faultline:v1:${receipt.transaction}:${requestHash}` })
const activationBody = { ...request, paymentResponse, intentToken: intent.intentToken, payerSignature }
const stateDir = process.env.HEDERA_JOB_STATE_DIR ?? join(process.cwd(), '.faultline-hedera-state')
mkdirSync(stateDir, { recursive: true, mode: 0o700 })
const recoveryFile = join(stateDir, `activation-${receipt.transaction.replace(/[^0-9]/g, '-')}.json`)
writeFileSync(recoveryFile, JSON.stringify(activationBody), { mode: 0o600 })
const activation = await fetch(`${base}/v1/stress-tests/activate`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(activationBody) })
if (!activation.ok) throw new Error(`Job activation failed: HTTP ${activation.status}; retry from ${recoveryFile}`)
console.log(JSON.stringify(await activation.json(), null, 2))
