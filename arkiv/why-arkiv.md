# Why Arkiv

The product promise is "no server of ours sees your model or your data", and that has to include the catalog. If
listings lived in our database we would be the gatekeeper of what can be sold and a single point of censorship and
failure (it would also break our CROPS claim).

Arkiv fits the catalog's shape exactly:

- **Wallet-owned writes.** A listing is written by the seller's own wallet, so `$creator` is a cryptographic
  statement of authorship that the client can check, not a field we vouch for.
- **Expiration built in.** Offers have a validity window; Arkiv entities expire with them, so the catalog cleans itself.
- **Queryable from the browser.** Indexed attributes (`category`, `task`, `architecture`, `seller`) give the browse
  page real filtering with no backend, over a public RPC with CORS.
- **Right split of data.** Arkiv holds small, public, searchable metadata; the heavy signed offer and encrypted model
  live on 0G Storage, referenced by root. Private state never goes to Arkiv.

Without Arkiv we would need either our own indexer (a server we run) or on-chain events scanned in the browser (no
attribute queries, no expiry).
