# Faultline Studio: handoff for the next coding agent

Branch `feat/faultline-studio` (Pivot_HTE), from Vedant's session, 2026-11-07. Read this file first, then
`CLAUDE.md`, `packages/hedera/README.md`, and `docs/CARLA_PAYMENT_HANDOFF.md`.

## What this branch adds

Studio is the product UI. It takes one test from purchase to evidence:
**Order → Pay (x402 on Hedera) → Run (live) → Results (worst moment, evidence, compare)**.

The browser never holds a key or a permit. A local "agent console" does, and it runs on the customer's machine next
to their policy.

| File | Role |
|---|---|
| `apps/faultline-studio/index.html` | Layout and all CSS. RISE-style palette: black page, colour-block cards with ink outlines, pills. Strict CSP (Google Fonts only) |
| `apps/faultline-studio/src/main.ts` | The 4 screens: catalog, hold-to-pay, x402 step animation, live view (canvas scene, decision list, telemetry, gauge, job timeline), results (scrub to worst moment, Hedera receipt, 0G evidence, compare table) |
| `packages/hedera/src/agent-console.ts` | Local server on `127.0.0.1:8788` (details below) |
| `packages/hedera/src/buyer.ts` | The x402 purchase from `buy-stress-test.ts` as a library that reports each step. `buy-stress-test.ts` is now a thin CLI wrapper with the same behaviour and output |
| `packages/integrations/src/storage.ts` | 0G Storage upload fix (see Known issues #1) |

What `agent-console.ts` does:
- serves `apps/faultline-studio/dist`
- holds the Hedera payer key, from `.env`
- streams NDJSON from:
  - `POST /api/buy {suite, mode: 'quote'|'pay'}`: x402 steps. Quote mode signs nothing and spends nothing.
  - `POST /api/launch {jobId}`: spawns `run-paid-job.ts`.
  - `POST /api/stream {run, mode: 'live'|'replay', speed}`: run events, either by tailing a live run or replaying a recorded one.
- serves `GET /api/catalog`, `/api/runs` and `/api/runs/:name`. These never return the salt, the permit or any key.

## Run it

```bash
. ~/.nvm/nvm.sh && npm ci
npm run hedera:serve          # merchant service, 127.0.0.1:8787 (needs HEDERA_* in .env)
npm run studio                # builds the page and starts the console, http://127.0.0.1:8788
```

`.env` keys needed for a paid run:
- `HEDERA_PAYER_ACCOUNT_ID`, `HEDERA_PAYER_PRIVATE_KEY`, `HEDERA_MERCHANT_ACCOUNT_ID`, `HEDERA_PAYMENT_AMOUNT`
- `ZG_ROUTER_URL`, `ZG_API_KEY`, `RPC_URL`, `STORAGE_INDEXER`, `FAULTLINE_TENANT_KEY`
- the chain signer named by `FAULTLINE_CHAIN_SIGNER`. Vedant's machine uses `FAULTLINE_CHAIN_SIGNER=STUDIO_PRIVATE_KEY`, because `PRIVATE_KEY` is empty there.

The page shows "Runner not ready: …" and disables Hold to pay if any key is missing. Never print or commit `.env`
values.

**Free ways to check the UI:**
- **Replay** a run under Runs (it reads `runs/<name>/`).
- **Quote only** runs discovery, the 402 quote, the facilitator check and the policy checks, then stops before signing.

A real purchase is **Hold to pay**: 0.001 testnet HBAR, plus a few cents of 0G Router, Galileo gas and storage fees for
the run. The console allows at most 3 paid buys per process (`FAULTLINE_CONSOLE_MAX_BUYS`).

## Checks

```bash
npm run typecheck && npm test          # 92 pass, 0 fail, 1 skip at handoff
npm run studio:build
```

There is no headless test for Studio yet. Vedant verified it with a Playwright-based browser script against a replay
of paid job 001 and a quote-only purchase; screenshots are not committed.

**Recommended next step:** an `apps/faultline-studio/test/headless.mjs` like `apps/faultline-web/test/headless.mjs`
that replays a fixture run and asserts the timeline reaches "Report ✓".

## Evidence produced on this branch

Paid job `c05897152fb3772005171fb654ffed37` (suite `cut-in-v1-kinematic`), bought and launched from Studio:

| Stage | Evidence |
|---|---|
| Hedera payment | `0.0.9185802@1794009393.382135011` |
| Galileo commit | `0x12e3cf53c603587c4505e87d9e58f59cff7471bc262bcc8b443b723dadb74eb7` (registry seq 7, commit block 64251936) |
| 0G decisions | 7 decisions from 0G, then cp7 `SAFE_HALT` with reason `bad_nonce` (the A3 nonce echo failed, so the run halted as designed) → status `interrupted` |
| Result | CCS 0.964, min TTC 0.91 s, min gap 0.97 m, no collision |
| First publish | Hung. See Known issues #1 |
| 0G Storage | public `0x470ca9ba5b0816493e7e4fd3b9520ba5648749b2955904962e084251c7d19971` (txSeq 160817); sealed `0xaeb35c164a7ab390d0e08c97e2dc23a34568a9faf517675dc8ad18d828b83bcb` (txSeq 160816). 7/7 signatures archived. Re-published manually with the fixed adapter |
| Galileo finalize | `0xb145a17287a7b9816c6369fd4e87912a51fab5556af511e317b328e0fe9d774d`, `onchainMatches: true` |

The run directory exists only on Vedant's machine
(`runs/paid-c05897152fb3772005171fb654ffed37-1794009582394`, gitignored). The Hedera job record says `interrupted`,
because the runner reported before the manual re-publish. That is accurate: the automated pipeline did not finish on
its own.

`docs/evidence/faultline-ledger.md` was **not** committed from this machine. The run regenerated it from local runs
only and would have wiped your rows. Run `faultline/ledger.py --backfill` on your machine if you want this run listed.

## Known issues and what to do next

1. **0G Storage submit can run out of gas** (fixed in `storage.ts`).
   - Cause: SDK 1.2.13 under-estimated `Flow.submit` gas.
     - Seen live: tx `0x20d524e1…0b62` reverted (status 0, 315,903 of 320,353 gas used).
     - The same call succeeds with 500k gas.
   - After a revert the SDK loops forever on "Waiting for storage node to sync" (`Uploader.js`, `while (true)`).
   - The adapter now:
     - passes `gasLimit` (default 1,000,000, env `ZG_STORAGE_GAS_LIMIT`)
     - watches the submit receipt and fails within seconds on a revert
     - times out after `ZG_STORAGE_TIMEOUT_MS` (default 6 min)
   - Not done: the CLI cannot yet resume a run whose publish failed. Vedant ran `npm run faultline -- publish <dir>` then `finalize <dir>` by hand.
2. **`bad_nonce` halts.**
   - The 0G model sometimes fails to echo the commit-block nonce (`docs/evidence/carla-crash/nonce-rate.json` on main tracks the rate).
   - Each such failure halts the run. That is correct (fail closed), but it cuts demo runs short.
   - Options: a firmer prompt, or one re-ask within the same checkpoint. Never accept an answer that fails the check.
3. **Studio gaps.**
   - CARLA suite: only reachable where CARLA is up. The console checks TCP 2000, and the page marks the suite offline otherwise.
   - Compare: needs more runs of the same policy to be meaningful.
   - The live scene draws the kinematic two-lane frame. For CARLA runs it uses the same `s`/`lat` fields if present.
4. **The recovery path**, so a failed launch never loses a paid permit. Keep it.
   - Paid but unstarted jobs are re-activated from `.faultline-hedera-state/activation-*.json`. This is idempotent on the server and never pays again.
   - Such jobs appear in Order under "Paid, not started", with a Launch button.
   - The console blocks payment while `runnerError()` reports a missing key.

## Conventions this branch keeps

- Payment endpoints accept POST only, require the header `x-faultline-console: 1`, check the Host header, send no CORS headers, and cap paid buys per process.
- `buyer.ts` steps carry public data only (accounts, amounts, transaction IDs, hashes).
- The spending policy (`spending-policy.ts`) authorizes payment. The UI never does.
- Studio describes Hedera (payment settled) and 0G (who decided, what was published) as separate claims.

## References used for the design

- **F1Dash** (pit-wall telemetry): the live screen.
- **NASA Eyes** (time scrubber): the Results "Worst moment" scrub.
- **GitHub Actions** run view: the job timeline.
- **LangSmith evaluations**: the compare table.
- **Foretellix**: KPI verdict pills.
- **Linear**: restraint.
- **RISE** brand cards: colour, pills and ink outlines. Vedant asked for no filler text, only labels and data.
- **Emil Kowalski's motion principles**: short ease-out transitions, a 0.97 press scale, nothing animated without a reason.
