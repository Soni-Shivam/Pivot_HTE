import 'dotenv/config'
import { PrivateKey } from '@hiero-ledger/sdk'
import { x402Client } from '@x402/core/client'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { createClientHederaSigner } from '@x402/hedera'
import { wrapFetchWithPayment } from '@x402/fetch'
import { authorizePayment, type HederaExactRequirements } from './spending-policy.ts'

const accountId = process.env.HEDERA_PAYER_ACCOUNT_ID
const privateKey = process.env.HEDERA_PAYER_PRIVATE_KEY
const merchant = process.env.HEDERA_MERCHANT_ACCOUNT_ID
const amount = process.env.HEDERA_PAYMENT_AMOUNT
const facilitatorUrl = process.env.HEDERA_FACILITATOR_URL ?? 'https://x402.org/facilitator'
const asset = process.env.HEDERA_PAYMENT_ASSET ?? '0.0.0'
const url = `http://127.0.0.1:${process.env.HEDERA_DEMO_PORT ?? '8787'}/v1/paid-ping`
if (!accountId || !privateKey || !merchant || !amount) throw new Error('Set Hedera payer, key, merchant, and amount')
if (!/^[1-9][0-9]*$/.test(amount)) throw new Error('Invalid HEDERA_PAYMENT_AMOUNT')
if (!/^0\.0\.[0-9]+$/.test(asset)) throw new Error('Invalid Hedera payment asset ID')
if (asset === '0.0.0' && BigInt(amount) > 100_000n) throw new Error('HBAR paid check is capped at 100000 tinybars (0.001 HBAR)')

const first = await fetch(url)
if (first.status !== 402) throw new Error(`Expected HTTP 402, got ${first.status}`)
const encoded = first.headers.get('payment-required')
if (!encoded) throw new Error('Missing PAYMENT-REQUIRED header')
const required = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as { accepts?: HederaExactRequirements[] }
const quote = required.accepts?.find(x => x.network === 'hedera:testnet' && x.scheme === 'exact')
if (!quote) throw new Error('No Hedera testnet exact quote')

const supportedResponse = await fetch(`${facilitatorUrl}/supported`)
if (!supportedResponse.ok) throw new Error('Facilitator capability lookup failed')
const supported = await supportedResponse.json() as { kinds?: Array<{ scheme?: string, network?: string, extra?: { feePayer?: string } }> }
const supportedFeePayers = supported.kinds?.filter(k => k.scheme === 'exact' && k.network === 'hedera:testnet')
  .map(k => k.extra?.feePayer).filter((x): x is string => Boolean(x)) ?? []
authorizePayment(quote, {
  network: 'hedera:testnet', asset, merchantAccounts: [merchant], feePayerAccounts: supportedFeePayers,
  maxPerJob: BigInt(amount), maxTotal: BigInt(amount), alreadySpent: 0n, maxTimeoutSeconds: 180,
})

const rawKey = privateKey.replace(/^0x/, '')
if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) {
  throw new Error('HEDERA_PAYER_PRIVATE_KEY must be a 32-byte ECDSA private key, not an address')
}
const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(rawKey), { network: 'hedera:testnet' })
const client = x402Client.fromConfig({
  schemes: [{ network: 'hedera:testnet', client: new ExactHederaScheme(signer) }],
  spendControls: { allowedAssets: [{ network: 'hedera:testnet', asset, maxAmountPerPayment: amount }] },
})
const paidFetch = wrapFetchWithPayment(fetch, client)
const response = await paidFetch(url)
if (!response.ok) throw new Error(`Paid request failed: HTTP ${response.status}`)
const body = await response.json()
console.log(JSON.stringify({ response: body, paymentResponse: response.headers.get('payment-response') }, null, 2))
