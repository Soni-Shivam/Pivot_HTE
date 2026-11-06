# Faultline build: handoff brief for the executing agent

Read in this order: `CLAUDE.md`, `.claude/skills/sealedai-stack/SKILL.md`, the spec
`docs/superpowers/specs/2026-11-06-faultline-0g-architecture-design.md` (§2.1, §5, §6, §10, §12), then the plan
`docs/superpowers/plans/2026-11-07-faultline-build.md`. The spike scripts in `spikes/` show the exact CARLA 0.10 and
Router calls that already worked on this machine; reuse their code where the plan's interfaces allow.

## Context
Repository `/home/sedrica-w/shivam/eth_hackathon`, branch `build/faultline` (checked out; commit there, never on
`main`). ETHGlobal hackathon, 0G "Physical AI" track. Faultline: a CARLA 0.10 lead vehicle driven at 1 s checkpoints by
the 0G model `0gm-1.0-35b-a3b` on the Router's private (TeeML) tier; physics, limits and the safe halt stay local;
criticality metrics (TTC, THW, DRAC, CCS v2) come from the ego's LiDAR; every decision is logged with its 0G request
ID and independently verified with the Compute SDK (`processResponse`); the bundle goes to 0G Storage (public JSON +
AES-GCM sealed tar); commitments go to `EpisodeRegistry` on 0G Galileo; a static page verifies and replays.

Track rules that decide the prize: a 0G call inside the decision loop; an episode log on 0G Storage with a request id
per decision; a replayable simulation; a safe-stop fallback when 0G is unreachable, and "a fallback that fakes the
decision disqualifies".

Already live-tested 2026-11-07: 0GM answered `BRAKE_HARD` in 2.7 s with request id, provider and `Zg-Res-Key`;
`processResponse` returned true; the CARLA 0.10 server runs headless here; `.venv` (Python 3.12) imports the CARLA
wheel; the MBRDI metrics (MIT) are cloned at `~/shivam/mbrdi-development`. The user authorized the small paid calls
(Router cents, Galileo gas; deployer holds ~7.85 0G) and asked that every decision be taken by the plan, not reopened.

The repo also contains the previous product (SealedAI: `packages/planner`, `packages/worker`, `packages/client`,
`apps/web`, escrow contracts). Leave it in place; reuse only what the plan names.

## Hard rules (override anything else)
- Private tier only; no retry on another tier or model. A failed decision is a logged `source: "none"` safe halt,
  never a substituted decision. Nothing is called verified without `processResponse === true`.
- Never print, log or commit `.env` values. Node via `. ~/.nvm/nvm.sh`. Exact pins. `ethers` only where the plan
  allows. No backend server. Smallest change that passes the task's acceptance tests. Evidence (request IDs, roots,
  tx hashes, test summary lines) goes into `docs/evidence/`.
- If a step cannot pass as written (an API differs, CARLA behaves differently), make the smallest change that keeps
  the task's acceptance test meaningful, say so in the commit message, and keep going.

## Environment
- CARLA must listen on `127.0.0.1:2000`: `ss -ltn | grep :2000`; if nothing, start it with the command in the
  plan's Global Constraints. Another project on this machine also uses CARLA: never start a second server; always
  restore async mode.
- Python: `.venv/bin/python`; tests `.venv/bin/python -m pytest tests/python -q`. TS: `npm test`, `npm run typecheck`.
- `.env` holds `ZG_ROUTER_URL`, `ZG_API_KEY`, `RPC_URL`, `STORAGE_INDEXER`, `PRIVATE_KEY`. Add `FAULTLINE_TENANT_KEY`
  with `openssl rand -hex 32` (and a placeholder in `.env.example`).

## Done
All plan tasks checked off and committed; all three test commands green; `runs/demo-002` = completed CARLA episode
with real 0GM decisions, published, anchored, verified (`verification.json`), replayed; `runs/halt-001` = real
unreachable-0G halt; verifier page built and checked headless; `docs/evidence/faultline-matrix.md` filled with real
IDs/roots/txs; `README.md` rewritten; branch pushed (`git push -u origin build/faultline`, no PR). End with a short
report: green, red and why, exact artefacts.
