# Faultline paid stress tests on Hedera

Run `npm run hedera:serve` from the repository root. The service publishes its fixed-price `cut-in-v1` suite at `/.well-known/faultline-service.json` and quotes an x402 payment for `POST /v1/stress-tests`.

The buyer uses `npm run hedera:buy -- 0x<64-hex-policy-commitment>`. It reads discovery, enforces the configured merchant and 0.001 HBAR cap, pays once, and activates a job after the server confirms the settlement transfer through Hedera Mirror Node. The response includes a job ID and bearer permit. Keep the permit private.

If activation fails after payment, the buyer saves a private activation JSON file in `.faultline-hedera-state/`. Run `npm run hedera:recover -- <saved-file>` to retry activation without another transfer. The server checks settlement on Mirror Node, verifies a signature from the payer's Hedera ECDSA account, and refuses a transaction already bound to a different job.

On the customer's machine, run `npm run hedera:run -- <jobId> <permit> <same-policy-commitment>`. The server consumes the permit for one start. The adapter runs one local 0G-driven cut-in episode with Galileo anchoring, then posts the report. A dashboard can poll `GET /v1/stress-tests/<jobId>` with `Authorization: Bearer <permit>`.

The state directory `.faultline-hedera-state/` holds the job ledger and a local permit signing secret. Keep it persistent and private. This initial store is for a single server process; deploy a transactional database before running multiple replicas. The report is submitted by the customer's runner and should be described as such; Hedera verifies settlement, while the 0G evidence supports independent episode inspection.

The first paid endpoint check is recorded in [testnet payment evidence](../../docs/evidence/faultline-hedera-x402-testnet.md). The paid job, 0G run, and verification are recorded in [end-to-end evidence](../../docs/evidence/faultline-paid-job-001.md).
