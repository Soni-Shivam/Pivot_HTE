# Faultline safety memory: version-aware regression, owner anchors, Arkiv claims (live, 2026-11-07)

Plan: `docs/superpowers/plans/2026-11-07-faultline-memory-identity-plan.md` steps 1 (ideas B + A) and 2 (idea C).
Run dir `runs/memory-001` (gitignored; key artifacts copied here and in `faultline-memory-regression.md`).

## Model refs (`faultline/memory.py`)
`artifact_digest = sha256(canonical({params, source}))`, source = sha256 of `faultline/controller.py`
(`c37b935a…6cb`) and `faultline/experiment.py` (`79291f3d…dcb`), the same code shas as research-mission-001.
| model | params | digest |
|---|---|---|
| `idm-follower@1.0` | `experiment.CTRL0` = min_gap 2, comfort_decel 3, max_accel 1.5 (the `IdmParams` defaults), min_time_headway 0 | `56592f0463f1a04af3e339c1349cfd3aa7132eaafc8042493e61eb2b6ab79d8c` |
| `idm-follower@1.1` | min_gap 5, comfort_decel 2, max_accel 3, min_time_headway 2 | `1f2328936cd0df03edf1036f4729e38b71e24966007d333d092561d23360938c` |

v1.1 is the classical 240-point grid fix read from `runs/research-mission-001/research.json`
`fix_baseline.fewest_suite_unsafe` (also `faultline-research.md` "Fix": suite unsafe 19 → 0, no regressions).
Every record's config hash = sha256({research.config_hash(params, ctrl, chooser model, prompt sha), model@version,
artifact_digest}).

## Regression v1.0 → v1.1 (kinematic lead-brake world)
Test set: 58 imported failures (57-row failure library + research mission, labelled `imported:*`; all 58 re-ran on
v1.0 with the stored outcome, 0 mismatches) + 40 frozen suite + 31 boundary probes (gap −5/+5/+10/+20 m around each
fingerprint's representative) = 129, all re-run on v1.1, plus 6 System-2 (0G) experiments on both = **135 pairs**.
Safe = no collision AND min gap ≥ 2 m. Rates: Wilson 95 %. The set is failure-biased, so rates compare versions only.

| category | n | collisions v1.0 | collisions v1.1 | unsafe v1.0 | unsafe v1.1 | fixed | regressions | status | mean speed (m/s) |
|---|---|---|---|---|---|---|---|---|---|
| low_friction (μ<0.5) | 11 | 5 (45.5 % [21.3, 72.0]) | 1 (9.1 % [1.6, 37.7]) | 7 | 1 | 6 | 0 | improved | 15.90 → 13.19 |
| slow_reaction (delay≥1 s) | 27 | 9 (33.3 % [18.6, 52.2]) | 2 (7.4 % [2.1, 23.4]) | 24 | 3 | 21 | 0 | improved | 13.50 → 11.96 |
| hard_brake (lead≥6) | 30 | 6 (20.0 % [9.5, 37.3]) | 0 (0 % [0, 11.4]) | 22 | 0 | 22 | 0 | improved | 11.80 → 9.93 |
| lead_brake (rest) | 67 | 9 (13.4 % [7.2, 23.6]) | 0 (0 % [0, 5.4]) | 51 | 0 | 51 | 0 | improved | 13.00 → 11.04 |
| **overall** | 135 | 29 (21.5 %) | 3 (2.2 %) | 104 (77.0 %) | 4 (3.0 %) | 100 | 0 | | 13.07 → 11.15 |

Efficiency cost of the fix: mean speed −14.7 %, cruise time headway 2.38 → 2.65 s.
Fingerprints: **7 fixed**, **3 persist** (`collision/ttc_collapse/friction_limited/braking_phase/during_lead_braking`
1/11 cases, `…/friction_limited/reaction_delay/during_lead_braking` 1/1, `…/grip_available/braking_phase/after_lead_stopped`
2/4), **0 new weaknesses**, **0 regressed categories**. Two of the persisting collisions are 0G's extreme picks
(30 m/s, 10 m gap, lead 9 m/s², delay 1.5 s), which no bounded IDM tuning avoids.

System 2 (0G `0gm-1.0-35b-a3b`, private tier, provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`, temperature 0,
JSON mode, thinking off): 2 calls, 7163 + 1825 tokens, $0.00145.
- plan `b2aed5f9-d6a8-4392-8ca2-1260ff907a7e` (6 experiments, all valid, all ran on both versions)
- report `5d2aa9fa-653c-4127-877e-c15fffd783e8`
- `designer.jsonl` chain head `e4fdb877873e2d693948fc0e1f14cf05e74fdbed3b22a3fb315048d65cef3d2c`, verify_chain true
- `npm run faultline -- sigs runs/memory-001/designer.jsonl` (run right after the campaign): `{"total":2,"verified":2}`

Audit of the 0G report (structured claims vs the deterministic classification): first pass 7 supported / 4
contradicted; the 4 were rate claims with `category: "overall"`, which the audit called an unknown category. After
`python -m faultline.regression rebuild` (audit only, no new 0G call, `rebuilt` stamp in regression.json and snap-2
public.json, done before snap-2 was published): **11 supported, 0 contradicted**. Not audited (free text): the
summary says "one collision fingerprint persists" (three do), two claim texts read "from 0.022 in v1.1 to 0.022 in
v1.1" (their structured values are correct), and a caveat calls THW "time-to-whistle".

## AgentMemoryRegistry (Galileo 16602)
- ERC-8004 ABI confirmed by live reads on `0x8004A818BFB912233c491871b3d84c89A494BD9e`: `supportsInterface(0x80ac58cd)`
  = true (ERC-721), `ownerOf(579)` = `0x8dac3a1fd3D7796254b84Ad70750430f67871069`, `ownerOf(999999999)` reverts
  `ERC721NonexistentToken`. So `anchor` checks `ownerOf(agentId) == msg.sender` (no recorded-owner fallback).
- `forge test`: 45 passed, 0 failed, 5 suites (AgentMemoryRegistry 7: first anchor + event, prev-root chain, zero prev on first,
  only current owner incl. transfer, unknown agent reverts, zero roots, seq per agent and model).
- Deploy: `forge script script/DeployMemoryRegistry.s.sol --rpc-url $RPC_URL --broadcast --gas-estimate-multiplier 150`
  → **`0x7a8676D267f1aa17d6B55cF5BfcD2A9509b963e3`**, tx `0xd5bf9f0340ecdb7c6fb2b5ae288481f6e737ab3391515cf34172eed41f4475f7`,
  block 64247587, status 1; `contracts/deployments/16602.json` key `agentMemoryRegistry` (existing keys kept).
- Source verified: `forge verify-contract … --verifier custom --verifier-url https://chainscan-galileo.0g.ai/open/api`
  (GUID e3182248-…); `getsourcecode` returns ContractName AgentMemoryRegistry, v0.8.28.

## Snapshots, 0G roots, anchors
| snapshot | records | records root | claims root | public root | sealed root | anchor tx (seq) |
|---|---|---|---|---|---|---|
| `idm-follower@1.0#1` | 129 | `0xed632b73…bed31` | `0x10c74eb5…76a97` | `0x08c592a1b87d622067c0964ae15d9ed9665e5868704fec9e142bf91606035d9e` | `0xcdc2a6094e2b5ccca89e80ec6c488e0eb945b76c08e5965ac0515109b639d7c0` | `0x0281c6a1012c721e989a8d569d809849eda9ddbfa067137d975a40f6965688e5` (1) |
| `idm-follower@1.1#2` | 270 | `0x6b73c885…b0a04` | `0x3b5d0bf0…d5610` | `0x0ff260127d38daecf4debacdd03dbf0df239b42ea5285502bc6e97f8d716ed4b` | `0x1c76089af9ac60fe06f10ea238ffd381a750d21086b569313cf8cc175e468e2a` | `0x9a7265d1e1aa58f554bff0b92b7c871db34cc59a1875ceb86b2fe0693077b084` (2) |

Anchor 2's `prevRoot` = snapshot 1's sealed root (enforced on chain). Upload txs: snap-1 public
`0x3b725fe9…84fd`, sealed `0x958f4955…c4e4`; snap-2 public `0xb0a69013…0c0f`, sealed `0x527944a5…ecf4`. Sealed key =
HKDF-SHA256(tenant key, "memory:" + memory version) → AES-256-GCM envelope (PROTOCOL §3). Public JSON = aggregates,
claim lines, fingerprint counts, the 0G report and request ids; no per-test params or trajectories.

## Arkiv (Rabdi 7794095), owner `0x8dac3a1fd3D7796254b84Ad70750430f67871069`, schema `faultline.claim/v1`, TTL 90 days
| version | category | entity key |
|---|---|---|
| 1.0 | low_friction | `0x0c86b3013723186cd72b15847256b349c37df3c0656427eb4f8abcfa40798db8` |
| 1.0 | slow_reaction | `0xac771ae307ab2f600f90c6050244665c6e4cc94382b7aa7fed96e5a717e88f0e` |
| 1.0 | hard_brake | `0x387e2bb62a97d77cf96f5f1b8eaa033a63cafe494e743515ed4857f288e7fa50` |
| 1.0 | lead_brake | `0x259ec53429995025292a6e53bf18ece655f93eb3ffe85c263e2f36314c3d692a` |
| 1.1 | low_friction | `0x3bdcf0a7b97a807aa5e9dd2c74c8fff6be26b6c2153610973cc61c7ed7e59727` |
| 1.1 | slow_reaction | `0xb1271d9ee72a20e99d630e36fa794cbd7d1f1082f40db07f22145fd7e39f30e3` |
| 1.1 | hard_brake | `0x0da7962d2180689ec7e2f0682b213dae95c33b1a02f83ea2c191d95afd7ec3b5` |
| 1.1 | lead_brake | `0x63990b662ebd9c39cda12bf0e550e9e03302462022b8e9bdfef7fea374f89dcd` |

Read back: `npm run memory -- arkiv-query --model idm-follower --version 1.1 --owner 0x8dac…1069` → 4 entities
(low_friction 1/11 rate 0.090909 ci [0.016232, 0.377358]; slow_reaction 2/27 0.074074; hard_brake 0/30; lead_brake 0/67).
The Rabdi RPC answers CORS preflights with `*` (and allows `X-Api-Key`), so the dashboard reads it directly.

## Auditor verify (`npm run memory -- verify <publicRoot> <sealedRoot>`, tenant key from .env)
Both snapshots: `ok: true` — 0G Merkle roots of both downloads match, claims root recomputed, sealed snapshot opened,
records file sha + records Merkle root recomputed, claims cover every (version, category) group, every claim's
n / collisions / unsafe / rate / CI / mean speed / per-claim records root recomputed, on-chain anchor roots and prevRoot
match. snap-1: 4/4 claims ok (129 records); snap-2: 8/8 claims ok (270 records).

## Dashboard (`apps/memory-web`, static)
`npm run mweb:build`; `node apps/memory-web/test/headless.mjs --shot docs/evidence/media/memory-web.png` (live Arkiv
public endpoint + Galileo): 8 claims, 2 anchors, comparison rows 4, anchor chain and claim roots all ✓, no page errors.
Screenshot: `docs/evidence/media/memory-web.png`.

## Tests
pytest `tests/python/test_memory.py` + `test_regression.py` (9, no network; shared Merkle vector
`0xf2ab04ec…a41b` also asserted in TS); `packages/memory/test/memory.test.ts` (3: vector, Python-written fixture
recomputed in TS, verify ok + tamper + wrong key + wrong anchor). Full-suite lines are in the commit message.

## Claims we make / don't
Make: v1.0 and v1.1 results come from deterministic re-execution with config hashes bound to the artifact digest;
snapshots are sealed on 0G Storage and anchored on Galileo by the ERC-8004 owner; every shared number is recomputable
by an auditor holding the key. Don't: "certified", "private from everyone" (0G roots and sizes are public), field
collision rates (failure-biased test set, one kinematic world).

## Deviations
1. Categories are lead-brake sub-conditions (low_friction / slow_reaction / hard_brake / lead_brake); cut-in,
   occlusion and swarm are not in this campaign (the failure library is lead-brake only; CARLA left for later).
2. "Minimized case" per fingerprint = the library case closest to the reference case (the library stores no minimized
   case except the mission's #21, which is included as an imported test).
3. Audit rebuilt once (category `overall`), labelled; see above.
4. One `memory publish` for snap-2 hung >15 min in the 0G upload wait and was killed; the re-run published. The
   killed attempt may have uploaded an unreferenced sealed blob (fresh nonce each seal); only the roots above are anchored.
5. No inclusion proofs: an auditor recomputes the whole tree from the sealed records (simpler, same guarantee).
