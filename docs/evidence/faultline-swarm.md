# Faultline swarm (swarm_v2): 4 cars, one 0G decision per checkpoint, a 0G-written plan (swarm-agent, 2026-11-07)

Prototype, **not anchored, not published, signatures not checked**. Every 0G call is logged with request id, provider,
Zg-Res-Key, latency, raw sha256 and the verbatim content (`decisions.jsonl`, `plan.json`, `decisions.html`).

## What runs

- **Cars** (`faultline/swarm.py SwarmScenario`): A red Charger, ego lane, ~22 m ahead; B yellow taxi, left lane, ~4 m
  ahead; C blue Mini, left lane, beside the ego; D magenta Patrol, ego lane, ~9 m behind. All kinematic (physics off);
  ego = PDM-Lite on its own LiDAR tracks in CARLA 0.10 Town10HD_Opt road 7, 8 m/s.
- **Planner**: one thinking-mode `0gm-1.0-35b-a3b` call before the first tick (private tier, max_tokens 6000,
  25–40 s, 12.7k–18k reasoning chars) writes a named plan with a role per car and 2–4 phases; content sha256 in the
  manifest. `--avoid` passes earlier plan names so the model must pick another pattern. Planner failure = every car
  SAFE_HALTs at the first checkpoint (tested).
- **Executor**: one non-thinking call per 1 s checkpoint returns `{"actions": {A..D}, "phase", "why"}`. Strict parse:
  every car present and in its own available set, else **every** car SAFE_HALTs, `source: "none"`, no substitute,
  no retry, no other model/tier. The observation carries the plan, a per-car state line, the inline reply schema
  with each car's allowed actions, and the local forecast (up to 24 most demanding joint actions of A–C, nominal IDM
  ego, 2 s).
- **Local rules**: per-car sets (cut-ins only from the left lane, gap ≥ 3 m, free slot; no braking a stopped car;
  ego-lane cars never change lane); separation guard between all cars and for D behind the ego (a lane-changing car
  counts in its target lane, fixed after kin-006); every guarded tick logged.
- **Display** (never feeds back): `faultline/director.py` 1920×1080 sim-time mosaic (chase camera 5.5 m/70°, drone
  top-down with per-car labels, numpy LiDAR BEV with track/GT boxes and lane borders, 0G panel, metrics strip, a
  1.25 s card with the raw JSON per call, plan and result cards); `faultline/stitch.py` records :2 with wall-clock
  timestamps and puts RViz + Lichtblick HMI crops next to the director, frame-matched by wall clock (HMI shows
  `AWAITING_0G` under each 0G card). RViz gets a coloured GT box per car (`carla_swarm.swarm_bridge`).

## Parse rate: before / after the inline-schema fix (lead request)

| prompt | runs | checkpoints parsed | episodes full length |
|---|---|---|---|
| flat keys, `available_actions` in the car rows (kin-003/004, carla smoke1, 002–005) | 7 | 25/30 (83 %) | 1/7 |
| inline `reply_schema` + state line, actions nested (kin-005…009) | 5 | 37/38 (97 %) | 4/5 (kin-006 ended on an adversary contact, guard fixed) |
| same, CARLA (007–010) | 4 | 25/27 (93 %) | 2/4 |

All failures are the model naming an action outside the car's set (masked cut-in ×5, braking a stopped car ×1,
re-sending CUT_IN during a lane change ×1, dropping a car ×1) plus one 8 s Router timeout (smoke1; the executor
timeout is now 20 s). The parse was never loosened. Run 006 used a short-lived rule that offered braking to stopped
cars as a no-op; it was reverted at the lead's request.

## CARLA episodes (PDM-Lite on LiDAR, ground truth)

| run | plan (0G) | plan request id | 0G / halt | outcome | GT CCS | min gap | min TTC | PDM-Lite peak |
|---|---|---|---|---|---|---|---|---|
| smoke1 | Decoy Cut-In | `6d5aed5b-7a47-48a0-bf9b-230d5e928017` | 2 / 1 (timeout) | halted 8.6 s | 0.90 | 3.90 m | 1.14 s | 6.99 m/s² |
| 002 | Decoy Cut-in | `04248b35-3441-4829-a080-bbcf4033c05b` | 9 / 0 | completed | 0.91 | 3.51 m | 1.11 s | 7.12 |
| 003 | Staggered Cut-In | `dd16b280-1ad9-4ac1-9385-c8299658f012` | 3 / 1 | halted (C masked cut-in) | 0.65 | 3.51 | 1.46 | 7.01 |
| 004 | Consecutive Cut-In | `6000eb6b-b73c-41ce-999f-445cbf452301` | 1 / 1 | halted (C masked cut-in) | 0.61 | 3.81 | 1.66 | 7.01 |
| 005 | Frontal Brake Check | `86dbb000-5b6f-493a-b64e-0802c475c74e` | 4 / 1 | halted (B brake at 0 m/s) | 0.91 | 3.51 | 1.10 | 7.15 |
| 006 | Cut-In Follow | `07a9d856-a736-4a06-a95e-91098d04ebb6` | 10 / 0 | completed (no-op-brake rule) | 0.65 | 3.51 | 1.46 | 7.01 |
| 007 | Rolling Roadblock | `a82e6dc8-c09a-4e98-8afe-d26149474ff2` | 1 / 1 | halted (CUT_IN re-sent mid-change) | 0.52 | 3.91 | 2.49 | 7.03 |
| **008** | **Decoy Cut-in** | `8576e523-5183-45e9-b206-31f38187fd27` | 10 / 0 | completed | 0.55 | 4.27 | 1.92 | 7.18 |
| 009 | Pincer Squeeze | `3f9b4a97-df11-415f-be78-1dc3590b9d19` | 4 / 1 | halted (B cut-in, slot taken) | 0.89 | 3.91 | 1.15 | 7.11 |
| **010** | **Staggered Cut-in** | `e1a9a298-520d-42bf-ad30-ad67d0cc5894` | 10 / 0 | completed | 0.90 | 3.49 | 1.13 | 7.03 |

No collisions, no adversary contact in any CARLA run. 60 executor checkpoints in CARLA (54 parsed `ok`; 59 reached the Router, 1 timeout), 10 planner calls.
Each run dir has `director.mp4`, `stitched.mp4`, `decisions.html`, `plan.json`, `decisions.jsonl` (request ids per
checkpoint), `recorder.log`. Kinematic dry runs: `runs/swarm-kin-003…009` (plans incl. Rolling Roadblock ×3,
Pincer Squeeze, all 10/10 after the fix).

## Patterns that emerged (the model chose them; nothing scripted)

- **Decoy cut-in** (008): "B cuts in ahead to force ego braking, then accelerates to open space. C applies left-lane
  pressure and cuts in behind B. D brakes to maintain safe rear gap." Executed: cp0 A BRAKE_HARD + B CUT_IN + D
  BRAKE_HARD; cp2–5 B accelerates away, C accelerates to get ahead of the ego; cp6 C CUT_IN behind B; cp8–9 release.
  Two different cars cut in 6 s apart.
- **Staggered cut-in** (010): "B and C sequentially cut into the ego lane ahead, while A progressively brakes."
  Executed: cp0 B CUT_IN; cp2–5 A SLOW_DOWN (B too at cp5) compressing the lane; cp6–8 C slows to hold off B;
  cp9 C CUT_IN "to block the ego's path, forcing the ego to stop behind B". Ego stopped 3.49 m short (W8).
- Also planned: Rolling Roadblock (kin-006/008/009, carla-007), Pincer Squeeze (kin-007, carla-009), Frontal Brake
  Check (005), Cut-In Follow (006).

## What PDM-Lite did

Followed whichever car its LiDAR saw first in its lane, braked at full pedal (brake 1.0, peak 7.0–7.2 m/s²) on every
cut-in, and always stopped ~3.5 m short of a stopped car (its fixed buffer, audit W8). It never collided; min true
TTC 1.10–2.49 s. The swarm made it brake hard, it did not beat it.

## Honest limits

- The model still sometimes names an action the schema just told it is unavailable (2/27 CARLA checkpoints after the
  fix); that halts every car by design. Its plans sometimes need moves the layout forbids (C "cuts in behind B" from
  beside the ego).
- Forecast and local physics are ours; the forecast's ego is a nominal IDM, not PDM-Lite. All cars are kinematic
  on the lane, no tyre physics. The guard authors motion (110–210 guarded ticks per run, mostly D vs the ego); it is
  logged per tick.
- Sync mode: the sim pauses 2.4–4.7 s per call; the director shows those pauses as cards, the stitched desktop drops
  them. "CCS (LiDAR, max)" in the result card includes the spawn transient (W10); the table above is ground truth.
- Not anchored on Galileo, not published to 0G Storage, TEE signatures not verified for these runs.

Reproduce: `source viz/env.sh && .venv/bin/python -m faultline.carla_swarm --out runs/<new> --ros [--avoid "A,B"]`
(takes the CARLA flock; viz from `viz/launch_viz.sh start`); kinematic: `.venv/bin/python -m faultline.swarm --plan
--lookahead --out runs/<new>`; re-stitch: `.venv/bin/python -m faultline.stitch runs/<id>`.

## Signature check (2026-11-06T22:39:54Z)
`npm run faultline -- sigs runs/swarm-carla-<id>/decisions.jsonl`, run about 2 min after the episodes (inside the provider cache window; these runs were not published, so the signatures are not archived):
- swarm-carla-010: 10/10 processResponse true
- swarm-carla-008: 10/10 processResponse true
