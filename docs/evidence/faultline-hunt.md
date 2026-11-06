# Faultline failure hunter / safety boundary mapper (live, 2026-11-07)

0G (`0gm-1.0-35b-a3b`, private tier, provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`) as an adaptive
experiment designer, benchmarked against classical designers on the same budget and the same deterministic runner
(`faultline/experiment.py`, ~5 ms per experiment). Code: `faultline/{experiment,designer,hunt}.py`,
`python -m faultline.hunt {ground-truth,run,bench,minimize,carla}`; tests `tests/python/test_hunt.py` (15, no network);
`npm run faultline -- sigs <jsonl>` (`packages/episode/src/sigs.ts`, `test/sigs.test.ts`).

**Safety definition (everywhere): safe = no collision AND min bumper-to-bumper gap >= 2.0 m.**

## Deviations from the brief (each forced by a measurement)
1. **Ego IDM tuned to follow at the initial gap.** With the brief's IDM (desired speed = ego speed, headway 1.2 s)
   the IDM re-chooses its own gap during the run-up, so the initial gap barely matters: at 25 m/s / 6 m/s² every gap
   5-80 m was unsafe at delays 0.3, 0.9 and 1.5 s (min gap ~1.6 m at 0.3 s from standstill creep, collisions at
   0.9 s+). `experiment.idm_for` sets desired speed = 2 × start speed and the headway so the IDM's equilibrium gap
   equals `initial_gap_m` (an ACC time-gap setting); the gap at brake onset then equals the initial gap.
2. **G1 at 15 m/s, not 25 m/s.** Even with (1), at 25 m/s the boundary is > 80 m (outside the frozen range) for
   every delay >= 0.9 s. At 15 m/s all five scoring delays have a boundary inside [5, 80].
3. **Brake onset fixed at 5 s in G1** (the brief left it unstated; the goal text says so).
4. **No `progress.mp4`:** neither `rsvg-convert` nor ImageMagick is installed (and Python has no PIL/cairosvg); the
   24 `progress/step-NN.svg` frames are written. Nothing was installed.
5. Thinking mode tried and **frozen off** (below). Final report gets `max_tokens` 2000 (turns 600).

## Ground truth (G1, `runs/hunt-groundtruth.json`)
Bisection on gap (final bracket <= 0.25 m) at 25 delays 0.30-1.50 s plus a 1 m scan per delay: **monotone at every
delay** (no safe → unsafe flip). Boundary (bracket midpoint): 0.3 s **29.10 m**, 0.6 s **38.76**, 0.9 s **49.90**,
1.2 s **61.76**, 1.5 s **73.63**. 10.6 s wall.

## Benchmark G1, budget 24 (`runs/hunt-bench-002`)
| method | status | boundary MAE (m) | first unsafe at | distinct unsafe | invalid | off-goal | wall (s) | inference calls | tokens (prompt/completion) |
|---|---|---|---|---|---|---|---|---|---|
| A grid 6×4 | completed | 5.87 | 1 | 13 | 0 | 0 | 0.12 | 0 | — |
| B random (seed 0) | completed | 6.84 | 2 | 13 | 0 | 0 | 0.12 | 0 | — |
| C per-delay bisection | completed | **0.57** | 3 | 13 | 0 | 0 | 0.12 | 0 | — |
| D 0G designer | completed | 5.57 | 1 | 19 | 0 | 0 | 120.2 | 25 | 65 635 / 5 402 |

| boundary (m) at delay | 0.3 | 0.6 | 0.9 | 1.2 | 1.5 |
|---|---|---|---|---|---|
| ground truth | 29.10 | 38.76 | 49.90 | 61.76 | 73.63 |
| A grid | 17.50 | 42.50 | 42.50 | 61.25 | 67.50 |
| B random | 25.58 | 28.90 | 40.52 | 53.31 | 76.61 |
| C bisection | 29.61 | 38.98 | 50.70 | 62.42 | 72.97 |
| D 0G (final report, interpolated) | 29.19 | 37.14 | 45.09 | 53.05 | 61.00 |

Estimators: classical = midpoint of the tightest unsafe/safe pair per tested delay (range ends stand in), linear
interpolation across delays; 0G = its own final-report table, interpolated.

**What 0G actually did:** tested only two delays (0.3 s and 1.5 s), spent 12 experiments refining 0.3 s to below
1 cm (29.18 vs 29.1875 m) and 12 at 1.5 s without ever finding a safe gap (it stopped at 65 m; truth 73.6 m).
Its final report is **internally inconsistent**: the table says 1.5 s → 61.0 m while its own findings say "no safe
gap was found for 1.5 s"; it also calls experiment 24 a collision though it was safe. Its MAE beats grid/random
only because the boundary happens to be near-linear and its two endpoints are interpolated.

**Verdict:** per-delay bisection (which knows monotonicity) is ~10× more accurate, free and instant. The 0G
designer ranks 2/4, behind bisection. It did turn the natural-language goal into 24 valid, on-goal experiments with
a stated hypothesis each (0 invalid, 0 off-goal) and wrote a cited report; it did not search efficiently and its
report needs checking against the log. One run, one seed.

Earlier run `runs/hunt-bench-001` (same turns budget): **halted** at the final report (cut at `max_tokens` 600 →
`invalid_json`), status `halted`, no fallback; fixed by giving the final call 2000 tokens.

## G2 (natural language, all six free, budget 16; `runs/hunt-g2-002`)
0G: 16 valid experiments, 15 unsafe, but only **9 distinct (8 distinct unsafe)**: it repeated experiments 1, 2, 5, 7 up to 4 times;
never varied reaction delay (always 0.5 s) or onset (always 5 s), only one safe run (8 m/s, μ 1.0, 80 m). Findings:
unsafe for every speed >= 10 m/s regardless of friction or gap; μ 0.3 collides even at 80 m. Its claim that "the
measured reaction delay was consistently 0.6 s, a fixed system parameter" mistakes the measured response (0.5 s
delay + jerk detection) for a constant. Random sampling (same budget, seed 0): 13/16 unsafe, all distinct, across
all six parameters (incl. delay 0.2-1.5 s, onset 4-10 s). **Qualitatively random covered the space better; 0G gave
a narrative but no extra coverage.**

## Failure minimizer (`runs/hunt-g2-002/minimize.json`)
Start: 0G G2 experiment 1 (25 m/s, gap 20 m, decel 5, μ 0.3, delay 0.5, onset 5; collision). 17 runs. Minimal
failing case = the benign reference except **speed 15.83 m/s** (min gap 1.98 m); μ, delay, decel and gap all
restored. Counterfactual: speed 15.0 → safe, min gap 2.056 m. This mainly shows the benign reference itself sits at
the 2.0 m margin (the IDM's standstill gap is its s0 = 2 m), so the minimizer reports the smallest step over that
margin. Mechanism verified on a constructed rule in tests (necessary = {μ, gap}). The optional 0G explanation was
skipped.

## CARLA confirmation (scripted executions; parameters from 0G's final report)
0G boundary at 0.9 s = 45.09 m → CARLA 0.10 Town10, chase camera, `CarlaWorld` with the hunt IDM:
- 47.09 m (0G's "safe side"): **unsafe**, ground-truth min gap 1.79 m (LiDAR min 2.48 m); `runs/hunt-bench-002/carla-safe/screen.mp4`
- 43.09 m (unsafe side): unsafe, min gap 1.36 m (LiDAR 2.14 m); `runs/hunt-bench-002/carla-unsafe/screen.mp4`
Both match the kinematic run (CARLA motion is the same integrator). The 0G boundary is 4.8 m too low at 0.9 s, and
the roof LiDAR would have called both runs safe (close-range blind zone, see the matrix's known limits).

## Trace and signatures
All calls HTTP 200 with `x_0g_trace.request_id`, `Zg-Res-Key`, provider above; every `designer.jsonl` passes
`verify_chain` against the manifest head. `npm run faultline -- sigs` (Compute SDK `processResponse`):
bench-002 **25/25 true**, g2-002 **17/17**, bench-001 **25/25**, g2-001 **17/17**.
- bench-002: first `a00eb00f-1205-4518-ad7d-095c6e6a2ffb`, final `af754324-b83a-47db-84e8-424b0af51990`; latency median 4.6 s, max 9.5 s
- g2-002: first `bbdaf71b-8d54-4a83-b372-a889a8a4d54e`, final `c44b539d-967f-40e7-9027-b8b391d43845`; median 4.6 s
- bench-001: `5a5e3fda-8082-4044-a8e1-8755e4446a76` … `7fa80951-5dde-496a-b593-164fb5ab9169`; g2-001: `fc2d00bb-d1b4-47fa-8d56-25979f22d139` … `be498860-cdf4-4c13-9b60-f88e448c68a9`
Full per-call ids: `docs/evidence/hunt/*-sigs.json`.

## Thinking on vs off (G1, 3 turns + final each)
Off (`runs/hunt-trial-nothink`): ~4 s/turn, 130-190 completion tokens, bisection-like choices, valid final report.
On (`runs/hunt-trial-think`, max_tokens 6000): 32-39 s/turn, ~2 600 completion tokens (2 500 reasoning), similar
choices; the final call spent all 6000 tokens reasoning and returned empty content → halted. Frozen: **off**.

## Files
`docs/evidence/hunt/`: `boundary*.svg` (G1 per method), `bench-002-report.md`, `g2-002-report.md`,
`g2-002-boundary.svg`, sigs, minimizer and CARLA JSON. Full data for the interactive page: `runs/hunt-bench-002/hunt.json`,
`runs/hunt-g2-002/hunt.json`; 0G progress frames `runs/hunt-bench-002/progress/step-01..24.svg`.
