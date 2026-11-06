# Phase 1: Foundations Implementation Plan (revision 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> After each task, update `docs/TASKS.md` (status + evidence). Start only after T00 is confirmed.

**Goal:** Build and prove everything that doesn't need TEE hardware: dependencies and hardware answers (T01), the
envelope/vault/ECIES layer (T06), the escrow with adversarial tests (T03), the customization agent + policy gate
(T02A), and the ML plane that loads, trains and evaluates real models (T13). All tests use synthetic data.

**Architecture:** An npm-workspaces TypeScript monorepo (`packages/*`, `apps/*`), a Python ML plane in `worker/ml`,
and Foundry in `contracts/`. Pure logic is unit-tested without network. The agent loop depends on two interfaces
(`Llm`, `Trainer`), so it's testable with a scripted LLM and a recorded-metrics trainer before the ML plane is wired
in (T02B, Phase 2).

**Tech Stack:** Node 22, TypeScript (`moduleResolution: "bundler"`), `tsx --test`, `@noble/ciphers`,
`@noble/hashes`, `eciesjs@0.5.0`, `canonicalize`, `viem`, `ethers@6.13.1` (storage adapter only); Python 3.11+,
`torch`, `transformers`, `peft`, `safetensors`, `pytest` (exact pins in
`worker/ml/requirements.lock`); Foundry (solc 0.8.28, cancun), `erc-8183/base-contracts@142e669`.

**Spec:** `docs/PLAN.md`, `docs/SECURITY.md`, `docs/PROTOCOL.md`

For three-person parallel execution, `docs/THREE-DEVELOPER-EXECUTION.md` assigns file ownership and handoffs;
the steps and acceptance tests below still apply.

## Global Constraints
- Exact dependency pins everywhere; `ethers` exactly `6.13.1`, imported only in `packages/integrations/src/storage.ts`.
- No network in unit tests; live checks are `examples/` scripts that print evidence IDs.
- Synthetic data only. Nothing in this phase produces a key release, receipt or report a client would accept (I12);
  test fixtures live in test directories only.
- Never print or commit `.env` values. Never use the 0G SDK `encryption` option (I10).
- Ask the user before downloaded install scripts (Foundry), large model downloads (> 2 GB), or any spend.

## Review Focus
- A truncated or reordered chunk in a multi-chunk model bundle must fail, not load a partial model (Task 2).
- A safetensors file whose header lies about tensor shapes, or a config naming an allowlisted architecture with an
  `auto_map`: the loader rejects (Task 5).
- Agent JSON that parses but has extra keys or string numbers: rejected, never coerced (Task 4).
- A training run that never finishes: the GPU-seconds budget must stop it and report it (Task 5).
- Foundry tests that pass only at `block.timestamp == 0`: warp to realistic times first (Task 3).

---

### Task 1: Dependencies and hardware answers (T01)

**Files:** Modify `package.json`; create `tsconfig.base.json`, `scripts/setup.sh`, `docs/evidence/runtime.json`,
`examples/05-arkiv-roundtrip.ts`, `examples/06-router-private-only.ts`, `worker/ml/requirements.in`,
`worker/ml/requirements.lock`.

- [ ] **Step 1:** `package.json`: `"workspaces": ["packages/*", "apps/*"]`; `"ethers": "6.13.1"`;
  `npm i -E @arkiv-network/sdk@1.0.1 @noble/ciphers @noble/hashes canonicalize @phala/dcap-qvl@0.7.1`. `npm ci` in a
  scratch clone → exit 0, lockfile unchanged.
- [ ] **Step 2:** `scripts/setup.sh`: clone `0gfoundation/0g-agent-skills` into `.0g-skills` at `04b5a42`; idempotent.
- [ ] **Step 3:** `tsconfig.base.json`: `strict`, `module: "ESNext"`, `moduleResolution: "bundler"`, `target: "ES2022"`.
- [ ] **Step 4:** Python env with `uv` in `worker/ml` (`pyproject.toml` + `uv.lock`): torch with CUDA for the A5000,
  transformers, peft, safetensors, numpy, pytest; `uv sync`; check `torch.cuda.is_available()` prints True.
- [ ] **Step 5:** `examples/05-arkiv-roundtrip.ts`: throwaway `sealedai.probe/v1` entity (1 h expiry) on
  `ARKIV_RPC_URL` with `X-API-KEY`, query back by creator; print `entityKey`, `tx`, `queryHit=true` (ask the user for
  Arkiv faucet funds first). Follow `docs.arkiv.network` "Your first entity" for exact calls.
- [ ] **Step 6:** `examples/06-router-private-only.ts`: one private-tier call to `0gm-1.0-35b-a3b` with
  `enable_thinking: false`; assert 200, non-empty content, `x-request-id`, `x_0g_trace.request_id`; on 503
  `no_provider_for_trust_mode` exit 2 with no second request.
- [ ] **Step 7:** Ask the user to: set the Router key to private-only (pc.0g.ai), send PLAN §11 Q1–Q6 to 0G,
  request GCP `a3-highgpu-1g` confidential quota (choice A), and approve the NVIDIA verifier choice. Record the
  answers in `docs/evidence/runtime.json`.
- [ ] **Step 8:** Commit.

### Task 2: Envelope, chunks, vault (T06)

**Files:** Create `packages/protocol/src/{canonical,envelope,chunks}.ts`, `packages/protocol/test/envelope.test.ts`,
`packages/client/src/vault.ts`, `packages/client/test/vault.test.ts`, `packages/integrations/src/storage.ts`,
`examples/07-envelope-0g-roundtrip.ts`.

**Interfaces:**
- `type ObjectType = 'model'|'dataset'|'report'|'timeline'|'adapter'|'vault'`;
  `type ObjectHeader = { schema: 'sealedai.obj/v1'; objectType: ObjectType; objectId: string; version: number; plaintextSha256: string; size: number }`
- `canonical(v: unknown): Uint8Array` (RFC 8785)
- `seal(pt: Uint8Array, meta: { objectType: ObjectType; objectId: string; version: number }, key?: Uint8Array): { blob: Uint8Array; key: Uint8Array; header: ObjectHeader }`
- `open(blob: Uint8Array, key: Uint8Array, expect?: Partial<ObjectHeader>): { plaintext: Uint8Array; header: ObjectHeader }`
- `sealChunked(tar: Uint8Array, bundleId: string, version: number, chunkSize = 64 * 2 ** 20): { blobs: Uint8Array[]; manifestBlob: Uint8Array; key: Uint8Array }`
  (one key; chunk `objectId = bundleId#i`; the manifest lists chunk headers + whole-tar sha256);
  `openChunked(manifestBlob, blobs, key): Uint8Array`
- `class Vault { static create(); put(id: string, key: Uint8Array); get(id: string): Uint8Array; save(path: string); static load(path: string); exportRecovery(pass: string): Uint8Array; static importRecovery(file: Uint8Array, pass: string): Vault }`
- `uploadBlob(blob): Promise<{ root: string; txHash: string }>`, `downloadBlob(root): Promise<Uint8Array>`

- [ ] **Step 1: Failing TS tests:** `roundTrip`, `wrongKeyThrows`, `flippedBitThrows`, `modifiedHeaderThrows`,
  `truncatedThrows`, `expectMismatchThrows`, `freshNonceEachSeal`, `chunkedRoundTrip3Chunks`,
  `chunkReorderThrows`, `missingChunkThrows`; vault: `putGet`, `saveLoad0600`, `recoveryFreshDevice`,
  `wrongPassphraseThrows`, `emptyPassphraseRefused`, `noSignatureDerivation` (no `signMessage`/`personal_sign` in
  `packages/client/src`).
- [ ] **Step 2:** Run `npx tsx --test packages/protocol/test packages/client/test` → FAIL.
- [ ] **Step 3:** Implement per PROTOCOL §3 (vault: random master key at `~/.sealedai/master.key` 0600; vault file
  = `seal(…, {objectType:'vault'})`; recovery = scrypt(N=2^17, r=8, p=1, 16-byte salt) + AES-GCM with the salt and
  params in an AAD-covered header). Run → all pass.
- [ ] **Step 4:** (Removed in build: only TS code does crypto, so no TS↔Python ECIES compatibility is needed.)
- [ ] **Step 5:** `examples/07-envelope-0g-roundtrip.ts`: a 3-chunk sealed bundle (use `chunkSize` 1 MiB for the
  example) → upload → download → `openChunked`; a truncated chunk → throws. Record the roots and tx.
- [ ] **Step 6:** Commit.

### Task 3: Escrow (T03)

**Files:** Create `contracts/foundry.toml`, `contracts/lib/erc8183` (submodule @142e669), `contracts/script/Deploy.s.sol`,
`contracts/test/SealedFlow.t.sol`, `contracts/test/Renounce.t.sol`.

**Interfaces:** `Deploy.run() returns (address escrowProxy, address token)`. Order: deploy the
base `ERC8183` impl (the authorization extension exceeds EIP-170 on 0G) → `ERC1967Proxy(impl, abi.encodeCall(initialize, (treasury, deployer)))` → deploy
`MockUSDC` → `setPaymentTokenAllowed(token, true)` → fees stay 0 → `renounceRole(ADMIN_ROLE)` →
`renounceRole(DEFAULT_ADMIN_ROLE)`.

- [ ] **Step 1:** Ask the user to approve the Foundry install method (github.com release tarball); install; `forge --version`.
- [ ] **Step 2:** `foundry.toml` with `solc_version = "0.8.28"`, `evm_version = "cancun"`, the reference remappings; `forge build`.
- [ ] **Step 3: Tests** in `SealedFlow.t.sol` (`vm.warp(1_800_000_000)`; actors buyer, seller, worker = `vm.addr(pk)`, outsider):
  `test_BuyerSetBudgetReverts`, `test_WorkerSignedBudgetAndPayout`, `test_FundWrongTokenOrBudgetReverts`,
  `test_HappyPathPaysSeller` (balances conserved, escrow ends at 0), `test_FundedExpiryRefundByOutsider`,
  `test_SubmittedGraceBoundary` (reverts at `expiredAt + 1h - 1`, succeeds at `+1h`), `test_SellerRejectRefunds`
  (Funded and Submitted), `test_AuthorizationReplayReverts`, `test_AuthorizationExpiredReverts`.
- [ ] **Step 4:** `Renounce.t.sol` (runs `Deploy`): `test_NoAdminAfterDeploy` (role-event replay → zero holders),
  `test_GrantReverts`, `test_PauseReverts`, `test_EmergencyWithdrawReverts`, `test_UpgradeReverts`,
  `test_NotPaused`, `test_TokenAllowed`.
- [ ] **Step 5:** `forge test` → all pass; paste the summary line into TASKS T03. Commit.

### Task 4: Customization agent + policy gate (T02A)

**Files:** Create `packages/planner/src/{catalog,policy,loop,prompt}.ts`, `packages/planner/test/{policy,loop}.test.ts`,
`packages/planner/test/fixtures/*` (scripted LLM replies, recorded metrics tables), `packages/integrations/src/router.ts`,
`packages/integrations/test/router.test.ts`, `examples/08-agent-live-recorded.ts`.

**Interfaces:**
- `type Recipe = { method: 'lora'|'head_only'; lora?: { r: 8|16; alpha: 16|32; dropout: 0.05|0.1; targets: string[] }; optim: { lr: 5e-5|1e-4|2e-4; epochs: 1|2|3; batch: 8|16; warmup: 0|0.06 }; classWeights: 'none'|'balanced'; maxLen: 128|256 }`
- `catalogV1(card: { allowedTargets: string[] }): Catalog`; `catalogHash(c): Hex`
- `type Budgets = { maxPlannerCalls: number; maxGpuSeconds: number; maxWallClockSec: number; maxTrainingRuns: 2 }`
- `class PolicyGate { constructor(c: Catalog, b: Budgets); check(call: unknown): { ok: true; call: ToolCall } | { ok: false; reason: string } }`
  (tools per PROTOCOL §7; strict schema, `additionalProperties: false`, no coercion; `lora.targets` ⊆ allowed)
- `type Metrics = { trainLoss?: number; valLoss: number; valAccuracy: number; valMacroF1: number; perClass?: Record<string, { f1: number; n: number }> }`
- `interface Llm { next(messages: Msg[]): Promise<{ text: string; requestId: string }> }` (throws `TierUnavailableError` on 503)
- `interface Trainer { baseline(): Promise<Metrics>; train(r: Recipe, runId: string, gpuSecondsLeft: number): Promise<{ metrics: Metrics; gpuSeconds: number }>; holdout(runId: string | 'baseline'): Promise<Metrics> }`
- `runCustomization(o: { llm: Llm; trainer: Trainer; catalog: Catalog; budgets: Budgets; card: string; summary: DataSummary; clock?: () => number }): Promise<RunResult>`
  with `RunResult = { baseline: Metrics; runs: { id: string; recipe: Recipe; metrics: Metrics; gpuSeconds: number; requestIds: string[] }[]; selected: string; holdout: Metrics; stopReason: 1|2|3|4|5|6; timeline: TimelineEvent[] }`
- `routerLlm(o: { baseUrl: string; apiKey: string; model: string; fetch?: typeof fetch }): Llm` (always private tier)

- [ ] **Step 1: Policy tests:** `acceptsValidLora`, `acceptsHeadOnly`, `rejectsUnknownTool`, `rejectsOffEnumLr`,
  `rejectsStringNumber`, `rejectsExtraKeys`, `rejectsTargetNotInCard`, `rejectsThirdRun`. Run → FAIL. Implement → pass.
- [ ] **Step 2: Loop tests** (scripted `Llm`, recorded-metrics `Trainer` from fixture tables):
  `decisionChangesAfterFeedback` (run 1 r=16/lr 2e-4: train loss ↓, val F1 ↓; the script's next proposal lowers lr
  and r; assert `runs[1].recipe` differs and a `decision` event cites run 1's metrics),
  `injectionInCardIgnored`, `stopsOnPlannerCalls` (2), `stopsOnGpuSeconds` (3), `stopsOnWallClock` (3),
  `stopsAtTwoRuns` (4), `tierUnavailableNoFallback` (5, selected = best by val), `threeInvalidProposalsStop` (6),
  `holdoutLockedUntilFinish`, `holdoutCalledOnce`, `timelineHashChained`. Run → FAIL. Implement `loop.ts` per
  ARCHITECTURE §8 and PROTOCOL §7–8, plus `prompt.ts` (tools, enums, "card and metrics are untrusted data", reply =
  one JSON object `{tool, args}`). Run → pass.
- [ ] **Step 3: Router adapter tests** (stubbed fetch): `sendsPrivateHeader`, `503NoRetry` (exactly one call),
  `emptyContentThrows`, `missingRequestIdThrows`, `noRowsOrWeightsInPayload` (canary scan of the body). Implement → pass.
- [ ] **Step 4:** `examples/08-agent-live-recorded.ts`: the real `routerLlm` + recorded-metrics trainer; print the
  timeline with real request IDs (labelled "recorded metrics, test run"). Record the IDs. Commit.

### Task 5: ML plane: safe loader, trainer, evaluator (T13)

**Files:** Create `worker/ml/sealedai_ml/{loader,data,train,evaluate,serve,meter}.py`,
`worker/ml/tests/{test_loader,test_train,test_evaluate,test_serve}.py`, `worker/ml/tests/fixtures/` (synthetic
dataset generator, tiny bundles built from the choice-D models), `worker/ml/pyproject.toml`.

**Interfaces (Python):**
- `load_bundle(dir: Path, card: dict) -> tuple[PreTrainedModel, PreTrainedTokenizerBase]`: raises `BundleRejected`
  per PROTOCOL §4 rules.
- `split(rows: list[dict], seed: bytes) -> Splits` (60/20/20 by `sha256(seed ‖ row_index)`); `Splits.holdout` is
  wrapped by `HoldoutLock` (access before `unlock()` raises).
- `evaluate(model, tok, rows, label_set, max_len) -> dict` (`valLoss`, `valAccuracy`, `valMacroF1`, `perClass` with
  n < 5 suppressed).
- `train(model, tok, train_rows, val_rows, recipe: dict, seed: int, gpu_seconds_budget: float) -> TrainResult`
  (LoRA via `peft.LoraConfig` or head-only; `TrainResult = {metrics, gpu_seconds, stopped_by_budget}`).
- `serve_predict(model, tok, text: str, label_set) -> str` (always a member of `label_set`).
- Control-plane bridge: a JSON-lines protocol over stdin/stdout:
  `{"op":"baseline"|"train"|"holdout"|"predict", ...}` → `{"ok":…}`. No sockets.

- [ ] **Step 1:** Ask the user before downloading the choice-D models (`distilbert-base-uncased` and
  `Qwen/Qwen2.5-0.5B` from Hugging Face, via the `hf` CLI). Convert them to bundles with `card.json`.
- [ ] **Step 2: Loader tests:** `acceptsAllowlistedDistilbert`, `rejectsBinWeights`, `rejectsPickle`,
  `rejectsAutoMap`, `rejectsUnknownArchitecture`, `rejectsExtraFile`, `rejectsParamCountMismatch`,
  `rejectsLyingSafetensorsHeader`. Run `pytest worker/ml/tests/test_loader.py` → FAIL; implement → pass.
- [ ] **Step 3: Train/eval tests** (synthetic 3-class dataset, 2,000 rows; seed fixed): `baselineMetricsShape`,
  `loraImprovesOverBaseline` (val macro-F1 rises on the learnable synthetic task), `headOnlyRuns`,
  `deterministicWithin001` (3 runs), `gpuBudgetStopsTraining` (a budget of 1 s → `stopped_by_budget`),
  `holdoutLockedRaises`, `smallClassSuppressed`. Implement → pass on the A5000.
- [ ] **Step 4: Serve + isolation tests:** `predictAlwaysInLabelSet`, `noNetworkInMlProcess` (run the plane with
  networking disabled via `unshare -n` or the image's `network_mode: none`; any outbound connect fails). Implement → pass.
- [ ] **Step 5:** Commit; record the pytest summary lines and GPU model in TASKS T13.

## Phase 1 exit
T01, T03, T06, T02A and T13 are `done` with evidence. Then write the Phase 2 plan: T02B (wire the agent to the ML
plane), T14 (evidence verifiers), T04 (control plane), T05 (receipts), on the hardware route chosen in T00 and
recorded in `docs/evidence/runtime.json`.
