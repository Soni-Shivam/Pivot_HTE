# How we use Arkiv

Arkiv is the marketplace's **catalog**: the only place listings live. There is no database of ours.

**Write.** When a seller publishes a model, their own wallet writes a `sealedai.listing/v1` entity
([`publishListing`](../packages/client/src/catalog.ts)). The entity points at the seller's EIP-712-signed offer on
0G Storage (`offerRoot`) and expires with the offer.

**Read (user-visible).** The web app's first screen, "Models for sale", is an Arkiv query
([`browseListings`](../packages/client/src/catalog.ts)): `select … from sealedai.listing/v1 where category = X`, paged
100 at a time (following `skipped` so schema-mismatched rows don't stall paging). Every row is then **re-verified**
before it is shown:

1. `$creator` must equal the `seller` column (Arkiv is public; anyone can write our schema tag).
2. It must target our chain and escrow, and not be expired.
3. The full offer is downloaded from 0G Storage, its hash must equal `offerHash`, its EIP-712 signature must recover
   the seller, and its price must match.

Rows that fail are hidden, and the app says why. In our test ([`examples/11`](../examples/11-arkiv-catalog.ts)) an
impostor wallet wrote a copy of a real listing claiming the seller's address; the app showed the real one and hid
the copy ("listing not written by its seller").

Evidence: seller listing `0xe7e6e3a53f9a682a01f68df5f3945a5116ad3cb3180888f746b61b3daae3a7e3`, impostor
`0x22d6d29bbd5ae916ac50349d6169ca00005f4c5315e6bebf3c4dabedba937af6` ([log](../docs/evidence/11-arkiv-catalog.log)).
