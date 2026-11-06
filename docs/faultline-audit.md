# Faultline trust audit: failure points, evidence and fixes

Branch `build/faultline`, base commit `3cfc97b`. Audit date 2026-11-07 (local); live checks at 2026-11-06T20:40Z (UTC).

**Method.** Code read plus read-only live calls. Nothing was spent:
- 0G Storage download
- Galileo `eth_getLogs` / `getEpisode`
- 0G mainnet `InferenceServing.getService`
- provider `GET /v1/proxy/signature/…` and `GET /v1/quote`
- Router `GET /v1/models`

**Sources.** Three independent reviews fed this document:
- 0G broker source and docs research (`0gfoundation/0g-serving-broker` @ `56f24ba4`, docs.0g.ai, build.0g.ai/llms.txt)
- a code audit
- track and 0G-feature research (ETHGlobal Mumbai 0G prize page)

## What a judge must be able to check without trusting us

| | Question | Before this audit | After the fixes on this branch |
|---|---|---|---|
| a | The 0G model really made each decision | Checkable only within the provider's signature cache window (default 20 min) | Signatures archived at publish; offline check against the on-chain TEE signer, in the CLI and the browser. Content binding is still open (A2) |
| b | Nothing changed after publishing | Root typed by the user was trusted; no Merkle check at all | Merkle root recomputed from the downloaded bytes; public decisions bound to the sealed hash chain |
| c | The AI wasn't swapped for hardcoded commands | Any real chat ID "verified" any logged action | Still open (A2, A3): needs one live call and a prompt change, see plan |
| d | Results weren't cherry-picked from reruns | No mechanism | Registry v2 written and tested (per-evaluator sequence numbers, aborted status, config hash); not deployed |
| e | Published results are the ones generated | Headline numbers taken on faith | Aggregates recomputed from ticks; per-tick metrics recomputed |

## Track requirements (ETHGlobal Mumbai, 0G "Physical AI: Agents with a Body", $5k)

The prize page lists these must-shows. Two other facts from the page:
- No judging rubric is published.
- Prizes are paid "at 0G's discretion", subject to a quality threshold.

| Must-show | Status |
|---|---|
| A 0G call inside the decision loop | Met: one Router call per 1 s checkpoint |
| Episode log on 0G Storage with a request id per decision | Met; now integrity-checked (S1) |
| Replayable simulation (or live hardware) | Met for kinematic (bit-exact) and CARLA ground truth; CARLA LiDAR not bit-exact (B2) |
| Safe-stop fallback; a faked fallback disqualifies | Met: `source: "none"` SAFE_HALT, chaos matrix |
| Submission: public repo, README, <3 min video, **live demo link**, contract addresses | **Live demo link missing**: the verifier only runs on localhost (T1) |

The same page has a second 0G track, "Build with 0G Private Computer" ($5k), whose must-show is "Inference on 0G Private Computer in your main user flow, with request IDs". Faultline fits it too. Whether one project can win both is unknown.

---

## Failure points

Severity: **C** critical, **H** high, **M** medium, **L** low.

Status:
- **fixed**: code and tests on this branch
- **fixed\***: fixed, but needs a new live run to show green
- **written**: code and tests done, not deployed
- **open**: not started
- **needs decision**: waiting on the user

### A. 0G Private Computer (Router, TeeML)

Already works:
- private tier only, with no fallback to another tier or model
- SAFE_HALT on every failure
- 8/8 distinct request IDs and `Zg-Res-Key`s
- model listed live as `0gm-1.0-35b-a3b`, TeeML / TDX / dstack

Provider `0xf4FB8d2b…B250` on chain (mainnet `InferenceServing` `0x47340d90…8d84`):
- `url` `https://compute-network-20.integratenetwork.work`, model `0GM-1.0-35B-A3B`
- signer `0xDdaEaac4d8525d72DfD20cc6dE0f28eb3d320Bfb`, acknowledged
- `TargetSeparated: false` (the broker TEE signs)
- The TDX quote's `report_data` names the same signer (checked live).

**A1 (C) — Provider signatures expire and were never stored. Status: fixed\*.**
- Evidence:
  - `verify` on demo-002 at 20:40Z returned all 8 `verified: null`.
  - The provider answers `404 "Chat id not found or expired, chat_id_not_found"`.
  - Broker source: the cache is in memory only, `chatCacheExpiration` default 20 min (`api/inference/config/config.go`), and a restart loses everything.
  - The public JSON stored only `true` flags, with no `text` or `signature`.
- Fix: `packages/episode/src/tee.ts`, plus `archiveTee` in `verify.ts`:
  - At publish, fetch `{text, signature}` for every 0G decision, plus the provider's on-chain service record and TDX quote, and store them in the public JSON (`tee`).
  - `checkTee` recovers the EIP-191 signer offline and compares it with the signer read from chain, never with the archived copy. It follows the SDK's own rules (TeeML, acknowledged, separated-TEE address).
  - Tests: `packages/episode/test/verify.test.ts` covers valid, tampered text, wrong signer, unacknowledged signer, missing signature, and zero decisions.
  - Demo-002 shows 0/8 until a new run is published.

**A2 (C) — A valid signature isn't tied to the logged action. Status: open (needs one live call).**
- Evidence:
  - SDK 0.9.0 `processResponse` only recovers the signer of the provider-supplied `text`.
  - Broker `signing.go signChatWithKey` sets `text = hex(sha256(reqBody)) + ":" + hex(sha256(respBody))`, computed over the broker's rewritten upstream request and its sanitized response.
  - The Router adds `x_0g_trace` to the body, so `sha256(Router body) ≠ respHash`.
  - We stored only `raw_sha256`.
- Fix so far: `faultline/router.py` now keeps the exact Router body (`raw_b64`, sealed only).
- Plan: one live call to learn whether the provider body can be rebuilt from the Router body by removing `x_0g_trace`. If yes, check the response hash in `checkTee`. If no, call the provider directly through the Compute SDK, so we receive the exact signed bytes.

**A3 (H) — Decisions aren't bound to the episode. Status: open (needs decision).**
- Evidence: the prompt carries only `{history, observation}` (`faultline/policy.py:44`), the scenario is fixed and temperature is 0, so answers from an unanchored practice run could be reused.
- Broker research: a nonce in the prompt is covered by the request hash, but the request preimage is broker-rewritten, so nobody can show the nonce is in it.
- Plan: put `episode_id` and the v2 commit block hash in the prompt, and have the model echo a short nonce in its JSON. Once A2 binds the response, the echo proves "made after the commit, for this episode".

**A4 (L) — The Router URL and chaos mode aren't recorded as provenance. Status: partly fixed.**
- Evidence: `cli.py:89` accepts `--router-url` but never records it; `trust_mode` is hardcoded (`episode.py:153`); `source: "0g"` is set for the fake router too.
- Fix: the page now shows a red CHAOS MODE row when `manifest.chaos` is set. Recording the Router URL host in the manifest is still open.

### B. 0G Storage (evidence locker)

**S1 (C) — No Merkle check anywhere; the page claimed "proof checked". Status: fixed.**
- Evidence: storage SDK 1.2.13 `Downloader.js:289` has `// TODO: add proof check` and ignores the `_proof` argument. `verify.ts` hardcoded `publicRootOk: true`. A malicious indexer (the URL is editable on the page) could serve anything.
- Fix: `packages/integrations/src/storage.ts downloadBlob` now:
  - fetches `GET {indexer}/file?root=` over https (CORS `*`, so it also works on a hosted page), falling back to `downloadToBlob`
  - rebuilds the 0G Merkle root with `MemData.merkleTree()` and refuses the bytes on mismatch
- Live check: demo-002 is 82,535 bytes and its root matches; one flipped bit fails. Test: `packages/integrations/test/storage.test.ts`.

**B1 (H) — The page showed the publisher's own embedded check as a green tick. Status: fixed.**
- Evidence: `main.ts:62-68` (old) read `p.verification`.
- Fix: the page runs `checkTee` in the browser against 0G mainnet RPC. Seen in a headless browser on demo-002: "✗ 0/8 archived signatures…", which is honest.

**R2 (H) — Stored XSS on the verifier page could steal the pasted tenant key. Status: fixed.**
- Evidence: `latency_ms`, `cp`, `decisions_*`, `short(...)`, `peak_step` and `scans_without_target` were inserted into `innerHTML` unescaped.
- Fix: every value goes through `esc()` or `num()`, and a strict CSP meta tag (`script-src 'self'`, `object-src 'none'`, `form-action 'none'`) is added.

**R5 (H) — Public decision fields were bound to nothing, even with the key. Status: fixed.**
- Evidence: the sealed check compared only `observation_sha256`. Editing a public action or swapping request IDs still passed.
- Fix: `verify.ts` `publicDecisionsMatchSealed` compares every public field with the hash-chained sealed line, plus the line count. Tested with an edited cp3 action.
- The CLI field `chainOk` (which was not a chain check) is renamed `decisionsWellFormed`.

**R8 (M) — Headline numbers were never recomputed. Status: fixed.**
- Fix: `check.ts aggregatesOk` checks peak CCS, `peak_step`, min TTC, min gap, max decel, and collision against the manifest. The page shows it and the badge warns on a mismatch.

**R10 (L) — "All signatures true" passed when there were zero 0G decisions. Status: fixed.**
- Fix: `allTrue` requires at least one 0G decision.

**B2 (M) — Nobody checks publicly that the trajectory follows from the decisions. Status: open.**
- Evidence: replay is Python-only, needs the sealed bundle, and CARLA LiDAR differs by up to 1.27 m between runs.
- Plan: port `KinematicWorld` and the checkpoint loop to TS. They use only `+ - * / min max sqrt`, so a browser replay is bit-exact. Then compare `gt_gap`, `ego_v` and `lead_v` per tick. This needs the scenario public (see R7).

**R7 (M) — "The scenario is hidden" is hollow. Status: needs decision.**
- Evidence: the public JSON carries the unsalted `scenario_hash`, `Scenario` is all defaults plus an int seed (brute-forceable), and the trajectory shows the gap and speeds. Test T10 only checks that the literal key `initial_gap_m` is absent.
- Choice: reveal the scenario and salt at finalize, which enables B2 and C3 (recommended for the hackathon). Or keep it hidden and drop the trajectory from the public JSON.

**B3 (L) — The decision hash chain can't be checked without the key. Status: open.**
- Plan: chain a redacted per-line projection (observation, history and content hashes) so the chain can be recomputed publicly.

**R12 (L) — One tenant key opens every episode; `sealedTar` packs stale files and fails on subdirectories. Status: open.**
- Plan: derive a per-episode key with HKDF(tenant key, episode_id), and use an explicit file allowlist in `sealedTar`.

**T1 (H, track) — No live demo link. Status: needs decision.**
- `downloadToBlob` uses plain-http storage nodes, so a hosted https page could not download. With S1 the page reads the https indexer, so static hosting now works. Publishing a URL is outward-facing, so it needs your OK.

### C. 0G Galileo (EpisodeRegistry)

Already works: 2 `ScenarioCommitted` and 2 `EpisodeFinalized` events on `0x23edb2e3…F46A`, same evaluator `0x8dac3a1f…1069`; roots match.

**C2 (H) — Commit doesn't prevent rerun-until-good (the README's promise). Status: written.**
- Evidence: the commitment covers only the public demo `scenario.json` (`anchor.ts:41`); there's no per-evaluator counter; unfinalized and unanchored runs are invisible.
- Fix: `contracts/src/EpisodeRegistryV2.sol` (tests in `contracts/test/EpisodeRegistryV2.t.sol`; forge: 14 passed, 0 failed across v1 and v2):
  - per-evaluator `seq`, `stats(evaluator)` and `episodeBySeq`
  - status 3 = aborted
  - public `configHash` (prompt hash, model, code commit)
  - `commitBlock` stored, so its block hash can serve as the nonce for A3
- Not deployed: needs Galileo gas and your OK. `anchor.ts`, the CLI and the page also need v2 wiring.

**R9 (M) — Commits on v1 can be front-run or griefed. Status: written.**
- Evidence: v1 keys by `episodeId` only (`EpisodeRegistry.sol:32-38`). A copied pending ID makes the honest commit revert and the run abort (`cli.py:111`, `check=True`).
- Fix: v2 keys by `(evaluator, episodeId)`; tested in `test_frontRunCannotGriefAnotherEvaluator`.

**R3 (H) — The page took the registry address from the untrusted document. Status: fixed.**
- Evidence: `main.ts:91,95` (old) read `m.registry`.
- Fix: `EPISODE_REGISTRY` is pinned in the page, a mismatch shows ✗, and the evaluator address is shown.

**R4 (H) — The "committed before the first call" tick failed open. Status: fixed.**
- Evidence: an uncommitted episode returns `committedAt = 0`, and `0 < Date.parse(...)` came out true.
- Fix: require a non-zero evaluator and `committedAt`; otherwise show "✗ no commitment".

**C1 (H) — "Before the first call" relies on our own clock. Status: partly fixed.**
- Fix so far: the page now labels the time as "the evaluator's own clock".
- Full fix: A3 (commit block hash inside the signed response).
- Extra 0G evidence: the storage upload's Flow `Submit` tx and `txSeq` give chain timestamps for the log; record them in `finalizeEpisode`.

**C3 / R6 (M) — Commitments can't be opened, even with the key. Status: open.**
- Evidence: no tool recomputes `keccak(salt, sha256(scenario.json))` or the result commitment and compares them with `getEpisode`.
- Plan: after opening the sealed bundle, recompute both commitments and compare them on chain; or reveal the salt (R7).

## Extra 0G features worth adding (from research; availability checked)

**ERC-8004 identity for the adversary:**
- Identity registries: Galileo `0x8004A818BFB912233c491871b3d84c89A494BD9e`, mainnet `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.
- `register(agentURI)` with the model, prompt hash and action set; put the `agentId` in `configHash`.
- Shows the adversary is a fixed, published agent. No Validation Registry is deployed.

**Storage upload timestamps:** the upload returns `{txHash, rootHash, txSeq}`, and the indexer shows `/file/info/<root>` → `seq 160344, finalized: true` for demo-002. Record them on chain at finalize.

**TDX quote:** archived per provider; a full quote check is left to the dstack verifier named in the service's `additionalInfo.VerifierURL`.

**Not worth it now:**
- 0G KV: the only public node didn't answer and is plain http
- 0G DA: needs self-hosted nodes
- ERC-7857: testnet only, poor fit
- fine-tuning: no trust benefit
- on-chain inference settlement: commits to a nonce, not to content

## Evidence still owed (needs a live run or a spend)

1. One Router call (cents, 0G mainnet) for A2: does the provider body equal the Router body without `x_0g_trace`?
2. A new anchored CARLA run, published with the TEE archive, on the Linux/GPU machine. This turns signatures green on the page.
3. Deploying `EpisodeRegistryV2` on Galileo (gas), then wiring it into `anchor.ts`, the CLI and the page.
4. Hosting the verifier page publicly (the track's live demo link).

## Test status on this branch (macOS)

- `npm test` → `# tests 79 # pass 78 # fail 0 # skipped 1` (the skip needs `runs/demo-002/sealed.bin`)
- `npm run typecheck` clean
- `.venv/bin/python -m pytest tests/python -q` → `37 passed, 1 skipped` (the CARLA test)
- `forge test --match-contract EpisodeRegistry` → `14 tests passed, 0 failed`
- Built verifier page in a headless Chromium against the live demo-002 root:
  - Merkle root recomputed ✓, hashes ✓, metrics ✓, aggregates ✓, pinned registry ✓
  - signatures ✗ 0/8 (published before the archive existed)

---

## 2026-11-07 follow-up (trust agent): A2 live probe

**Probe.** One private-tier Router call (same body shape as `faultline/router.py`), signature fetched seconds later from
`https://compute-network-20.integratenetwork.work/v1/proxy/signature/<Zg-Res-Key>`. Evidence (full response bytes,
headers without credentials, signature): `docs/evidence/faultline-a2-probe.json`.
- request id `7daefcd6-96f6-478b-81e3-7507c037dad4`, provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`,
  `Zg-Res-Key` `163f9a49-4994-4e4e-8626-5f310f829a8c`, 2026-11-06T21:49:27Z
- response header `x-0g-e2ee: sealed`
- signed `text` = `zg-sig-v1/e2ee-ct:722ae25c…6ad1:e7ab870b…f6af`; EIP-191 signer recovers to
  `0xDdaEaac4…0Bfb` = on-chain `teeSignerAddress`

**Result: no match.** None of these equals either hash in `text`: the raw Router body, the body with `x_0g_trace`
removed (re-serialized compact, indent 2, trailing newline, and textually cut from the raw bytes, which equal the
compact form), the message content alone, or our request bytes.

**Why (source).** The Router now seals every private-tier turn end-to-end to the provider enclave (broker
`docs/design/e2ee.md` @ `56f24ba4`, §"Response signature"): for a sealed turn `signChatE2EE` signs
`zg-sig-v1/e2ee-ct:<sha256(aad‖ciphertext) of the sealed request>:<same of the sealed response>`. The E2EE client is
the Router, so only the Router holds those ciphertext bytes; what we receive is the Router's decrypted re-encoding.
No transformation of our bytes can match. Content binding through the Router as we call it is impossible, so the
check stays **off**; nothing claims it.

**Side effect found and fixed.** `tee.ts SIGNED_TEXT` only accepted the plaintext form `<64hex>:<64hex>`, so every
signature archived from a run today would have shown ✗. It now also accepts the `zg-sig-v1/e2ee-ct:` scheme (same
EIP-191 signer check against the chain; the scheme is reported per signature). Test: a real archived signature from
the probe verifies, and any edit to scheme or hash fails.

**Ways to get real content binding (not done, no spend):**
1. *Be the E2EE client ourselves* (preferred): seal `messages` to the enclave's X25519 key (`GET /v1/e2ee/pubkey`,
   HPKE DHKEM-X25519/HKDF-SHA256/ChaCha20-Poly1305 per `0g-pc-e2ee` SPEC) and send the `_e2ee` envelope through the
   Router (router acceptance `0g-router#618`, shipped per the same doc). We would then hold `aad‖ciphertext` of both
   sides, so `sha256` of our own bytes must equal the signed hashes, and the Router never sees the prompt. Cost:
   an HPKE client in Python plus the response-unseal path; no deposit. Needs the SPEC read first (not done here).
2. *Compute SDK direct to the provider*: the broker then signs bytes we hold. Needs a ledger on 0G mainnet:
   `broker.ledger.depositFund(n)` (minimum 3 0G) and `transferFund(provider, 'inference', …)` (per
   `.claude/skills/sealedai-stack/SKILL.md`); not spent.

## 2026-11-07 follow-up (trust agent): status after the fixes

| Item | Status | Evidence |
|---|---|---|
| A1 signatures expire | **fixed, shown live**: demo-003 8/8, cutin-002 6/6, trust-kin-001 8/8 archived and ✓ offline (CLI and page) | `docs/evidence/faultline-verify-*.json` |
| A2 content binding | **open, cannot be fixed through the Router as called** (probe above). Options: our own E2EE client through the Router, or Compute SDK direct (ledger ≥ 3 0G) | `faultline-a2-probe.json` |
| A3 episode binding | **fixed as far as A2 allows**: `binding` {episode_id, commit_block, commit_blockhash, nonce} in every anchored prompt; the parser requires the nonce echo (`bad_nonce` → SAFE_HALT; happened live at cutin-002 cp6). The page checks blockhash(commitBlock) on Galileo and the echoed nonce of every accepted 0G decision. Not signature-bound until A2 | demo-003, cutin-002 |
| C2 / R9 rerun-until-good, front-running | **fixed, deployed**: `EpisodeRegistryV2` `0xeE2260cE4835059F0e0f1FB9C9948Ca5a7d4b5A4`; page shows run #seq and the evaluator's committed/completed/interrupted/aborted/never-finalized counts; configHash = keccak(prompt_hash, model, git commit) recomputed by the page | `faultline-registry-v2-deploy.log` |
| C1 commit before the first call | still the evaluator's clock for the tick, now backed by the nonce (A3). Storage `txSeq`s recorded in anchor.json at finalize | `runs/*/anchor.json` |
| R7 scenario hidden | **decided (team lead): reveal**. public.json carries `reveal {scenario_json, salt}` (at publish, just before finalize); sealed bundle keeps anchor.json too | anchor.test.ts |
| B2 public replay | **fixed for lead brake**: `packages/episode/src/replay.ts`, bit-exact on the fixture (test) and on trust-kin-001 (every field) and demo-003 (ground-truth fields; CARLA LiDAR not deterministic). Cut-in: not ported | replay.test.ts |
| C3 / R6 commitments opened | **fixed** via the reveal: page and CLI recompute scenario and result commitments against `getEpisode` | `onchain.ts` |
| A4 provenance | **fixed**: manifest `router_host`; chaos fake router logs `source: "chaos-fake"` | `cli.py` |
| R12 one key, stale files | **fixed**: envelope version 2 = HKDF-SHA256(tenant key, "faultline/episode/v2:"+id); version 1 still opens; `SEALED_FILES` allowlist | bundle.test.ts |
| ERC-8004 | **done**: agentId 579 (interface from the EIP text; deployed source unverified, call simulated first). Not in configHash yet | `faultline-erc8004.log` |
| T1 live demo link | not done (user's decision). `dist/` makes only https requests, so static https hosting works | README |
