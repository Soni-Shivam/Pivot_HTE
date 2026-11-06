// 0G Galileo chain + ERC-8183 escrow adapter (viem). Any party (buyer, seller, worker) uses the same calls with
// its own key; the contract enforces who may do what (PLAN §6).
import { createPublicClient, createWalletClient, defineChain, decodeEventLog, http, type Hex, type Address, type Account } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { erc8183Abi, erc20Abi, GALILEO_DEPLOYMENT } from './abi/erc8183.ts'

export const galileo = (rpcUrl = 'https://evmrpc-testnet.0g.ai') =>
  defineChain({ id: 16602, name: '0G Galileo', nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } })

export const JobStatus = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'] as const
export type Job = {
  client: Address; status: (typeof JobStatus)[number]; provider: Address; expiredAt: number; evaluator: Address
  submittedAt: number; budget: bigint; hook: Address; paymentToken: Address; providerAgentId: bigint
  description: string; settledAmount: bigint; payoutReceiver: Address
}

export function escrow(o: { rpcUrl: string; account?: Account | Hex; escrow?: Address; token?: Address }) {
  const chain = galileo(o.rpcUrl)
  const pub = createPublicClient({ chain, transport: http(o.rpcUrl) })
  const account = typeof o.account === 'string' ? privateKeyToAccount((o.account.startsWith('0x') ? o.account : `0x${o.account}`) as Hex) : o.account
  const wallet = account ? createWalletClient({ chain, transport: http(o.rpcUrl), account }) : undefined
  const address = o.escrow ?? (GALILEO_DEPLOYMENT.escrow as Address)
  const token = o.token ?? (GALILEO_DEPLOYMENT.token as Address)

  async function send(fn: string, args: unknown[], to: Address = address, abi: readonly unknown[] = erc8183Abi) {
    if (!wallet) throw new Error('this escrow client has no signer')
    const { request } = await pub.simulateContract({ address: to, abi: abi as never, functionName: fn as never, args: args as never, account: wallet.account })
    const hash = await wallet.writeContract(request)
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 })
    if (receipt.status !== 'success') throw new Error(`${fn} reverted: ${hash}`)
    return receipt
  }

  return {
    chain, address, token, account, pub,
    async getJob(jobId: bigint): Promise<Job> {
      const j = (await pub.readContract({ address, abi: erc8183Abi, functionName: 'getJob', args: [jobId] })) as Omit<Job, 'status' | 'expiredAt' | 'submittedAt'> & { status: number; expiredAt: number | bigint; submittedAt: number | bigint }
      return { ...j, status: JobStatus[j.status], expiredAt: Number(j.expiredAt), submittedAt: Number(j.submittedAt) }
    },
    async createJob(provider: Address, evaluator: Address, expiredAt: number, description: string) {
      const r = await send('createJob', [provider, evaluator, expiredAt, description, '0x0000000000000000000000000000000000000000', 0n])
      for (const log of r.logs) {
        if (log.address.toLowerCase() !== address.toLowerCase()) continue
        try {
          const ev = decodeEventLog({ abi: erc8183Abi, data: log.data, topics: log.topics })
          if (ev.eventName === 'JobCreated') return { jobId: (ev.args as { jobId: bigint }).jobId, tx: r.transactionHash }
        } catch { /* other event */ }
      }
      throw new Error('JobCreated event not found')
    },
    setPayoutReceiver: (jobId: bigint, receiver: Address) => send('setPayoutReceiver', [jobId, receiver]).then((r) => r.transactionHash),
    setBudget: (jobId: bigint, amount: bigint, tok: Address = token) => send('setBudget', [jobId, tok, amount, '0x']).then((r) => r.transactionHash),
    async fund(jobId: bigint, expectedBudget: bigint, tok: Address = token) {
      const approve = await send('approve', [address, expectedBudget], tok, erc20Abi)
      const fund = await send('fund', [jobId, tok, expectedBudget, '0x'])
      return { approveTx: approve.transactionHash, fundTx: fund.transactionHash }
    },
    submit: (jobId: bigint, deliverable: Hex) => send('submit', [jobId, deliverable, '0x']).then((r) => r.transactionHash),
    complete: (jobId: bigint, reason: Hex) => send('complete', [jobId, reason, '0x']).then((r) => r.transactionHash),
    reject: (jobId: bigint, reason: Hex) => send('reject', [jobId, reason, '0x']).then((r) => r.transactionHash),
    claimRefund: (jobId: bigint) => send('claimRefund', [jobId]).then((r) => r.transactionHash),
    mintTestToken: (to: Address, amount: bigint) => send('mint', [to, amount], token, erc20Abi).then((r) => r.transactionHash),
    tokenBalance: (who: Address) => pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>,
    nativeBalance: (who: Address) => pub.getBalance({ address: who }),
    async sendGas(to: Address, value: bigint) {
      if (!wallet) throw new Error('no signer')
      const hash = await wallet.sendTransaction({ to, value, account: wallet.account!, chain })
      await pub.waitForTransactionReceipt({ hash, timeout: 180_000 })
      return hash
    },
  }
}
export type Escrow = ReturnType<typeof escrow>
