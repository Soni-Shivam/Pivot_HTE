# FLTTEST x402 and repeat campaign, Hedera testnet

Date: 2026-11-07 UTC. This evidence concerns payment and job activation. No CARLA or 0G episode was executed for these three jobs.

## Setup

- Created a fungible test token, `FLTTEST`, entity ID `0.0.11348519`, 0 decimals, 100 units initial supply, payer treasury. [Creation transaction](https://hashscan.io/testnet/transaction/0.0.11345424@1794016334.874761179).
- Sent 1 unit to the merchant to establish its automatic token association. [Funding transaction](https://hashscan.io/testnet/transaction/0.0.11345424@1794016340.997636665).
- Both payer and merchant have automatic token association enabled. The buyer pinned the token ID and symbol and checked both accounts through Hedera Agent Kit before signing.
- Merchant price and buyer per-job cap: **1 FLTTEST base unit**. This token is a test fixture, **not USDC**.

## One paid request

The buyer discovered the provider, exchanged A2A proposal/offer/acceptance messages, checked the x402 quote and facilitator, signed a one-unit HTS transfer, and activated the single-use run permit. Job `69dc01a820664f465670868244f56055` was accepted. [Payment transaction](https://hashscan.io/testnet/transaction/0.0.9185802@1794016439.361391302).

Mirror Node returned `SUCCESS` and token transfers of `-1` from payer `0.0.11345424` and `+1` to merchant `0.0.11345316` for token `0.0.11348519`. Activation used the token transfer check, not the HBAR fee transfers.

## Bounded repeat campaign

Campaign `0e237ea6-6907-496e-9353-dba0a0a14d1f` specified a 10-second minimum interval, two jobs, and a two-unit total cap. The first `tick` bought job `6bc6e51e10354a92367804020fd8b768` ([payment](https://hashscan.io/testnet/transaction/0.0.9185802@1794016474.535522594)). An immediate second `tick` returned `not_due` without a payment. After the due time, the next `tick` bought job `921924bec6824bdf672252d5bb8f4fe0` ([payment](https://hashscan.io/testnet/transaction/0.0.9185802@1794016500.677557444)). A further `tick` returned `complete`, with two purchases and two units spent.

Hedera Agent Kit Mirror Node queries returned `SUCCESS` for both campaign transactions. Each transferred exactly one FLTTEST unit from payer to merchant. The runner stores its private campaign state and any activation recovery file outside the repository.

The repeat timing comes from a client scheduler invoking `tick`; these transfers are x402 direct transfers. No Hedera Scheduled Transaction was created. This demonstrates bounded recurring x402 purchases, not the Scheduled Transactions bonus.
