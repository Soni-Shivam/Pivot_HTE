# Faultline Studio public backend

The user asked for this PC to be the backend for the live demo. This overrides the project's "no backend server"
rule for the demo only (change log in `docs/TASKS.md`).

```
browser (Vercel: apps/faultline-studio)  ──HTTPS──▶  Tailscale Funnel  https://sedrica-w.tail1b988f.ts.net
                                                          │ (proxies to loopback)
                                                          ▼
                       agent console  127.0.0.1:8788   packages/hedera/src/agent-console.ts
                       ├─ Hedera payer key, run permits, 0G Router key, chain signer: .env on this PC only
                       ├─ merchant service 127.0.0.1:8787 (npm run hedera:serve, x402 on Hedera testnet)
                       ├─ .venv/bin/python -m faultline run | faultline.stack.arena  (spawned per job)
                       └─ CARLA 127.0.0.1:2000 (shared server; worlds take the flock, the backend never starts or reloads CARLA)
```

## Run it

```bash
FAULTLINE_PUBLIC_ORIGINS="https://<app>.vercel.app,http://localhost:5173" scripts/backend.sh start
scripts/backend.sh status      # local + public /api/health
scripts/backend.sh restart     # re-uses the last origins (runs/backend/origins)
scripts/backend.sh stop        # stops 8787 + 8788; the funnel config stays
```

Logs: `runs/backend/{merchant,console}.log`. Processes are `setsid nohup`, so they outlive the shell.
Funnel: `tailscale funnel --bg 8788`. Once per machine it needs `sudo tailscale set --operator=$USER`.
Check: `curl -s https://sedrica-w.tail1b988f.ts.net/api/health`.

## Endpoints

All responses are JSON; streams are NDJSON (one event per line). Every POST needs `content-type: application/json`
and `x-faultline-console: 1`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ok, carla, zg, hedera, queue:{running, waiting}, caps:{buys_left, runs_left}}` |
| GET | `/api/policies` | | `[{id, name, description, spec, kinematic, digest, compatible, check, paid}]`. Ids are `pdm-lite` and `idm-cautious`. Digests come from `python -m faultline.stack check`, run once at startup |
| POST | `/api/demo-run` | `{policy, suite: "cut-in-v1-kinematic" \| "cut-in-v1-carla", seed?, mode: "free" \| "paid"}` | `{jobId, queuePos, label, kinematicNote}` |
| POST | `/api/arena` | `{policies?: ["pdm-lite","idm-cautious"], site?, mode: "script"}` | `{jobId, queuePos, label}` |
| GET | `/api/jobs/:id` | | `{id, kind, lane, policy, policies, suite, site, seed, mode, label, status, error, queuePos, runs, result, ...}` |
| POST | `/api/stream` | `{job}` | NDJSON: `meta`, `queue {pos}`, `step` (x402, paid only), `phase`, `log`, `decision`, `ticks`, then `done {job}` or `error {message, job}` |
| POST | `/api/stream` | `{run, mode: "live" \| "replay", speed}` | Vedant's recorded-run stream (unchanged) |
| GET | `/api/catalog`, `/api/runs`, `/api/runs/:name` | | Vedant's endpoints (unchanged) |
| POST | `/api/buy`, `/api/launch` | | Vedant's x402 purchase and launch. A paid buy now counts against the daily cap |
| GET | `/api/showcase` | | Curated evidence: swarm-carla-008/-010, arena-script-001, research-mission-001, hunt-bench-002, memory v1.0→v1.1, and demo-003 / cutin-002 / paid job 002 with explorer links. Facts are read from run dirs; facts that exist only in docs carry a `source` |
| GET | `/media/<path>` | | mp4, png, svg, `decisions.html` and `console.html` under `videos/` or `runs/`, with Range support |

### Modes

- **free** is a real run with real private-tier 0G decisions. It has no Hedera payment, no Galileo anchor and no
  0G Storage publish, and its label reads "demo, unpaid, not anchored".
  - Kinematic: `faultline run --world kinematic --family cut_in --decider 0g --ego default|cautious`.
  - CARLA: `faultline.stack.arena --mode live --stacks <stack>`, the real stack in `StackCutInWorld`.
- **paid** is the full flow: x402 on Hedera, then the permit, then `run-paid-job.ts` (commit, 0G loop, publish,
  finalize). Paid runs are `pdm-lite` only, because the permit binds the PDM-Lite policy commitment.
- **arena** replays the identical adversary script from `runs/cutin-002` against each stack. It makes no 0G calls and
  queues in the CARLA lane.
- **Kinematic policy choice** is a stand-in, and it is labelled as one (`kinematicNote`). The kinematic world has no
  CARLA sensors, so it cannot host an AVStack.
  - `pdm-lite` maps to the default exact-sensor IDM ego.
  - `idm-cautious` maps to the same ego with `idm_lidar`'s numbers: 1.6 s headway, 3 m minimum gap, no delay.
- **0G failures:** any failure → SAFE_HALT. This is the existing `run_episode` behaviour; the backend never
  substitutes a decision.

## Caps and guards

| Guard | Default | Env |
|---|---|---|
| Paid buys per UTC day (persisted in `runs/backend/caps.json`) | 6 | `FAULTLINE_CONSOLE_MAX_BUYS` |
| Live 0G runs per UTC day, free and paid (counts runs, not dollars) | 20 | `FAULTLINE_CONSOLE_MAX_RUNS` |
| Waiting jobs per lane | 4 | `FAULTLINE_QUEUE_MAX` |
| POSTs per IP per minute / all requests per IP per minute | 12 / 600 | `FAULTLINE_RATE_POST` / `FAULTLINE_RATE_ALL` |

- **Over a cap**, the API returns HTTP 429 `{error: "Live runs are paused for today — replay a recorded run"}`.
- **Queue:** the CARLA lane runs one job at a time. The kinematic lane runs one at a time, alongside a CARLA job.
- **Host header** must be `127.0.0.1:8788`, `localhost:8788` or the funnel host. Anything else gets 421.
- **CORS** is sent only to origins in `FAULTLINE_PUBLIC_ORIGINS`. A POST from any other cross-site origin gets 403.
- **Client IP** for rate limits is the first `X-Forwarded-For` entry when the request comes from the loopback
  proxy. Without that header, all funnel clients share one bucket.
- **No code upload.** Judges choose from the two example policies only.

## What is public, and what is never sent

**Public:**
- run summaries and decisions (actions, request ids, provider, latency)
- trajectories
- roots and transaction hashes
- videos and decision pages
- the policy digests

**Never sent** (`console-guard.ts mediaPath`, `runSummary`):
- `.env` values and keys
- run permits
- `anchor.json` salt
- `sealed.bin`
- any JSON file under `/media`
- dotfiles
- paths outside `videos/` and `runs/`

Tests: `packages/hedera/test/console-guard.test.ts` covers the caps, the rate limit, the CORS allowlist, the Host
check, the console header and the media allowlist.
