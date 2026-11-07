# Studio PRD build: contract for every agent

Authority, in order: the user's words → `docs/submission/Faultline_Frontend_Product_Requirements.txt` (the PRD; .docx alongside) →
`docs/SECURITY.md` allowed claims → this contract → `docs/superpowers/specs/2026-11-07-studio-rebuild-design.md`.
One deliberate deviation from the PRD: the coordinated four-car attack (`swarm-v1-carla`) **runs live** as a free demo
(user instruction after the PRD's audit date; backend in `a232b61`). It is a selectable Lab attack, free only, PDM-Lite only.
Paid tests stay cut-in only (`packages/hedera/src/suites.ts` SUITES is payment-bound; do not change it).

App: `apps/faultline-studio` (vanilla TypeScript, esbuild via `build.mjs`, no framework, no new npm dependencies).
Node: `. ~/.nvm/nvm.sh` (Node 22). Typecheck: `npx tsc --noEmit -p tsconfig.json` (repo root). Never print `.env` values.
Do not commit; the orchestrator commits. Do not edit files you don't own. Do not touch `packages/` (backend is fixed for this build).

## Routes (`src/routes.ts`, fixed, tested by `test/routes.test.ts`)
`/` Discover · `/lab` Run a test · `/mission/:id` · `/results/:id` · `/verify[/:id]` · `/library` Explore runs · `/research` · `/stack`.
Aliases: `/run/:id`→`/mission/:id`, `/proof[/:id]`→`/verify`, `/runs`→`/library`, `/attacks`→`/#scenarios`, unknown → `/`.
Static apps (not SPA routes, never intercepted): `/verifier/index.html?root=0x…` (the independent verifier, `apps/faultline-web`)
and `/memory/index.html` (Safety Memory, `apps/memory-web`). Build every link with `href.*`; never hand-write a path.
`id` is a run name (e.g. `swarm-carla-010`, `demo-free-carla-<stamp>/<site>__<stack>`) or a live job id (16 hex chars).
Nav: Discover, Run a test (Stack lights it), Explore runs (Mission/Results light it), Research, Verify (`navFor`).

## Files and ownership
| File | Owner | Job |
|---|---|---|
| `index.html` | shell | head, global design tokens and base component CSS, skip link, `<header id="hdr">`, `<main id="main">` with one empty `<section id="v-<page>" class="hidden" aria-labelledby>` per page, `<div id="judge">` dialog, script tag |
| `src/main.ts` | shell | boot: register pages, start orbs, `route()` |
| `src/shell.ts` | shell | header + nav (desktop) + labelled phone menu, runner status strip, offline strip, link interception (`isStaticApp` excluded), judge mode (focus trap, Escape, restore focus), `go(path)` export |
| `src/core/*.ts` | shell (phase 1 creates them) | shared, page-agnostic code; pages import, never edit |
| `build.mjs` | shell | also builds `apps/faultline-web` and `apps/memory-web` and copies their dist to `dist/verifier/` and `dist/memory/`; `STUDIO_OUT` env overrides the output dir |
| `src/pages/<page>.ts` | that page's agent | everything visible on that page, its event handlers and a `css` string |
| `test/e2e.mjs` + `test/fixtures/*` | test agent | Playwright journeys (below) |

## Core modules (exact exports; phase 1 creates these by moving code out of the current `main.ts`)
- `core/api.ts`: types `Tick, Decision, Run, Plan, Job`; `api(path)`, `media(path)` with the `LITE` set **verbatim** (another
  session owns that list), `getJson`, `postJson`, `stream(path, body, onEvent, signal?)` (NDJSON), `verifyRoot(root)` → typed
  `/api/verify` result or `{ status: 400|422|429|503, error, rootMismatch? }`.
- `core/dom.ts`: `$`, `esc`, `num`, `short`, `kv`, `extLink`, `copyText`, `sleep`, `galileoTx`, `galileoAddr`, `loading(text, orbState?)`.
- `core/state.ts`: `health` store (`online`, `carla`, `zg`, `hedera`, `queue`, `caps`, `checked`) with `onHealth(fn)`;
  wallet store (EIP-6963 discovery, `connect`, `walletErr`, `onWallet(fn)`); `lastJob` persisted `{ jobId, runName?, mode, suite, startedAt }`.
- `core/run.ts`: `loadRun(id, onEvent)` (live job or replay; returns `{ run, ticks, ds, plan, state }` and streams), `videoOf`,
  `runTitle`, `say`, `why`, `RUN_VIDEO`, `runTabs(id, active: 'mission'|'results'|'verify')` → sibling-link bar HTML.
- `core/trust.ts`: `trustFromRun`, `railHtml`, `PS` statuses + `statusChip(ps)` (icon + text, never colour alone),
  `METHOD` labels: `browser` "Checked in this browser", `runner` "Checked by local runner", `meta` "Metadata only", `external` "Open external explorer".
- `core/catalogue.ts`: attack catalogue (cut-in live, swarm live, lead brake recorded `demo-003`, pedestrian / LiDAR dropout /
  intersection in development with preview clips), featured runs (`FEATURED`, `SWARM`, `LEAD_BRAKE`).
- `core/a11y.ts`: `radioGroup(el)` (arrow/Home/End roving focus, `aria-checked`), `tabs(el)` (arrows, `aria-selected`, tabpanel), `announce(text)` (polite live region).
- Page module shape: `export const page = { id: Page, title: string, css: string, mount(root: HTMLElement): void, open(id: string | null, search: URLSearchParams): void, leave?(): void }`.
  `mount` runs once (renders the section's HTML); `open` runs on every visit; `leave` stops streams/timers (use `AbortController`).

## Backend facts (read-only; cite, don't invent)
- `GET /api/health` → `{ ok, carla, zg, hedera, queue:{running,waiting}, caps:{runs_left,buys_left} }`.
- `GET /api/policies` → `[{ id, name, description, digest, compatible, paid }]` (paid only for `pdm-lite`).
- `GET /api/catalog` → `{ cap, pending:[{ jobId, suite, hashscan }] }`. `POST /api/launch {jobId}` → `{ run }`.
- `POST /api/demo-run {policy, suite, mode, guest|address+message+signature}` → `{ jobId, queuePos, label, duplicate? }`; suites
  `cut-in-v1-carla`, `swarm-v1-carla` (free + pdm-lite only), `cut-in-v1-kinematic`; same visitor within 30 s gets the same job back.
- `POST /api/stream {run, mode:'replay', speed}` or `{job, mode:'live'}` → NDJSON `meta, plan, queue, phase, step, await0g, ticks, decision, log, idle, done, error`.
- `GET /api/runs`, `/api/run?name=`, `/api/jobs/:id` (in-memory: lost on console restart → show "This live job is no longer
  on the runner" and link to `/library`), `GET /api/live/:id` (MJPEG, cut-in only), `GET /api/showcase` (`{ items }`).
- `GET /api/verify?root=` (commit `cab7d72`): contract in the Verify brief; fixture `test/fixtures/verify-002.json`.
- Run JSON is **not** downloadable through `/media`; "download the evidence" means the independent verifier link.

## Content rules (PRD §7, SECURITY.md)
- Never "safe", "certified", "trustless", "tamper-proof" as a verdict. Outcome sentence: "Avoided collision in this test" / "Collision occurred in this test"; Interrupted shown beside it when the run did not complete.
- Provenance line on every data card: Recorded / Live / Replay · CARLA / kinematic · ground truth / LiDAR · checked in browser / by runner / on-chain link.
- Free runs: "not paid, not anchored". No "scripted" footnotes; clips only on In-development cards say "Preview".
- A signature is never called a payment. CCS is "criticality score", not crash probability.
- Header status: "Recorded content available" when the console is unreachable; "Local runner online · CARLA online|offline" when it is.

## Design system (PRD §6, existing tokens in `index.html`)
Dark ink nav, off-white reading cards, accents yellow/cyan/pink/purple/lime, one primary button per section, body ≥16 px / 1.45,
max width 1280, 12/8/4 columns, 16 px phone gutters, no horizontal scroll at 320/375/768/1024/1440. 150–250 ms transitions;
`prefers-reduced-motion` removes them. Touch targets ≥44 px. Thinking orbs (`orb(state, 20|64, {dark})`) on every
thinking/loading moment. Units beside values, fixed decimals, full IDs on hover/focus/copy.

## Journeys the test agent must pass (PRD §9), with the API mocked
1. Judge, console offline: `/` → recorded run → results → verify → judge tour 6 steps, no dead end, no page error.
2. Guest free run: Lab 1→4, CARLA offline disables live with reason and offers Replay; online starts exactly one job (POST count 1 on double click), lands on `/mission/<job>`, reload returns to the same job.
3. Wallet: sees the exact EIP-191 message; rejection (4001) keeps choices; signing posts one request with signature.
4. Paid path: review card shows merchant/suite/cap/0.001 HBAR/payer; pending paid job shows Launch, never a second pay.
5. Swarm: `/lab?attack=swarm` posts `suite:"swarm-v1-carla"`; with Cautious IDM selected swarm is disabled with its reason.
6. SAFE_HALT run: Mission and Results show Interrupted + reason.
7. Verify: fixture `/api/verify` → Verified rows name their method; 422 rootMismatch:false → Unavailable (not Failed); free run → Not applicable; "Verify independently" links `/verifier/index.html?root=<publicRoot>`.
8. Every `a[href^="/"]` on every page parses to a known page (or is a static app); no text matches /scripted/i; widths 320/375/768/1024/1440 have no horizontal scroll; keyboard: radio arrows in Lab, tab arrows in Results, Escape closes judge.
