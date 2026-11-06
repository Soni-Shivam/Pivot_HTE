# Faultline: 3-minute video shot list

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
