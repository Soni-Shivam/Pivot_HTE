// T07: the seller lists a signed offer on Arkiv; an impostor writes a copy claiming the same seller; browsing shows
// only the listing whose Arkiv creator is the seller AND whose offer (fetched from 0G Storage) verifies.
//   npx tsx examples/11-arkiv-catalog.ts <offerRoot from examples/10>
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { parseEther, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { reviveTyped, typedHash } from '@sealedai/protocol'
import { storage, arkiv, GALILEO_DEPLOYMENT } from '@sealedai/integrations'
import { publishListing, browseListings } from '@sealedai/client'

const env = { rpcUrl: process.env.RPC_URL!, indexerUrl: process.env.STORAGE_INDEXER! }
const offerRoot = process.argv[2] ?? '0x326aef9704afbc057ad23e0e91c7a52c90aa65dca73d29197f0b184bce11aa6e'
const key = process.env.ARKIV_API_KEY!
const out: string[] = []
const say = (s: string) => { console.log(s); out.push(s) }

const raw = JSON.parse(new TextDecoder().decode(await storage(env).downloadBlob(offerRoot)))
const offer = reviveTyped('Offer', raw.offer)
const listing = { offer, offerHash: typedHash('Offer', offer, GALILEO_DEPLOYMENT.escrow), offerRoot, card: raw.card }

const real = await publishListing(key, process.env.PRIVATE_KEY!, listing, 'support-triage')
say(`seller listing entity ${real.entityKey} tx ${real.txHash ?? '-'} (writer ${offer.seller})`)

// Impostor: a different wallet writes the same listing, claiming the seller's address.
const impostorKey = process.env.BUYER_PRIVATE_KEY! as Hex
const impostor = privateKeyToAccount(impostorKey)
const seller = arkiv(key, process.env.PRIVATE_KEY!)
if ((await seller.publicClient.getBalance({ address: impostor.address })) < parseEther('0.01')) {
  await seller.walletClient!.sendTransaction({ to: impostor.address, value: parseEther('0.05'), account: seller.account!, chain: seller.chain })
}
const fake = await publishListing(key, impostorKey, listing, 'support-triage')
say(`impostor listing entity ${fake.entityKey} (writer ${impostor.address}, claims seller ${offer.seller})`)

const { shown, hidden } = await browseListings(key, env, { category: 'support-triage' })
for (const l of shown) say(`SHOWN  ${l.entityKey} "${l.title}" price ${l.price} seller ${l.seller}`)
for (const h of hidden) say(`HIDDEN ${h.entityKey}: ${h.reason}`)
if (!shown.some((l) => l.entityKey === real.entityKey) || shown.some((l) => l.entityKey === fake.entityKey)) throw new Error('catalog validation failed')
say(`query: select listing/v1 where category = "support-triage", shown only if $creator == seller and the 0G-stored offer verifies`)
writeFileSync('docs/evidence/11-arkiv-catalog.log', out.join('\n') + '\n')
