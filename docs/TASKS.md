# Task tracker (revision 3)

Spec: `docs/PLAN.md` · Security: `docs/SECURITY.md` · Formats: `docs/PROTOCOL.md` · Step plans: `docs/superpowers/plans/`.
IDs T00–T12 follow the PR #1 review; T13–T14 were added in revision 3.

## Rules for agents (also in CLAUDE.md)
1. Take the first `todo` whose **Needs** are all `done`; mark it `doing` and add your session name. In the
   three-developer parallel workflow, take the first ready item in your lane in `THREE-DEVELOPER-EXECUTION.md`;
   Person 2 coordinates status and evidence for cross-cutting items.
2. `done` requires **Evidence** a stranger can check (a test command plus its passing summary line, tx hash,
   address, 0G root, request ID, entity key, image digest) and every acceptance box ticked, or marked `n/a` with a
   reason the user approved.
3. Never call unverified hardware an enclave, a request ID an attestation, or a synthetic-data test a confidential run.
4. A scope change → stop, add a change-log line, tell the user. Never mark T00 yourself.
5. Never paste `.env` values. No spending (testnet or cloud), installs of downloaded scripts, publishing, pushing or
   posting without the user's go-ahead.

Tags: **[S]** done with synthetic data on dev hardware (tests only, never acceptable artifacts) · **[C]** needs real
TEE hardware that passed G-RT.

## T00 · Final confirmation. Needs: none. Status: `done`
The user confirms PLAN rev 3 and picks choices A (hardware + budget), B (formats), C (deliverable), D (dev models).
Evidence: user, 2026-11-06: "Confirm as recommended" (choices A–D per PLAN §2 recommendations).

## T01 · Dependencies and hardware answers. Needs: T00. Status: `todo`
Acceptance:
- [ ] Exact pins installed; `npm ci` reproducible on a fresh clone; `scripts/setup.sh` restores `.0g-skills@04b5a42`.
- [ ] Worker image lockfile (Python: torch, transformers, peft, safetensors; locked by uv in worker/ml/uv.lock) builds reproducibly; digest recorded.
- [ ] Hardware: written answers or quota results for H1 (0G), H2 (GCP `a3-highgpu-1g` confidential quota, zone),
      H3 (Phala), and the H4 CPU training-time estimate for distilbert on 5k synthetic rows.
- [ ] NVIDIA GPU attestation verifier chosen (NRAS or local), with a doc reference.
- [ ] Live Arkiv create + query; a private-tier Router call with request ID and `x_0g_trace`.
Evidence: `docs/evidence/runtime.json`.

## T13 · ML plane: safe loader, LoRA trainer, evaluator, server [S]. Needs: T00. Status: `todo`
Acceptance (RTX A5000, synthetic data, choice-D models):
- [ ] The loader accepts an allowlisted safetensors bundle; rejects `.bin`/`.pkl`, `auto_map`/remote code, files
      outside the list, unknown architectures, and a parameter count off the card by > 1 %.
- [ ] `text-classification`: baseline eval; LoRA and head-only training for each catalog value; macro-F1 on val.
- [ ] Determinism: the same seed and recipe reproduce val macro-F1 within ±0.01 over 3 runs.
- [ ] GPU-seconds metered; a run exceeding its budget is stopped and reported.
- [ ] The ML process has no network (a test asserts outbound connects fail inside its namespace or the image's run config).

## T02A · Customization agent + policy gate [S]. Needs: T00. Status: `todo`
Acceptance (scripted LLM + a recorded-metrics executor; then the real Router once):
- [ ] A decision that changes after a validation observation (run 1 overfits, so run 2 differs).
- [ ] Unknown tool, unknown recipe value, out-of-enum and wrong-type params are each rejected and logged.
- [ ] Injected instructions in the card or metrics don't change what the gate allows.
- [ ] Stops on each budget: planner calls, GPU-seconds, wall clock, 2 runs.
- [ ] Router 503 → `PLANNER_UNAVAILABLE`, no request at another tier.
- [ ] Holdout unreachable before `finish`.

## T02B · Full loop on the ML plane [S]. Needs: T02A, T13. Status: `todo`
Acceptance:
- [ ] Baseline → ≤ 2 trainings chosen by the agent → freeze → holdout exactly once, on synthetic data.
- [ ] Failed runs and invalid outputs stay visible in the report and denominators.
- [ ] `/v1/infer` (via the ML server) returns only labels from the label set.

## T03 · Escrow: pinned contracts, deploy + renounce, adversarial tests. Needs: T01. Status: `todo`
Acceptance (Foundry, local): buyer `setBudget` reverts; only the worker can `setBudget` / `setPayoutReceiver` /
`submit`; payout receiver locked after funding; wrong token or budget at `fund` reverts; payout to the seller with
exact conservation; Funded→Expired refund after `expiredAt` by an outsider; the Submitted grace boundary (+1 h);
seller reject → refund; authorization replay and expired deadline revert; atomic proxy init, unpaused, token allowed,
then both admin roles renounced, after which grant/pause/`emergencyWithdraw`/`upgradeToAndCall` all revert and a
role-event replay shows zero holders. The testnet deploy is a separate go-ahead.

## T06 · Envelope, vault, ECIES compatibility. Needs: T00. Status: `todo`
Acceptance: a real 0G round trip; wrong key, bit flip, header change and truncation each throw; chunked model
bundles (≥ 3 chunks) round-trip; fresh-device recovery from file + passphrase; no signature-derived keys. (ECIES
compatibility dropped: only TS code does crypto; the Python ML plane receives plaintext inside the enclave via
tmpfs and a local pipe.)

## T14 · Evidence verifiers (client) [S→C]. Needs: T01. Status: `todo`
Acceptance: per runtime (PROTOCOL §9). The TDX quote verified with dcap-qvl against recorded real quotes (from the
TAPP repo or our first VM); `report_data` binding; nonce; image digest from the event log; GPU reports verified with
the chosen NVIDIA verifier; v3 certificate path for runtime 3. Negative fixtures (debug on, stale quote, wrong
nonce, wrong image, unverified GPU, swapped key) all reject. The production build contains no code path that accepts
unverified evidence (CI grep + build test, I12).

## T04 · Worker control plane. Needs: T03, T06, T02B. Status: `todo`
Acceptance: ECIES + signature + ts + nonce enforced; wrong-party, wrong-manifest, mismatched-hash and conflicting
releases rejected or aborting; `/v1/manifest` refuses a price/token/image/evidence-policy/expiry mismatch with the
Offer; `/v1/run` requires the exact Funded job on chain; `/v1/infer` call limit; restart = keys gone, license ended;
`/v1/adapter` only when the Offer allows.

## T02 · G-RT on real TEE hardware [C]. Needs: T04, T14, hardware from T01. Status: `todo`
Acceptance: the buyer client starts the worker; the **seller** client verifies it independently with its own nonce;
wrong image, stale quote, swapped key, unverified GPU report and replayed release each fail closed; no shell/exec
into the worker; a host-side capture shows only ciphertext; a canary string in the buyer data appears only inside
the sealed report; the ML process can't reach the network.

## T05 · Receipts and acceptance policy. Needs: T04. Status: `todo`
Acceptance: any mismatch in chain, escrow, domain, worker key, `evidenceHash`, runtime, image digest or timeline head
→ reject; evidence archived in the report; later re-verification uses the archived bytes and release-time freshness.

## T07 · Arkiv listings and honest scores. Needs: T01, T05. Status: `todo`
Acceptance: real create + query (keys, tx), writer wallets and one query in the README; wrong creator, expired, bad
offer signature and cross-chain collision are not shown; scores without a completed job and verifying receipt carry
no badge; pagination > 100; strings rendered as text.

## T08 · Router strict tier + fix example 03. Needs: T01. Status: `todo`
Acceptance: example 03 private-only (tier comparison split into a named diagnostic); simulated 503 → non-zero exit,
no other-tier request; empty, truncated or malformed replies and a missing request ID → counted as failed, never
dropped; a test asserts no Router payload contains dataset rows or weight bytes (canary scan of every outgoing body).

## T09 · End-to-end CLI run, confidential [C]. Needs: T02, T05, T07, T08. Status: `todo`
Acceptance: seller lists → buyer plans/approves → worker on TEE hardware → both clients verify → 2-of-2 release →
baseline + 2 agent-chosen trainings with one feedback-driven change → holdout → sealed report → submit → complete →
3 `/v1/infer` calls; a second run where the worker is stopped → refund after expiry; a client restart mid-run doesn't
double-fund; every evidence ID printed.

## T10 · Static web app + CROPS demo. Needs: T09. Status: `todo`
Acceptance: fresh clone → build → run; browse (Arkiv), goal → plan → approve → evidence check → release → timeline
with request IDs → report → use → refund; no trackers; the user brings their own Router key; our hosting removed and
an RPC swapped mid-demo; unavailable Router or TEE host fails honestly; tested in a real browser.

## T11 · Submission. Needs: T10. Status: `todo`
README (setup, CROPS section, plaintext-recipient table, limitations, evidence links, pins); LICENSE (MIT, matching
package.json); `/arkiv/*.md`; pre-event history disclosed; ≤ 3-min video; forms prepared for user review.

## T12 · Deferred
Seller-code executor (choice B2), `causal-lm-sft` task adapter, licensed clones, AgentDNA assets, ERC-8004 feedback,
self-paying agents, iAI sign-in, direct-to-TeeML-provider agent calls.

## Build status (2026-11-06, branch build/phase1)
- `done` T03: 24 forge tests; escrow `0x0E28A6Cb4A7B7De38Cc626E8E1E80A95cD0e070a`, admin renounced (docs/evidence/T03-*).
- `done` T06: envelope/chunks/vault tests; real 3-chunk 0G round trip (07-*).
- `done` T02A: 23 planner tests; live agent (08-*). `done` T13: 21 pytest (kernel netns skipped: AppArmor).
- `done` T02B: live agent + real LoRA (09-*). `done` T08: private-only Router (03, router tests).
- `done` T05: `acceptResult` (receipt signature, manifest/job/evidence binding, report commitment, timeline head,
  holdout metric, escrow state) exercised in examples/10.
- `done` T07: Arkiv listings with full re-verification; impostor hidden (11-*).
- `done` T09 as a TEST RUN: full transaction on testnet with a test-only verifier (10-*). Confidential T09 needs T02.
  Not yet run: the worker-failure → refund-after-expiry scenario.
- `done` T10: static web app, tested in headless Chromium (catalog, agent plan, verifier refusal).
- `done` T11 (docs part): README with CROPS, LICENSE (MIT), `/arkiv/*.md`, `.env.example`. Video and forms remain.
- `doing` T14: TAPP verifier tested on real Intel TDX quotes; NVIDIA GPU verifier and sealed-sandbox path missing
  (both reject); TAPP evidence provider in the worker missing.
- `blocked` T02: needs TEE hardware (0G-hosted or GCP `a3-highgpu-1g`) and a budget decision.
- `doing` T01: hardware answers from 0G / GCP quota (user).

## Change log
- 2026-11-06 rev 1: tracker created.
- 2026-11-06 rev 2: rebuilt after the PR #1 review; customization agent and two-party worker restored.
- 2026-11-06 rev 3: user decisions relayed by a side session: everything confidential, **no mock mode** (synthetic
  data allowed for tests), and the seller asset is a **real model trained inside the enclave**. Reverses rev-2 D1
  (config-only asset), the "no weight training" non-goal, and D2's config-only recipes. New D10: the Router sees
  aggregates only, fixing the rev-2 flaw where classifier calls carried seller templates and buyer text through the
  0G gateway. Added T13 (ML plane) and T14 (evidence verifiers); MOCK removed everywhere. Pending: T00 confirmation
  of choices A–D.
- 2026-11-06 build: `ERC8183WithAuthorization` is 27,574 bytes, over the EIP-170 limit 0G enforces (deploy reverted
  twice). We deploy the unchanged base `ERC8183` instead; the worker sends its own provider txs, and the buyer
  funds its gas. Deployed and verified on Galileo (`docs/evidence/T03-galileo-deploy.log`).
- 2026-11-06 build: the ML plane does no crypto (the control plane decrypts into enclave tmpfs), so eciespy and the
  TS↔Python ECIES compatibility test are removed.
- 2026-11-06 T00 done: the user confirmed rev 3 with the recommended choices: A = ask 0G for a hosted GPU TEE
  (H1) + request GCP `a3-highgpu-1g` confidential quota (H2) in parallel, budget set by the user before any spend,
  H4 for small models if CPU timing allows; B = B1 standard formats only; C = C1 hosted inference (C2 adapter export
  only if the Offer allows); D = distilbert-base-uncased + Qwen2.5-0.5B on synthetic data.
- 2026-11-06 scope change (PROPOSED, awaiting T00 rev 4): the user is pivoting to **Faultline**, a 0G-powered
  adversarial traffic agent for the ETHGlobal Physical AI track. Verified architecture and pipeline:
  `docs/superpowers/specs/2026-11-06-faultline-0g-architecture-design.md`. PLAN rev 3 (SealedAI) stays authoritative
  until the user approves; no product code changed.
- 2026-11-07 Faultline Task 10: `ethers` 6.13.1 is now also imported in `packages/episode/src/verify.ts` (the one
  exception the Faultline plan allows): the 0G Compute SDK needs an ethers wallet for `processResponse`; a random
  throwaway wallet on 0G mainnet RPC is used, no funds, no key stored.
