# Faultline paid job 001 — Hedera x402 to 0G report

Date: 2026-11-07 IST. Suite: `cut-in-v1`, one kinematic cut-in episode using PDM-Lite and ten private-tier 0G decisions. Policy commitment: SHA-256 of `faultline/ego/pdm_lite.py`, `0x8edf01447b050b384dc02eaf2284d991276c58dcd67ab8c6ab8c6b0aa6ffd168`.

| Stage | Evidence |
| --- | --- |
| Hedera x402 settlement | [0.001 HBAR transaction](https://hashscan.io/testnet/transaction/0.0.9185802@1794004328.340591562), Mirror Node `SUCCESS`, payer −100,000 and merchant +100,000 tinybars |
| Accepted job | `7b37925861e5bd810b11c73ede19e7ef`, bound to that transaction and payer signature |
| Galileo pre-run commit | `0xf42b857a60f196392559e9f681b62e6e779154cb21865eebc12ca6ad0593456c` |
| Episode | `f9fd961718a149c99ecbc45cf0b7688fef0504acff94670c46f2fae4be3dd6ae`, status `completed`, ten 0G decisions, zero halts |
| 0G Storage | Public root `0xad8457de93e273b169d573947b2e7282b29a27bef1994ea950c6abe983e5ac12`; sealed root `0x9a887c5b8880dcc12b3466cfa5b6ab999e9f038dfcdefde5b16a3318ebf6fc40` |
| Galileo finalize | `0xe3fbcc38221f39fbd330c5f841df82c1e1cab249ead9c268b663ebc12763da76`; `onchainMatches: true` |
| Replay | 240 ticks, decisions and trajectory hashes match; maximum gap and velocity differences are zero |
| Evidence verification | Public and sealed roots, file hashes, metrics, decision chain, and public/sealed match passed; 10 archived provider signatures recovered the chain signer; quote signer matched chain |
| Permit reuse | Completed job read returned 200; second start returned 409 |

The first activation attempt returned 503 while querying Mirror Node. The Hedera transfer had settled. Recovery used that transaction and a payer signature, with no second payment. Two local attempts then stopped before the first simulation decision because the existing CLI sourced `nvm` against an incompatible npm prefix; after invoking the installed Node 22 `npm` directly, the same paid job completed. These are real recovery cases the product interface should show.

The current provider signature uses `zg-sig-v1/e2ee-ct:<request-hash>:<response-hash>`. Offline EIP-191 recovery verifies the signer against the on-chain service record. The ciphertext hashes are not independently bound to the published plaintext response by this check, so the report must describe signer verification and evidence replay separately.

This run used a kinematic simulator, not CARLA. It demonstrates the payment and evidence pipeline; CARLA execution remains a separate validation step.
