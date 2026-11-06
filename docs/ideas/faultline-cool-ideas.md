# Faultline: what's weird, what the models can do, and cooler attacks (ideas-agent, 2026-11-07)

Inputs: every run in `runs/` (decisions, trajectories, metrics, frames of `screen.mp4`), 10 live private-tier probes
(`docs/evidence/faultline-model-probes.log`, script `spikes/ideas_probe.py`), and a working two-car prototype
(`faultline/swarm.py`, `faultline/swarm_carla.py`, `tests/python/test_swarm.py`, 4 tests pass).

## 1. Weirdness audit (evidence first)

| # | What | Where | Likely cause / proposed fix |
|---|---|---|---|
| W1 | **Same input, different answer at temperature 0.** demo-001 cp5 and demo-002 cp5 have identical observation + history (gap 0.839, ego 2.687, lead 0) but answer BRAKE_HARD vs MAINTAIN. Re-asking cutin-001 cp3 twice gave two different `why`s (`3b41951c…`, `36c1ded3…`). | `runs/demo-00{1,2}/decisions.jsonl` line 6; probes log | Provider sampling is not deterministic even at T=0 (batching/MoE). Fine for the referee story (we log what was said), but never claim "replay re-asks 0G and gets the same answer". |
| W2 | **The model says it wants a collision.** demo-002 cp5: "Maintaining speed creates a collision, which is the maximum demand." cp4: "…creates immediate collision". | `runs/demo-002/decisions.jsonl` lines 5–6 | Prompt says "most demanding" and "MAINTAIN hold speed" for a car already at 0 m/s; the model thinks MAINTAIN = keep driving. Tell it explicitly that the lead is stopped and actions are no-ops at 0 m/s (the swarm prompt now does). |
| W3 | **Braking at standstill.** cutin-001 cp3, cp4, cp9 (adversary speed 0.0) pick BRAKE_HARD; swarm-carla-001 cp5–6 too. Every brake action is a no-op then. | `runs/cutin-001/decisions.jsonl` lines 4,5,10 | Mask brake actions out of `available_actions` when `v < 0.3` (one line in `CutInAdversary.available()`), or tell the model. |
| W4 | **Wrong facts in the "why".** cutin-001 cp3: "TTC below 1.0s and ego is slower" (TTC 1.141, ego 5.81 > adversary 0). cp5: "accelerating creates a large gap, forcing ego to react aggressively"; cp7: "Slowing down increases the gap". All rule checks happen in prose only. | lines 4, 6, 8 | Non-thinking 0GM does not do arithmetic. Fix: give it computed booleans (`brake_hard_allowed`, `cut_in_allowed`) or the forecast table (idea #2) instead of raw numbers; or enforce the rule locally and say so. |
| W5 | **The prompt's TTC ≥ 1 s rule is advisory.** demo-001/002 min TTC 0.50 s; swarm-kin-002 0.50 s. | `metrics.json` | Known (matrix "Known limits"). Either enforce locally or reword to "the controller does not enforce this; it is scored". |
| W6 | **`max_ego_decel_mps2` = 6.2784 is a ghost.** In the IDM worlds the ego is stopped (v = 0) but `ego_a` stays at −6.2784 (the friction clamp) for 2 s, and that becomes the "max decel". Real peak in demo-002 ≈ 5.1 m/s². | `runs/demo-002/trajectory.jsonl` rows 172–208; `runs/swarm-kin-002` t ≥ 7.0 | `IdmFollower.accel` returns the clamp while `v` is already 0. Report `ego_a = 0` when `v == 0 and a < 0` (or compute decel from Δv). Affects demo-001/002 metrics. |
| W7 | **Reaction-delay estimate is noise-triggered.** cutin-001 history says `ego_observed_reaction_delay_s` 0.25 then **0.05 s** (cp8): PDM-Lite jitter crosses the −0.4 m/s³ jerk threshold. That number is fed to the model. | `runs/cutin-001/decisions.jsonl` history | Threshold too small for CARLA physics; use a −2 m/s³ jerk threshold or "first tick with brake > 0.2" for PDM-Lite. |
| W8 | **PDM-Lite always stops 3.50 m short.** cutin-001 min in-path gap 3.501 m, every occlusion row 3.49–3.50, swarm-carla-001 3.504 m. | metrics | PDM-Lite's fixed stopping buffer. Attacks that end in a full stop cannot beat it; demanding attacks must happen while it is moving (≥ 5 m/s). |
| W9 | **Ego decelerates harder than the adversary is allowed to.** PDM-Lite peaks at 7.06 m/s² (cutin-001) while the adversary is capped at 0.8·9.81·μ = 6.28. | `runs/cutin-001/trajectory.jsonl` t 5.2 | CARLA tyre friction ≠ scenario μ 0.8. Either set the ego's wheel friction to μ or state the asymmetry. |
| W10 | **Spawn transient.** Ego `ego_a` −3.34 → +6.36 m/s² with throttle 1.0 in the first 0.15 s of every PDM-Lite run (incl. cutin-halt-001). | trajectory rows 0–3 | Already excluded from GT max decel (t > 0.25), but the LiDAR CCS series still includes it. |
| W11 | **LiDAR gap error 3.8 m during the lane change**, HUD TTC 0.80 s at t 2.5 in swarm-carla-001 while ground truth TTC was ~3 s. | cutin-001 t 2.30; swarm-carla-001 frame at 2.5 s | Side returns of a car crossing at ~36°. Documented; worth showing in the HUD as "LiDAR vs truth". |
| W12 | **The video is 70% frozen frames.** cutin-001 `screen.mp4` is 40.1 s for a 12 s episode: the sim pauses ~2.3 s per 0G call and the recorder keeps grabbing the still window. | ffprobe | Expected (sync mode), but bad TV. Record CARLA camera frames per tick to images and encode at 20 fps for a sim-time video, with "0G thinking… 2.3 s" interstitial cards. |
| W13 | **The near miss looks harmless on camera.** 90° FOV chase cam 7 m behind: a 3.9 m gap looks like 15 m; car A in the swarm run is hidden behind the taxi. | frames `cutin-001` t 5.9; `swarm-carla-001` t 3–7 | Add a top-down (bird's-eye, z = 35 m) second camera or a lower FOV (60°); colour the adversaries. |
| W14 | **Coordinated cars crash into each other.** First swarm run (no guard, no forecast): 0GM picked A:BRAKE_HARD + B:SLOW_DOWN with B behind A in the same lane; B would have rear-ended A at t ≈ 5.2 s. | `runs/swarm-kin-001` (`adv_contact: true`) | The model ignores inter-car kinematics. Fixed in the prototype with a local separation guard (logged per tick as `guarded`). |
| W15 | Storage log prints "Detected mainnet (chain ID: 16661)" while the selected storage node reports `chainId: 16602` (Galileo). | `faultline-cutin-001.log` lines 24, 184 | Probably the verifier's Compute-SDK line (mainnet ledger), not the upload. Cosmetic, but a judge reading the log will ask. |
| W16 | cutin-halt-001: the SAFE_HALT stops the adversary in its own lane and the ego drives past a stopped car at 8 m/s — CCS 0.0. Correct, but the halt video looks like "nothing happened". | `runs/cutin-halt-001` | Fine; label the video. |

## 2. Model landscape, probed live (2026-11-07, private header on every call)

`GET /v1/models`: 125 models; **TeeML (private-capable): `0gm-1.0-35b-a3b`, `0gm-1.0-35b-a3b-sia`, `glm-5.3`
(2 providers), `laya`, `vela-2.0-9b`**, plus embeddings/whisper/image. All other chat models are standard-tier only.

| Probe | Model | Request id | Latency | Outcome |
|---|---|---|---|---|
| cutin-001 cp3 replay ×2 | 0gm non-thinking | `3b41951c-852b-4849-acfb-105ad2326577`, `36c1ded3-70c4-4657-afc6-7f2cf38c95f6` | 2.21 s, 2.15 s | BRAKE_HARD both (a no-op: adversary already at 0); 2nd repeats the false "TTC below 1.0s and ego is slower" |
| same | 0gm **thinking** | `ee82d4d8-f359-4e7f-93a8-9dfa6223c047` | **9.85 s**, 1721 reasoning tokens | ACCELERATE, "I am stationary… accelerating increases the gap": notices the no-op, becomes defensive |
| same | **sia** (35B + 4B value model steering each token; HHH-tuned; no `response_format`, 32k ctx, ~6.7× price) | `d8160f5a-1673-49cb-a5d0-aa1557a41b46` (provider `0x15aD…Eabe`, a different TEE) | 2.14 s | Valid JSON without JSON mode; BRAKE_HARD "TTC is borderline". Same quality, more "harmless"-tuned: a natural **critic/safety referee**, not a better attacker |
| same | glm-5.3 (no JSON mode) | `18d7dfa5-9bf4-4863-a127-0b2300db046d` | 6.75 s | Ignores "JSON only", reasons in prose, truncated at 200 tokens. Usable only with a large budget; slow |
| same | laya `/decisions` | `ffd963fb-3385-4dcc-8a69-3c279b5fca77` | **3.83 s** | Near-uniform (0.20–0.28), input truncated at 512 tokens. **Not a reflex model: slower than 0GM over the Router** |
| same | vela-2.0-9b `/decisions` | `86d435b2-eb65-4243-ad98-bd11f529c484` | 3.93 s | BRAKE_HARD p = 0.71, calibrated probabilities. Useful as a **second-opinion/critic with confidence**, not faster |
| planner→critic | 0gm critic with our forecast | `f10737c8-599d-40d9-8e56-045ed067f76d` | 2.89 s | REVISE → SLOW_DOWN; caught "TTC is 1.141 s, not below 1.0 s" but invented "ego speed equals adversary speed". Half right |
| joint 2-car plan (thinking; logged under the name `swarm-nothink` by a probe-script bug, `reasoning_chars` 8376 shows it) | 0gm thinking | `6b27c8c1-ba45-4725-9639-92e68326d220` | 17.6 s | **Ran out of 3000 tokens still thinking**, empty content → would be SAFE_HALT. Thinking is unusable per checkpoint |
| joint 2-car plan | 0gm non-thinking | `31461854-b3cc-4b1f-973f-25d21a0cecc8` | 2.24 s | `{"A":"SLOW_DOWN","B":"CUT_IN_AGGRESSIVE"}`, strict parse ok. **One call coordinates several cars fine** |

Findings: (1) there is **no fast model on the private tier** — every call is ≥ 2.1 s over the Router, so "Laya reflex
at 0.25 s" is impossible; the sim pauses anyway, so the real lever is *what* the model sees, not latency.
(2) Thinking 0GM reasons better but costs 5–8× latency and can blow its budget; use it **once per episode as a
strategist** (pre-episode plan), not per checkpoint. (3) Non-thinking 0GM cannot do arithmetic; giving it **our
local forecast of each candidate** is the biggest quality jump we measured (below). (4) sia and Vela are the natural
second voices (critic / safety referee with probabilities), each in its own TEE with its own request id.

## 3. Ranked ideas

| # | Idea | Viewer sees | 0G's role (always request ids, strict parse, failure → SAFE_HALT) | Why harder for the ego | Cost | Risk |
|---|---|---|---|---|---|---|
| 1 | **Box-in / pincer swarm (prototyped)** | Taxi slices in front of the ego at 6 m while a Charger ahead slams on its brakes: a double squeeze | One joint JSON per checkpoint for both cars | Two targets; the cut-in removes the ego's buffer exactly when the far car brakes | done (2 h); 1 h to polish | Guard authors some motion (logged) |
| 2 | **Forecast-in-the-loop ("lookahead")** (prototyped) | HMI shows the 16–24 candidate futures as a heat strip, the chosen one lit | Model picks from candidates our local kinematics scored (min gap, TTC, collision, cars touching) | Measured: kinematic swarm CCS **0.55 → 0.997**, min TTC 3.3 → 0.50 s, no collision | done | Forecast uses a nominal IDM ego, not PDM-Lite (labelled) |
| 3 | **Strategist + tactician**: thinking 0GM writes a 3-phase attack plan once (≈10 s, before the run, anchored with the scenario), non-thinking 0GM executes it per checkpoint with the plan in context | Title card "0G's plan: bait, squeeze, brake-check" then the plan playing out | Two models, two request-id classes; plan hash committed on Galileo before the first tick | Attacks with intent across 6–10 s (decoy then strike) instead of greedy 1-s moves | 3 h | Thinking may time out → halt before start (fine) |
| 4 | **Red team / referee**: 0GM proposes, **sia** (different TEE provider) vetoes illegal or no-op moves, proposal re-asked once | HMI: "0GM: BRAKE_HARD — sia: VETO, you're already stopped" | Both calls logged and signature-verified; veto rules are prompt-level, final legality local | Removes wasted no-op checkpoints (W3) so every second is pressure | 2 h | +2.1 s per checkpoint; disagreement loops (cap at 1 retry) |
| 5 | **Adaptive attacker**: feed PDM-Lite's measured profile (reaction delay with a fixed W7, its 3.5 m stop buffer W8, decel peak) back into the next episode's prompt; run a 5-episode "campaign" | Scoreboard: attack #1 CCS 0.68 → #5 0.95, each bar a 0G-root link | Same loop; history across episodes | The model learns the ego attacks only while it is moving | 3 h | Needs W6/W7 fixed first |
| 6 | Decoy-then-strike (3 cars): car C cuts in and accelerates away (ego relaxes), B cuts into the opened gap | Two cut-ins in 3 s | One joint JSON for 3 cars | IDM/PDM headway resets after the first cut-in | 2 h on top of #1 | Road 7 has 2 lanes; C must use the left lane too |
| 7 | Tailgater squeeze: car R behind the ego at 0.8 s headway; front car brakes; any hard brake by the ego risks a rear hit (scored as R's fault) | Rear-view inset | Joint JSON including R | Ego must brake *enough but not too much* | 2 h | PDM-Lite ignores rear traffic: measures nothing new |
| 8 | Wow visuals: HMI "why" ticker, top-down camera, sim-time video with "0G thinking 2.3 s" cards, scoreboard page of attacks vs survivals, side-by-side scripted vs 0G | — | display only | — | 1–3 h each | none |

## 4. Prototype result (swarm_box_v1)

Scenario (prototype, not frozen in `faultline/config.py`): ego 8 m/s; car A in the ego lane 24 m ahead at 8 m/s; car
B (taxi) in the left lane 4 m ahead at 9 m/s; 1 s checkpoints after a 2 s run-up; actions as cut_in_v1. Local rules:
CutInAdversary physics per car, A never gets cut-in actions, **separation guard** (a car behind the other in the same
lane gets at most the braking needed to stop 1 m short; every guarded tick is logged in `trajectory.jsonl.guarded`).
Any transport/parse failure → both cars SAFE_HALT (tested). Not anchored, not published, not signature-verified yet.

| Run | World / ego | Lookahead | 0G decisions | Outcome (ground truth) |
|---|---|---|---|---|
| `runs/swarm-kin-001` | kinematic / IDM | no | 4 (cp0 `20332b1c-c674-40dd-8ed6-db57874780c5`, cp1 `acba28f7-c1b2-4f91-8a6b-d944545b8f1d`, …) | **B ran into A** (adv_contact) at ~5 s; ego CCS 0.55, min TTC 3.3 s |
| `runs/swarm-kin-002` | kinematic / IDM | yes | 7 (cp0 `3a1d7fde-c0d3-4d56-b2d5-517a29736f67` … cp6 `28354162-ad88-46bc-b722-f154108f1536`) | CCS **0.997**, min gap 0.51 m, min TTC 0.50 s, no collision, guard 30 ticks |
| `runs/swarm-carla-001` | CARLA / PDM-Lite on LiDAR | yes | 7: `5fba54ef-b149-4f8b-91b7-8f75415432c1` (A:SLOW_DOWN B:CUT_IN_AGGRESSIVE), `9f650f29-7509-41f1-ab86-c0fec7aa9229`, `072cfd69-e208-4ca7-bab5-4c273e6d030f` (both BRAKE_HARD), `0171ce79-53b1-4b4a-83ff-6db80c5a2a2e` (both ACCELERATE), `326a1004-d75e-4b3e-91a6-876a630b826a`, `a37b077a-2cfb-4f27-8da3-5385b144117e`, `e071d249-b872-45b1-8e58-6d120c8ff5fd` (BRAKE_HARD, no-ops) | GT CCS 0.68, min gap 3.50 m (W8), min TTC 1.43 s, PDM-Lite peak 7.02 m/s², no collision, guard 10 ticks. **Video: `runs/swarm-carla-001/screen.mp4` (29.7 s)** |

Reading: coordination works mechanically (one call, two cars, strict parse), the forecast makes it far more
demanding against the nominal ego, and PDM-Lite still survives in CARLA by stopping 3.5 m short. The next lever is
attacking while PDM-Lite is still moving (ideas #3, #5) and fixing W3 so the last 3 checkpoints are not wasted.

Reproduce: `.venv/bin/python -m faultline.swarm --world kinematic --lookahead --out runs/<new>`;
`... --world carla --view --lookahead --out runs/<new>` (takes the CARLA flock).
