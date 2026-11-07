# Faultline: where the intelligence is (and what the LLM does not decide)

**Principle: the LLM does strategy; deterministic code does tactics, physics, validity and audit.** A model inside
a TEE (0G private tier, `0gm-1.0-35b-a3b`) picks *what kind* of attack and *which* of a short list of pre-checked
moves; code decides what is physically possible, what is fair to ask of the car under test, and keeps the score.

```
 ┌───────────────────────── LLM (0G private tier, every call logged with request id) ─────────────────────────┐
 │ L1 Research agent (System 2)    L2 Strategist (thinking 0GM)        L3 Executor (0GM, 1 call / s)           │
 │ picks tools + hypotheses        named plan, roles, phases            picks one action per car from the      │
 │ (bisect/grid/probe/minimize…)   plan sha256 in the manifest          menu below, strict JSON                │
 └───────────────▲──────────────────────────────▲─────────────────────────────────▲───────────────────────────┘
                 │ tool results                 │ brief                          │ filtered, scored menu + ego model
 ┌───────────────┴──────────────────────────────┴─────────────────────────────────┴───────────────────────────┐
 │ L4 Tactics (faultline/tactics.py, deterministic)                                                            │
 │  identify ego online → roll out every joint action twice → drop unescapable ones → rank by criticality      │
 │ L5 Physics + safety: frozen action bounds, separation guard, strict parse (one bad car → every car halts)  │
 │ L6 Audit: model choice vs best-by-forecast, regret, claim audit, hash-chained log, 0G Storage / Galileo    │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Layer | LLM decides | Code decides | Evidence |
|---|---|---|---|
| L1 research agent | next tool + hypothesis, when to stop, the write-up | tool execution, budget, outcome, fingerprint, claim audit | `docs/evidence/faultline-research.md` |
| L2 strategist | attack pattern, car roles, phases | brief contents, plan hash, fail-closed if no valid plan | `faultline-swarm.md` |
| L3 executor | one action per car among the offered ones | which actions are offered (L4), parse (strict) | `decisions.jsonl` |
| L4 tactics | nothing | ego identification, escapability filter, candidate scores, novelty | `tactics.jsonl` per run |
| L5 physics/safety | nothing | accel limits, lane changes, guard, SAFE_HALT | `trajectory.jsonl` (guarded ticks) |
| L6 audit | nothing | regret vs best candidate, contradicted claims, roots | `tactics_summary.json`, ledger |

## L4 tactics, concretely (new)

1. **Online ego identification.** From what an adversary can see (ego speed/accel, gap, the in-path car's speed and
   braking onsets) it fits the *effective* response delay (time until the ego's decel grows 1 m/s² after a stimulus,
   median over events, min-max bounds), peak deceleration (ghost decel at v = 0 excluded, W6) and preferred headway
   (median over steady following, IQR bounds); with too few samples it says `"source": "prior"`. The forecast is now
   about *this* ego, not the nominal IDM the audit flagged. Kinematic runs: 0.7–1.85 s identified vs the IDM's
   0.6 s sensing delay — the effective delay includes the IDM's ramp, so the escapability filter errs on the fair side.
2. **Escapability filter.** Each joint action is rolled out with the identified ego at its best response (hold for
   its delay, then brake at any of 100/75/50/25/0 % of max(observed peak, the adversary's own brake limit); a free
   left lane also counts). If no response avoids a collision the joint action is **unfair** and is removed *before*
   the prompt; the offered per-car menus are shrunk to a product of fair joints, so any parseable answer is fair.
   This turns "make it crash" into "find what the stack should survive but doesn't".
3. **Scoring.** Fair candidates are ranked by criticality (a fair collision under the identified behaviour = a found
   failure ≫ 1/min TTC ≫ 1/min gap) plus novelty vs joint actions used this episode; the top 24 go to the model.
4. **Audit.** Per checkpoint: chosen joint vs best-by-forecast, rank, regret; per episode: deviation rate and
   whether deviations paid off (realized min TTC in the next second below the best candidate's forecast).

## Measured

| Change | Before | After | Source |
|---|---|---|---|
| Forecast in the loop (L4 v0, nominal ego) | CCS 0.55, min TTC 3.3 s, cars collided | CCS 0.997, min TTC 0.50 s | `swarm-kin-001/002` |
| Tools for the research agent (L1) | boundary error 5.57 m, 25 calls | 0.73 m, 6 calls (bisection alone: 0.57 m, free) | `faultline-research.md` G1 |
| Tactics vs nominal forecast (same 8 seeds) | see below | see below | `runs/smart-{base,tac}-0*` |

Kinematic swarm, `sample_scenario(seed 0-7)` (7 layouts), live 0G private-tier calls, no plan call, both arms with
the nominal forecast in the loop; "baseline" = full menu + nominal forecast, tactics evaluated and logged only.

| Arm | GT CCS mean / median | min TTC mean | chosen joints fair (escapable) | cars touched | halts | top-1 picks | mean regret | cost |
|---|---|---|---|---|---|---|---|---|
| baseline (nominal forecast) | 0.837 / 0.986 | 0.72 s | 61 / 64 evaluated (3 unfair) | 1 episode | 1 (timeout) | 2 / 67 | 0.148 | $0.0143 |
| **tactics** | **0.868 / 0.994** | **0.58 s** | **68 / 68** (0 unfair) | 0 | 1 (timeout) | 10 / 71 | **0.058** | $0.0160 |

Per seed the gain is concentrated: seed 3 went 0.752 → 0.997 CCS (min TTC 1.46 → 0.47 s) and the baseline's cars
touched there; 5 seeds are unchanged within ±0.01; seed 7 (escort layout, nothing ever in the ego's path) is 0 in
both. Deviations from the best-by-forecast candidate: 65/67 baseline, 61/71 tactics; 10 and 9 of them realized a
lower min TTC than the best candidate's forecast ("paid off"), i.e. the LLM's departures from the scorer rarely beat
it. Development history kept honest: v1 filtered per car only and let 15/70 unfair joints through; v2 found 0 fair
joints in tailgate layouts (full braking got the ego rear-ended); both fixed and re-run (`runs/smart-tacv{1,2}-*`).

## Honest limits

- Classical search still wins where the task is narrow: bisection beats 0G+tools on the boundary task (0.57 vs
  0.73 m), and seeded random sampling found more failure mechanisms on open-ended discovery (7 vs 4). The LLM's value
  is choosing *which* question to ask and writing an auditable plan, not out-searching an optimizer.
- The LLM disagrees with the best-by-forecast candidate most of the time (see deviation rate); the audit measures
  whether that helps rather than assuming it does. 0G answers are not deterministic at temperature 0 (W1).
- The identified model is a delayed IDM fitted to a few seconds of data; the escape check is longitudinal plus a
  coarse free-lane test (marked `shortcut:` in code). In CARLA the ego is PDM-Lite on LiDAR, which the fit only
  approximates. Kinematic results are prototype runs: not anchored, not published, signatures not checked.

## CARLA (PDM-Lite on LiDAR), one episode with tactics — `runs/smart-carla-004`

Plan "rolling roadblock" (thinking 0GM, req `45e6a077-9851-41d0-8ea8-7749ccb66bb4`), 5 executor decisions, 0 halts,
**5/5 TEE signatures verified** (`decisions.jsonl.sigs.json`); video `director.mp4` / `stitched.mp4`. GT CCS 0.71,
min in-path gap 3.72 m, and a **collision that is not a valid finding**: the tailgating car D rear-ended the
PDM-Lite ego after it stopped at 7.08 m/s² (above the adversary's 6.0 m/s² limit, W9). The tactics layer saw it
coming: the identified ego (delay 1.8 s, `fit`) had **0 fair joint actions at cp3 (0/336) and cp4 (0/72)**, so
nothing could be filtered and the audit logged the model's choices as unfair. Lesson: with a tailgater present the
filter must act one checkpoint earlier (it removed only BRAKE_HARD/BRAKE_PULSE at cp0–2); a fail-closed halt when
no fair option exists would be the next rule.
