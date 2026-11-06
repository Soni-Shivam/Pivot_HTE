# Arkiv schema

Defined in [`packages/integrations/src/arkiv.ts`](../packages/integrations/src/arkiv.ts) with `@arkiv-network/sdk` 1.0.1
on the Rabdi testnet (chain 7794095). Only **public** data goes to Arkiv; private job state stays on the user's device
or encrypted on 0G Storage.

## `sealedai.listing/v1` — one model offered for customization

| Column | Type | Indexed | Meaning |
|---|---|---|---|
| `chainId` | u64 | | Settlement chain (16602, 0G Galileo) |
| `escrow` | addr | | ERC-8183 escrow the offer pays through |
| `seller` | addr | ✓ | Seller wallet (must equal the entity's `$creator`) |
| `assetId` | key | ✓ | Namespaced asset id from the signed offer |
| `assetVersion` | u64 | | Version of the model bundle |
| `task` | str | ✓ | e.g. `text-classification` |
| `architecture` | str | ✓ | e.g. `BertForSequenceClassification` |
| `category` | str | ✓ | Marketplace category, e.g. `support-triage` |
| `title` | str | | Display name (≤ 128 bytes, rendered as text) |
| `parameters` | u64 | | Parameter count from the model card |
| `price` | u256 | | Price in the payment token's base units |
| `token` | addr | | Payment token |
| `offerHash` | key | | EIP-712 hash of the signed Offer |
| `offerRoot` | str | | 0G Storage root of the full signed Offer + public model card |
| `validUntil` | u64 | | Offer expiry (unix seconds) |

Expiration: the entity expires when the offer does (`ExpirationTime.fromSeconds(validUntil − now)`), so stale offers
disappear from the catalog without anyone deleting them.

## `sealedai.score/v1` — a buyer-reported result (schema defined; publishing is opt-in)

| Column | Type | Indexed | Meaning |
|---|---|---|---|
| `listingKey` | key | ✓ | The listing that was customized |
| `assetVersion` | u64 | | Model version evaluated |
| `buyer` | addr | | Who reports the score |
| `jobId` | u256 | | Escrow job |
| `escrow` | addr | | Escrow contract |
| `holdoutMacroF1` | dec | ✓ | Held-out score from the worker-signed receipt |
| `n` | u64 | | Holdout rows |
| `protocol` | str | | `sealedai/v1` |
| `manifestRoot` | str | | 0G root of the public job manifest (salted commitments only) |
| `receiptRoot` | str | | 0G root of the worker-signed receipt |

Scores are always labelled *buyer-reported*; PROTOCOL §10 defines when a "worker-signed" badge may be shown.
