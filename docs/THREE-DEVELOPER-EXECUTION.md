# Three-developer execution charter

This document assigns the complete SealedAI hackathon MVP to three developers. It covers T01–T11 and T13–T14 in
`docs/TASKS.md`; T00 is already confirmed and T12 is deferred. It is an ownership and handoff document, not a new
product specification. `docs/PLAN.md`, `docs/SECURITY.md`, and `docs/PROTOCOL.md` remain authoritative for behavior,
claims, and wire formats. The phase plans still define implementation steps and acceptance tests; this charter
supersedes their file-owner assumptions where work crosses people.

## 1. Starting point and non-negotiable constraints

The repository currently has the confirmed architecture, protocol, tracker, a phase-one plan, and four exploratory
examples. It does **not** yet have the worker, client, ML plane, contracts, CLI, or web app. Each developer should
build against the other developers' published interfaces and test fixtures as though those components already
exist. No one needs to wait for another component's implementation to start their own tests.

- The seller asset is a real, allowlisted `safetensors` model bundle. Buyer rows and seller weights meet only inside
  the verified worker. The planner gets the public card, buyer-approved goal, numeric summary, and rounded aggregate
  metrics; it never gets rows or weights.
- Both parties verify the worker independently and release keys for the same manifest. No real evidence means no key
  release. Synthetic data, scripted LLM replies, and recorded responses are **test fixtures only**, never a product
  mock mode or acceptable confidential-run evidence.
- The LLM proposes enumerated training recipes; deterministic code enforces policy and budgets. The holdout is
  evaluated once, after the planner finishes. The MVP returns an encrypted report and label-only hosted inference.
- There is no platform backend. Client code runs locally or in the static web app. Shared secrets do not go into
  logs, commits, Arkiv, the chain, or Router prompts.
- Use exact dependency pins and the repository's pinned upstream revisions. Obtain the user's go-ahead before
  downloaded install scripts, model downloads requiring approval, testnet/cloud spend, or publication.

## 2. Ownership map and task accounting

One person edits each path. Tests and fixtures follow the same owner as the implementation. Person 2 owns root
dependency files and the task tracker; Persons 1 and 3 send exact dependency requests and evidence summaries to
Person 2 rather than editing those files concurrently. Each person can use a separate branch or worktree and
integrate at the gates in §7.

| Owner | Exclusive paths | Accountable work |
|---|---|---|
| **Person 1 — customization engine** | `packages/planner/**`, `worker/ml/**`, planner/ML tests and fixtures, `examples/08-agent-live-recorded.ts` except the imported Router adapter | T13, planner/policy part of T02A, T02B, Python crypto half of T06 |
| **Person 2 — protocol and sealed worker** | `packages/protocol/**`, `packages/worker/**`, `worker/image/**`, `packages/integrations/src/router.ts` and its tests, Router examples, root `package.json`/lockfile/TypeScript config, `scripts/setup.sh`, `docs/evidence/runtime.json`, `docs/TASKS.md` | T01 coordination and hardware, envelope/core protocol part of T06, Router part of T02A, T08, T04, worker receipt generation in T05, runtime side of T02 |
| **Person 3 — contracts and product client** | `contracts/**`, `packages/client/**`, Storage/Chain/Arkiv adapters and tests, `apps/**`, client/Storage/Arkiv examples, README, LICENSE, `/arkiv/**`, demo/submission assets | T03, vault/Storage/client part of T06, T14, client receipt acceptance in T05, T07, T09, T10, T11 |

Cross-cutting tracker IDs have a single completion gate even though their code is split: T06 needs Person 1's
Python compatibility test, Person 2's envelope/vector test, and Person 3's vault/Storage round trip; T05 needs
Person 2's receipt and Person 3's independent acceptance check; T02 needs Person 2's real runtime and Person 3's
seller and buyer verifiers. Person 2 marks a task `done` only after all owners supply the tracker evidence. No owner
changes another person's implementation to make an integration test pass; report the failing input and expected
output to the owner.

T01 starts immediately: Person 2 owns root setup, pins, hardware questions, the image build and runtime evidence;
Person 1 owns the Python dependency lock and CPU/GPU ML timing evidence; Person 3 owns the Arkiv create/query probe
and the local Foundry setup. Person 2 records their results together in `docs/evidence/runtime.json`.

## 3. Interface freeze and fixture rules

Before implementation diverges, freeze these three boundaries using the existing protocol and phase-one plan:

| Producer | Consumer | What the consumer may assume |
|---|---|---|
| Person 1 | Person 2 worker | `Recipe`, `Metrics`, `Budgets`, `Trainer`, and `runCustomization` have the TypeScript signatures in the phase-one plan. The trainer's `baseline`, `train`, `holdout`, and `predict` operations are available through a local JSON-lines pipe; the ML process has no sockets. |
| Person 2 | Persons 1 and 3 | `Llm.next(messages)` returns `{text, requestId}` or a typed private-tier-unavailable error. Protocol exports match `docs/PROTOCOL.md`. The worker implements exactly the HTTP paths in Protocol §6, with encrypted/signed bodies and recipient-encrypted replies. |
| Person 3 | Person 2 worker | The escrow ABI is the pinned ERC-8183 reference plus `ERC8183WithAuthorization`; `jobId` is paired with chain and escrow; chain reads expose the exact on-chain job state, price, token and parties. |

Person 3 uses Person 1's policy/catalog exports for the buyer's pre-run plan approval, Person 2's Router adapter for
the pre-run private-tier call, and Person 2's protocol exports for Offer and manifest signing. Person 2 consumes
Person 1's `Trainer` and planner; it does not import the Python internals. Person 1 never has to know how the
worker's HTTP or escrow logic is implemented.

The following values are **synthetic fixture values**, not protocol changes or measured model performance:

```text
Task: text-classification; labels: [red, blue, green]; 2,000 generated rows
Split: 1,200 train / 400 validation / 400 locked holdout
Public card: allowlisted DistilBERT architecture; allowed LoRA targets from the test bundle
Goal: "Improve macro-F1 while staying within two training runs"
Baseline validation macro-F1: 0.70
Run 1 validation macro-F1: 0.66 (overfit); run 2: 0.75 (recipe changes after feedback)
```

Every owner keeps fixtures under test directories or explicitly labelled examples. A production build cannot
select a fixture verifier, bypass evidence checks, release keys on synthetic evidence, or generate a receipt that a
client accepts as a confidential run. Fixture IDs use a visible `synthetic-` prefix. The shared scenario is for
contract tests; real ML tests calculate their own metrics and must not assert these particular fixture numbers.

## 4. Person 1 brief — customization engine

### What to build, in order

1. Build the Python `hf-safetensors/v1` loader for the allowlisted architectures and bundle files. Check actual
   tensor headers and parameter count; reject pickle/`.bin`/`.pt`/`.pkl`, `auto_map`, remote code, unknown files,
   and mismatched cards. Use `trust_remote_code=False`.
2. Implement the seeded 60/20/20 split, validation and holdout separation, baseline evaluation, LoRA and
   head-only training, accuracy and macro-F1, GPU-seconds metering, budget interruption, and label-only prediction.
   Hide the holdout behind a lock until `finish`.
3. Implement the versioned recipe catalog, strict JSON policy gate, planner prompts, and bounded loop. Catalog
   enums, tool names and return values come from Protocol §7 and the phase-one plan. Reject extra keys and string
   numbers; do not coerce. Record invalid proposals and failures in the hash-chained timeline.
4. Connect the planner to the Python ML plane through `Trainer`. The control plane uses a local JSON-lines child
   process; request operations are `baseline`, `train`, `holdout`, `predict`, and every response is either a typed
   success or error. The `Trainer` adapter translates these into the published TypeScript interface. No ML network
   access is needed.
5. Implement the Python ECIES and AES-GCM reader against Person 2's fixed vectors. Ship the scripted/recorded
   agent-loop example with request IDs visibly labelled as test data.

### Black-box inputs and outputs

Person 1 receives a public card, buyer-approved goal, `DataSummary`, budgets, and an `Llm` implementation. The
Router adapter and wallet/worker internals are opaque. A fake `Llm.next()` can return:

```ts
{
  text: '{"tool":"propose_recipe","args":{"method":"lora","lora":{"r":16,"alpha":32,"dropout":0.1,"targets":["q_lin","v_lin"]},"optim":{"lr":0.0002,"epochs":2,"batch":8,"warmup":0.06},"classWeights":"none","maxLen":128}}',
  requestId: 'synthetic-request-1'
}
```

A recorded `Trainer.baseline()` may return `{valLoss: 0.68, valAccuracy: 0.72, valMacroF1: 0.70}`. A recorded
`Trainer.train(recipe, "run-1", 600)` may return `{metrics: {trainLoss: 0.31, valLoss: 0.74, valAccuracy: 0.68,
valMacroF1: 0.66}, gpuSeconds: 94}`. `runCustomization` returns baseline, at most two runs with their recipes and
request IDs, selected checkpoint, exactly one holdout result, stop reason, and timeline. The next proposal must
change after seeing run 1's worse validation metric; it cannot read holdout metrics.

### Good looks like

- T13 loader, train/eval, determinism (macro-F1 within ±0.01 over three seeded runs), budget-stop, label-only
  prediction, and no-network tests pass on synthetic data.
- T02A tests reject unknown tools, out-of-enum values, extra fields, wrong types, disallowed targets, prompt
  injection, a third run, and each exhausted budget. A Router 503 ends with `PLANNER_UNAVAILABLE` and the best
  validation checkpoint.
- T02B runs baseline → up to two agent-chosen trainings → freeze → one holdout, preserving failed attempts in
  report/timeline data. `Trainer` can be consumed by Person 2 without importing the ML implementation.
- The owner hands over the interface exports, representative success/error fixtures, exact test commands and
  passing summaries. The model and dataset fixtures contain synthetic data only.

## 5. Person 2 brief — protocol, worker, and runtime

### What to build, in order

1. Set up Node 22 workspaces, exact pins, TypeScript configuration and reproducible install. Define protocol
   exports from Protocol §§1–5 and §§8–9: identifiers, canonical hashing/EIP-712, encrypted object envelope,
   chunk manifest, Offer, JobManifest, KeyRelease, receipt and timeline types. Generate fixed TS encryption vectors
   for Persons 1 and 3. Do not use the 0G Storage SDK encryption option.
2. Implement `routerLlm` with private-tier headers and a private-only key. Require nonempty content and request
   ID; a private-tier 503 stops without another-tier retry. Make canary tests prove no buyer rows, seller weights,
   or other asset bytes enter Router payloads. Update the private-only Router example.
3. Implement worker HTTP Protocol §6: public identity/challenge; buyer manifest validation and worker-signed escrow
   authorizations; signed, timestamped, nonce-protected encrypted releases; run only after both roles release for
   the same manifest and the exact escrow job is Funded; encrypted timeline/result; bounded inference and optional
   adapter export only when licensed. Keys remain memory-only. A restart ends the job/license.
4. Wire Person 1's planner and `Trainer` to the worker. Build the hash-chained timeline, encrypted report, worker
   receipt, and `SubmitAuthorization`. Archive the evidence bytes needed for later client verification. Do not
   treat the LLM's output as signing, spending, key-release, or file/network authority.
5. Build the reviewed image from the pinned Python and TS locks. Resolve H1/H2/H3/H4 feasibility, select the
   NVIDIA GPU verifier with a source, obtain the selected route's real quote/report/certificate, record image
   digest, and coordinate G-RT with Person 3. The worker exposes no SSH, exec, debug or owner-chat path.

### Black-box inputs and outputs

Person 2 receives Person 1's `Trainer` and planner exports and Person 3's escrow ABI/job-state reader. For local
tests, use a synthetic Offer with fixed price, token, image digest, evidence policy and `offerHash`, plus a matching
JobManifest with buyer, seller, worker, budgets, `jobId` and `manifestHash`. The illustrative behavior is:

```text
POST /v1/manifest + matching signed Offer/manifest
  -> worker-signed setBudget and setPayoutReceiver authorizations
POST /v1/release + seller's manifest-bound model key
POST /v1/release + buyer's manifest-bound data/Router keys
POST /v1/run + exact Funded escrow job -> starts customization
GET /v1/timeline -> encrypted timeline events
GET /v1/result -> report root, WorkerReceipt, signed SubmitAuthorization
```

This is a test flow description, **not plaintext HTTP wire format**: real bodies and replies follow Protocol §6.
A mismatched price, token, image, policy, job, signer, manifest hash, or conflicting second release fails. A local
fixture can simulate a Funded chain read for state-machine tests; only a real chain read and real verified evidence
may participate in the confidential end-to-end run.

### Good looks like

- T06 tamper, wrong-key, wrong-header, truncation, reorder and three-chunk round-trip tests pass; TS vectors open
  in Python and Python vectors open in TS. T08 private-tier and canary tests pass.
- T04 rejects wrong party, stale/replayed requests, mismatched terms, invalid or duplicate releases, and unfunded
  jobs. `/v1/infer` observes call limits; restart leaves no usable keys.
- T05 receipt creation commits to the manifest, job, evidence, runtime, report and timeline head so Person 3 can
  independently reject any mismatch.
- T01 records exact dependency pins, image digest, hardware answers, Router request ID and Arkiv probe evidence.
  T02's real runtime passes both clients' G-RT checks; a host capture contains ciphertext only.

## 6. Person 3 brief — contracts, client, and product

### What to build, in order

1. Reuse the pinned ERC-8183 reference and `ERC8183WithAuthorization` in Foundry. Deploy with atomic proxy init,
   allow the payment token, then renounce both admin roles. Test worker/provider authorizations, seller payout,
   reject/refund, Funded expiry, Submitted grace boundary, replay, and post-renounce privilege denial. Supply ABI
   and deployed addresses to Person 2; testnet deployment awaits the user's go-ahead.
2. Implement the local vault and recovery flow, deterministic bundle packing, client-side AES-GCM sealing,
   verified 0G Storage upload/download, seller Offer/listing, buyer dataset sealing, numeric summary, goal and
   plan approval, manifest signing, funding and authorization relay. Use Person 2's protocol types and Person 1's
   policy exports; do not duplicate EIP-712 or recipe definitions.
3. Implement evidence verification independently in seller and buyer clients. Challenge the worker with each
   party's fresh nonce, validate quote/certificate, image digest, report-data/key binding, freshness, and required
   GPU reports before showing or enabling release. Implement receipt/report acceptance against the manifest,
   chain, escrow, domain, worker key, evidence, runtime, image and timeline head.
4. Implement Arkiv create/query and browse/score rules. Verify creator, Offer signature, version, chain and
   expiry. Keep scores labelled “buyer-reported”; add a worker-signed badge only for a Completed matching job and
   verifying receipt. Render strings as text and paginate beyond 100 results.
5. Build the CLI end-to-end path first. Once T09 passes on real TEE hardware, build the static web flow, CROPS
   failure demonstration, README/setup, license, `/arkiv/*.md` and submission materials for the user's review.

### Black-box inputs and outputs

Person 3 consumes Person 2's worker API and protocol exports and Person 1's planner/policy interface. A synthetic
Arkiv listing fixture follows Protocol §10 and has a signed Offer, valid creator, correct chain and future expiry;
the browse view displays it. Change any of those properties and the view excludes it.

A recorded worker identity fixture with an invalid GPU report must produce `verification failed` and **zero**
`/v1/release` calls. A test-only verifier stub may exercise later UI screens with a recorded worker response, but is
excluded from production builds. A report/receipt fixture whose `timelineHead` or `evidenceHash` differs from the
manifest is rejected before submission or a score badge. In production, the client's actual verifier determines
key release; a worker-supplied “verified” boolean is never evidence.

### Good looks like

- T03 Foundry adversarial tests and role-event replay pass. T06 vault recovery works on a fresh device; wrong
  passphrase and tampered storage objects fail closed.
- T14 negative fixtures reject debug-on, stale, wrong nonce, wrong image, unverified GPU, swapped key and bad
  certificate/registry state. Production builds have no test-evidence acceptance path.
- T07 creates and queries a real listing and records entity key/transaction; score provenance is honest. T09
  completes the real seller-to-buyer CLI path, including two-party release, feedback-driven training, one holdout,
  settlement and three inference calls; a second stopped-worker run refunds after expiry, and restart does not
  double-fund.
- T10 builds from a fresh clone, works in a real browser without a platform backend, supports an RPC swap, and
  fails honestly when Router or TEE hosting is unavailable. T11 includes setup, limitations, evidence and pins;
  forms and publishing await user review.

## 7. Integration gates and manager checklist

| Gate | Required result | Owner of evidence |
|---|---|---|
| **A — interface freeze** | Protocol and planner exports compile; test fixtures implement each boundary; pinned escrow ABI is available. No consumer imports another owner's private implementation. | Person 2 records, all three sign off |
| **B — independent local work** | Local T13, T02A, T03 and T06 tests pass with synthetic data/local contracts. Person 2 can consume `Trainer`; Person 3 can consume the worker API through a recorded transport. Live checks remain open. | Each owner supplies test command and summary |
| **C — joined local flow** | T02B, T04, T05, T06, T07 and T08 pass, including their required live 0G/Arkiv/Router checks; wrong inputs fail at each boundary; synthetic artifacts remain visibly test-only. | Person 2 records cross-owner results |
| **D — confidential runtime** | T01 hardware route and T14 verifier are evidenced; the seller and buyer independently challenge and verify the same worker; T02 G-RT negative cases fail closed. | Person 2 runtime + Person 3 client evidence |
| **E — product and submission** | T09 CLI happy/refund paths, T10 browser/CROPS checks and T11 handoff pass with IDs, roots, addresses, digest and limitations recorded. | Person 3 assembles, Person 2 updates tracker |

For each gate, review the producer's tests, the consumer's contract tests, and the actual evidence. A passing unit
test on synthetic data is not a confidential-run claim. The manager only closes a tracker item when every
acceptance box and evidence field is complete; unverified hardware, an unavailable private tier, or missing real
receipts keep the corresponding gate open. Product/security decisions discovered to be wrong go into the tracker
change log and are raised to the user before implementing a different behavior.
