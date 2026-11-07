# Faultline: 3-minute video shot list

**Archive of early shot ideas.** The current 2:54 edit, voiceover, asset cuts, and proof checklist are in [the submission video plan](submission/video-shots.md#final-3-minute-story-one-paid-test-then-the-platform-around-it). Use that plan for the final render.

Footage on disk: `runs/demo-001/screen.mp4`, `runs/demo-002/screen.mp4`, `runs/halt-001/screen.mp4`,
`runs/baseline-001/screen.mp4` (chase camera + HUD with the live 0G decision line). Re-record any of them with `--view`.

1. **Referee pitch (20 s).** Title card, then the one-paragraph pitch (README "Why 0G is the referee"): nobody trusts
   a benchmark whose referee has a stake; the adversary's brain runs on 0G private compute, signed, logged and
   committed on chain. "The customer keeps its driving stack. The referee is the network."
2. **Live run (60 s).** Split screen: terminal running
   `python -m faultline run --world carla --seed 7 --out runs/demo-00X --anchor --view` (commit tx appears first,
   then the decision table fills with request IDs) and the CARLA chase view: 0GM brakes the taxi hard; the HUD shows
   LiDAR gap and TTC falling to 0.5 s; the follower stops ~1.5 m behind. Cut to the contrast line: scripted
   `MAINTAIN` baseline CCS 0.094 vs 0G run CCS 1.0.
3. **Pull the network (25 s).** `--chaos unreachable` (the Router URL is a closed port: a real failed connection,
   not a fake): first checkpoint `reason unreachable, source none`, the lead performs SAFE_HALT, status
   `interrupted`. Say: "no fallback decides for 0G; the track disqualifies that, and so do we."
4. **Verifier page (45 s).** `npm run fweb:serve`, open `?root=0x03c68b42…7b44`: "Downloaded … proof checked", four
   green checks (file hashes, decision log, metrics recomputed, 8/8 signatures), on-chain block: committed 20:01:06Z
   before the first 0G call 20:01:29Z, public root on chain matches. Press Play on the replay; point at the gap/TTC
   chart. Paste the tenant key to open the sealed bundle (file hashes ✓). Show the CLI
   `npm run faultline -- verify <root>` printing `processResponse` true per decision.
5. **Limits (15 s).** Physics and the stand-in driver run on our machine (0G referees decisions and the record);
   CARLA motion is kinematic on the lane; LiDAR blind zone under 1.5 m; CCS is a criticality score, not an accident
   probability.

## Swarm cut (new, 60-90 s): `runs/videos/INDEX.md` → `swarm-carla-008__stitched.mp4`, `swarm-carla-010__stitched.mp4`

Sim-time videos, no frozen frames; every 0G call is a card with the model's raw JSON. Evidence:
`docs/evidence/faultline-swarm.md`. Not anchored: say so on screen.

6. **The plan (10 s).** Open `swarm-carla-010/director.mp4` at 0:00: the strategist card (thinking 0GM, 26 s real
   time, 14k reasoning chars) shows "Staggered Cut-in", the role of each coloured car, the phases, the request id and
   plan sha256.
7. **The swarm moves (35 s).** Same file 0:04–0:32: drone panel labels each car with its current action; the 0G panel
   shows the phase, the four actions and the model's "why"; LiDAR BEV shows the tracks PDM-Lite sees; metrics strip
   gap / TTC / brake. B cuts in, A brakes, C cuts in last ("forcing the ego to stop behind B"). Then the second
   pattern: `swarm-carla-008` (Decoy cut-in: B cuts in then accelerates away, C cuts in 6 s later).
8. **The robotics view (15 s).** `swarm-carla-010/stitched.mp4`: the same moment in RViz (LiDAR cloud, coloured GT
   box per car) and the Lichtblick HMI, which reads `AWAITING_0G` exactly under each 0G card.
9. **Every output, verbatim (10 s).** Scroll `runs/swarm-carla-010/decisions.html`: plan JSON, then per checkpoint
   the state table, the forecast the model saw (chosen row highlighted), raw JSON, request id, latency.
10. **Fail-closed (10 s).** `swarm-carla-003/director.mp4`: the model names a cut-in its car may not make; red card
   "SAFE_HALT for every car (no substitute decision)", all four cars brake. Line: "one bad car stops the swarm."
