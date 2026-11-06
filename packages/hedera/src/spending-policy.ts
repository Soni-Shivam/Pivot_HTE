/** Hedera x402 exact-scheme requirements, limited to fields this client authorizes. */
export type HederaExactRequirements = {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: { feePayer?: string }
}

export type SpendingPolicy = {
  network: 'hedera:testnet' | 'hedera:mainnet'
  asset: string
  merchantAccounts: readonly string[]
  feePayerAccounts: readonly string[]
  maxPerJob: bigint
  maxTotal: bigint
  alreadySpent: bigint
  maxTimeoutSeconds: number
}

const accountId = /^0\.0\.[1-9][0-9]*$/
const amount = /^(0|[1-9][0-9]*)$/

/** Call before invoking the x402 signer. Never ask the 0G decision model to approve payment. */
export function authorizePayment(requirements: HederaExactRequirements, policy: SpendingPolicy): bigint {
  if (requirements.scheme !== 'exact') throw new Error('Unsupported payment scheme')
  if (requirements.network !== policy.network) throw new Error('Unexpected Hedera network')
  if (requirements.asset !== policy.asset) throw new Error('Unexpected payment asset')
  if (!accountId.test(requirements.payTo) || !policy.merchantAccounts.includes(requirements.payTo)) {
    throw new Error('Merchant is not allowlisted')
  }
  const feePayer = requirements.extra?.feePayer
  if (!feePayer || !accountId.test(feePayer) || !policy.feePayerAccounts.includes(feePayer)) {
    throw new Error('Facilitator fee payer is not allowlisted')
  }
  if (!amount.test(requirements.amount)) throw new Error('Invalid payment amount')
  const charge = BigInt(requirements.amount)
  if (charge === 0n || charge > policy.maxPerJob) throw new Error('Per-job spending cap exceeded')
  if (policy.alreadySpent < 0n || policy.maxTotal < 0n || charge > policy.maxTotal - policy.alreadySpent) {
    throw new Error('Total spending cap exceeded')
  }
  if (!Number.isSafeInteger(requirements.maxTimeoutSeconds) || requirements.maxTimeoutSeconds < 1 ||
      requirements.maxTimeoutSeconds > policy.maxTimeoutSeconds) {
    throw new Error('Payment timeout outside policy')
  }
  return charge
}
