// ERC-8004 identity for the Faultline adversary (audit "extra 0G features"). Interface from the EIP text
// (ethereum/ERCs ERCS/erc-8004.md: `register(string agentURI) returns (uint256 agentId)`, event
// `Registered(uint256 indexed agentId, string agentURI, address indexed owner)`); registry address from
// .claude/skills/sealedai-stack/SKILL.md (Galileo Identity). The deployed source is not verified on chainscan, so the
// call is simulated first and the agentId is read from the receipt's Registered event, never assumed.
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { galileo } from '@sealedai/integrations'

export const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const
const abi = parseAbi(['function register(string agentURI) returns (uint256 agentId)', 'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)'])

/** The registration file (EIP-8004 registration-v1) as a base64 data: URI, fully on chain. */
export function agentURI(card: Record<string, unknown>): string {
  const doc = { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', active: true, x402Support: false, services: [], ...card }
  return `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString('base64')}`
}

export async function registerAgent(cfg: { rpcUrl: string; privateKey: string }, uri: string) {
  const chain = galileo(cfg.rpcUrl)
  const account = privateKeyToAccount((cfg.privateKey.startsWith('0x') ? cfg.privateKey : `0x${cfg.privateKey}`) as Hex)
  const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) })
  const { request } = await pub.simulateContract({ address: IDENTITY_REGISTRY, abi, functionName: 'register', args: [uri], account })
  const hash = await createWalletClient({ chain, transport: http(cfg.rpcUrl), account }).writeContract(request)
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 })
  if (r.status !== 'success') throw new Error(`register reverted: ${hash}`)
  const ev = parseEventLogs({ abi, logs: r.logs, eventName: 'Registered' })[0]
  if (!ev) throw new Error(`no Registered event in ${hash}`)
  return { tx: hash, block: Number(r.blockNumber), agentId: ev.args.agentId.toString(), owner: ev.args.owner, registry: IDENTITY_REGISTRY }
}
