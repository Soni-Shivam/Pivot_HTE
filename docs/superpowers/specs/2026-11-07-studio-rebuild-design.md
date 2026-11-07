# Studio rebuild: one coherent flow (design)

Date: 2026-11-07. App: `apps/faultline-studio` (vanilla TS + one `index.html`, esbuild). Backend: `packages/hedera/src/agent-console.ts`.

## Why
The user (2026-11-07): "very random redirects", "the entire website flow is fucked up", the "multi agent coordinated
attack" button "leads to a random page with recorded data", remove footnotes like "scripted", plan the whole flow, then
build it as a big architectural rebuild, with the thinking-orbs animation (github.com/Jakubantalik/thinking-orbs).
Follow-up: "we ran it ourselves, make the backend able to do this": the coordinated attack must run live.

## Audit: what is wrong today (main.ts / index.html at d8845d9)
1. Lab step 2: picking "Coordinated multi-vehicle attack" jumps to `/library#x-swarm`; "Lead vehicle brakes" jumps to `/research` (`main.ts:235`).
2. Lab step 3: "Replay a recorded test" leaves the flow for `/library` (`main.ts:169`).
3. Header "Sign in with wallet" jumps to Lab step 4, skipping steps 1-3 (`main.ts:141`).
4. Lab "Connect your own stack" swaps the view without changing the URL (`main.ts:193` uses `show`, not `go`).
5. The nav is numbered 01-05 like a sequence, but "03 Mission Control" and "05 Proof Explorer" are hard links to one paid run, and `/library` and `/results/:id` are not in the nav at all (Results lights up "04 Results & Research").
6. Two pages per run: `/mission/:id` and `/results/:id` repeat the verdict, video and evidence.
7. Dead code: the old live view (`#oldlive`), old results (`#oldres`), `startStream`, `openResults`, the 2-D scene renderer, `#again` with no handler.
8. Scenario clips carry "scripted clip" captions and a "these clips are scripted illustrations" footnote.
9. The swarm's plan and roles are hard-coded for `swarm-carla-010` (`renderPlan`, `ROLES`).
10. The backend accepts only the two cut-in suites, so a coordinated attack cannot be started.

## Goals
- Every button says where it goes, and goes there. No button changes page without saying so.
- One page per thing: one run page, one proof page, one list of runs, one catalogue of attacks.
- The coordinated four-car attack runs live from the Lab (free demo run, CARLA, PDM-Lite ego).
- Thinking orbs mark every moment where the agent or the page is thinking or loading.
- No "scripted" footnotes. Honesty comes from structure (status chips such as "Runs live" and "In development")
  instead of fine print.

## Non-goals
- Paid swarm runs. Paid permits are bound to `SUITES` in `packages/hedera/src/suites.ts` (cut-in only); changing
  what a payment buys is a PLAN/SECURITY decision, not a site fix.
- New attack families beyond cut-in and swarm. Lead brake, pedestrian, LiDAR dropout, intersection stay "In development".
- A framework migration. The studio stays vanilla TS.

## Anti-goals (a failure even if it works)
- A live-action label that opens a recording.
- Claims beyond the evidence: free runs are never "anchored"; preview clips are never shown as results (I12, SECURITY.md).
- Model weights or buyer rows reaching the 0G Router; any new LLM authority (I5, I9). The swarm runner is the
  existing `faultline.carla_swarm` (private tier, strict parse, safe halt), used unchanged.

## Information architecture
Nav (not numbered): **Overview** `/` · **Attacks** `/attacks` · **Runs** `/runs` · **Proof** `/proof` · **Research** `/research`.
Right side: console status · **Run a test** (`/lab`) · wallet button (connects in place, never navigates).

| Route | One job | Reached from |
|---|---|---|
| `/` | The story: problem → the four-car attack → its outcome → evidence → research → test your stack | nav, brand |
| `/attacks` | What attacks exist and what you can do with each | nav, home |
| `/lab` | Run a test: policy → attack → run type → authorize → `/run/:jobId` | header CTA, attack cards, run pages |
| `/run/:id` | One run, live or recorded: stage, plan, decision timeline, inspector, telemetry, verdict, evidence rail | runs list, home, Lab start |
| `/runs` | Recorded runs: featured runs, A/B arena, the full list | nav, run pages |
| `/proof[/:id]` | Check one run's evidence | nav, run pages, home evidence section |
| `/research` | Boundary hunt, honest benchmark, claim audit, counterfactual | nav, home, lead-brake card |
| `/stack` | Connect your own stack | home CTA, Lab step 1 |

Old paths keep working: `/mission/:id` and `/results/:id` → `/run/:id`; `/verify[/:id]` → `/proof[/:id]`;
`/library` → `/runs` (`history.replaceState`, no extra history entry).

### Button map (label → destination)
- Home hero: "Watch this run" → `/run/<paid 002>` (the hero video is paid test 002) · "Run a test" → `/lab` · "Judge mode".
- Home four-car section: "Watch this run" → `/run/swarm-carla-010` · "Run it live" → `/lab?attack=swarm`.
- Home attacks strip: "All attacks" → `/attacks`. Evidence: "Open the Proof Explorer" → `/proof/<paid 002>`.
  Research: "See the research" → `/research`. Final CTA: "Connect your stack" → `/stack`, "Run a test" → `/lab`.
- Attacks: Cut-in → "Run it live" `/lab?attack=cut-in`, "Watch a recorded run" `/run/<paid 002>`.
  Four-car → "Run it live" `/lab?attack=swarm`, "Watch a recorded run" `/run/swarm-carla-010`.
  Lead brake → "See the research" `/research#counterfactual`. Pedestrian, LiDAR dropout, intersection → status chip only.
- Lab: steps never leave `/lab`. Step 1 "Connect your own stack" → `/stack`. Start → `/run/<jobId>`.
- Run page: "Check the evidence" → `/proof/:id` · "Run your own test" → `/lab` · "All runs" → `/runs`.
- Runs: each row and featured card → `/run/:id`; "Run the arena live" stays on the page.
- Proof: "Check" stays on `/proof/:id`; a run link → `/run/:id`.

### Lab
1. **What you test**: PDM-Lite or Cautious IDM (from `/api/policies`).
2. **Attack**: Cut-in (CARLA, about 90 s) or Coordinated four-car attack (0G plans, then steers four cars every
   second; about 2 minutes; PDM-Lite only, so it is disabled with that reason when Cautious IDM is picked).
   `?attack=` preselects.
3. **Run type**: Live demo (free, not paid, not anchored) or Paid anchored test (0.001 HBAR; cut-in + PDM-Lite +
   wallet only, with the reason shown when disabled). "Replay a recorded test" is removed (that is `/runs`).
4. **Authorize & start**: as today (EIP-191 signature or guest), then `/run/<jobId>`.

### Run page (`/run/:id`, merges Mission Control and Results)
Header (title, live/recorded, state chips) → plan card (any run with a 0G plan, live or recorded) → stage (recorded
video, or the live progress panel with an orb) → decision timeline (+ "Asking 0G…" chip with an orb while live) →
inspector → telemetry → verdict (stats + evidence rail + the three CTAs).

### Thinking orbs
Vendor the MIT engine (`src/engine/*`, `src/presets.ts`, types) from thinking-orbs at commit `de85557` into
`apps/faultline-studio/src/orbs/` with its licence; a ~50-line vanilla mount (`src/orb.ts`) draws every
`canvas[data-orb]` (one rAF loop, paused offscreen and on hidden tabs, one static frame under reduced motion).
Uses: live progress (planning `weaving`, waiting for 0G `searching`, driving `working`, finishing `breathing`),
"Asking 0G…" timeline chip, Lab start while signing or queuing (`connecting`), Proof loading (`solving`),
page and table loading (`breathing`), the 0G box on the home diagram (`working`).

### Backend: live coordinated attack (free only)
`POST /api/demo-run` accepts `suite: "swarm-v1-carla"` with `mode: "free"` and `policy: "pdm-lite"`; anything else is
a 400 with a reason. It joins the CARLA lane and runs `python -m faultline.carla_swarm --out runs/demo-free-swarm-<stamp> --display ""`.
Same rate limits, caps, signature and guest rules as cut-in. `/api/stream` sends a `plan` event when `plan.json`
exists (live and replay). `runSummary` falls back to `metrics.ground_truth` for min TTC and min gap, and to
`director.mp4` for video (that cut is not time-aligned; the page says so).

## Copy rules
- Remove "scripted" captions and the footnote. Preview clips sit only on "In development" cards and say "Preview".
- Keep existing honest labels where a claim needs one ("not paid, not anchored" for free runs, in the evidence rail).

## Verification
`apps/faultline-studio/test/headless.mjs` adds a click-through: every nav link, header CTA and page CTA is clicked and
its URL and visible view are checked against the button map; the Lab picks the swarm attack and posts
`suite: "swarm-v1-carla"`; a test fails on any hard-coded link that is not in the route table.
`packages/hedera/test/console-guard.test.ts` style unit check for the demo-run swarm rules.

## Left to the builder
Visual polish within the existing system (colours, type, cards); orb placement details; copy wording within the rules above.
