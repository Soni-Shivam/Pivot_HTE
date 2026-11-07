# Hedera payment extensions

This branch adds three paths to the existing paid Faultline job, plus a Hedera Agent Kit check. The normal job remains a one-time x402 purchase followed by a single-use CARLA or kinematic run permit.

Use Node `22.23.4+`, `24.22.1+`, or `26.12.1+` for the installed Agent Kit v4 package. The current development machine has Node 24.6.0, which ran the checked paths but is outside the package's declared engine range.

## Agent negotiation before payment

The merchant exposes an [A2A 0.3 JSON-RPC](https://a2a-protocol.org/v0.3.0/specification/) card at `/.well-known/agent-card.json` and `message/send` at `/a2a`. The buyer proposes the exact scenario suite, payment asset, and maximum amount. The provider offers an available suite at its configured amount; the buyer accepts in a second `message/send` call. The buyer still verifies the independent x402 quote against the accepted terms and its allowlist before signing. The negotiation does not itself authorize a run or move funds.

Run the merchant with `npm run hedera:serve`; `npm run hedera:buy -- <policy-commitment> <suite>` now performs this exchange automatically. The merchant card and negotiation can be inspected without payment.

## HTS payment

Set `HEDERA_PAYMENT_ASSET` to the fungible token's Hedera entity ID and `HEDERA_PAYMENT_AMOUNT` to its **smallest-unit** amount on both merchant and buyer. For USDC, also set `HEDERA_EXPECTED_TOKEN_SYMBOL=USDC` on the buyer. Both accounts must be associated with the token, and the buyer must have sufficient balance. The configured x402 facilitator must support that asset on `hedera:testnet`.

The buyer uses the official Hedera Agent Kit Mirror Node service to check the token's status, payer balance, account associations, and settled transaction. Job activation checks the same asset's exact token transfer on Hedera Mirror Node. HBAR remains supported with `HEDERA_PAYMENT_ASSET=0.0.0`; the 0.001 HBAR demo cap still applies only to HBAR. Setting a token ID is **not proof of a settled HTS payment**. Record a fresh transaction ID and HashScan link after an actual token-funded run.

## Repeated x402 purchases

The campaign client creates a bounded repeat plan and buys one fresh job whenever a scheduler calls `tick` after the next due time:

```sh
npm run hedera:campaign -- init cut-in-v1-carla <0x-policy-commitment> 3600 3
npm run hedera:campaign -- tick
```

Run `tick` from cron or another scheduler. The plan is in the private `HEDERA_JOB_STATE_DIR/campaign.json` file. It fixes the payment asset, price cap, interval, and total budget; each purchase still negotiates and pays through x402. A failed or ambiguous purchase leaves `purchase_in_progress` and `campaign.json.lock`, halting further charges until a human reconciles the saved activation file and Hedera transaction. Use a dedicated state directory per campaign. Do not delete the lock or reset the state without checking whether a transfer settled.

Hedera Scheduled Transactions execute a **single** transaction when signatures or an expiry condition are met. The [Hedera exact x402 scheme](https://docs.hedera.com/solutions/ai/x402/exact-scheme) uses a direct transfer and explicitly does not wrap it in `ScheduleCreate`. This campaign is recurring client automation, **not** a Hedera Scheduled Transaction or a claim of that bonus. It requires a scheduler to call `tick` for each due purchase.

## Verification status

The A2A card and proposal → offer → acceptance exchange were exercised against a local merchant. TypeScript typecheck and the HTS/HBAR settlement unit tests pass. Agent Kit queried the existing settled HBAR transaction `0.0.9185802@1794006563.434123686`, and the transfer verifier accepted it. One standalone HTS purchase and two campaign purchases settled and activated jobs; the transaction IDs and limits are in [the testnet evidence](evidence/faultline-hts-campaign.md). The local `.env` still defaults to HBAR; the HTS runs used explicit environment overrides. These jobs were activated but their scenario runs were not executed in this check.
