// Company-side buyer agent as a library: the same x402 purchase as buy-stress-test.ts, reporting each step so a UI
// (apps/faultline-studio via agent-console.ts) can show it live. The payer key never leaves this process; steps carry
// public data only (accounts, amounts, transaction ids, hashes). The spending policy, not the UI, authorizes payment.
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

export type StepId = 'discover' | 'quote' | 'facilitator' | 'policy' | 'settle' | 'mirror' | 'bind' | 'activate'
export type Step = { id: StepId; status: 'run' | 'ok' | 'fail'; title: string; detail?: string; data?: Record<string, unknown>; ms?: number }
export type Activation = { jobId: string; status: string; suite: string; simulator: string; permit: string; expiresAt: string; transaction: string }
export type BuyerConfig = { base: string; payer: string; key: string; merchant: string; cap: string; facilitator: string; stateDir: string }

export const MIRROR = 'https://testnet.mirrornode.hedera.com'
export const hashscanTx = (tx: string) => `https://hashscan.io/testnet/transaction/${tx}`

export function buyerConfigFromEnv(env = process.env): BuyerConfig {
  const payer = env.HEDERA_PAYER_ACCOUNT_ID
  const key = env.HEDERA_PAYER_PRIVATE_KEY?.replace(/^0x/, '')
  const merchant = env.HEDERA_MERCHANT_ACCOUNT_ID
  const cap = env.HEDERA_PAYMENT_AMOUNT
  if (!payer || !key || !/^[0-9a-fA-F]{64}$/.test(key) || !merchant || !cap || !/^[1-9][0-9]*$/.test(cap)) {
    throw new Error('Valid Hedera payer, ECDSA key, merchant, and payment cap are required')
  }
  if (BigInt(cap) > 100_000n) throw new Error('Demo buyer cap is 0.001 HBAR')
  return { base: `http://127.0.0.1:${env.HEDERA_DEMO_PORT ?? '8787'}`, payer, key, merchant, cap,
    facilitator: env.HEDERA_FACILITATOR_URL ?? 'https://x402.org/facilitator',
    stateDir: env.HEDERA_JOB_STATE_DIR ?? join(process.cwd(), '.faultline-hedera-state') }
}

/** Mirror Node `transactions/{id}` id form of a Hedera transaction id `0.0.x@sec.nanos`. */
export const mirrorTxId = (tx: string) => { const [a, t] = tx.split('@'); return `${a}-${t.replace('.', '-')}` }

/** Buy one run. `quoteOnly` stops after the policy check: nothing is signed or spent. */
export async function buy(cfg: BuyerConfig, opts: { suite: string; policyCommitment: string; recoveryTx?: string; quoteOnly?: boolean },
  emit: (s: Step) => void = () => {}): Promise<Activation | { quoteOnly: true; quote: HederaExactRequirements }> {
  let t0 = Date.now(), cur = 'discover' as StepId, title = ''
  const run = (id: StepId, t: string, detail?: string) => { cur = id; title = t; t0 = Date.now(); emit({ id, status: 'run', title: t, detail }) }
  const ok = (detail?: string, data?: Record<string, unknown>) => emit({ id: cur, status: 'ok', title, detail, data, ms: Date.now() - t0 })
  try {
    run('discover', 'Discover service')
    const manifestResponse = await fetch(`${cfg.base}/.well-known/faultline-service.json`)
    if (!manifestResponse.ok) throw new Error('Service discovery failed')
    const manifest = await manifestResponse.json() as { network: string, asset: string, merchant: string, price: string, suites: Array<{ id: string, simulator: string }> }
    const { suite, simulator } = suiteOf(opts.suite)
    if (manifest.network !== 'hedera:testnet' || manifest.asset !== '0.0.0' ||
        manifest.merchant !== cfg.merchant || BigInt(manifest.price) > BigInt(cfg.cap) ||
        !manifest.suites.some(x => x.id === suite && x.simulator === simulator)) throw new Error('Service manifest outside buyer policy')
    if (!/^0x[0-9a-fA-F]{64}$/.test(opts.policyCommitment)) throw new Error('Pass a 0x-prefixed 32-byte policy commitment')
    if (opts.recoveryTx && !/^0\.0\.[0-9]+@[0-9]+\.[0-9]+$/.test(opts.recoveryTx)) throw new Error('Invalid recovery transaction')
    ok(`${suite} on ${simulator}`, { merchant: manifest.merchant, price: manifest.price, network: manifest.network, suite, simulator })

    const request = { suite, maxRuns: 1, policyCommitment: opts.policyCommitment, idempotencyKey: randomBytes(16).toString('hex') }
    const url = `${cfg.base}/v1/stress-tests`
    const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }
    let paymentResponse: string | null = null
    let intent: { intentToken?: string, requestHash?: string } = {}
    if (opts.recoveryTx) {
      paymentResponse = Buffer.from(JSON.stringify({ success: true, payer: cfg.payer, transaction: opts.recoveryTx, network: 'hedera:testnet' })).toString('base64')
    } else {
      run('quote', 'HTTP 402 Payment Required', `POST /v1/stress-tests`)
      const quoteResponse = await fetch(url, init)
      if (quoteResponse.status !== 402) throw new Error(`Expected payment quote, got HTTP ${quoteResponse.status}`)
      const header = quoteResponse.headers.get('payment-required')
      if (!header) throw new Error('Missing x402 quote')
      const quote = (JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { accepts: HederaExactRequirements[] })
        .accepts.find(x => x.network === 'hedera:testnet' && x.scheme === 'exact')
      if (!quote) throw new Error('No Hedera exact quote')
      ok(`${quote.amount} tinybar to ${quote.payTo}`, { ...quote })

      run('facilitator', 'Facilitator capabilities', cfg.facilitator)
      const supportedResponse = await fetch(`${cfg.facilitator}/supported`)
      if (!supportedResponse.ok) throw new Error('Facilitator unavailable')
      const supported = await supportedResponse.json() as { kinds?: Array<{ network?: string, scheme?: string, extra?: { feePayer?: string } }> }
      const feePayers = supported.kinds?.filter(x => x.network === 'hedera:testnet' && x.scheme === 'exact')
        .map(x => x.extra?.feePayer).filter((x): x is string => Boolean(x)) ?? []
      ok(`fee payer ${feePayers.join(', ') || 'none'}`, { feePayers })

      run('policy', 'Agent spending policy')
      const policy = { network: 'hedera:testnet' as const, asset: '0.0.0', merchantAccounts: [cfg.merchant], feePayerAccounts: feePayers,
        maxPerJob: BigInt(cfg.cap), maxTotal: BigInt(cfg.cap), alreadySpent: 0n, maxTimeoutSeconds: 180 }
      // Display rows only; authorizePayment below is the authority and throws on any violation.
      const checks = [
        ['scheme exact on hedera:testnet', quote.scheme === 'exact' && quote.network === policy.network],
        ['asset is HBAR (0.0.0)', quote.asset === policy.asset],
        [`merchant ${quote.payTo} allowlisted`, policy.merchantAccounts.includes(quote.payTo)],
        [`fee payer ${quote.extra?.feePayer ?? '—'} allowlisted`, !!quote.extra?.feePayer && feePayers.includes(quote.extra.feePayer)],
        [`${quote.amount} ≤ cap ${cfg.cap} tinybar`, /^[0-9]+$/.test(quote.amount) && BigInt(quote.amount) <= BigInt(cfg.cap)],
        [`timeout ${quote.maxTimeoutSeconds}s ≤ 180s`, quote.maxTimeoutSeconds <= 180],
      ] as const
      authorizePayment(quote, policy)
      ok('all checks passed', { checks: checks.map(([label, pass]) => ({ label, pass })) })
      if (opts.quoteOnly) return { quoteOnly: true, quote }

      run('settle', 'Sign and settle on Hedera', 'x402 exact scheme')
      const signer = createClientHederaSigner(cfg.payer, PrivateKey.fromStringECDSA(cfg.key), { network: 'hedera:testnet' })
      const client = x402Client.fromConfig({ schemes: [{ network: 'hedera:testnet', client: new ExactHederaScheme(signer) }],
        spendControls: { allowedAssets: [{ network: 'hedera:testnet', asset: '0.0.0', maxAmountPerPayment: cfg.cap }] } })
      const paid = await wrapFetchWithPayment(fetch, client)(url, init)
      if (!paid.ok) throw new Error(`Paid request failed: HTTP ${paid.status}`)
      intent = await paid.json() as { intentToken: string, requestHash: string }
      paymentResponse = paid.headers.get('payment-response')
      if (!paymentResponse || !intent.intentToken) throw new Error('Missing settlement receipt or paid intent')
    }
    const receipt = JSON.parse(Buffer.from(paymentResponse!, 'base64').toString('utf8')) as { transaction: string, payer?: string }
    if (cur === 'settle') ok(receipt.transaction, { transaction: receipt.transaction, payer: receipt.payer ?? cfg.payer, hashscan: hashscanTx(receipt.transaction) })

    run('mirror', 'Mirror Node consensus', mirrorTxId(receipt.transaction))
    let transfers: Array<{ account: string, amount: number }> = [], consensus: string | undefined
    for (let i = 0; i < 6 && !transfers.length; i++) {
      const r = await fetch(`${MIRROR}/api/v1/transactions/${mirrorTxId(receipt.transaction)}`).catch(() => null)
      const j = r?.ok ? await r.json() as { transactions?: Array<{ result: string, consensus_timestamp: string, transfers?: Array<{ account: string, amount: number }> }> } : null
      const t = j?.transactions?.find(x => x.result === 'SUCCESS')
      if (t) { transfers = (t.transfers ?? []).filter(x => x.account === cfg.merchant || x.account === cfg.payer); consensus = t.consensus_timestamp }
      else await new Promise(r => setTimeout(r, 1500))
    }
    ok(transfers.length ? `SUCCESS at ${consensus}` : 'not visible yet; the service re-checks at activation', { transfers, consensus })

    run('bind', 'Bind payment to this request', 'payer signs tx id + request hash')
    const requestHash = hashRequest(suite, opts.policyCommitment, request.idempotencyKey)
    if (intent.requestHash && intent.requestHash !== requestHash) throw new Error('Service bound a different request than the one paid for')
    const payerSignature = await privateKeyToAccount(`0x${cfg.key}`).signMessage({ message: `faultline:v1:${receipt.transaction}:${requestHash}` })
    const activationBody = { ...request, paymentResponse, intentToken: intent.intentToken, payerSignature }
    mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 })
    const recoveryFile = join(cfg.stateDir, `activation-${receipt.transaction.replace(/[^0-9]/g, '-')}.json`)
    writeFileSync(recoveryFile, JSON.stringify(activationBody), { mode: 0o600 })
    ok(`request ${requestHash.slice(0, 12)}…`, { requestHash })

    run('activate', 'Issue run permit')
    const activation = await fetch(`${cfg.base}/v1/stress-tests/activate`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(activationBody) })
    if (!activation.ok) throw new Error(`Job activation failed: HTTP ${activation.status}; retry from ${recoveryFile}`)
    const a = await activation.json() as Activation
    ok(`job ${a.jobId}`, { jobId: a.jobId, suite: a.suite, simulator: a.simulator, expiresAt: a.expiresAt, transaction: a.transaction })
    return a
  } catch (e) {
    emit({ id: cur, status: 'fail', title, detail: (e as Error).message, ms: Date.now() - t0 })
    throw e
  }
}
