// Arkiv catalog (PROTOCOL §10, T07). Arkiv is public: anyone can write our schema tag, so a listing is shown only if
// its Arkiv creator is the offer's seller, the full signed offer (fetched from 0G Storage) verifies, and it's current.
import { ExpirationTime } from '@arkiv-network/sdk'
import { eq } from '@arkiv-network/sdk/query'
import type { Address, Hex } from 'viem'
import { reviveTyped, recoverTyped, typedHash, type Offer } from '@sealedai/protocol'
import { arkiv, ListingV1, addr, key, u64, storage, GALILEO_DEPLOYMENT } from '@sealedai/integrations'

export type OfferDoc = { offer: Offer; offerSig: Hex; card: Record<string, unknown>; license?: { calls: number; hours: number } }

export async function publishListing(arkivKey: string, sellerKey: string, p: { offer: Offer; offerHash: Hex; offerRoot: string; card: { name?: string; task: string; architecture: string; parameters: number } }, category: string) {
  const { walletClient } = arkiv(arkivKey, sellerKey)
  const ttl = Math.max(3600, Number(p.offer.validUntil) - Math.floor(Date.now() / 1000))
  const res = await walletClient!.createEntity(ListingV1, {
    chainId: u64(16602n), escrow: addr(GALILEO_DEPLOYMENT.escrow), seller: addr(p.offer.seller), assetId: key(p.offer.assetId),
    assetVersion: u64(BigInt(p.offer.assetVersion)), task: p.card.task, architecture: p.card.architecture, category,
    title: String(p.card.name ?? p.card.architecture).slice(0, 120), parameters: u64(BigInt(p.card.parameters)),
    price: BigInt(p.offer.price), token: addr(p.offer.token), offerHash: key(p.offerHash), offerRoot: p.offerRoot, validUntil: u64(BigInt(p.offer.validUntil)),
  }, { expiration: ExpirationTime.fromSeconds(ttl) })
  return res as { entityKey: Hex; txHash?: Hex }
}

export type VerifiedListing = { entityKey: Hex; title: string; category: string; price: bigint; seller: Address; offerRoot: string; doc: OfferDoc; offerHash: Hex }

export async function browseListings(arkivKey: string, env: { rpcUrl: string; indexerUrl: string }, filter: { task?: string; category?: string } = {}) {
  const { publicClient } = arkiv(arkivKey)
  let q = publicClient.select({ $key: true, $creator: true, title: true, category: true, price: true, seller: true, offerRoot: true, offerHash: true, validUntil: true, escrow: true, chainId: true }).from(ListingV1)
  if (filter.task) q = q.where(eq('task', filter.task))
  if (filter.category) q = q.where(eq('category', filter.category))
  const st = storage({ rpcUrl: env.rpcUrl, indexerUrl: env.indexerUrl })
  const shown: VerifiedListing[] = []
  const hidden: { entityKey: Hex; reason: string }[] = []
  const rows: Record<string, unknown>[] = []
  for (let offset = 0; ; ) {
    // Arkiv pages hold at most 100; skipped (schema-mismatched) rows still count toward the offset.
    const page = await q.limit(100).offset(offset).fetch()
    rows.push(...(page.entities as unknown as Record<string, unknown>[]))
    const covered = page.entities.length + page.skipped
    if (covered < 100) break
    offset += covered
  }
  for (const row of rows) {
    const v = (k: string) => (row[k] as { value: unknown })?.value
    const entityKey = row.$key as Hex
    try {
      if (String(row.$creator).toLowerCase() !== String(v('seller')).toLowerCase()) throw new Error('listing not written by its seller')
      if (Number(v('chainId')) !== 16602 || String(v('escrow')).toLowerCase() !== GALILEO_DEPLOYMENT.escrow.toLowerCase()) throw new Error('other chain or escrow')
      if (Number(v('validUntil')) <= Date.now() / 1000) throw new Error('expired')
      const raw = JSON.parse(new TextDecoder().decode(await st.downloadBlob(String(v('offerRoot'))))) as { offer: Record<string, unknown>; offerSig: Hex; card: Record<string, unknown>; license?: { calls: number; hours: number } }
      const offer = reviveTyped('Offer', raw.offer)
      const offerHash = typedHash('Offer', offer, GALILEO_DEPLOYMENT.escrow)
      if (offerHash !== v('offerHash')) throw new Error('offer document does not match the listing')
      if ((await recoverTyped('Offer', offer, raw.offerSig, GALILEO_DEPLOYMENT.escrow)).toLowerCase() !== String(offer.seller).toLowerCase()) throw new Error('offer signature invalid')
      if (String(offer.seller).toLowerCase() !== String(v('seller')).toLowerCase() || BigInt(offer.price) !== BigInt(v('price') as bigint)) throw new Error('listing contradicts its offer')
      shown.push({ entityKey, title: String(v('title')), category: String(v('category')), price: BigInt(offer.price), seller: offer.seller as Address, offerRoot: String(v('offerRoot')), doc: { ...raw, offer }, offerHash })
    } catch (e) {
      hidden.push({ entityKey, reason: (e as Error).message })
    }
  }
  return { shown, hidden }
}
