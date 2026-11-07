# Faultline × CARLA × Hedera: teammate handoff

Updated 2026-11-07. This is the working handoff for the teammate connecting CARLA to the paid Faultline workflow. Read the repo's `CLAUDE.md` and the current Faultline plans before changing simulation or 0G code. Preserve your ongoing CARLA work when applying these changes in the new repository.

## What already works

- A company-side client discovers the `cut-in-v1` service, checks a fixed merchant and 0.001 HBAR spending cap, receives an x402 quote, and pays on Hedera testnet without manual approval.
- The service confirms the transfer through Hedera Mirror Node, verifies a signature from the payer's ECDSA account, binds one payment transaction to one job, and issues a private permit. Activation can be retried from a saved local JSON file without another payment if Mirror Node is temporarily unavailable.
- The local runner consumes the permit once, checks a commitment to the built-in kinematic IDM ego, executes the 0G cut-in episode, commits and finalizes on 0G Galileo, publishes public and sealed evidence to 0G Storage, and reports status through the job API. The historical paid run used a PDM-Lite file hash despite running IDM; this was corrected in the HCS receipt follow-up.
- A real 0.001 HBAR paid job completed using the **kinematic** cut-in world: 10/10 decisions came from 0G, both Storage roots verified, the Galileo finalization matched on chain, and deterministic replay matched all 240 ticks. A second start returned HTTP 409. See `docs/evidence/faultline-paid-job-001.md` for transaction IDs, roots, and precise verification results.

The verified payment is already spent and its permit is consumed. Do not reuse it for the CARLA run or claim that CARLA has been tested end to end.

## Relevant code

| Area | File or entry point |
| --- | --- |
| Paid service and job API | `packages/hedera/src/paid-ping-server.ts` |
| Buyer and activation recovery | `packages/hedera/src/buy-stress-test.ts`, `retry-activation.ts` |
| One-run permit and durable local job state | `packages/hedera/src/job-store.ts` |
| Local paid runner adapter | `packages/hedera/src/run-paid-job.ts` |
| Buyer spending checks | `packages/hedera/src/spending-policy.ts` |
| Faultline command and 0G publish/finalize sequence | `faultline/cli.py` |
| CARLA cut-in world and ego | `faultline/carla_cutin.py`, `faultline/carla_world.py`, `faultline/ego/pdm_lite.py` |
| Evidence verifier | `packages/episode/src/verify.ts`, `packages/episode/src/tee.ts` |
| Paid evidence binding and HCS delivery | `packages/hedera/src/delivery-receipt.ts`, `faultline/cli.py`, `packages/episode/src/onchain.ts` |
| Usage and observed evidence | `packages/hedera/README.md`, `docs/evidence/faultline-paid-job-001.md` |

The service exposes `GET /.well-known/faultline-service.json`, paid `POST /v1/stress-tests`, `POST /v1/stress-tests/activate`, permit-protected `POST /v1/stress-tests/:jobId/start`, `POST /v1/stress-tests/:jobId/report`, and `GET /v1/stress-tests/:jobId`. The response format is ready for a dashboard. No dashboard has been connected yet.

## CARLA integration task

1. Merge these files into the new repository only after comparing them with its current CARLA work. Keep the new repository's simulator changes if they are newer. Do not replace whole directories blindly.
2. Make `run-paid-job.ts` select the simulator through an explicit, allowlisted suite or world setting. It currently hardcodes `--world kinematic --family cut_in --decider 0g --anchor`, and the server verifier enforces manifest `world=kinematic-cut-in`. A CARLA purchase needs a distinct suite/version in the request, permit, manifest binding, verifier, and runner command; a kinematic payment must not silently authorize CARLA. Keep `maxRuns: 1` and the policy commitment check.
3. Confirm CARLA 0.10 and `Town10HD_Opt` are available. The cut-in world checks road 7, lanes −2 and −1, a 3.5 m lane width, vehicle blueprints, LiDAR, and collision sensors. It runs PDM-Lite on the ego using proprioception and LiDAR tracks; ground truth is only for metrics. Coordinate CARLA ports and server lifecycle with your current setup.
4. Validate CARLA locally without paying first: run a bounded `faultline run --world carla --family cut_in` with the desired 0G/anchor settings and a fresh output directory. Use `.venv/bin/python`, since the system Python lacked `requests` in our environment. The CLI now calls the installed Node 22 `npm` directly for 0G commands because sourcing `nvm` failed against the user's npm prefix.
5. For the paid CARLA run, start the service, buy a fresh capped job, consume its permit once, and inspect the returned report. Run CARLA replay (`.venv/bin/python -m faultline replay <run-dir> --world carla`) and the 0G root verifier. Record the Hedera transaction, job ID, request IDs, public/sealed roots, Galileo commit/finalize transactions, replay status, and any interruption reason.
6. The repo's `.env` must provide Hedera payer/merchant settings, `ZG_ROUTER_URL`, `ZG_API_KEY`, `RPC_URL`, `STORAGE_INDEXER`, `FAULTLINE_TENANT_KEY`, and an authorized 0G chain signer. Do not print or commit secrets. The runner currently falls back to `STUDIO_PRIVATE_KEY` when `PRIVATE_KEY` is empty; replace this with an explicit deployment setting before multi-user use.

## Failure behavior to preserve and improve

- The first paid activation returned HTTP 503 because Mirror Node was temporarily unavailable. The transfer **had settled**. The buyer now saves the signed activation payload under `.faultline-hedera-state/`, and `npm run hedera:recover -- <file>` retries it without a second payment. Surface this as “payment settled, activation pending” in the dashboard.
- A run permit can start one job. A completed job cannot start again. The local demo required an operator to reset a job that had failed before any simulator decision or Galileo anchor. Build a documented pre-start recovery/refund path before production; do not allow unlimited client-declared retries after execution begins.
- `.faultline-hedera-state/` is a private single-process JSON store containing jobs and a permit signing secret. Use transactional storage and safe concurrency for multiple service replicas. Keep activation files and permits private.
- The report is submitted by the customer's local runner. Hedera proves payment settlement, while 0G roots and replay support evidence checks. The current 0G signature format is `zg-sig-v1/e2ee-ct:...`; signer recovery succeeds against the chain record, but this check does not independently bind ciphertext hashes to the published plaintext response. Describe these claims separately.
- The current policy commitment is checked against the built-in kinematic IDM source. For CARLA, bind PDM-Lite or the company's exact versioned artifact and ensure the runner loads that artifact. The merchant must never receive policy bytes or private keys. The paid binding is now included in the public evidence and Galileo config hash, but it is still the runner's assertion about which code executed; remote execution attestation is not implemented.
- The server checks the downloaded 0G public root, metrics, paid binding, and Galileo finalization before posting an HCS delivery receipt. HCS uses a merchant-controlled account and a topic with an operator submit key. Topic creation and submission spend testnet HBAR. A timed-out submission is marked `uncertain`; reconcile through Mirror Node before any retry.

## Repository transfer status

The destination is `Soni-Shivam/Pivot_HTE`. This handoff and the Hedera integration were added on branch `feature/hedera-paid-faultline`, created from the destination's `main` at `2580e1e`. Its newer CARLA/swarm code and signature verifier were preserved. The original checkout remains `build/faultline` under `Soni-Shivam/eth_hackathon` with its uncommitted work intact. Review and merge the feature branch into `main` after checking your CARLA changes; do not force-push over them.
