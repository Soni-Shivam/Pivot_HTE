# Faultline Hedera x402 testnet payment

On 2026-11-06 at 22:05:08 UTC, the local Faultline client completed one autonomous paid request to `GET /v1/paid-ping` through the Hedera x402 facilitator. The server returned HTTP 402 with an exact-scheme quote; the client checked the testnet, HBAR asset, merchant, facilitator fee payer, timeout, and 100,000-tinybar spending cap before signing. The paid request returned HTTP 200.

| Field | Value |
| --- | --- |
| Network | Hedera testnet |
| Price | 100,000 tinybars (0.001 HBAR) |
| Transaction | `0.0.9185802@1794002700.993105093` |
| Result | `SUCCESS` |
| Payer transfer | `0.0.11345424`: −100,000 tinybars |
| Merchant transfer | `0.0.11345316`: +100,000 tinybars |
| HashScan | https://hashscan.io/testnet/transaction/0.0.9185802@1794002700.993105093 |
| Mirror Node | https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.9185802-1794002700-993105093 |

The transaction ID is under the facilitator fee payer account; Mirror Node's transfer list confirms the payer-to-merchant HBAR movement. This is a paid endpoint smoke test. It does not yet authorize or launch a Faultline stress-test job.
