# Faultline trust fixes: handoff to Shivam

From Vedant's session, 2026-11-07. Commit `faultline: trust audit fixes …` sits on top of your `4114cfd` (rebased,
no force push). Full evidence for every item: `docs/faultline-audit.md`. Read that first; this file is the to-do list.

## TL;DR
Three of our headline claims were only true at the moment of the run, or not at all:
1. **"8/8 processResponse true" expires.** The provider keeps signatures in an in-memory cache, 20 min by default
   (0g-serving-broker `config.go chatCacheExpiration`). demo-002 re-verified 40 min later → 0/8 (404
   `chat_id_not_found`). The same applies to cutin-001's 10/10.
2. **There was no Merkle proof check.** Storage SDK 1.2.13 ignores `{proof: true}` (`Downloader.js:289 // TODO: add
   proof check`), and `verify.ts` hardcoded `publicRootOk: true`.
3. **A valid signature didn't prove the logged action.** The signed text is `sha256(req):sha256(resp)` over the
   broker's rewritten bytes, and the Router adds `x_0g_trace` to the body, so nothing compared it with our log.

Plus verifier-page holes: stored XSS (could steal a pasted tenant key), registry address read from the untrusted
JSON, and a green "committed before" tick for a commit that doesn't exist.

## What changed (files)
| File | Change |
|---|---|
| `packages/episode/src/tee.ts` (new, browser-safe) | read provider service from 0G mainnet `InferenceServing` `0x47340d90…8d84`, `expectedSigner` (same rules as SDK `processResponse`), `fetchSignature`, `fetchQuote`, offline `checkArchived` (EIP-191), `checkTee` |
| `packages/episode/src/verify.ts` | `archiveTee` (used by publish); `verify` uses `checkTee`, `aggregatesOk`, and `publicDecisionsMatchSealed` (every public field vs the sealed chained line); `chainOk` renamed `decisionsWellFormed`. **Your `makeProcessResponse` / `verifySignatures` are kept unchanged** (ethers now loaded lazily), so `faultline sigs` still works |
| `packages/episode/src/publish.ts`, `bundle.ts` | public JSON now carries `tee` (signatures + service + TDX quote) instead of `verification` |
| `packages/episode/src/check.ts` | `aggregatesOk`: peak CCS, min TTC, min gap, max decel and collision recomputed from ticks |
| `packages/integrations/src/storage.ts` | `downloadBlob` reads `GET {indexer}/file?root=` (https, CORS `*`), falls back to `downloadToBlob`, **refuses bytes whose recomputed Merkle root ≠ root**; new `merkleRoot()` |
| `apps/faultline-web/*` | escape everything + CSP, pinned `EPISODE_REGISTRY`, evaluator shown, fail-closed commit tick, signatures checked in the browser, chaos banner |
| `faultline/router.py`, `replay.py` | `Decision.raw_b64` = exact Router body (sealed only, not in `PUBLIC_FIELDS`) for content binding later |
| `contracts/src/EpisodeRegistryV2.sol` + test | keyed by (evaluator, id), per-evaluator `seq`/`stats`, status 3 aborted, public `configHash`, `commitBlock`. **Not deployed, not wired** |

## Check it on your machine
```bash
git pull --rebase && . ~/.nvm/nvm.sh && npm ci && npm test && npm run typecheck
```
```bash
.venv/bin/python -m pytest tests/python -q
```
```bash
cd contracts && forge test --match-contract EpisodeRegistry
```
```bash
npm run fweb:build && npm run fweb:serve   # then http://localhost:5174/?root=0x03c68b42f385410a4dfabde299667490e29f2d23af5b616d9389070e4f2d7b44
```
On macOS: npm 79 pass / 0 fail / 1 skip; forge 14/14; Python 76 pass / 5 skip / 1 fail. The failure is
`test_lidar_tracker.py`, which imports `carla` without the `FAULTLINE_CARLA` gate; please add the skip marker. On
the page, demo-002 now honestly shows **signatures ✗ 0/8** (published before the archive existed).

## Next, in order (you have CARLA and the funded key)
1. **New anchored run with the archive.** `python -m faultline run --world carla --seed 7 --out runs/demo-003 --anchor`
   (and a cut-in one). Publish runs right after the loop, inside the 20 min window, so `tee.signatures` get filled.
   The page should show ✓ N/N. Put the new roots in README and `docs/evidence/faultline-matrix.md`, and change the
   evidence wording from "processResponse true" to "signature archived at publish, re-checkable offline".
2. **A2 content binding (one Router call).** Make one call, fetch `/v1/proxy/signature/<Zg-Res-Key>` at once, and
   test whether `sha256(Router body with x_0g_trace removed)` equals the second half of `text` (try the raw bytes
   and the re-serialized JSON; `raw_b64` keeps the exact bytes). If it matches, check that in `checkTee` and publish
   the body. If not, decide whether to call the provider directly through the Compute SDK (a ledger deposit is needed).
3. **A3 episode binding.** Deploy `EpisodeRegistryV2`
   (`forge script` like `DeployRegistry.s.sol`), update `abi/episodeRegistry.ts`, `anchor.ts` (commit with
   `configHash = keccak(prompt_hash, model, git commit)`), the CLI and the page (`getEpisode(evaluator, id)`,
   `stats`). Then put `episode_id` and `blockhash(commitBlock)` in the user message and ask the model to echo a
   short nonce, which proves each decision came after the commit, for this episode.
4. **Scenario decision (R7, needs Vedant's or the team's call).** The scenario isn't really hidden (seed
   brute-forceable, trajectory shows it). Recommended: reveal `scenario.json` and the salt at finalize. That
   enables a bit-exact browser replay (port `KinematicWorld`, which uses only `+ - * / min max sqrt`) and a public
   commitment check.
5. **Live demo link (track requirement).** The page now works from https because it no longer needs the http
   storage nodes; host the `dist/` statically.
6. Smaller items: Router URL host and real `source` for the fake router in the manifest; per-episode key via HKDF
   (tenant key, episode_id); explicit file allowlist in `sealedTar`; ERC-8004 registration of the adversary
   (Galileo identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`); storage `txSeq` recorded at finalize.

## Avoiding merge conflicts
- **Ownership.** Vedant: `packages/episode/src/{tee,verify,check,bundle,publish}.ts`, `packages/integrations/src/
  storage.ts`, `apps/faultline-web/`, `contracts/*V2*`, `docs/faultline-audit.md`. Shivam: `faultline/**/*.py`,
  `viz/`, `scripts/`, the hunt/swarm/cut-in code, `docs/evidence/`. Anything outside your area: small commit and a
  note in the commit message.
- **Shared files.** `docs/TASKS.md`: append-only, one bullet per change, never edit others' lines.
  `faultline/router.py`: keep `Decision` field order; add new fields only at the end with a default.
- **Always** `git pull --rebase` before pushing; no force-push to `build/faultline`; commit small and often.
- If you change the public JSON shape, update `PUBLIC_FIELDS` and the `checkTee`/`verify` tests in the same commit.
