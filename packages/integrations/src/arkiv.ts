// Arkiv adapter (PROTOCOL §10). Public data only: listings and buyer-reported scores. Readers must re-validate
// creators and offers (see packages/client), because anyone can write entities with our schema tag.
import { createPublicClient, createWalletClient } from '@arkiv-network/sdk'
import { rabdi } from '@arkiv-network/sdk/chains'
import { addr, dec, defineSchema, key, str, u256, u64 } from '@arkiv-network/sdk/schema'
import { http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const ListingV1 = defineSchema('sealedai.listing/v1', {
  chainId: u64(),
  escrow: addr(),
  seller: addr().indexed(),
  assetId: key().indexed(),
  assetVersion: u64(),
  task: str().indexed(),
  architecture: str().indexed(),
  category: str().indexed(),
  title: str(),
  parameters: u64(),
  price: u256(),
  token: addr(),
  offerHash: key(),
  offerRoot: str(),
  validUntil: u64(),
})

export const ScoreV1 = defineSchema('sealedai.score/v1', {
  listingKey: key().indexed(),
  assetVersion: u64(),
  buyer: addr(),
  jobId: u256(),
  escrow: addr(),
  holdoutMacroF1: dec().indexed(),
  n: u64(),
  protocol: str(),
  manifestRoot: str(),
  receiptRoot: str(),
})

export const hex0x = (k: string) => (k.startsWith('0x') ? k : `0x${k}`) as Hex

export function arkiv(accessKey: string, privateKey?: string) {
  const chain = rabdi({ accessKey })
  const publicClient = createPublicClient({ chain, transport: http() })
  const account = privateKey ? privateKeyToAccount(hex0x(privateKey)) : undefined
  const walletClient = account ? createWalletClient({ chain, transport: http(), account }) : undefined
  return { chain, publicClient, walletClient, account }
}

export { addr, dec, key, str, u256, u64 }
