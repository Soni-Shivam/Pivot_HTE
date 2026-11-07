# Faultline: AI crash hunt against PDM-Lite in CARLA (2026-11-07)

**Result: no valid PDM-Lite collision was found.** The two collisions the hunt hit were sideswipes: a slow car turned into the side of the ego while it was alongside. They are not escapable cut-ins, so they are excluded and the rule that excludes them is now in the code. The closest valid call found by 0G was a 3.55 m minimum gap with a 1.19 s minimum TTC.

## 1. Nonce omission (full-length runs)

Prompt-side fix only (`a1bd9d5`). The user message now carries a `reply_schema` with the nonce pre-labelled (`"nonce": "<copy exactly: ab12cd34>"`) and the allowed actions inline. This applies to both families (`faultline/policy.py`; the system prompts in `policy.py` and `cutin.py` point to it). The parser is unchanged: a missing or wrong nonce, or the copied label itself, still gives `bad_nonce`, which halts the run (`tests/python/test_policy.py`).

Live private-tier 0G calls, kinematic world, random binding per episode (`scripts/nonce_rate.py`). Request ids are in `docs/evidence/carla-crash/nonce-rate.json`.

| Prompt | cut_in bad_nonce | lead_brake bad_nonce |
| --- | --- | --- |
| before (conditional sentence after the schema) | **4 / 30** (13%) | **2 / 26** |
| reply_schema with nonce only | 0 / 32 (but 4 `out_of_set`: BRAKE_HARD offered to a stopped car) | 0 / 24 |
| reply_schema with nonce and inline actions (committed) | **0 / 30**: 3 full episodes, 30/30 ok | — |

The prompt hashes changed, so earlier runs need re-baselining.

## 2. Environment as an attack lever

`cutin.ENVIRONMENTS` is a frozen menu: `clear_noon`, `clear_night`, `wet_noon`, `hard_rain_night`, `dense_fog`. `with_environment()` copies the values into `CutInScenario.environment/env_params` and sets `friction_mu`, so `scenario.json` and the scenario hash carry them. `check_environment()` rejects off-menu entries, out-of-bounds values and a friction that does not match the menu.

- **Weather:** `carla.WeatherParameters` fields (precipitation, deposits, wetness, fog density/distance/falloff, sun altitude −90 for night).
- **LiDAR:** only attributes the live 0.10 `sensor.lidar.ray_cast` blueprint has: `atmosphere_attenuation_rate`, `dropoff_general_rate`, `dropoff_intensity_limit`, `dropoff_zero_intensity`, `noise_stddev` (and `noise_seed` = the scenario seed). CARLA weather alone does not degrade the ray-cast LiDAR; rain and fog reach it only through these attributes.
- **Friction:** μ sets the adversary's brake clamp (0.8·g·μ) and the hunt's validity limits, and in CARLA the ego's wheel `friction_force_multiplier` = μ/0.8. Caveat: the ego's measured max decel stayed about 7.2 m/s² even at μ 0.5. This lever has not been shown to cut the ego's braking in Chaos physics.
- **Shared server:** the weather is saved and restored in `close()`. A failed `reset` now also undoes sync mode, weather and actors (before, `run_episode` left sync mode on). After every run the world was checked: async, original weather, 0 vehicles.

## 3. Hunt (`faultline/carla_hunt.py`)

0G (`0gm-1.0-35b-a3b`, private tier, Designer/Agent contract imported read-only from `research.py`, strict JSON, fail-closed) calls one tool per turn: probe, grid, counterfactual or stop. Deterministic code validates each experiment and runs it as a full `run_episode` bundle in CARLA, with PDM-Lite on LiDAR only and a scripted adversary (`source: scripted-hunt`). Outcomes are ground truth.

Validity rules for an experiment:
- brake ≤ 0.8·g·μ
- quintic peak lateral accel ≤ 0.8·g·μ
- predicted gap ≥ 3 m at the cut-in start
- added after hunt-002: predicted gap ≥ 3 m at mid lane change, assuming the ego does not brake (no sideswipes from alongside)

| Hunt | Exp | Experiment | Collision | Min gap (m) | Min TTC (s) |
| --- | --- | --- | --- | --- | --- |
| 001 (non-thinking, 18 turns) | 1, 6, 8, 10, 12, 17 | benign / no-brake cut-ins | no | 16.7 / 4.50 | — |
| 001 | 11 others | invalid (brake > grip, lateral accel, start alongside; the same invalid call repeated) | — | — | — |
| 002 (thinking) | 1 | clear_noon, ego 10, lead 10, gap 6, cut at checkpoint 2, lane change 1.8 s, brake 5.0 | no | 3.60 | 1.65 |
| 002 | 2 | hard_rain_night, ego 12, lead 4, gap 20, cut at checkpoint 0, lane change 2.27 s, no brake | **yes: sideswipe** | — | — |
| 002 | 3 | the same in clear_noon | **yes: sideswipe** | — | — |
| 003 (thinking, stricter rule) | 2 | dense_fog, ego 8, lead 9, gap 3, cut at checkpoint 2, lane change 2.0 s, brake 5.0 | no | **3.55** | **1.19** |

Every hunt ended `halted` on an `invalid_json` reply from 0G at turn 4 (fail-closed).

### The sideswipes, and why they are excluded

In 002/2 the adversary starts its lane change 3.0 m ahead while 8 m/s slower. When it reaches the ego's lane its rear is at −3.1 m, beside the ego, and the collision sensor fires at t = 3.05 s. Up to then it was never "in path" by footprint. This is the adversary steering into the ego's side, not a cut-in the ego could have escaped. Weather made no difference (002/2 and 002/3 are identical).

### Closest valid call

Hunt-003 exp 2. The car enters the ego's path at 5.0 s with a 7.8 m gap. LiDAR first placed it in the ego's lane at 4.7 s. PDM-Lite braked up to 7.0 m/s² and kept a 3.55 m minimum gap (min TTC 1.19 s, CCS 0.87).

Why PDM-Lite survived:
- It brakes as soon as its LiDAR track enters the lane corridor, about 0.3–0.4 s before the footprints overlap.
- Its CARLA braking (about 7.2 m/s²) exceeds anything a valid adversary can do (≤ 6.27 m/s² at μ 0.8).
- Its stopping target keeps about 3.5 m.

The menu's LiDAR degradation (dense fog: attenuation 0.06, dropoff 0.75) did not delay detection enough at these ranges (4.6–4.7 s first-in-lane in both fog and clear). A pre-hunt manual calibration run, not chosen by 0G, came closer: clear_noon, ego 12, lead 6, gap 25, cut at checkpoint 1, lane change 1.8 s, brake 6.2 gave a 1.64 m minimum gap and 1.81 s minimum TTC, still no contact.

No minimization or counterfactual was run, because there was no valid collision. Nothing was anchored for the same reason.

## Evidence

- 0G request ids (signatures `npm run faultline -- sigs`: **18/18, 4/4, 4/4** verified):
  - hunt-001: `a297cc6e-c260-47b6-b66e-dd9fb228edc5` … (18; `docs/evidence/carla-crash/hunt-001.json`)
  - hunt-002: `64acf711-ec91-4571-9c68-f934e00a878a`, `5b22fde8-6380-4d7b-9113-e9150f876345`, `2cc713f8-e94d-41e1-a7e2-6ef7a12a0158`, `315dca09-ab82-4e2d-a699-f4fbb4290f56`
  - hunt-003: `6531254f-d50d-4d00-8e3e-96a222a0ff3f`, `25b8aefd-fbf7-413c-8fbe-80a0ac89c7a9`, `e15183b3-e239-49dc-a322-c5d1288a550f`, `08ed814e-ad03-4675-a242-8256a3c372a4`
- Cost: $0.0052 + $0.0093 + $0.0085.
- Logs: `docs/evidence/carla-crash/agent-00{1,2,3}.jsonl` and `hunt-00{1,2,3}.json`. Bundles are in `runs/carla-hunt-00{1,2,3}/exp-NN/` (gitignored).
- Chase video of the closest call (re-run, same outcome: 3.545 m, 1.185 s): `runs/carla-hunt-003/closest-view/screen.mp4`. Indexed in `runs/videos/INDEX.md`.
- No 0G Storage roots or Galileo txs: nothing was anchored.
