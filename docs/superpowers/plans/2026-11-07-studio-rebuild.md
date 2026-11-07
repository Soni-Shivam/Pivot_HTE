# Faultline Studio v7 rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `apps/faultline-studio/` as one connected product: Discover → scenario → its Mission Control → its Results → its Proof. Every label leads where it promises, and no footnote clutter remains.

**Architecture:** The site stays a static single-page app: `index.html` plus one esbuild bundle, deployed on Vercel. Vercel proxies `/api/*` and `/media/*` to the agent console. A new pure module `src/model.ts` holds the scenario catalog, route parsing, run labels and every link destination. It is unit-tested. `main.ts` renders views from it. The headless test asserts every link in the IA table below.

**Tech Stack:** TypeScript, esbuild (existing), Playwright core 1.64.1 (existing, for the headless test), `node --test` through `tsx` (already a devDependency). No new dependencies.

**Spec:** the coordinator brief of 2026-11-07, "Plan and then rebuild the Faultline Studio website". Its hard requirements are copied into Global Constraints.

## Global Constraints

- Labels match destinations. Every scenario card, including "Coordinated multi-vehicle attack", opens `/scenario/<id>`.
- Only the CARLA cut-in runs live. Say so in the main layout: "Only the CARLA cut-in can run live today."
- No footnotes. Remove the word "scripted", "source: …" and small grey provenance lines from the main layout. Provenance lives only in the Proof Explorer and each run's Evidence tab.
- A scenario without a live 0G loop shows a visible "Recorded example" badge.
- No 2-D cartoon simulator anywhere. Delete `drawScene`, `#scene` and `#rscene`. Use recorded CARLA video or the live MJPEG stream, with "run, then reveal".
- The five destinations plus Judge mode stay. A persistent run context ("which run am I looking at") has a Switch run control.
- The wallet flow stays as is: EIP-6963 plus legacy injection, guest path, signed EIP-191 request, caps. The browser never holds keys.
- No em dashes. Plain headings. Every number comes from the API or from `docs/evidence/*.md`, cited in a code comment.
- No new dependencies. Never print or commit `.env` values or the Vercel token.

## Review Focus

1. Run names that contain `/` (for example `demo-free-carla-…/r7l-2s3__pdm_lite`) must round-trip through `/mission/…`, `/results/…` and `/verify/…`. Test: `model.test.ts` `runPath` round-trip.
2. A live job id (16 hex) as the context run must keep working after the run ends, for Results and Proof. Test: the headless guest flow lands on `/results/<job>`.
3. If the console is offline, scenario pages still show their clip, title and badge, and their links stay correct. Test: the headless offline pass.
4. A stale run context in localStorage that points to a run that no longer exists falls back to paid test 002, never to an error page. Test: `model.test.ts` `contextRun`.
5. An unknown route (`/library`, `/foo`) renders Discover. It never shows a blank page or a generic list. Test: headless.

---

## Live link and flow audit (v6, https://faultline-av-ethmumbai.vercel.app, 2026-11-07)

Method: a Playwright crawl of every route at 1440×900, which clicks every in-page button that has no side effects. Start, wallet, copy and arena buttons were not clicked. Script: `scratchpad/audit/audit.mjs`.

`:F` = `paid-de2d56fd2f3cd49fb30c1a7633f9d8c1-1794006602051` (paid test 002). ✗ = mismatch, which is a bug.

| route | element | goes to today | should go to | |
|---|---|---|---|---|
| header | faultline. | / | / | |
| header | 01 Discover | / | / | |
| header | 02 Safety Lab | /lab | /lab | |
| header | 03 Mission Control | /mission/:F always | /mission/<context run> | ✗ loses run context |
| header | 04 Results & Research | /research | /results/<context run> (Research is linked from there) | ✗ label says Results |
| header | 05 Proof Explorer | /verify/:F always | /verify/<context run> | ✗ loses run context |
| header | Sign in with wallet | /lab step 4 | /lab step 4 (unchanged) | |
| / | Explore real attack | /mission/:F | "Watch the paid cut-in test" → /scenario/cut-in | ✗ vague label, skips the scenario |
| / | Verify evidence | /verify/:F | /verify/:F, labelled "Check the proof" | |
| / | Judge mode (3 min) | overlay | overlay | |
| / | Open in Mission Control (swarm section) | /mission/swarm-carla-010 | section removed; swarm card → /scenario/swarm | |
| / | Scenario families clips (5) | not clickable | each card → /scenario/<id> | ✗ dead cards, "scripted clip" footnote |
| / | Open the Proof Explorer | /verify/:F | /verify/:F | |
| / | See the research | /research | /research | |
| / | Connect your stack | /stack | /stack | |
| / | Open the Safety Lab | /lab | /lab | |
| /lab s2 | Coordinated multi-vehicle attack | /library#x-swarm (generic test library) | /scenario/swarm | ✗ the user's reported bug |
| /lab s2 | Lead vehicle brakes | /research | /scenario/lead-brake | ✗ unrelated page |
| /lab s3 | Replay a recorded test → Next | /library | mode removed; recorded runs are reached through scenarios | ✗ generic list |
| /lab s4 | Watch a recorded test | /library#x-runs | "Watch the recorded cut-in" → /scenario/cut-in | ✗ generic list |
| /lab s1 | Connect your own stack | /stack view, but the URL stays /lab | /stack (URL changes) | ✗ URL does not match the view |
| /mission/:F | decision chips, Jump to worst moment | in-page | in-page | |
| /mission/:F | Check the evidence for this run | /verify/:F | /verify/<run>, labelled "Check the proof" | |
| /mission/:F | See the results | /results/:F | /results/<run> | |
| /mission/:F | Run your own test | /lab | /lab | |
| /results/:F | Open in Mission Control | /mission/:F | /mission/<run> | |
| /results/:F | Check the evidence | /verify/:F | /verify/<run> | |
| /results/:F | tabs (5) | in-page | in-page | |
| /results/:F | Replay with the decision timeline | /mission/:F | /mission/<run> | |
| /research | Featured result: paid test 002 | /results/:F | "Back to results" → /results/<context run> | |
| /research | All recorded tests | /library | removed | ✗ generic list |
| /verify/:F | Check, Check again | in-page | in-page | |
| /verify/:F | explorer links | chainscan, hashscan | unchanged | |
| /stack | tabs, Copy, onboarding | in-page | in-page | |
| /library | whole page | a generic list of 25 runs, swarm, A/B, paid 002 | route removed; /library → Discover | ✗ |
| any | 2-D top-down canvas (`#scene`, `#rscene`) | hidden but still in the bundle | deleted | ✗ |
| / , mission | "Recorded · paid test 002 · CARLA Town10", "prototype run, not anchored", telemetry source line, video notes | main layout | Evidence tab or Proof Explorer only | ✗ footnotes |

## Information architecture (v7)

State model, owned by `src/model.ts` and stored in localStorage:

- `ctxRun`: the run in view. It is set when any of `/scenario/<id>` (its featured run), `/mission/<run>`, `/results/<run>` or `/verify/<run>` opens. Key `faultline.run`. Default: paid test 002. The three run nav items use it.
- `myRuns`: job ids this browser launched, newest first, at most 10. Key `faultline.myruns`. Shown in Switch run.
- Lab state (`faultline.flow`, unchanged): `policy`, `attack` (always `cut-in-v1-carla`), `mode` (`free` | `paid`), `guest`, wallet rdns.
- Scenario: derived from a run (`scenarioForRun(name, family)`), never stored.

Scenario catalog (`SCENARIOS`, in display order). Each row lists its featured run and its source.

| id | title | badge | featured run | data |
|---|---|---|---|---|
| cut-in | Cut-in | Runs live | `:F` paid test 002 (anchored, 7 of 7 signatures; `docs/evidence/faultline-paid-job-002-carla.md`) | live suite `cut-in-v1-carla` |
| swarm | Coordinated multi-vehicle attack | Recorded example | `swarm-carla-010` (10 of 10 from 0G; `faultline-swarm.md`) | plan from `/api/showcase` |
| lead-brake | Lead vehicle brakes | Recorded example | `demo-003` (8 of 8 from 0G, anchored; `/api/run?name=demo-003`) | |
| lidar-dropout | LiDAR dropout | Recorded example | `cutin-001`, whose decisions are replayed under dropout (`faultline-occlusion.md`) | occlusion table |
| pedestrian | Pedestrian crossing | Recorded example | none: the main layout says "No 0G attacker in this scenario yet." | clip only |
| intersection | Intersection conflict | Recorded example | none: same line | clip only |

Pages: each has one purpose, its entry points, its data, and every link with its exact destination.

| route | purpose | entry points | reads | links and buttons → destination |
|---|---|---|---|---|
| `/` Discover | Understand Faultline and pick a scenario | brand, nav 01, unknown routes, `/library` | `/api/runs` (card metrics), `/api/health` | "Watch the paid cut-in test" → `/scenario/cut-in`; "Run the cut-in live" → `/lab`; "Judge mode" → overlay; each of 6 scenario cards → `/scenario/<id>`; "Open the Proof Explorer" → `/verify/:F`; "See the research" → `/research`; "Connect your stack" → `/stack`; "Open the Safety Lab" → `/lab` |
| `/scenario/<id>` | What the scenario is, its real recorded run, its proof, and whether it can run | Discover cards, Lab scenario cards, run bar | `/api/run?name=`, `/api/stream` replay (decisions), `/api/showcase` (swarm plan) | with a run: "Open in Mission Control" → `/mission/<run>`, "See the results" → `/results/<run>`, "Check the proof" → `/verify/<run>`; cut-in only: "Run this scenario" → `/lab`; no run: "Run the live cut-in instead" → `/lab`; "All scenarios" → `/#scenarios` |
| `/lab` Safety Lab | Configure and launch a live cut-in run | nav 02, scenario CTA, wallet button | `/api/policies`, `/api/health`, `/api/catalog` | steps 1–4 in-page; step 1 "Connect your own stack" → `/stack`; step 2 non-live cards → `/scenario/<id>`; step 4 "Watch the recorded cut-in" → `/scenario/cut-in`; Start → `/mission/<jobId>` |
| `/mission/<run>` | Watch the run: live progress, then the recorded CARLA video and decision timeline | nav 03, scenario page, Lab start, run bar | `/api/stream`, `/api/live/<job>` MJPEG, `/media/…` | run bar: "Mission Control" `/mission/<run>`, "Results" `/results/<run>`, "Proof" `/verify/<run>`, "Switch run" dialog, scenario name → `/scenario/<sid>`; verdict: "See the results" → `/results/<run>`, "Check the proof" → `/verify/<run>` |
| `/results/<run>` | Verdict, worst moment, metrics, reasoning, comparison, evidence | nav 04, mission verdict, run bar | `/api/stream` replay or job, `/api/run` | "Open in Mission Control" → `/mission/<run>`; "Check the proof" → `/verify/<run>`; "Research: where the agent lost" → `/research`; Evidence tab "Open the Proof Explorer" → `/verify/<run>` |
| `/research` | Boundary hunt, benchmark, claim audit, counterfactual | Results link, Discover, Judge step 6 | `/hunt.json`, evidence constants | "Back to results" → `/results/<ctxRun>` |
| `/verify/<run>` | Proof Explorer: every claim with its status and artifact | nav 05, results, mission, Discover | `/api/runs`, `/api/run`, `/api/jobs/<id>`, `/api/stream` | Check → `/verify/<input>`; explorer links (external) |
| `/stack` | Bring your own AV stack | Lab step 1, Discover CTA | static | tabs and copy in-page |

The run bar appears on mission, results and verify. It reads "Run: <label> · <scenario title>" with the three page tabs and a Switch run button. The dialog lists the featured run of each scenario, then "Your runs" (`myRuns`), then the 5 newest completed guest CARLA runs from `/api/runs` (`demo-free-carla-*`). Choosing one goes to the same page type for that run.

Judge mode steps: 1 `/` #problem · 2 `/scenario/swarm` (plan) · 3 `/mission/:F`, jump to the worst moment · 4 `/verify/:F` timeline · 5 `/verify/:F` Hedera group · 6 `/research` claims.

---

### Task 1: model module (catalog, routes, context)

**Files:**
- Create: `apps/faultline-studio/src/model.ts`
- Test: `apps/faultline-studio/test/model.test.ts`

**Interfaces:**
- Produces: `FEATURED: string`; `SCENARIOS: Scenario[]`, where `Scenario = { id, title, what, live: boolean, run: string | null, clip: string, family: string }`; `scenarioById(id): Scenario | undefined`; `scenarioForRun(name: string, family?: string | null): Scenario | undefined`; `runPath(name): string` (encodes each `/` segment); `parseRoute(pathname): { page: 'home'|'scenario'|'lab'|'mission'|'results'|'research'|'verify'|'stack', id: string }` (unknown → home); `runLabel(name): string`; `contextRun(stored: string | null): string`; `navHrefs(run): { mission, results, verify }`.

- [ ] Step 1: write the tests. `parseRoute('/scenario/swarm')` → `{page:'scenario', id:'swarm'}`. `parseRoute('/library').page === 'home'`. `parseRoute('/mission/demo-free-carla-x%2Fr7l')` round-trips with `runPath`. `scenarioForRun('swarm-carla-010').id === 'swarm'`. `scenarioForRun(FEATURED).id === 'cut-in'`. `scenarioForRun('demo-003').id === 'lead-brake'`. `scenarioForRun('abc', 'cut_in').id === 'cut-in'`. `SCENARIOS.filter(s => s.live).map(s => s.id)` deep-equals `['cut-in']`. `contextRun(null) === FEATURED`. `contextRun('') === FEATURED`. `navHrefs('a/b').mission === '/mission/a/b'`.
- [ ] Step 2: `npx tsx --test apps/faultline-studio/test/model.test.ts` must FAIL (module missing).
- [ ] Step 3: implement `model.ts`.
- [ ] Step 4: run the tests again. Expected: all pass.
- [ ] Step 5: commit.

### Task 2: markup (index.html)

**Files:** Modify `apps/faultline-studio/index.html`.

- [ ] Delete the `#oldlive`, `#oldres` and `#v-explore` sections and the swarm "example" and "consequence" cards on Discover.
- [ ] Add `#v-scenario`, `#runbar` and `<dialog id="switcher">`.
- [ ] Replace the families strip with a `#scenarios` grid, rendered from `SCENARIOS`.
- [ ] Change the nav item 04 label target to results. Hero buttons get the labels from the IA table.
- [ ] Remove the source line in the telemetry card head, the hero figcaption, and the "Explore" wording in the offline banner.
- [ ] Lab: drop `.fam` from step 2. Add the line "Only the CARLA cut-in can run live today." Step 4 recorded button → `<a href="/scenario/cut-in">Watch the recorded cut-in</a>`.

### Task 3: router, context, Discover, scenario page (main.ts)

**Files:** Modify `apps/faultline-studio/src/main.ts`.

**Interfaces:** consumes all of Task 1.

- [ ] `route()` uses `parseRoute`. Opening a run page or a scenario page sets `ctxRun` and re-renders the nav hrefs and the run bar.
- [ ] `/library` and unknown routes do `history.replaceState` to `/`.
- [ ] Delete `drawScene`, `carShape`, `pillAt`, `startStream`, `openResults`, `drawResults`, `renderExplore`, `loadRuns`, `gotoExplore`, the families strip and the `frame` loop's scene drawing.
- [ ] `openScenario(id)`:
  - clip or run video
  - badge
  - stats from `/api/run?name=`
  - decisions list from a replay stream
  - swarm plan
  - LiDAR dropout table: constants cited to `faultline-occlusion.md`
  - the buttons from the IA table
- [ ] Switch run dialog.

### Task 4: Lab, Mission, Results, Proof, Research, Judge link fixes and copy

**Files:** Modify `apps/faultline-studio/src/main.ts`.

- [ ] Step 2 attack list: one radio (cut-in). The other scenarios render as `<a href="/scenario/<id>">` cards with a "Recorded example" badge.
- [ ] Remove `replay` mode.
- [ ] `#byo` → `go('/stack')`.
- [ ] Start and launch push the job id into `myRuns`.
- [ ] Mission verdict buttons per the IA table. `RUN_VIDEO` notes move to the Results Evidence tab, and `mc-note` shows only state messages.
- [ ] Results gets the "Research: where the agent lost" link. Research gets "Back to results" pointing to the context run.
- [ ] Judge step 2 → `/scenario/swarm`.
- [ ] Copy sweep: `grep -n "scripted\|—\|source:" index.html src/*.ts` returns nothing user-visible.

### Task 5: headless IA test

**Files:** Modify `apps/faultline-studio/test/headless.mjs`.

- [ ] Add an `IA` table: `[route, selector, expectedPath]` for every link row of the page table above. Cover all 6 scenario cards on `/`, all 5 non-live cards in Lab step 2, the run bar tabs, and the nav items after visiting `/scenario/swarm`, which must point at `swarm-carla-010`.
- [ ] For anchors, assert `href`. For router buttons, click and assert `location.pathname`.
- [ ] Assert no `canvas#scene` or `#rscene`. Assert no visible text matching `/scripted|source:|—/`.
- [ ] Keep the existing wallet-signed and guest flow assertions, updated to land on `/mission/<job>` then `/results/<job>`.
- [ ] Run: `PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node apps/faultline-studio/test/headless.mjs`. Expected last line: `N passed, 0 failed`.

### Task 6: build, deploy, live verification, commit

- [ ] `. ~/.nvm/nvm.sh && FAULTLINE_API_BASE= npm run studio:build`
- [ ] Stage `dist/.` plus `vercel.proxy.json` (as `vercel.json`) into `scratchpad/vercel-site/`, keeping `.vercel/`.
- [ ] Run `npx -y vercel@65.2.0 deploy --prod --yes --token "$(cat ~/.config/faultline/vercel_token)"`.
- [ ] Run the audit script against live. It must report zero ✗ rows: every label goes to the destination in the IA table.
- [ ] One real guest CARLA run on the live site, end to end, through `/mission/<job>` → `/results/<job>` → `/verify/<job>`.
- [ ] Screenshots `docs/evidence/media/studio-v7-{discover,scenario-swarm,scenario-pedestrian,lab,mission-live,mission,results,verify}.png`, viewed before calling it done.
- [ ] Commit the studio paths plus screenshots.
