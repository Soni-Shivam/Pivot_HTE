# Faultline swarm campaign: MAP-Elites archive vs no archive (2026-11-06/07)

Code: `faultline/campaign.py` (archive, J, page), `faultline/swarm.py` (`behaviour_cell`, `CAMPAIGN_PLANNER_PROMPT`),
`faultline/carla_swarm.py --elite`. Tests: `tests/python/test_campaign.py`. Pages: `runs/campaign-00{1,2}/campaign.html`
(archive grid filling episode by episode, links to each episode's decisions page; CARLA elite videos listed). Every
episode has a ledger row (`docs/evidence/faultline-ledger.md`, run `campaign-00x/<arm>/ep-NN`, cost per run). Not
anchored, not published.

## Setup
- Kinematic two-lane world, swarm_v3 primitives, seeded varied starts `sample_scenario(100+i)` (7 layouts); both arms
  get the same 12 starts.
- Per episode: one thinking-mode plan call + one non-thinking joint call per checkpoint (10), 0G Router private tier,
  model `0gm-1.0-35b-a3b`. Strict parse unchanged: any bad car action → all cars halt, `source:"none"`.
- Behaviour cell (measured, never the model's claim): dominant **pressure** (lateral / braking / boxing / pace, counted
  from action changes actually executed) × **first threat** (in-path TTC < 3 s: none / early < 5 s / mid 5–8 s /
  late > 8 s). 16 cells.
- Archive: best *valid* episode per cell by ground-truth CCS (valid = plan parsed, no SAFE_HALT, no adversary contact).
  J = 1.0·CCS + 0.5·new-valid-cell − 0.5·invalid (logged, deterministic; the model never scores itself).
- **archive** arm: the planner's brief lists filled cells (plan, score) and empty cells; it must target an empty cell
  (`target_cell` in the plan). **baseline** arm: same starts, plain planner prompt.

## Results (honest: the archive did not increase behavioural coverage)

| campaign | arm | coverage (valid cells /16) | cells visited | distinct plan names | valid eps | plan truncated | target hit | cost |
|---|---|---|---|---|---|---|---|---|
| 001 (plan cap 6000) | archive | 3 | 6 | 6 | 4/12 | 6 | 0/6 | $0.0341 |
| 001 | baseline | 7 | 9 | 2 | 8/12 | 0 | – | $0.0371 |
| 002 (cap 12000, empty cells rotated) | archive | **5** | 7 | **10** | 7/12 | 2 | 1/10 (invalid) | $0.0518 |
| 002 | baseline | **5** | 7 | 4 | 8/12 | 0 | – | $0.0389 |

- campaign-001's archive arm is confounded: the longer brief made the thinking planner exhaust 6000 tokens on 6/12
  episodes (empty content → `invalid_json` → every car halts), and it kept choosing the first listed empty cell. Fixed
  in 002 (cap 12000 for both arms, empty-cell list rotated per episode); 2/12 still truncated.
- campaign-002: equal coverage (5 vs 5) and equal cells visited (7 vs 7). The archive raised *plan-text* diversity (10
  distinct names vs 4: the baseline wrote "Decoy Cut-In" 8 times) but the plans rarely produced the cell they aimed at
  (1/10 hit, and that one halted). Behaviour is driven mostly by the start layout and the executor, not the plan's
  intent. Union over both campaigns (24 eps each): archive 6 cells, baseline 9.

## Distinct elites (campaign-002 archive arm) and CARLA re-runs
CARLA re-run = the elite's start + its recorded 0G plan (same request id, marked `reused_from`), live 0G executor,
PDM-Lite ego on its own LiDAR, director + stitched video + decisions.html. No lookahead (as in the campaign).

| elite | plan (request id) | kinematic cell / CCS | CARLA run | CARLA cell / CCS / min TTC | 0G/halt | sigs |
|---|---|---|---|---|---|---|
| ep-06 staggered4 | **Front-Back Squeeze**: "Car A slows ahead, Car D tailgates behind, Car B blocks left lane to prevent escape, forcing ego to brake." (`35241ef4-a73d-4d36-8399-2392228727ec`) | braking×early / 0.98 | carla-05 | braking×early / 0.88 / 1.16 s | 10/0 | 10/10 |
| ep-03 staggered4 | **Late Cut-in Squeeze**: "B accelerates to maintain gap, then cuts in late at 9s after A brakes, creating a late lateral threat." (`b822d237-832b-4491-96e5-ee16da7b5e41`) | braking×late / 0.78 | carla-06 | braking×late / 0.72 / 1.39 s | 10/0 | 10/10 |
| ep-00 duo_front2 | **Decoy Weave**: "B weaves into ego lane early to force braking, then exits…" (`22d6c483-6aae-43b9-8378-1a9e063b357d`) | pace×mid / 0.97 | carla-07 | lateral×none / 0.83 / 5.67 s | 10/0 | 10/10 |
| ep-10 left_wall3 | **Front Cut-in**: "Car A executes a cut-in from ahead, entering the ego lane. Car B blocks alongside." (`35c6c7e4-7d1d-4f80-9812-19d9865e863d`) | braking×mid / 0.99 | carla-08 | pace×early / 0.51 / 1.98 s | 10/0 | 10/10 |

2 of 4 elites landed in the same cell in CARLA; no collision in any run. Videos: `runs/campaign-002/carla-0{5..8}/
{stitched,director}.mp4` (indexed in `runs/videos/INDEX.md`).

Signature check: `npm run faultline -- sigs runs/campaign-002/carla-0N/decisions.jsonl`, run 1–2 min after each run
(2026-11-06T23:59Z – 2026-11-07T00:04Z): 10/10 verified for carla-05, -06, -07, -08 (40/40).

## Failures kept on record
- carla-01..03 (23:48–23:50Z): SAFE_HALT at checkpoint 0. From ~23:45Z the model started nesting
  `{"action","why"}` per car; the strict parse rejected it (`out_of_set`), as designed. A kinematic recheck of the same
  plan reproduced it, so it was provider-side drift, not CARLA. Fix: one prompt sentence ("each value is the bare
  action string, never an object"); the parse was not loosened. Sigs 1/1 each.
- carla-04: crashed in reset (spawn collision with the base taxi's initial pose, left_wall3); 4 of our own actors leaked
  and were destroyed by hand. Fixed: extra cars spawn 30 m up then are placed, and the extra spawns run inside
  `CutInCarlaWorld.reset`'s cleanup-on-failure.

## Cost
Campaign-tagged ledger rows (48 kinematic episodes + CARLA runs): **$0.186** recorded; CARLA part $0.024. Plus ~$0.006
in two unlogged kinematic rechecks (scratch).
