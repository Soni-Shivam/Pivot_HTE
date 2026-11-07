/** Check the actual asset movement on Mirror Node, not merely the x402 receipt. */
export function paidTransfer(
  tx: { result: string; transfers?: Array<{ account: string; amount: number }>; token_transfers?: Array<{ account: string; token_id: string; amount: number }> },
  asset: string, payer: string, merchant: string, amount: bigint,
): boolean {
  if (tx.result !== 'SUCCESS' || payer === merchant) return false
  const rows = asset === '0.0.0' ? tx.transfers : tx.token_transfers?.filter(x => x.token_id === asset)
  if (!rows || amount > BigInt(Number.MAX_SAFE_INTEGER) || rows.some(x => !Number.isSafeInteger(x.amount))) return false
  const net = (account: string) => rows.filter(x => x.account === account).reduce((n, x) => n + BigInt(x.amount), 0n)
  return net(merchant) === amount && net(payer) === -amount
}
