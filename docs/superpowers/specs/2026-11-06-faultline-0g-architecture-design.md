# Faultline × 0G — verified architecture and build pipeline

Status: **DRAFT for the user's approval (would become PLAN rev 4).** Written 2026-11-06 from the official 0G docs,
live calls to the 0G Router and Galileo made the same day, the zerobot source, the ETHGlobal Physical AI prize page,
the uploaded MBRDI overview, and the user's draft audit. Nothing here is "verified" unless the **Evidence** column
says how it was checked. Where this document and a live call disagree, the live call wins.

This replaces the SealedAI product (PLAN rev 3) with a new product on the same stack. The repo's reusable code,
rules and evidence discipline carry over (§8). `docs/SECURITY.md` invariants I5, I9, I10, I11, I12 still apply
verbatim; the two-party key release invariants (I1–I3, I6–I8) do not apply to this product.

## Status legend

| Tag | Meaning |
|---|---|
| **LIVE** | We called it on 2026-11-06 from this machine and saw the result (command in §10) |
| **DOC** | Stated in official 0G documentation or pinned source; not yet exercised by us |
| **TEST** | Documented or implied, but behaviour, availability or cost must be confirmed with a real account before we depend on it |
| **BUILD** | Feasible, but 0G does not supply it; it is our code |
| **NO** | Not possible with the documented product today; the row says what we do instead |

---

## 1. Intent

**Product (long-term):** a confidential adversarial testing network for physical AI. Companies keep their
autonomous-driving stack (the system under test, SUT) in their own environment. Faultline supplies intelligent,
0G-powered traffic actors that interact with the SUT in closed loop at decision checkpoints, discover hard
encounters, and produce replayable, integrity-verifiable evidence.

**Hackathon deliverable (Physical AI track, $5k):** one simulated encounter family (lead vehicle braking in front
of the ego), where the *lead vehicle's* maneuver at each checkpoint is decided by a 0G model running in a TEE, the
physics and safety limits run locally, every decision is logged with its 0G request ID, the episode log lives on
0G Storage, the episode replays deterministically from the recorded decisions, and loss of 0G produces a real,
physically bounded safe halt that is logged as a halt, never as a decision.

**Why 0G:** it is the only place we found that combines, with one API key, (a) model execution inside a TEE with a
per-request provider signature we can verify against the chain, (b) a fail-closed `private` tier (503, no silent
downgrade), (c) Merkle-proofed decentralized storage for the episode record, and (d) an EVM chain for commitments.
Without it we would operate our own attested inference, storage and audit infrastructure.

**Goals:** pass the four qualification rules; a 3-minute demo where the 0G decision visibly changes the lead
vehicle's trajectory; a verifier page a judge can use without us.
**Non-goals:** hosting a customer's AV stack on 0G, CARLA, vision, multi-agent negotiation, adaptive search (PPO),
marketplace or payments, real hardware.
**Anti-goals:** a fallback that substitutes a local or scripted decision when 0G is unreachable (disqualifying);
"attested"/"private" labels without the evidence in §6; chain transactions inside the control loop; raw customer
scenario data in prompts, calldata or logs.

---

## 2. Verdict on the draft audit, claim by claim

The user's draft was largely right. These rows are where the live checks changed something.

| Draft claim | Verdict | What we found (Evidence) |
|---|---|---|
| Laya / Vela "private TEE listed" is uncertain | **LIVE: both are TeeML** | `GET /v1/models` lists `laya` and `vela-2.0-9b` with `type: "decisions"`, `verifiability: "TeeML"`, `tee_attested: true`, `tee_type: "TDX"`, `tee_verifier: "dstack"`, `supported_parameters: ["state","questions"]`, `provider_count: 1`. |
| Laya/Vela providers can be queried with `GET /v1/providers?model=` | **TEST: returns empty** | `GET /v1/providers?model=laya` and `...&service_type=decisions` both returned `{"data":[]}` while `/v1/models` says `provider_count: 1`. The pc.0g.ai model pages show one provider each ("PrivateTEE · ZDR", `0x787A…` for Laya, `0xE6c9…C72D` for Vela). So provider pinning for decisions is not usable yet; routing by model id is. |
| `/decisions` endpoint exists on the Router | **LIVE: route exists** | Unauthenticated `POST /v1/decisions` returns 401 (same as `/chat/completions`), i.e. the route is live and behind the API key. The request shape is documented on pc.0g.ai/models/laya (`model`, `state`, `questions` keyed by id with `type` ∈ {choice, score, noul}, `instructions`, `criteria`) and in Laya's repo. The **response** example was not visible on the page; one authenticated call fixes that (T2). |
| `x_0g_trace` / request IDs exist on decisions responses | **TEST** | Documented as "always present" on Router responses in the chat docs; the Laya/Vela pages confirm `verify_tee` and `tee_verified` in the trace for decisions, but do not show `request_id`. Our skill notes say every Router response carries an `X-Request-ID` header. Confirm on the first call; if absent, the qualifying loop uses route A (chat). |
| `verify_tee` is chat-only | **DOC: also decisions** | The Laya and Vela model pages document `verify_tee: true` → `tee_verified` in the trace. The docs page for verifiable execution shows it on chat and multipart endpoints. |
| Independent verification via `processResponse(provider, chatID)` | **DOC for chat; TEST for decisions** | SDK docs: `chatID` from the `ZG-Res-Key` header (body `id` is a chat-only fallback). Decisions are not mentioned; test whether the header is present. Fallback: trust the Router's `tee_verified` flag and say so. |
| 0GM is the primary chat model | **LIVE, with new facts** | `0gm-1.0-35b-a3b`: TeeML, one healthy provider `0xf4FB…B250`, observed latency 2046 ms, `supported_parameters` include `response_format` (JSON mode), `tools`, `chat_template_kwargs`; **input modalities `text, image`**; price $0.08/M in, $0.48/M out. Thinking is on by default (burns tokens); send `chat_template_kwargs: {enable_thinking:false}`. |
| Only 0GM has TeeML among chat models | **LIVE: no longer** | `glm-5.3` is TeeML too (two providers, one `0xD179…E503` 0G Foundation, one `baidu` identity; latency 3451 ms, $1.4/M in). Also TeeML: `0gm-1.0-35b-a3b-sia`, `whisper-large-v3`, `qwen3-embedding-*`, `z-image-turbo`. |
| Qwen3-VL-Plus for camera frames, "private not listed" | **LIVE: confirmed no TEE** | `qwen3-vl-plus` has no `verifiability` field. **But** 0GM accepts images, so a private vision checkpoint is possible via 0GM (TEST; out of hackathon scope). |
| Use the testnet Router for the Galileo story | **TEST: unreachable today** | `https://router-api-testnet.integratenetwork.work/v1/models`: TCP/TLS connects, no HTTP response (HTTP 000) on three attempts. Mainnet Router is live. Decision: inference on **mainnet Router**, storage and contract on **Galileo**, both networks named in every artifact. |
| Store with the SDK's `encryption: {type:'aes256'}` | **NO (repo finding)** | The SDK's `aes256` mode is AES-256-CTR with no authentication (`lib.esm/common/encryption.js`); a wrong key returns ciphertext silently. Use our AES-256-GCM envelope, already implemented in `packages/protocol/src/envelope.ts` (I10). |
| zerobot as a reference for receipts / safe stop / logs | **LIVE source read: do not adopt** | `sdk/src/ai/broker.ts` uses the Direct SDK with default model `qwen-2.5-7b-instruct` (not TeeML), records **no request IDs**; `recording/playback.ts` is a Go2 joint-angle replay format, not an episode log; `mock/server.ts` has **no stop/e-stop** and answers unknown commands with status 0 (success). zerobot alone would not meet the track's own rules. Its contracts (`RobotRegistry 0x2911…73bb`, `RobotCommandDispatcher 0x418b…A753` on Galileo) are an on-chain command queue we do not need. |
| Router rate limits are numeric | **DOC: unpublished** | Limits "depend on your account state"; headers `X-RateLimit-Limit-Requests`, `X-RateLimit-Remaining-Requests`, `X-RateLimit-Reset-Requests`, and `Retry-After` on 429. The checkpoint controller must read them. |
| Galileo deployer is funded | **LIVE** | Deployer `0x8dac…1069` holds 7.85 0G on chain 16602. Enough for storage uploads and one small contract. |

### 2.1 Live results of 2026-11-07 (first paid calls, CARLA spike)

| Check | Result | Consequence |
|---|---|---|
| Route A on `0gm-1.0-35b-a3b`, private tier, JSON mode, the §5.2 observation | HTTP 200 in 2.68 s; content `{"action":"BRAKE_HARD","why":"…"}`; `finish_reason: stop`; headers `X-Request-Id`, `Zg-Res-Key`, `X-Ratelimit-Limit-Requests: 500`; body `x_0g_trace.{request_id, provider 0xf4FB…B250, billing}`; cost $0.000053 | **0GM is the brain.** |
| Route A on `glm-5.3`, same request | HTTP 200 in 5.06 s but the model echoed the observation JSON and hit `max_tokens` | Fallback only, with a reworded prompt; not the default |
| Route B on `laya` `/decisions` | HTTP 200 in 1.89 s; `answers.maneuver.{choice:"COAST", probabilities ≈ 0.20–0.32, answer_confidence 0.32}`; `x_0g_trace.provider 0x787A…341D`; `Zg-Res-Key` present | Near-uniform: no reasoning, as predicted. **Dropped from the build.** |
| `verify_tee: true` (body) and `?verify_tee=true` (query) on 0GM | `x_0g_trace` keys are only `billing, provider, request_id`; no `tee_verified` | Do not rely on the Router flag. |
| Independent verification: `broker.inference.processResponse(provider, ZG-Res-Key)` with a random wallet on `https://evmrpc.0g.ai` (Compute SDK 0.9.0, detected chain 16661) | **`true` in 283 ms** | This is the per-decision proof in the verifier. |
| CARLA 0.10.0 (`~/carla/Carla-0.10.0-Linux-Shipping`, UE5) headless with `-RenderOffScreen -quality-level=Low -nosound`; Python 3.12 venv `.venv` with the shipped cp312 wheel | Server on :2000 in ~20 s, 6.5 GB VRAM; maps `Town10HD_Opt`, `Mine_01`; sync mode 20 Hz runs 80 ticks in 1.36 s; `sensor.lidar.ray_cast` gives ~7.6k points/scan; corridor filter tracks the lead (nearest x 29.1 m at 32.9 m centre gap); recorder start/stop/info work; vehicles include `vehicle.lincoln.mkz`, `vehicle.taxi.ford`, `vehicle.dodge.charger` | **Simulator = CARLA 0.10 on this machine**, LiDAR-based metrics are feasible |
| Town10 straight stretches (16 candidates ≥ 140 m junction-free) | All posted 30 km/h; CARLA's `BehaviorAgent` caps at the limit and needs `shapely`/`networkx` | SUT = our own IDM follower (desired 20 m/s), not BehaviorAgent |
| MBRDI repo (`~/shivam/mbrdi-development`, HEAD 030e5df) | `pyproject.toml` license MIT; `criticality_metrics/utils/kinematics.py` and `metrics/composite_scorer_v2.py` are pure Python with no `e2e_core` at module level | Vendor those two files with attribution; nothing else |

---

## 3. The 0G stack, in Web3 terms, and what each layer can and cannot establish

```
┌──────────────────────── customer side (never ours) ────────────────────────┐
│ SUT policy (their code/weights)  ·  their scenario parameters  ·  their keys│
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ observations in, authorized actions out
┌───────────────────────────────▼────────────────────────────────────────────┐
│ Faultline runtime (TS, local, no server of ours)                            │
│  simulator (2-D longitudinal) · checkpoint scheduler · observation sanitizer│
│  action validator + bounds · safe-halt state machine · metrics · episode log│
└──────┬───────────────────────────┬─────────────────────────────┬────────────┘
       │ private-tier inference    │ sealed episode bundle        │ commitments
┌──────▼──────────┐     ┌──────────▼──────────┐     ┌────────────▼────────────┐
│ 0G Compute      │     │ 0G Storage          │     │ 0G Chain (Galileo)      │
│ Router, TeeML   │     │ Merkle root, proof  │     │ EpisodeRegistry, ERC-8004│
│ x_0g_trace,     │     │ download, our GCM   │     │ (optional agent identity)│
│ provider sig    │     │ envelope            │     │                          │
└─────────────────┘     └─────────────────────┘     └──────────────────────────┘
```

| Layer | Exact interface | Role here | Status | Establishes | Does not establish |
|---|---|---|---|---|---|
| 0G Compute Router (mainnet) | `https://router-api.0g.ai/v1`, Bearer `sk-…`, `X-0G-Provider-Trust-Mode: private` | The brain: one decision per checkpoint | LIVE (catalog), TEST (our calls) | The response came from a TeeML provider that signed it; the Router refused to downgrade | That the maneuver is safe or sensible |
| Router routing headers | `X-0G-Provider-Address`, `-Identity`, `-Sort`, `-Trust-Mode`, `-Allow-Fallbacks`, `-Max-Price-Usd-*` | Pin trust tier; optionally pin provider | DOC | Deterministic provider choice | Nothing about the provider's honesty beyond the TEE |
| Router verification | `verify_tee: true` → `x_0g_trace.tee_verified` | Cheap per-decision check | DOC (chat, decisions pages) | Router says the signature verified | Not the raw proof; trusts the Router |
| Compute SDK verification | `@0gfoundation/0g-compute-ts-sdk` `broker.inference.processResponse(provider, chatID)`; chatID from `ZG-Res-Key` | Independent check by the verifier page / auditor | DOC chat, TEST decisions | Provider's on-chain `teeSignerAddress` signed the returned text (EIP-191) | That the provider's TEE is genuine beyond dstack attestation |
| Decision models | `laya` (ModernBERT-large, 512 tokens, free, ~33 ms on a T4 per its repo), `vela-2.0-9b` (16k tokens, $0.04/M) at `POST /v1/decisions` | Route B: typed choice with calibrated probability | LIVE catalog, TEST call | Typed answer + `answer_confidence` | Reasoning text |
| Chat models | `0gm-1.0-35b-a3b` (JSON mode, tools, images), `glm-5.3` | Route A: JSON action | LIVE catalog | Free-form reasoning + action | Latency bound |
| 0G Storage | `@0gfoundation/0g-storage-ts-sdk` 1.2.13, `Indexer.upload(MemData)`, `downloadToBlob(root,{proof:true})`; Galileo indexer `https://indexer-storage-testnet-turbo.0g.ai` | Episode bundle, sealed or public | LIVE in this repo (`examples/07`) | Bytes match the committed root | Truthfulness of the bytes |
| 0G Chain (Galileo 16602) | Foundry, `evmVersion: cancun`, explorer chainscan-galileo | `EpisodeRegistry` commitments; optional ERC-8004 agent identity (`0x8004A818…BD9e`) | LIVE (repo has deployed/verified contracts there) | A hash was committed by an account at a time | That the runner behaved honestly |
| 0G Compute Direct SDK fine-tuning | LoRA on provider-configured bases only | Not used | DOC | — | Cannot host a customer's AV stack |
| 0G DA | — | Not needed | — | — | — |
| 0G sealed sandbox / 0G-TAPP | Provider-registered images only; hosted broker 404 on 2026-11-06 | Future: attested evaluator | TEST | An attested runner | Not available self-service now |
| zerobot | Galileo command queue + operator bridge + Go2 mock | Reference only | LIVE source | — | No request IDs, no safe stop, no episode log |

**Why not Direct Compute for the loop:** it needs a 3 0G ledger plus 1 0G per provider sub-account, wallet-signed
headers per request, and provider selection by us; the Router gives trust-tier enforcement and failover with one key.
We use the Direct SDK only as a read-only verifier (any wallet, no deposit, per the docs).

---

## 4. What is not possible, and what we do instead

| Wanted | Reality | What we do |
|---|---|---|
| Customer uploads its AV stack to 0G and we test it "on 0G" | **NO.** The Router serves catalog models; Direct fine-tuning is LoRA on provider bases; no end-user API runs arbitrary containers in a 0G TEE (self-service sandbox returned 404; images are provider-registered) | The SUT stays in the customer's environment. 0G runs the *adversary*. Later: an attested evaluator via 0G-TAPP/sandbox once 0G registers our image (ask them). |
| CARLA/ROS as a 0G job | **NO.** No job API | Local 2-D simulator for the hackathon; MBRDI/CARLA stays customer-side later |
| Hard real-time control from the cloud | **NO.** No latency SLA; observed 2–3.5 s provider latency on 0GM/GLM; unpublished rate limits | Turn-based checkpoints: the simulator pauses while a decision is pending; local controller owns every physics step; safe halt on timeout |
| A fallback that keeps "deciding" when 0G is down | **Forbidden by the track** | `SAFE_HALT` is a controlled brake with `decision_source: "none"`, the episode is marked `interrupted`, and the UI says so |
| Pin a specific Laya/Vela provider | **TEST: providers list is empty for decisions** | Route by model id; record `x_0g_trace.provider` from the response; pin only for chat models |
| Testnet Router for an all-Galileo story | **TEST: unreachable from here** | Mainnet Router for inference; Galileo for storage and contracts; network named per artifact |
| "Prompts are invisible to everyone" | **Partly.** TeeML: the enclave decrypts the prompt; 0G's docs say neither 0G nor the host sees it; the Router handles prompts "in memory" to bill (our notes call this tier 2.5) | Observation minimization: numeric, relative, unit-normalized state only; no scenario ids, customer names or map names in prompts; claims limited to §6 wording |
| Encrypted files are fully private | **Partly.** Root, size, uploader, timing are public | Sealed bundle + separate public manifest with only hashes, request IDs and metrics; per-tenant keys (BUILD) |
| Prove the simulation was honest | **NO** (0G proofs cover inference and bytes) | Commit scenario before, result after; deterministic replay from the log; attested evaluator later |
| Identical results from a fresh LLM rerun | **NO** | Two replay modes: recorded-decision playback (bit-exact given seed) and fresh closed-loop rerun (new request IDs, may differ) |
| Reuse MBRDI code in the public repo | **Blocked until cleared.** It imports a protected Mercedes-Benz framework and a public repo is required | Re-implement the three metrics we use (TTC, THW, DRAC → CCS v2 fuzzy-OR) from the documented formulas; port the lead-brake family *parameters*, not code |
| Private vision over camera frames | **TEST.** 0GM accepts images and is TeeML; no vision model is TeeML | Not in scope; numeric state only |
| Full multi-tenant system | Not in one week | One synthetic tenant, two keys to show isolation (T10) |

---

## 5. Target architecture and the exact pipeline

### 5.1 Components (all TypeScript, one repo, no backend)

| Package | Responsibility | New / reused |
|---|---|---|
| `packages/sim` | 2-D longitudinal world: ego (SUT) + lead actor; 50 ms fixed step; deterministic from seed; bounded controls; metrics (TTC, THW, DRAC, CCS v2) | New (~300 lines) |
| `packages/agent` | Checkpoint scheduler, observation sanitizer, Router client (route A and B), action validator, safe-halt state machine | New; Router client adapted from `packages/integrations/src/router.ts` |
| `packages/episode` | Episode log (hash-chained), manifest, sealing, upload, download+verify, replay | Reuses `protocol/envelope.ts`, `protocol/timeline.ts`, `protocol/canonical.ts`, `integrations/storage.ts` |
| `contracts/src/EpisodeRegistry.sol` | Commit-before / finalize-after | New (~60 lines); Foundry config and Galileo deploy script reused |
| `apps/web` | Run page (live sim + decision feed) and Verifier page (paste root → verify) | Reuses the existing static app skeleton and `web:build` |
| `apps/cli` | `faultline run`, `replay`, `verify`, `anchor` | New, thin |

**The SUT in the demo** is a deterministic Intelligent Driver Model follower standing in for a customer's policy
(desired speed 25 m/s, time headway 1.2 s, minimum gap 2 m, max accel 1.5 m/s², comfortable decel 3 m/s², hard limit
0.8·g·μ, reaction delay 0.6 s implemented as a 12-tick buffer of sensed gap and lead speed). It senses state every tick;
it never reads the lead's control. It is not PDM-Lite and we say so. The seed randomizes nothing in the MVP (scenario
parameters are explicit); it is carried in the manifest so later noise models stay reproducible.

### 5.2 Schemas (ours; field names binding once approved)

```jsonc
// Observation sent to 0G (route A as JSON text; route B as the `state` string). Units in the names. Nothing else.
{ "schema": "faultline.obs/v1", "checkpoint": 7, "sim_time_s": 7.0,
  "lead_speed_mps": 17.5, "ego_speed_mps": 23.1, "gap_m": 21.0, "closing_speed_mps": 5.6,
  "ttc_s": 3.75, "thw_s": 0.91, "road_friction": 0.8, "lead_max_brake_mps2": 6.0,
  "available_actions": ["MAINTAIN","COAST","BRAKE_SOFT","BRAKE_HARD"] }

// Decision (route A: the model must return exactly this JSON; route B: derived from the `choice` answer)
{ "action": "BRAKE_SOFT", "confidence": 0.71 }

// Executed control after validation (what the simulator actually applies for the next checkpoint interval)
{ "lead_accel_mps2": -2.5, "source": "0g" | "none", "reason": "ok" | "timeout" | "invalid_json" | "out_of_set" | "http_429" | ... }
```

Action → physics map (deterministic, in code, not in the prompt): `MAINTAIN` hold speed; `COAST` −0.5 m/s²;
`BRAKE_SOFT` −2.5 m/s²; `BRAKE_HARD` −min(6.0, 0.8·g·μ) m/s². The simulator clamps every command and never lets
the lead reverse.

**Frozen demo scenario (`lead_brake_demo_v1`)**: straight single lane, μ 0.8, ego and lead both start at 25 m/s,
initial gap 35 m (THW 1.4 s), 30 s horizon, checkpoints every 1.0 s from t = 1 s, lead not allowed to act before
t = 3 s (run-up). With these numbers a `MAINTAIN` run ends Nominal (CCS < 0.4) and a `BRAKE_HARD` at a 21 m gap ends
Near-Crash or in a collision for the stand-in SUT, so the 0G choice is visible. The builder may tune the initial gap
within 30–40 m to keep that contrast; the chosen values are frozen in the manifest. A second recorded run with the
scripted `MAINTAIN` baseline (no 0G) is shown next to the 0G run for contrast and is labelled "scripted baseline".

**The adversary's objective (prompt and route-B `instructions`)**: "You drive the lead car in a test of the car
behind you. Choose the maneuver that makes the encounter as demanding as possible while still leaving the follower a
physically possible escape: never choose an action whose resulting TTC would fall below 1.0 s unless the follower is
already at or below your speed. Reply with JSON {"action": one of available_actions}." The observation JSON is
delimited as untrusted data (I9 pattern). A collision is a measured SUT failure, recorded with `collision: true`,
neither hidden nor rewarded; the risk band label is reported from the measured CCS only.

**Determinism**: fixed 50 ms step, semi-implicit Euler, only `+ − × ÷ min max sqrt` in the simulator and the SUT
(IEEE-754 exact across platforms), state serialized at 6 decimals. Replay compares `sha256(trajectory.jsonl)` and
requires equality; metrics (which use `exp`) are recomputed and compared with tolerance 1e-9. Exactness is claimed
for the same code version and seed on any machine; cross-version drift is reported, not hidden.

### 5.3 Route A vs route B (decide after T2; both are built behind one interface)

| | Route A: chat, `0gm-1.0-35b-a3b` | Route B: decisions, `laya` (or `vela-2.0-9b`) |
|---|---|---|
| Request | `POST /v1/chat/completions`, `response_format: {type:"json_object"}`, `chat_template_kwargs: {enable_thinking:false}`, `temperature: 0`, `max_tokens: 64`, `verify_tee: true`, header `X-0G-Provider-Trust-Mode: private` | `POST /v1/decisions`, `{model, state: <obs as text>, questions: { maneuver: { type:"choice", instructions:"…", criteria: { MAINTAIN:"…", COAST:"…", BRAKE_SOFT:"…", BRAKE_HARD:"…" } } }, verify_tee: true}`, same header |
| Output parse | `choices[0].message.content` → JSON → `action` ∈ set | `answers.maneuver.choice`, `answer_confidence` (per Laya's repo; confirm the Router's response shape in T2) |
| Latency | ~2 s observed provider latency | Repo claims ~33 ms model time; Router overhead unknown (TEST) |
| Cost | $0.08/M in, $0.48/M out | Free (Laya) / $0.04/M (Vela) |
| Trace | `x_0g_trace.{request_id, provider, tee_verified}` documented | `tee_verified` documented; `request_id` TEST |
| Independent verify | `processResponse` + `ZG-Res-Key` documented | TEST |
| Risk | Thinking leak, truncation, non-JSON | Response shape, trace fields |

Decision after the live calls (§2.1): the brain is **`0gm-1.0-35b-a3b` on route A**; `glm-5.3` is the configured
fallback model (same code path, reworded prompt); route B is dropped. Per-decision proof = `processResponse` with the
`ZG-Res-Key`, not the Router's `tee_verified` flag.

### 5.4 The run loop (one episode)

```
1 CREATE     seed, scenario params frozen → scenarioHash = sha256(canonical(params))
             scenarioCommitment = keccak256(abi.encode(salt, scenarioHash))   (I11: salted, low-entropy space)
             optional: EpisodeRegistry.commitScenario(episodeId, scenarioCommitment)   [before any inference]
2 STEP       simulator advances 50 ms ticks under the current lead control; ego policy runs locally every tick
3 CHECKPOINT every 1.0 s sim time (20 ticks): freeze the world, build Observation, hash it
4 DECIDE     state AWAITING_0G: POST (route A or B) with a 8 s wall-clock timeout, one retry only on 429
             honoring Retry-After, no retry on 5xx, no tier change, no model change
5 VALIDATE   HTTP 200 ∧ request id present ∧ (tee_verified ≠ false) ∧ parse ok ∧ action ∈ available_actions
             → EXECUTING with the mapped control; else → SAFE_HALT
6 LOG        append {checkpoint, sim_time, obs_hash, obs, request_id, provider, model, trust_mode, tee_verified,
             latency_ms, raw_response_sha256, action, control, source, reason, prevHash} to decisions.jsonl
7 LOOP       back to 2 until: collision, ego stopped and gap stable, 30 s sim time, or SAFE_HALT completed
8 MEASURE    TTC/THW/DRAC per tick → CCS v2 (sigmoid + fuzzy OR), min TTC, min gap, collision, max |decel|
9 SEAL       full   = tar{manifest.json, scenario.json, decisions.jsonl (with observations), trajectory.jsonl,
                           metrics.json, verification.json}
             sealed = envelope(full, AES-256-GCM, tenantKey)  → 0G Storage → sealedRoot
             public = the tenant's disclosure choice. Demo tenant (synthetic scenario): everything except the raw
                      observations and scenario.json are replaced by their sha256 → still replayable keylessly
                      because trajectory.jsonl and the recorded controls are public. A real tenant may publish only
                      manifest + per-decision {request_id, provider, tee_verified, action, obs_hash} + metrics.
             → 0G Storage → publicRoot
10 ANCHOR    EpisodeRegistry.finalizeEpisode(episodeId, publicRoot, sealedRoot, resultCommitment, status, collision)
             [after the loop; optional per episode: an unanchored episode is shown as "anchoring pending" and the
             §6 commit-before claim is made only for anchored episodes]
11 VERIFY    verifier page (static, keyless by default): download publicRoot with proof, check sha256s, re-run
             metrics from trajectory.jsonl, replay from the recorded controls and compare hashes, re-check request
             ids with processResponse where the route supports it, show explorer links. With a pasted tenant key it
             also opens sealedRoot (GCM tag, then hashes) and shows the observations. Interrupted episodes go through
             steps 8–11 unchanged; replay stops at the halt and must reproduce the halt maneuver.
```

Checkpoint cadence is a parameter; 1 s at ~2 s latency gives a 30 s episode in about a minute of wall time, which
fits the demo. The simulator is turn-based: physics never runs while a decision is pending, so latency changes
wall time, not the physics.

### 5.5 Safe-halt state machine (I5: the LLM never has authority; the controller does)

```
READY ──checkpoint──▶ AWAITING_0G ──valid──▶ EXECUTING ──next checkpoint──▶ AWAITING_0G
                           │                                   │
                           ├─ timeout / 429 after retry / 5xx / 503 no_provider_for_trust_mode
                           ├─ no request id / tee_verified=false / non-JSON / action not in set
                           ▼                                   ▼
                       SAFE_HALT (lead decelerates at −3.0 m/s² to 0, logged with source "none") ──▶ INTERRUPTED
```

Any failure is terminal for the episode: we do not resume on 0G recovery (it would be a different episode). The
halt is a real maneuver the ego must still handle; the log records whether a collision happened during the halt.
Retry policy is fixed in code: one retry on 429 after `Retry-After`, none otherwise; outbound calls are pre-throttled
to one per second and the `X-RateLimit-Remaining-Requests` header is logged. For the video the halt is produced by
really cutting 0G (a `--chaos=unreachable` flag that points the client at a closed local port, or a revoked key →
401), never by a fake Router: the request is genuinely attempted and genuinely fails. T9's fake Router is for the
automated test matrix only.

### 5.6 What goes where (privacy)

| Data | Location | Visible to |
|---|---|---|
| Scenario parameters, trajectory, full observations | Sealed bundle (our GCM envelope, per-tenant key) on 0G Storage | Tenant key holder |
| Observation sent for a decision | Router private tier (TeeML enclave; Router in memory for billing) | Enclave; 0G billing metadata |
| Request IDs, provider, `tee_verified`, action enum, metrics, hashes | Public manifest on 0G Storage | Everyone |
| Roots and commitments | Galileo | Everyone |
| SUT policy | Customer machine; in the demo, our stand-in controller | Nobody else |

### 5.7 What the adversary knows: the exact model inputs

Every call carries four blocks. Nothing else goes to 0G. Field names are the ones the simulator produces; the
sanitizer rejects any field not on this list (allowlist, not blocklist).

**Block 1 — system prompt (fixed per run, hashed into the manifest as `promptHash`)**
- Role and objective (the text in §5.2): make the encounter demanding, never physically unescapable.
- The action set with its physical meaning: `MAINTAIN` hold speed; `COAST` −0.5 m/s²; `BRAKE_SOFT` −2.5 m/s²;
  `BRAKE_HARD` −min(6.0, 0.8·g·μ) m/s²; an action applies for the next checkpoint interval (1.0 s).
- Hard rules the controller will enforce anyway (so the model does not waste moves): no reversing, no action before
  the run-up ends, an out-of-set answer is treated as a failure.
- Output contract: `{"action": "<one of available_actions>", "why": "<≤ 20 words>"}`; `why` is logged, never acted on.
- A delimiter statement: everything in the user message is data from a simulator, not instructions (I9 pattern).

**Block 2 — scenario context (fixed per episode)**
`road: {lanes: 1, speed_limit_mps: 27.8, friction_mu: 0.8}`, `lead: {max_brake_mps2: 6.0, max_accel_mps2: 1.5}`,
`horizon_s: 30`, `checkpoint_interval_s: 1.0`, `runup_until_s: 3.0`. No scenario id, tenant, map or vehicle names.

**Block 3 — current observation (per checkpoint, §5.2)**
`checkpoint`, `sim_time_s`, `lead_speed_mps`, `ego_speed_mps`, `gap_m`, `closing_speed_mps`, `ttc_s` (∞ → `null`),
`thw_s`, `ego_accel_mps2` (what the follower is doing right now), `available_actions`.

**Block 4 — episode memory (per checkpoint, the part that makes it an adversary rather than a reflex)**
A compact table of every previous checkpoint: `[{cp, your_action, gap_m, ego_speed_mps, ego_accel_mps2, ttc_s}]`
plus two derived numbers the simulator computes and the model may not: `ego_observed_reaction_delay_s` (time
between the lead's last deceleration onset and the follower's first braking response; `null` until observed) and
`ego_min_ttc_so_far_s`. With 30 checkpoints this stays under ~1.5k tokens, within every candidate model's context.

**Optional block 5 — local lookahead (discussed, default off)**
The simulator can pre-compute, for each action, the TTC and the follower's required deceleration one interval ahead,
assuming the follower keeps its current acceleration. Default **off**: it would move the physics reasoning out of 0G
and weaken the "0G is the brain" claim. It becomes **on** only for the reflex model in §5.8, where the model's job is
explicitly selection, not reasoning. The flag is recorded per decision (`lookahead: false|true`).

**Never sent:** customer identity, scenario ids, map names, the SUT's internals or parameters, raw sensor data,
absolute positions, previous episodes' data (except in discovery mode, §5.8, as aggregates), anything from `.env`.

**Discovery mode inputs (across episodes, P3 or later):** the same system prompt plus `episodes: [{params:
{initial_gap_m, lead_initial_speed_mps, runup_s}, ccs, min_ttc_s, collision, halted}]` for the frozen family's
parameter space, and the allowed ranges. The model proposes the next episode's parameters as JSON inside those
ranges; code validates and runs it. This is the agentic replacement for MBRDI's Sobol/PPO proposer, and each proposal
has its own request ID.

### 5.8 How smart is the adversary, and which model gives that

The honest hierarchy of what is available on the private tier today:

| Tier | Model(s) | What it is | Can it be the adversary's brain? |
|---|---|---|---|
| Reflex | `laya` (ModernBERT-large encoder, 512-token state, no generation), `vela-2.0-9b` (7.9B decoder used as a classifier, 16k state) | "System One": one forward pass maps text to a choice with a calibrated probability. No chain of thought, no arithmetic, no memory beyond what fits in the state | **No** as strategist. It cannot derive "if I brake hard now the follower needs 5.9 m/s² and has 0.6 s delay". It can pick among options whose consequences are already spelled out (block 5 on), which makes it a fast arbiter, not a planner. Its value is latency (~33 ms model time per its repo) and price (free). |
| Reasoning, small | `0gm-1.0-35b-a3b` (Qwen-architecture 35B MoE, ~3B active, thinking optional, JSON mode, 262k context) | A real instruction-following LLM; comparable to a Qwen3-30B-A3B-class model | **Yes, adequately.** It can read block 4, estimate the follower's reaction delay, and time a two-stage trap (coast to shrink the gap, then brake hard). Expect occasional physically naive choices; the controller bounds the damage. Cheapest reasoning option. |
| Reasoning, strong | `glm-5.3` (TeeML, two providers, 1M context, JSON mode, tools, reasoning_effort) | Frontier-class open-weights model | **Yes, best available privately.** Better multi-step planning and more consistent JSON. 3.4 s observed latency and ~17× the input price of 0GM, still negligible at our token volume. |
| Frontier closed | Claude, GPT, Gemini families | Served on the **standard** tier only | **No**: not TeeML, so no private tier, no provider signature. Using them breaks I9 and the referee story in §12. |

So "do we need something better than Laya?" Yes, and it exists: the brain is `glm-5.3` (or `0gm`), with episode
memory. Laya's place, if any, is a second cheap call per checkpoint that acts as a **guardrail arbiter**: given the
reasoning model's chosen action and the lookahead table, answer the `noul` question "does this action leave the
follower an escape?" and veto to `BRAKE_SOFT` if not. That is a defensible use of a System One model (it is what Vela
is built for) and gives a two-model 0G decision per checkpoint. It is optional and lands only after the single-model
loop passes T2–T3 and T9.

Where the intelligence actually shows in the demo:
1. **Within an episode** the model uses block 4 to adapt: after it sees the follower react late to a `COAST`, it
   chooses `BRAKE_HARD` when the gap is largest and the follower is still accelerating. The scripted baseline cannot.
2. **Across episodes (discovery mode)** the model proposes the next initial gap and run-up from prior metrics,
   steering toward the Near-Crash window. That is the search loop MBRDI's PPO failed to beat random on; here it is
   an LLM over aggregate metrics, every proposal with a request ID.
3. **What it cannot do, and we say so:** it is not a physics oracle; the simulator clamps it; a bad choice produces a
   boring checkpoint, not an unsafe one; a collision is the follower's failure to handle a bounded, logged maneuver.

Prompt-quality work is the main P0 engineering risk after connectivity, so T2 includes a 10-checkpoint dry run per
model with the decisions eyeballed against the lookahead table, and the chosen prompt is frozen by hash.

---

## 6. Allowed claims (SECURITY §5 extended for this product)

| Allowed once evidenced | Forbidden |
|---|---|
| "Each lead-vehicle maneuver was decided by `<model>` inside a TEE on 0G; request IDs: …" (needs `tee_verified: true` or `processResponse === true` per decision) | "Verified safe", "certified", "trustless" |
| "Prompts were served on the private tier; a 503 halts the run, nothing falls back" | "Nobody can see the observations" (the enclave sees them) |
| "The episode log is on 0G Storage and downloads with a Merkle proof; replaying the recorded decisions reproduces the trajectory exactly" | "The simulation is proven honest" |
| "The scenario was committed on Galileo before the first inference and the result after the last" | "Tamper-proof benchmark" |
| "CCS is a criticality score, not an accident probability" (MBRDI's own limit) | Any safety guarantee about a real vehicle |

---

## 7. Contracts

`EpisodeRegistry.sol` (Foundry, cancun, Galileo), events only plus a mapping:

```
commitScenario(bytes32 episodeId, bytes32 scenarioCommitment)            // once, before inference; msg.sender recorded
finalizeEpisode(bytes32 episodeId, bytes32 publicRoot, bytes32 sealedRoot,
                bytes32 resultCommitment, uint8 status /*1 completed, 2 interrupted*/, bool collision)
getEpisode(bytes32) → (evaluator, scenarioCommitment, publicRoot, sealedRoot, resultCommitment, status, collision, t0, t1)
event ScenarioCommitted, event EpisodeFinalized
```

Rules: only the committing evaluator can finalize; finalize once; no payments, no roles, no upgradeability.
Optional P3: register the adversary agent in the ERC-8004 Identity Registry on Galileo (`register(agentURI)`) so the
submission lists a standards-based agent identity next to our contract. Not zerobot's dispatcher (we are not
queuing commands on chain).

---

## 8. Reuse map

| From this repo | Use |
|---|---|
| `packages/integrations/src/router.ts` | Copied (not imported) into `packages/agent/router.ts` as a new typed client, so `agent` does not depend on `@sealedai/planner`: keeps the private header, `enable_thinking:false`, 503 → typed error, `X-Request-ID` / `x_0g_trace`; adds `verify_tee`, `response_format`, `max_tokens: 64`, latency, raw-body hash, `ZG-Res-Key`, and the decisions route behind the same `decide(obs) → Decision` interface. |
| `packages/integrations/src/storage.ts` | Unchanged upload/download with proof |
| `packages/protocol/src/envelope.ts`, `canonical.ts`, `tar.ts` | Sealed bundle, canonical hashing, deterministic tar. One change to `protocol`: add `'episode'` to `ObjectType`; the schema string `sealedai.obj/v1` stays until the rename decision. `timeline.ts` is **not** reused (closed kinds, `Date.now`): `packages/episode/log.ts` is a 30-line sha256 chain with injected timestamps. |
| `packages/planner` policy-gate pattern | Action validator: enumerated values, code-enforced budgets, untrusted-data delimiting in the prompt |
| `contracts/` Foundry setup, Galileo deploy + verify scripts, `--gas-estimate-multiplier 150` | EpisodeRegistry |
| `apps/web` static build, no backend | Run + Verifier pages |
| `docs/SECURITY.md` I5, I9–I12; evidence discipline in `docs/TASKS.md` | Unchanged |
| `.0g-skills`, `.claude/skills/sealedai-stack` | Facts and traps |

| From MBRDI (concepts and formulas only, no code until licensing is cleared) | Use |
|---|---|
| `lead_brake` family parameters (ego speed ratio, trigger time, brake grip fraction, target speed ratio, run-up time) | Scenario parameter space and the frozen demo scenario |
| CCS v2: sigmoid normalisation, fuzzy OR `1 − Π(1 − mᵢ)` | `packages/sim/metrics.ts` with **our** labelled constants (the overview gives midpoints but not every slope): TTC = gap / closing speed when closing, falling sigmoid mid 1.5 s k 3; THW = gap / ego speed, falling sigmoid mid 1.0 s k 3; DRAC = closing speed² / (2·gap) when closing, rising sigmoid mid 4 m/s² k 1.5. Reported as "CCS-v2-style, Faultline constants", not as MBRDI's numbers. |
| "Every reported score is a real closed-loop measurement"; three replay meanings; immutable checksummed evidence; `interrupted_unknown` never silently rerun | Design rules carried over |
| Risk-band windows (Nominal ≤ 0.40, Challenging 0.45–0.70, Near-Crash 0.75–1.00) | Reported as a label on the measured CCS only; no band targeting promised |

Not reused: `space/actions.py` (scenario-search ABI, not a driving action), Fast Preview, PPO, NL parsing, CARLA.

---

## 9. Build order, exit criteria, three lanes

| Phase | Deliverable | Exit |
|---|---|---|
| **P0 decision loop** | `packages/sim` + `packages/agent` + CLI `run`: real 0G decisions change the lead vehicle; safe halt on injected timeout/429/503/garbage | T1, T2, T3, T9 pass |
| **P1 evidence + replay** | `packages/episode`: hash-chained log, sealed + public bundles on Galileo storage, proof-verified download, metrics, replay with zero drift | T6, T7, T8 pass |
| **P2 trust** | `verify_tee` on every decision, `processResponse` in the verifier, per-tenant keys, second-tenant negative test | T4, T5, T10 pass |
| **P3 chain + product** | EpisodeRegistry on Galileo, web Run + Verifier pages, README, video | T11 pass; a judge verifies an episode from a fresh clone |

Lanes (same charter rules as `docs/THREE-DEVELOPER-EXECUTION.md`: one owner per path, Person 2 owns root files
and the tracker): **Person 1** `packages/sim`, `packages/agent`, fault-injection tests; **Person 2** `packages/episode`,
Router adapter changes, replay, evidence; **Person 3** contracts, `apps/web`, CLI, README, video.

---

## 10. Live verification matrix (the plan is conditional on these)

Commands assume `. ~/.nvm/nvm.sh` and `.env` with `ZG_ROUTER_URL=https://router-api.0g.ai/v1`, `ZG_API_KEY`,
`RPC_URL`, `STORAGE_INDEXER`, `PRIVATE_KEY`. Rows marked **$** spend Router balance or Galileo gas and need the
user's go-ahead first (repo rule).

| # | Test | Command / method | Pass | On fail |
|---|---|---|---|---|
| T1 | Model availability | `curl -s $ZG_ROUTER_URL/models \| jq '.data[] \| select(.verifiability=="TeeML") \| {id,type,provider_count}'` | `0gm-1.0-35b-a3b` and `laya` present with `provider_count ≥ 1` (LIVE today) | Use `glm-5.3` (TeeML, 2 providers) |
| T2 **$** | Real decision, both routes | one route-A call with the §5.2 observation; one route-B call with the §5.3 body | A: valid JSON action; B: `answers.maneuver.choice` present; action changes the lead's control | Drop the failing route |
| T3 **$** | Trace | same calls, capture headers `X-Request-ID`, `ZG-Res-Key`, body `x_0g_trace.{request_id,provider,tee_verified}` | All present for the qualifying route | Route B demoted to "fast adversary, unverified" or dropped |
| T4 **$** | Private routing | header `X-0G-Provider-Trust-Mode: private`, then a deliberate `standard`-only model with the private header → expect 503 `no_provider_for_trust_mode` | Private succeeds; downgrade impossible | Blocker: do not demo |
| T5 **$** | Independent verification | `processResponse(trace.provider, ZG-Res-Key)` via the Compute SDK with a random wallet on `https://evmrpc.0g.ai` | `true` on route A | Show "Router-verified only" |
| T6 **$** | Storage upload | `examples/07` pattern with the episode bundle | Root + tx on storagescan-galileo | Fund/indexer diagnosis |
| T7 | Storage download | `downloadToBlob(root,{proof:true})` → envelope `open` → sha256s | Bit-exact | Evidence integrity fails loudly |
| T8 | Replay | `faultline replay <bundle>` | Trajectory identical to the log (tolerance 0, same seed, same decisions) | Report drift; never overwrite |
| T9 | Fault injection | a fake Router (`fetch` override) returning timeout, 429+Retry-After, 502, 503, non-JSON, out-of-set action, `tee_verified:false` | Each → `SAFE_HALT`, source `none`, episode `interrupted`; no second-tier request in the recorded outbound calls | Stop feature work |
| T10 | Tenant isolation | tenant B key on tenant A's sealed root | GCM tag failure, no plaintext; public manifest contains no scenario params | Fix keys/redaction |
| T11 **$** | Chain | `forge script` deploy; `commitScenario` before T2's run; `finalizeEpisode` after T6 | Events on chainscan with matching roots | Keep episode off-chain, mark "anchoring pending" |

Hard gates for the track: T2, T3, T6, T8, T9.

---

## 11. Decisions frozen in this draft, and what is the user's

Frozen (mine, overridable): TypeScript throughout, 2-D turn-based simulator in `packages/sim` (not Python/CARLA),
mainnet Router + Galileo storage/chain, route A built in full first and route B only after T2 shows its response
shape, 1 s checkpoints, four-action set, the frozen demo scenario and adversary objective in §5.2, AES-GCM envelope
not SDK encryption, EpisodeRegistry with events only and an optional per-episode anchor, no zerobot dependency,
stand-in IDM SUT, CCS-v2-style metrics with our labelled constants, replay = trajectory hash equality, interrupted
episodes sealed and anchored like completed ones, keyless verifier on the demo tenant's public bundle, a new typed
Router client in `packages/agent` (no planner dependency), `timeline.ts` not reused, `'episode'` added to the envelope
`ObjectType`.

**Needs the user:**
1. Approve this pivot as PLAN rev 4 (T00 is the user's; the current PLAN describes SealedAI).
2. Authorize the first paid calls: T2–T5 (cents on the mainnet Router) and T6/T11 (Galileo gas from the 7.85 0G).
3. Python simulator instead of TypeScript if direct MBRDI code reuse is wanted, which also needs the licensing answer.
4. MBRDI / `e2e_core` licensing: may any file be copied into a public repo? Until answered, formulas only.
5. Whether to show route B (Laya) at all if its trace fields are incomplete.
6. Is a collision an acceptable demo outcome? My recommendation: yes, shown as a measured SUT failure (status
   `completed`, `collision: true`), with the adversary objective in §5.2 that forbids provoking unavoidable ones.
7. Repo layout: keep the SealedAI packages (`planner`, `worker`, `client`, escrow, Arkiv) in the tree, or move them to
   an archive branch so judges see one product? My recommendation: archive branch; keep `protocol`, `integrations`,
   `contracts` toolchain and `apps/web`.
9. Model for the brain: `glm-5.3` (strongest private model, my recommendation) or `0gm-1.0-35b-a3b` (0G's own,
   cheaper); and whether to build the optional Laya guardrail arbiter (§5.8) after the single-model loop passes.
8. Router account: which key and balance the demo uses (the existing `ZG_API_KEY` on mainnet, or a fresh key set to
   private-only in the pc.0g.ai dashboard). Expected use: ≈30 calls per episode × ≈20 rehearsals ≈ 600 calls ×
   ≈400 tokens, under $0.10 on 0GM.

---

## 12. The pitch: a market that cannot exist without a neutral referee

**Weak version:** "0G gives us TEEs, storage and a chain." True, replaceable, and judges have heard it.

**Strong version:** autonomous-vehicle safety testing is a market with buyers who distrust every available referee.
- An OEM will not run its stack against a competitor's adversary, and will not accept a competitor's results.
- An OEM will not trust a benchmark **vendor** either: the vendor can leak scenarios, tune the adversary toward a
  paying customer, or quietly rerun until the number looks right. Today every benchmark is "trust the vendor".
- Insurers, fleet buyers and regulators want results that are comparable across OEMs and that nobody can later
  repudiate or edit.

So the market needs a referee that (1) makes the adversary's decisions where neither the vendor nor the OEM can steer
them mid-run, (2) proves which model made each decision, (3) keeps the record where neither party hosts it, and (4)
fixes the test before and the result after, with a timestamp nobody controls. That referee cannot be Faultline (we
are the vendor) and cannot be an OEM. It has to be infrastructure.

**0G is that referee, concretely:**

| Referee duty | 0G mechanism | What it stops |
|---|---|---|
| Adversary decisions nobody can steer during the run | TeeML inference: the model runs in a TDX enclave; the prompt is only visible inside it; `private` tier refuses to downgrade (503) | Faultline or the OEM injecting a softer or harsher adversary mid-episode |
| Proof of which model decided, per decision | Provider signature over the response, verifiable against the on-chain `Service` registry (`processResponse`), plus Router `request_id` | "The model said X" claims with no evidence; substituting a scripted decision |
| A record neither party hosts | 0G Storage root with Merkle-proofed download | Editing the log after the fact; "the file was lost" |
| Fixed test before, fixed result after | `commitScenario` before the first inference, `finalizeEpisode` after the last, on Galileo | Choosing the scenario after seeing the result; reporting a rerun as the first run |
| Agent identity | ERC-8004 identity for the adversary agent (optional P3) | Anonymous referees; lets reputation attach to a declared agent + prompt hash |

**What 0G does not referee today, said out loud:** the simulator and the stand-in SUT still run on the vendor's
machine. 0G proves the decisions and the record, not the physics. Closing that gap is the roadmap: run the evaluator
itself as an attested workload (0G-TAPP or the sealed sandbox once 0G registers our image), so the physics run is
signed by an enclave too. The pitch is honest about which half is refereed now.

**One-paragraph version for the video:** "Nobody trusts anyone's safety benchmark, because the referee is always
someone with a stake. Faultline makes the adversary's brain run on 0G's private compute, where neither we nor the
customer can touch it, every decision signed and logged on 0G Storage, the test committed on-chain before it runs
and the result after. The customer keeps its driving stack. We keep nothing. The referee is the network."

---

## Sources

Live: `GET https://router-api.0g.ai/v1/models`, `GET /v1/providers?model=…`, unauthenticated `POST /v1/decisions`
and `/v1/chat/completions` (401), `https://router-api-testnet.integratenetwork.work/v1/models` (no response),
Galileo RPC balance, all 2026-11-06. Docs: `docs.0g.ai` Router overview, chat-completions, verifiable-execution,
privacy, routing, errors, rate-limits, models; compute-network/inference (SDK); storage/sdk; `pc.0g.ai/models`,
`/models/laya`, `/models/vela-2.0-9b`. Source: `0gfoundation/zerobot` `sdk/src/ai/broker.ts`,
`recording/playback.ts`, `mock/server.ts`, README; `NandhaKishorM/laya` README (Jev-compatible schema).
Repo: `.claude/skills/sealedai-stack/SKILL.md`, `docs/PLAN.md` rev 3, `docs/SECURITY.md`, `docs/PROTOCOL.md`,
`packages/integrations/src/*.ts`, `packages/protocol/src/envelope.ts`. ETHGlobal Physical AI prize text as pasted
by the user. MBRDI: the uploaded overview (no code inspected).
