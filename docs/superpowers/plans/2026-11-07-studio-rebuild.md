# Studio Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Faultline studio's flow so every button goes where its label says, merge duplicate pages, run the four-car coordinated attack live, and add thinking orbs.

**Architecture:** One route table (`src/routes.ts`) owns every path, alias and nav item; pages link only through it. Mission Control and Results merge into `/run/:id`. The console gains a free-only `swarm-v1-carla` demo suite that spawns the existing `faultline.carla_swarm` runner. Orbs are the vendored MIT thinking-orbs engine drawn by a small vanilla mount.

**Tech Stack:** TypeScript, esbuild (`apps/faultline-studio/build.mjs`), Express console (`packages/hedera/src/agent-console.ts`), `tsx --test`, Playwright (headless test).

**Spec:** `docs/superpowers/specs/2026-11-07-studio-rebuild-design.md`

## Global Constraints
- Node via `. ~/.nvm/nvm.sh` (Node 22). No new npm dependencies; orbs are vendored source with the MIT licence.
- No mock mode, no claims without evidence: free runs are "not paid, not anchored"; preview clips only on "In development" cards (SECURITY.md I12).
- Swarm runs are free only, `policy: "pdm-lite"` only; `SUITES` (payment-bound) is unchanged.
- The word "scripted" does not appear in user-visible studio copy.
- Never print or commit `.env` values. No push or deploy without asking.
- Playwright: `PLAYWRIGHT_MODULE=<scratchpad>/pw/node_modules/playwright` (the repo has none installed); browsers are in `~/.cache/ms-playwright`.

## Review Focus
- Deep link straight to `/run/<id>`, `/proof/<id>`, `/lab?attack=swarm` on a cold load: the right view and state render (headless: `goto` each).
- Old bookmarked paths (`/mission/:id`, `/results/:id`, `/verify/:id`, `/library`) land on the new page with the new URL (headless asserts URL after load).
- Console offline: Attacks, Runs, Run pages show recorded data or a plain message, never a spinner forever (headless offline pass checks no orb stays visible on `/runs` after load and the offline banner shows).
- Cautious IDM selected then "?attack=swarm": swarm card is disabled with its reason and the summary does not say swarm (headless).
- Browser back after a Lab step change: stays on `/lab` (steps use `replaceState`), back from `/run/:id` returns to the previous page (headless `goBack`).

---

### Task 1: Backend: live four-car attack (free)

**Files:**
- Modify: `packages/hedera/src/suites.ts` (add `DEMO_SWARM`, `demoSuite`)
- Modify: `packages/hedera/src/agent-console.ts` (`/api/demo-run`, `runJob`, `/api/stream` replay + `streamJob`, `runSummary`, `jobVideo`)
- Test: `packages/hedera/test/suites.test.ts`

**Interfaces:**
- Produces: `export const DEMO_SWARM = 'swarm-v1-carla'`; `export function demoSuite(suite: unknown, mode: unknown, policy: unknown): { lane: 'carla' | 'kin', swarm: boolean } | { error: string }`.
- Produces (stream): event `{ t: 'plan', plan: { name: string, summary: string, roles: Record<string,string>, phases?: unknown } , requestId: string | null }` sent once per stream when `<run>/plan.json` exists.
- Produces (summary): `minTtc`/`minGap` fall back to `metrics.ground_truth.min_ttc_s` / `.min_gap_in_path_m`; `video` falls back to `runs/<name>/director.mp4`.

- [ ] **Step 1: Failing tests** in `suites.test.ts`: `demoSuite('swarm-v1-carla','free','pdm-lite')` → `{lane:'carla', swarm:true}`; `('swarm-v1-carla','paid','pdm-lite')` → error matching `/free/`; `('swarm-v1-carla','free','idm-cautious')` → error matching `/PDM-Lite/`; `('cut-in-v1-kinematic','free','idm-cautious')` → `{lane:'kin', swarm:false}`; `('nope','free','pdm-lite')` → error.
- [ ] **Step 2:** `. ~/.nvm/nvm.sh && npx tsx --test packages/hedera/test/suites.test.ts` → FAIL (`demoSuite` not exported).
- [ ] **Step 3:** Implement `demoSuite`; in `/api/demo-run` replace the suite check and lane line with it (policy check stays first). In `runJob` free branch: when `j.suite === DEMO_SWARM`, `out = runs/demo-free-swarm-<stamp>`, `spawnPy(j, ['-m','faultline.carla_swarm','--out',out,'--seed',String(j.seed),'--display',''])`. `estS` = 150 for swarm. Plan event in both stream paths; `runSummary` fallbacks; `jobVideo` falls back to `director.mp4`.
- [ ] **Step 4:** tests PASS; `npx tsc --noEmit -p packages/hedera` (or the repo's typecheck) clean.
- [ ] **Step 5:** commit `console: live coordinated four-car attack as a free demo suite (swarm-v1-carla), plan event in streams`.

### Task 2: Thinking orbs

**Files:**
- Create: `apps/faultline-studio/src/orbs/` (vendored `engine/*.ts`, `presets.ts`, `types.ts` reduced to the two type aliases, `LICENSE`, header comment naming repo + commit `de85557`)
- Create: `apps/faultline-studio/src/orb.ts`

**Interfaces:**
- Produces: `orb(state: OrbState, size: 20 | 64, opts?: { dark?: boolean, label?: string }): string` → `<canvas class="orb" data-orb=… data-size=… data-dark=… role="img" aria-label=…>`; `startOrbs(): void` (one rAF loop; MutationObserver picks up new canvases; IntersectionObserver + visibilitychange pause; reduced motion draws `t=0.6` once).

- [ ] **Step 1:** headless assertion (added in Task 6) that a visible `canvas.orb` has non-transparent pixels; for now build must pass: `npm run -s studio:build`.
- [ ] **Step 2:** commit `studio: vendor thinking-orbs engine (MIT) and a vanilla canvas mount`.

### Task 3: Route table, nav, header

**Files:**
- Create: `apps/faultline-studio/src/routes.ts`
- Modify: `apps/faultline-studio/index.html` (nav, header), `src/main.ts` (router, wallet button, delete dead code: `#oldlive`, `#oldres`, `startStream`, `openResults`, `drawScene`, `carShape`, `pillAt`, `drawResults`, `renderFeed`, `progress`, `logLine`, `gotoExplore`, `data-goto-explore`, replay mode, `v-results2`)

**Interfaces:**
- Produces: `FEATURED`, `SWARM = 'swarm-carla-010'`; `type Page = 'home'|'attacks'|'lab'|'run'|'runs'|'proof'|'research'|'stack'`; `parse(path: string): { page: Page, id: string | null, canonical: string | null }` (canonical set when the path is an alias); `href.run(id)`, `href.proof(id?)`, `href.lab(attack?: 'cut-in'|'swarm')`; `NAV: { page: Page, label: string, path: string }[]` = Overview `/`, Attacks `/attacks`, Runs `/runs`, Proof `/proof`, Research `/research`.

- [ ] **Step 1:** `parse` self-check at module load in dev is not wanted; instead headless (Task 8) asserts aliases. Implement `routes.ts`; router calls `parse`, `replaceState(canonical)` when set, toggles `#v-<page>`.
- [ ] **Step 2:** header: nav from `NAV`, "Run a test" button (`/lab`), wallet button connects in place (no navigation; with no wallet it shows "No wallet found" for 3 s with a tooltip).
- [ ] **Step 3:** build passes; commit `studio: one route table, unnumbered nav, aliases for old paths, dead views removed`.

### Task 4: Overview and Attacks

**Files:** `index.html` (`#v-home`, new `#v-attacks`), `src/main.ts` (`ATTACK_CATALOGUE`, render)

**Interfaces:** `ATTACK_CATALOGUE: { id, title, line, status: 'live' | 'dev', clip: string, actions: { label, href }[] }[]` with the button map from the spec.

- [ ] **Step 1:** home CTAs per spec button map; families footnote and "scripted clip" captions removed; strip shows "Runs live" / "In development" chips and an "All attacks" button. 0G box in the diagram gets `orb('working', 20)`.
- [ ] **Step 2:** `/attacks` page renders the catalogue; dev cards show a "Preview" clip and no run button.
- [ ] **Step 3:** build; commit `studio: Overview button map and the Attacks catalogue`.

### Task 5: Lab

**Files:** `index.html` (`#v-lab`), `src/main.ts` (Lab code)

- [ ] **Step 1:** attacks = `cut-in-v1-carla` and `swarm-v1-carla` (copy from spec); swarm disabled with "Runs against PDM-Lite" when policy is `idm-cautious`; picking Cautious IDM with swarm selected switches attack back to cut-in. Run types: free live, paid (disabled unless cut-in + PDM-Lite + wallet, reason shown). `?attack=` preselects. Steps use `replaceState`. Step 1 "Connect your own stack" → `go('/stack')`. Start shows `orb('connecting', 20)` while signing/queuing, then `go(href.run(jobId))`.
- [ ] **Step 2:** build; commit `studio: Lab runs cut-in or the live four-car attack; no step leaves the Lab`.

### Task 6: Run page

**Files:** `index.html` (`#v-run`), `src/main.ts` (merge `openMission`/`openResults2` into `openRun(id)`)

- [ ] **Step 1:** `openRun` = Mission Control + verdict card with stats, `railHtml(trustFromRun(...))`, CTAs "Check the evidence" (`href.proof`), "Run your own test" (`/lab`), "All runs" (`/runs`). Plan card from the `plan` stream event (generic; `ROLES` set from it); swarm fallback text deleted. Live progress panel: orb 64 (`weaving` until plan or first tick for swarm, `searching` while waiting for 0G, `working` while driving, `breathing` while finishing). Timeline trailing chip `orb('searching',20)` "Asking 0G…" while live and waiting. Video note for `director.mp4`: "Director cut with decision cards inserted, not time-aligned". Peek hidden for swarm jobs (no live camera).
- [ ] **Step 2:** build; commit `studio: one run page (live or recorded) with plan, timeline, verdict and evidence`.

### Task 7: Runs, Proof, Research, Stack

**Files:** `index.html`, `src/main.ts`

- [ ] **Step 1:** `/runs`: featured cards (paid 002, swarm 010) → `/run/:id`, A/B arena section (copy: "the same recorded attack, replayed (no 0G calls)"), full table → `/run/:id`, loading row with `orb('breathing',20)`. `/proof` renamed from `/verify` (loading `orb('solving',64)`), run title links to `/run/:id`. Research counterfactual card gets `id="counterfactual"`. Stack page final CTA "Run a test with an example policy" → `/lab`.
- [ ] **Step 2:** build; commit `studio: Runs, Proof, Research and Stack wired to the route table`.

### Task 8: Judge mode, click-through test, copy sweep

**Files:** `src/main.ts` (JUDGE paths), `apps/faultline-studio/test/headless.mjs`

- [ ] **Step 1:** rewrite the test around the button map: for each `[selector, expectedPath, expectedView]` click and assert `location.pathname` and visible `#v-*`; aliases; `/lab?attack=swarm` posts `suite:'swarm-v1-carla'` (guest); disabled swarm with Cautious IDM; no element with text `/scripted/i` on any page; every `a[href^="/"]` resolves via `parse` to a known page; orb canvas has painted pixels; zero page errors; offline pass.
- [ ] **Step 2:** `npm run -s studio:build && PLAYWRIGHT_MODULE=… node apps/faultline-studio/test/headless.mjs` → all PASS.
- [ ] **Step 3:** commit `studio: judge mode on the new routes; click-through test of every button`.
