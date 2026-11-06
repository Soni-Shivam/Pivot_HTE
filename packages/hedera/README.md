# Faultline paid stress tests on Hedera

Run `npm run hedera:serve` from the repository root. The service publishes its fixed-price `cut-in-v1` suite at `/.well-known/faultline-service.json` and quotes an x402 payment for `POST /v1/stress-tests`.

The buyer uses `npm run hedera:buy -- 0x<64-hex-policy-commitment> <suite>`. It reads discovery, enforces the configured merchant and 0.001 HBAR cap, pays once, and activates a job after the server confirms the settlement transfer through Hedera Mirror Node. The response includes a job ID and bearer permit. Keep the permit private.

If activation fails after payment, the buyer saves a private activation JSON file in `.faultline-hedera-state/`. Run `npm run hedera:recover -- <saved-file>` to retry activation without another transfer. The server checks settlement on Mirror Node, verifies a signature from the payer's Hedera ECDSA account, and refuses a transaction already bound to a different job.

On the customer's machine, run `npm run hedera:run -- <jobId> <permit> <same-policy-commitment> <same-suite>`. The server consumes the permit for one start. The adapter runs one local 0G-driven cut-in episode with Galileo anchoring, then posts the report. A dashboard can poll `GET /v1/stress-tests/<jobId>` with `Authorization: Bearer <permit>`.

The state directory `.faultline-hedera-state/` holds the job ledger and a local permit signing secret. Keep it persistent and private. This initial store is for a single server process; deploy a transactional database before running multiple replicas. The report is submitted by the customer's runner and should be described as such; Hedera verifies settlement, while the 0G evidence supports independent episode inspection.

The first paid endpoint check is recorded in [testnet payment evidence](../../docs/evidence/faultline-hedera-x402-testnet.md). The paid job, 0G run, and verification are recorded in [end-to-end evidence](../../docs/evidence/faultline-paid-job-001.md).

## Suites

A payment buys exactly one run of one allowlisted suite (`src/suites.ts`): `cut-in-v1-kinematic` (simulator `kinematic-cut-in`) or `cut-in-v1-carla` (simulator `carla-0.10.0-cut-in`, CARLA 0.10 / Town10HD_Opt). Suite and simulator are part of the request hash, so the payer's signature, the job record and the permit HMAC all bind them. The runner reads the job before starting and refuses a permit bought for a different suite; the server refuses a start whose suite, simulator or policy commitment differs. A run whose `manifest.world` is not the paid simulator is reported `interrupted`. Job 001 predates this and carries the legacy suite id `cut-in-v1`, which cannot start.

`FAULTLINE_CHAIN_SIGNER` names the `.env` key that signs Galileo txs for paid runs: `PRIVATE_KEY` (default) or `STUDIO_PRIVATE_KEY` (what job 001 used). The runner stops if the named key is unset.

## How to reproduce end to end

From the repository root, with `.env` filled (Hedera payer/merchant, `ZG_*`, `RPC_URL`, `STORAGE_INDEXER`, the chain signer, `FAULTLINE_TENANT_KEY`) and, for CARLA, a CARLA 0.10 server with Town10HD_Opt on 127.0.0.1:2000:

```bash
P=0x$(sha256sum faultline/ego/pdm_lite.py | cut -d' ' -f1)       # policy commitment
SUITE=cut-in-v1-carla                                            # or cut-in-v1-kinematic
npm run hedera:serve &                                           # service on 127.0.0.1:8787
curl -s http://127.0.0.1:8787/.well-known/faultline-service.json # both suites advertised
npm run hedera:buy -- $P $SUITE                                  # pays 0.001 testnet HBAR; prints jobId + permit (keep private)
# on HTTP 503 at activation: npm run hedera:recover -- .faultline-hedera-state/activation-<tx>.json  (no second payment)
npm run hedera:run -- <jobId> <permit> $P $SUITE                 # one start; runs, anchors, publishes, reports
curl -s -H "authorization: Bearer <permit>" http://127.0.0.1:8787/v1/stress-tests/<jobId>
curl -s -XPOST -H "authorization: Bearer <permit>" -H 'content-type: application/json' \
  -d "{\"suite\":\"$SUITE\",\"simulator\":\"carla-0.10.0-cut-in\",\"policyCommitment\":\"$P\"}" \
  http://127.0.0.1:8787/v1/stress-tests/<jobId>/start             # second start: 409 (simulator: kinematic-cut-in for the kinematic suite)
.venv/bin/python -m faultline replay <outputDirectory> --world carla   # or --world kinematic
npm run faultline -- verify <publicRoot> --sealed <sealedRoot> --key env   # or --key env:OTHER_KEY_NAME
npm run fweb:build && node apps/faultline-web/test/headless.mjs --root <publicRoot>
kill %1
```

CARLA runs take the flock `/tmp/faultline-carla.lock`, so a paid run waits while another CARLA job holds the server. Evidence: [paid job 002 (CARLA)](../../docs/evidence/faultline-paid-job-002-carla.md).
