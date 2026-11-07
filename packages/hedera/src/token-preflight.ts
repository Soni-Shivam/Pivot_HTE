import { LedgerId } from '@hiero-ledger/sdk'
import { HederaMirrornodeServiceDefaultImpl } from '@hashgraph/hedera-agent-kit'

/** Agent Kit Mirror Node service checks the token, associations, and payer balance before x402 signing. */
export async function tokenPreflight(asset: string, payer: string, merchant: string, amount: bigint, expectedSymbol?: string) {
  if (asset === '0.0.0') return null
  const mirror = new HederaMirrornodeServiceDefaultImpl(LedgerId.TESTNET)
  const [token, payerBalances, merchantBalances] = await Promise.all([
    mirror.getTokenInfo(asset), mirror.getAccountTokenBalances(payer, asset), mirror.getAccountTokenBalances(merchant, asset),
  ])
  if (token.deleted || token.type !== 'FUNGIBLE_COMMON' || token.pause_status === 'PAUSED') {
    throw new Error('HTS payment token is unavailable')
  }
  if (expectedSymbol && token.symbol !== expectedSymbol) throw new Error('HTS payment token symbol does not match policy')
  const payerToken = payerBalances.tokens.find(x => x.token_id === asset)
  const merchantToken = merchantBalances.tokens.find(x => x.token_id === asset)
  if (!payerToken || !merchantToken) throw new Error('Payer and merchant must both be associated with the HTS token')
  if (payerToken.freeze_status === 'FROZEN' || merchantToken.freeze_status === 'FROZEN') throw new Error('HTS token association frozen')
  if (payerToken.kyc_status === 'REVOKED' || merchantToken.kyc_status === 'REVOKED') throw new Error('HTS token KYC revoked')
  if (!Number.isSafeInteger(payerToken.balance)) throw new Error('HTS balance exceeds safe Mirror Node numeric range')
  if (BigInt(payerToken.balance) < amount) throw new Error('Insufficient HTS token balance')
  return { symbol: token.symbol, decimals: Number(token.decimals), balance: String(payerToken.balance) }
}
