# Faultline research loop (live, 2026-11-07)

Question: *can the 0G agent find, explain and reproduce a weakness more effectively than a conventional algorithm,
while proving what happened?* Short answer from these runs: **it matches bisection on the boundary task only once it
has bisection as a tool, it loses to random sampling on open-ended discovery, it reproduced and minimized a collision
whose cause the audit could check, its explanation blamed the wrong mechanism (the audit caught it), and it did not
find a fix that a 240-point grid found.** Every 0G response is signed (47/47 verified) and every experiment carries a
config hash.

Code: `faultline/research.py` (`python -m faultline.research {bench,mission,carla,rebuild,audit-old}`),
`faultline/experiment.py` (adds `ctrl`, `keep_rows`, frozen `CTRL0`/`CTRL_BOUNDS`), `hunt.minimize(benign=)`;
tests `tests/python/test_research.py` (18, no network). Model `0gm-1.0-35b-a3b`, private tier, temperature 0, JSON
mode, thinking off, provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`.
Safety everywhere: **safe = no collision AND min gap >= 2.0 m.**

## What the one agent does (and what it does not)
| responsibility | 0G does | deterministic code does |
|---|---|---|
| Discover | picks one tool per turn from `bisect, grid, probe, sweep_delay, minimize, counterfactual, stop` + hypothesis | validates args, runs the tool on the budget, computes outcome, fingerprint, J(s), config hash |
| Explain | final report: claims citing run numbers, explanation | audit: each claim vs the measured runs (outcome, effect sign on runs that differ in one parameter, boundary vs slice, friction-mechanism check) |
| Fix | one bounded controller change (`min_gap_m`, `comfort_decel_mps2`, `max_accel_mps2`, `min_time_headway_s`; bounds frozen) | tests on the failing case + a frozen 40-scenario suite (21 safe today); verdict improved / regressed / no-change |

Fail-closed: a malformed reply halts (`halted`), no fallback. An unknown tool or bad arguments costs one experiment and
the loop continues. J(s) = 1.0·criticality + 1.0·novelty − 1.0·invalid (code-computed, shown to the agent).

## Benchmark G1 (boundary, budget 24) — `runs/research-bench-g1-00{1,2,3}`
| method | boundary MAE (m) | inference calls | wall (s) | invalid / off-goal |
|---|---|---|---|---|
| A grid 6×4 | 5.87 | 0 | 0.1 | 0 |
| B random (seed 0) | 6.84 | 0 | 0.1 | 0 |
| C per-delay bisection | **0.57** | 0 | 0.1 | 0 |
| D old 0G designer (hunt-bench-002, re-scored) | 5.57 | 25 | 120 | 0 |
| E 0G + tools, run 001 | 6.13 (bracket estimator 3.06) | 9 | 26 | 4 |
| E 0G + tools, run 002 | 4.47 (bracket 1.16) | 11 | 40 | 7 |
| **E 0G + tools, run 003 (final prompt)** | **0.73** (bracket 0.73) | 6 | 18 | 6 |

Run 003 boundary at delays 0.3/0.6/0.9/1.2/1.5 s: 30.78 / 40.16 / 49.53 / 61.62 / 73.70 m (truth 29.10 / 38.76 /
49.90 / 61.76 / 73.63). It opened with `sweep_delay([0.3, 0.9, 1.5], 5–80 m)` (12 runs), wasted one call on a
counterfactual over an outcome (`ego_max_decel_mps2`) and 5 runs on a friction grid the goal fixes (off-goal), then
bisected 1.5 s. **It nearly matches bisection (0.73 vs 0.57 m) with 6 calls instead of the old designer's 25; it does
not beat it.** Runs 001/002 are development runs with the earlier menu: 001 passed `fixed` as a JSON *string* 4×
(my menu showed it as a string), 002 asked for counterfactuals on an outcome key 7× in a row ignoring the error. After
001/002 the menu got typed JSON examples and errors that name the bad key (commit `faultline research: tool menu…`);
003 is the first run with the frozen prompt. Variance across the three runs is large (6.13 → 0.73).

Audit of run 003's report: 5 supported, 1 contradicted (it cited unsafe runs 4 and 10 as "safe above ~30 m"),
1 unverifiable. Audit of the **old designer's** table (the known test case): 0.3 s → 29.19 m supported; **1.5 s →
61.0 m contradicted** ("unsafe at gaps [61.0, 65.0] >= claimed 61.0"), matching the manual finding in
faultline-hunt.md.

## Benchmark G2 (open goal, all six free, budget 16) — `runs/research-bench-g2-00{1,2}`
| method | unsafe | distinct unsafe | collisions | **distinct fingerprints** | params varied | bin coverage |
|---|---|---|---|---|---|---|
| B random (seed 0) | 13 | 13 | 10 | **7** | 6/6 | **0.93** |
| D old 0G designer (hunt-g2-002) | 15 | 8 | 13 | 3 | 4/6 | 0.47 |
| E 0G + tools (002) | 10 | 10 | 7 | 4 | 4/6 | 0.50 |

Run 001 **halted** at turn 1 (`bad_schema`: the reply omitted `why`); fail-closed as designed, 1 call. Run 002
completed (11 calls). **Random beats 0G+tools on discovery** (7 vs 4 mechanisms, 0.93 vs 0.50 coverage); 0G+tools
beats the old designer (no repeats, 4 vs 3 fingerprints) but never varied reaction delay or onset as a sweep. It
misread counterfactual deltas as absolute values (`friction_mu: +1.0` → out of range; `reaction_delay_s: +0.2` then
claimed "reducing delay from 0.6 to 0.4"); the audit flagged that claim as contradicted.

Fingerprint = outcome / first failed constraint (TTC < 1.5 s vs gap < 2 m) / friction-limited braking (ego peak decel
≥ 0.99·0.8·g·μ or lead clamped) / reaction-dominated (≥ 50 % of the gap lost inside the measured reaction window) /
violation onset (before vs after the lead stopped). Library: `runs/failure-library.jsonl` (57 rows; benches start
from an empty library for fairness, the mission reads it).

## Mission (budget 30) — `runs/research-mission-001`
"Find a scenario where this autonomous vehicle cannot avoid a collision, explain why, give me the simplest
reproduction, and test a fix." 9 calls, 30 + 2 runs, 44 s.
- **Discover:** 4 probes (one exact repeat), found a collision at 20 m/s, μ 0.3, 20 m gap, lead 6 m/s².
- **Minimize (0G chose `minimize(3)`, 25 runs, predicate "still collides"):** minimal case **#21** = 18.75 m/s,
  gap 25 m, lead decel 3.66 m/s², μ 0.8, delay 0.6 s, onset 5 s → collision (min gap −0.008 m). Necessary: lead decel
  (restore 3.0 → no collision, 0.37 m), gap (40 m → 1.52 m), speed (15 m/s → 0.64 m). μ and delay restored to reference.
  Fingerprint `collision/ttc_collapse/grip_available/braking_phase/during_lead_braking` (new to the library).
- **Counterfactuals (deterministic completion, labelled, 2 runs):** delay −0.2 s → no collision (min gap 1.14 m);
  gap +10 m → no collision (1.03 m). Neither reaches the 2 m margin.
- **Explanation + audit:** 5 supported (collision, both counterfactual effects), **2 contradicted**: the explanation
  and a general claim blame *friction-limited* braking, but in run 21 the ego peaked at 5.76 m/s² against a friction
  limit of 6.28 m/s² — it never used the available grip. The measured mechanism is a delayed, under-braking IDM, not
  the road. (The friction check was added after the run; `research rebuild` recomputed the audit from the stored
  data, no new 0G call.)
- **Fix:** 0G proposed `min_gap_m 3.0` twice (the second time after being told it did not work): case → no collision
  but min gap 0.36 m (still unsafe), suite unsafe 19 → 13, 0 regressions → **verdict no-change**. Retest: 2/31 unsafe
  mission cases become safe. **Classical baseline** (240-controller grid inside the same bounds, not 0G): 67 make the
  case safe, 65 pass the rule; e.g. `{min_gap 5, comfort_decel 2, max_accel 3, min_time_headway 2}` → case min gap
  4.74 m, suite unsafe 19 → 0, no regressions, mean speed 11.77 → 10.79 m/s, cruise time headway 3.18 → 3.30 s.
- **Artifacts:** `runs/research-mission-001/{report.md,research.json,console.html}` (copies in
  `docs/evidence/research/`).

## CARLA (scripted executions of the 0G-found minimized case, not live 0G driving)
CARLA 0.10 Town10, chase camera, shared server under `/tmp/faultline-carla.lock`; CARLA and kinematic agree exactly:
- `runs/research-mission-001/carla-failure/screen.mp4` (18 s): current controller → **collision**, min gap −0.008 m
- `runs/research-mission-001/carla-fix-0g/screen.mp4` (20 s): 0G's `min_gap_m 3` → no collision, 0.36 m (**unsafe**)
- `runs/research-mission-001/carla-fix-baseline/screen.mp4` (23 s): grid fix → **safe**, 4.74 m
Indexed in `runs/videos/INDEX.md` (`scripts/video_index.py` now also collects `runs/*/carla-*/screen.mp4`). The
viewer's HUD shows its default "control BRAKE_HARD / decision waiting" text (viewer.py not touched).

## Trace, signatures, hashes
All calls HTTP 200 with `x_0g_trace.request_id`, `Zg-Res-Key` and the provider above; every `designer.jsonl` passes
`verify_chain` against the manifest head. `npm run faultline -- sigs` (Compute SDK `processResponse`):
g1-001 **9/9**, g1-002 **11/11**, g1-003 **6/6**, g2-001 **1/1**, g2-002 **11/11**, mission-001 **9/9** = **47/47**
(`docs/evidence/research/*-sigs.json`).
- g1-003 `dc662eb2-4b1e-4a3e-b7bb-32c8d5c86e52` … `f33da600-001f-4a23-9836-20341055a9ab`; g2-002
  `676e52fb-08a8-4251-b4b8-bec19501766e` … `8a2bd4b8-4dda-4484-b302-d3f1022932c6`; mission
  `93335606-cd77-4e07-ac73-9b8ffe2a2cee` … `1104b23b-f8f9-40fc-b50b-e5ddbf4359ea`; g2-001
  `c334d147-6c66-4038-b83d-de9250b9127b`. Median latency 3.2–3.9 s.
- Config hash per experiment = sha256(effective IDM params + ctrl, simulator settings + sha of
  experiment/controller/world.py, scenario, model id, turn-prompt sha). Listed in `report.md`.
**Signed inference authenticity and simulation integrity are separate claims**: the signature shows the provider
returned that response (who chose the tool); the config hash shows what was simulated (re-runnable by anyone). Neither
proves the other, and neither proves the simulator models a real car.

## Honest verdict
- Hybrid (0G picks classical tools) fixed the old designer's search loss: 0.73 m vs 5.57 m on G1 with 4× fewer calls,
  in one of three runs; bisection alone is still better, free and instant.
- On open-ended discovery seeded random sampling found more distinct failure mechanisms and covered the space better.
- 0G's value here was turning a natural-language mission into a minimized, counterfactual-backed reproduction and a
  readable report; its causal story was partly wrong and it repeated a failed fix. The deterministic audit and fix
  rule are what keep its output honest. One seed, one mission.

## Deviations
1. Two G1 development runs before the menu was fixed (both reported); G2-001 halted (reported); G2 re-run once.
2. The friction-mechanism audit check and the classical fix baseline were added after the mission and applied with
   `research rebuild` (deterministic, no new 0G calls; designer.jsonl untouched; `rebuilt` stamp in research.json).
3. Regression suite = 40 frozen scenarios, of which 21 are safe with the current controller (the regression set);
   the controller is too fragile for a 20+ all-safe suite of varied conditions.
4. Mission counterfactuals on the minimized case were run by deterministic completion (the agent spent its budget
   before asking for them); labelled `counterfactual[deterministic]`.
5. Efficiency = suite mean ego speed over each run (weak: runs end at standstill) and mean cruise time headway.
6. Third CARLA clip (classical fix) added because 0G's fix did not make the case safe.
