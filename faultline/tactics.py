"""Deterministic tactics under the LLM: the model chooses strategy, this module does identification, physics,
validity and audit (docs/submission/INTELLIGENCE.md).

1. identify(): online system identification of the ego under test from what an adversary can observe (ego speed,
   accel, gap to the car in its path, that car's speed/accel): reaction delay, peak deceleration, preferred headway,
   each with bounds, falling back to nominal priors when there are too few samples.
2. evaluate(): every joint action of the cars that can affect the ego is rolled out twice from the current state:
   (a) the identified ego behaving as observed (criticality: min TTC / gap / collision), and (b) the identified ego
   at its best response (holds its current accel for its reaction delay, then brakes at
   max(observed peak, the adversary's own hard-brake limit); a free left lane also counts as an escape).
   A joint action the best response cannot survive is unfair and its actions are removed from the menu.
3. rank(): fair candidates by criticality, then novelty vs joint actions already used this episode.
4. audit(): the model's choice vs the best-by-forecast candidate, and per-episode regret / deviation summary.
"""
import copy
import itertools
import statistics
from dataclasses import replace

from faultline import cutin
from faultline.config import IdmParams
from faultline.controller import G, IdmFollower
from faultline.cutin import ADV_LEN_M, EGO_LEN_M

PRIOR = IdmParams(desired_speed_mps=8.0)
STIM_DECEL_MPS2 = 1.0  # lead decel / ego decel step that counts as a stimulus / response (W7: not jerk noise)
MAX_DELAY_S = 2.5
MIN_EVENTS, MIN_FOLLOW = 1, 5
ESCAPE_H_S = 4.0
BRAKE_LEVELS = (1.0, 0.75, 0.5, 0.25, 0.0)  # fractions of the escape brake tried in turn


def _g(r, k):
    return r[k] if isinstance(r, dict) else getattr(r, k)


def identify(rows, dt: float = 0.05, prior: IdmParams = PRIOR) -> dict:
    """rows: tick states (dicts or SwarmTickState) with t_s, ego_v, ego_a, gt_gap, gt_in_path, lead_v, lead_a."""
    rows = [r for r in rows if _g(r, "t_s") > 0.25]  # W10 spawn transient
    # reaction delay: a stimulus is the in-path lead starting to brake, or a car entering the ego's path ahead;
    # the response is the ego's accel dropping STIM_DECEL_MPS2 below its value at the stimulus
    delays = []
    for i in range(1, len(rows)):
        p, r = rows[i - 1], rows[i]
        if not (_g(r, "gt_in_path") and 0 < _g(r, "gt_gap") < 40 and _g(r, "ego_v") > 1.0):
            continue
        brake = _g(r, "lead_a") <= -STIM_DECEL_MPS2 < _g(p, "lead_a")
        entered = not _g(p, "gt_in_path") and _g(r, "ego_v") > _g(r, "lead_v")
        if not (brake or entered):
            continue
        a0 = _g(r, "ego_a")
        for q in rows[i + 1:]:
            if _g(q, "t_s") - _g(r, "t_s") > MAX_DELAY_S:
                break
            if _g(q, "ego_a") <= a0 - STIM_DECEL_MPS2:
                delays.append(_g(q, "t_s") - _g(r, "t_s"))
                break
    peak = max([-_g(r, "ego_a") for r in rows if _g(r, "ego_v") > 0.05] + [0.0])  # W6: no ghost decel at v = 0
    # preferred headway: steady following, s0 fixed at the prior (speeds barely vary, so a 2-parameter fit is
    # ill-conditioned); robust = median, bounds = interquartile range
    hw = [(_g(r, "gt_gap") - prior.min_gap_m) / _g(r, "ego_v") for r in rows
          if _g(r, "gt_in_path") and 0 < _g(r, "gt_gap") < 50 and _g(r, "ego_v") > 2.0
          and abs(_g(r, "ego_a")) < 0.3 and abs(_g(r, "ego_v") - _g(r, "lead_v")) < 0.5]
    out = {"n_reaction_events": len(delays), "n_follow_samples": len(hw),
           "desired_speed_mps": round(max([_g(r, "ego_v") for r in rows] + [prior.desired_speed_mps]), 2),
           "peak_decel_observed_mps2": round(peak, 2)}
    if len(delays) >= MIN_EVENTS:
        d = statistics.median(delays)
        out.update(reaction_delay_s=round(d, 2), reaction_delay_bounds_s=[round(min(delays) - dt, 2),
                                                                          round(max(delays) + dt, 2)])
    else:
        out.update(reaction_delay_s=prior.reaction_delay_s, reaction_delay_bounds_s=[0.3, 1.5])
    if len(hw) >= MIN_FOLLOW:
        q = statistics.quantiles(hw, n=4)
        out.update(headway_s=round(statistics.median(hw), 2), headway_bounds_s=[round(q[0], 2), round(q[2], 2)])
    else:
        out.update(headway_s=prior.time_headway_s, headway_bounds_s=[0.8, 2.0])
    out["source"] = "fit" if len(delays) >= MIN_EVENTS and len(hw) >= MIN_FOLLOW else \
        "prior" if not delays and len(hw) < MIN_FOLLOW else "partial"
    return out


class _BestResponse:
    """Duck-types IdmFollower for KinematicSwarmWorld.tick: hold a0 for `delay`, then brake at `brake`."""

    def __init__(self, a0: float, delay: float, brake: float, dt: float):
        self.a0, self.n, self.brake, self.k = a0, round(delay / dt), brake, 0

    def observe(self, gap, v_lead):
        self.k += 1
        return gap, v_lead

    def accel(self, v, gap, v_lead):
        return self.a0 if self.k <= self.n else -self.brake


def _ego_behaviour(model: dict, dt: float, mu: float) -> IdmFollower:
    return IdmFollower(replace(PRIOR, desired_speed_mps=model["desired_speed_mps"], time_headway_s=model["headway_s"],
                               reaction_delay_s=model["reaction_delay_s"]), dt, mu)


def escape_brake(model: dict, s) -> float:
    """The ego is assumed able to brake at least as hard as the adversary may (symmetric fairness)."""
    return max(model["peak_decel_observed_mps2"], -cutin.action_accel("BRAKE_HARD", s))


def _rollout(world, last, s, cars, combo, ego, horizon_s):
    from faultline.swarm import KinematicSwarmWorld
    fs = replace(s, dt_s=0.1)
    w = KinematicSwarmWorld()
    w.s, w.t_s, w.ego_x, w.ego_v, w.collided = fs, 0.0, last.ego_x, last.ego_v, False
    w.advs = {c: copy.deepcopy(a) for c, a in world.advs.items()}
    w.idm = ego
    for c, act in zip(cars, combo):
        w.advs[c].command(act)
    gaps, ttcs, coll, contact, v0 = [], [], False, False, last.ego_v
    for _ in range(round(horizon_s / fs.dt_s)):
        st = w.tick()
        if st.gt_in_path and st.gt_gap > -EGO_LEN_M:
            gaps.append(st.gt_gap)
            if st.gt_ttc_s is not None:
                ttcs.append(st.gt_ttc_s)
        coll, contact = coll or st.collision, contact or st.adv_contact
        if coll or contact:
            break
    return {"min_gap": min(gaps) if gaps else None, "min_ttc": min(ttcs) if ttcs else None, "collision": coll,
            "contact": contact, "decel": max(0.0, (v0 - w.ego_v) / horizon_s), "advs": w.advs, "ego_x": w.ego_x}


def _left_lane_free(advs, ego_x, ego_v, lw, horizon_s=ESCAPE_H_S) -> bool:
    """shortcut: a lateral escape counts if no car is in or entering the left lane within the ego's reach over the
    escape horizon at the start of the rollout; upgrade to a lateral ego rollout if lateral escapes matter."""
    lo, hi = ego_x - EGO_LEN_M - ADV_LEN_M - 6.0, ego_x + ego_v * horizon_s + ADV_LEN_M
    return not any((abs(a.lat) >= lw / 2 or (a.lc and abs(a.lc[3]) >= lw / 2)) and lo < a.arc < hi
                   for a in advs.values())


def evaluate(world, last, s, available: dict, model: dict, used=(), horizon_s: float = 2.0,
             max_combos: int = 600) -> tuple[list, dict]:
    """Returns (ranked candidates, allowed {car: actions}). Only actions proven unfair are removed."""
    behind = {c for c, a in world.advs.items() if a.arc < last.ego_x - (EGO_LEN_M + ADV_LEN_M) / 2}
    cars = [c for c in world.advs if c not in behind]
    opts = [tuple(available[c]) for c in cars]
    if len(list(itertools.product(*opts))) > max_combos:  # same cap as swarm.forecast: classic actions only
        opts = [tuple(x for x in o if x in cutin.ACTIONS) for o in opts]
    dt, brake = 0.1, escape_brake(model, s)
    lane_free = _left_lane_free(world.advs, last.ego_x, last.ego_v, s.lane_width_m)
    cands = []
    for combo in itertools.product(*opts):
        b = _rollout(world, last, s, cars, combo, _ego_behaviour(model, dt, s.friction_mu), horizon_s)
        # best response = any brake level after the delay (full braking alone can get the ego rear-ended by a
        # car behind it that may brake less hard: smart-tac-05/07 v2 had 0 fair joints that way)
        for f in BRAKE_LEVELS:
            e = _rollout(world, last, s, cars, combo, _BestResponse(min(last.ego_a, 0.0), model["reaction_delay_s"],
                                                                     f * brake, dt), ESCAPE_H_S)
            if not e["collision"]:
                break
        escapable = not e["collision"] or lane_free
        cands.append({"actions": dict(zip(cars, combo)), "min_ttc_s": _r(b["min_ttc"]),
                      "min_gap_in_path_m": _r(b["min_gap"]), "collision": b["collision"],
                      "adversaries_touch": b["contact"] or e["contact"], "escapable": escapable,
                      "escape": "brake" if not e["collision"] else "left_lane" if lane_free else None,
                      "fair": escapable and not (b["contact"] or e["contact"]),
                      "novel": _label(dict(zip(cars, combo))) not in used})
    for c_ in cands:
        c_["criticality"] = criticality(c_)
    cands.sort(key=lambda c_: (not c_["fair"], -(c_["criticality"] + 0.25 * c_["novel"])))
    # per-car menus cannot express joint constraints (run smart-tac-0x v1: 15/70 chosen joints were unfair although
    # each action was fair in some joint). Shrink the evaluated sets to a product of fair joints only: drop the action
    # in the most unfair joints, never one of the best fair candidate's actions (so the product never empties).
    fair = {tuple(x["actions"][c] for c in cars) for x in cands if x["fair"]}
    sets = [list(o) for o in opts]
    if fair:
        keep = next(tuple(x["actions"][c] for c in cars) for x in cands if x["fair"])
        while True:
            bad = [j for j in itertools.product(*sets) if j not in fair]
            if not bad:
                break
            i, act = max(((i, a) for i, ss in enumerate(sets) for a in ss if a != keep[i]),
                         key=lambda ia: sum(j[ia[0]] == ia[1] for j in bad))
            sets[i].remove(act)
    allowed = {c: tuple(available[c]) for c in available}
    for i, c in enumerate(cars):  # if nothing is fair, nothing is filtered (the ego cannot escape anything)
        allowed[c] = tuple(a for a in available[c] if a not in opts[i] or a in sets[i]) if fair else allowed[c]
    return cands, allowed


def _r(x, n=2):
    return None if x is None else round(float(x), n)


def _label(acts: dict) -> str:
    return " ".join(f"{c}:{a}" for c, a in sorted(acts.items()))


def criticality(c: dict) -> float:
    """Higher = more demanding: a fair collision under the identified behaviour (a found failure) dominates, then
    inverse min TTC (capped at 5 /s), then a small term for a short in-path gap."""
    ttc = c["min_ttc_s"]
    gap = c["min_gap_in_path_m"]
    return round(10.0 * c["collision"] + (min(5.0, 1.0 / max(ttc, 0.2)) if ttc is not None else 0.0)
                 + (1.0 / max(gap, 1.0) if gap is not None else 0.0), 3)


def menu_rows(cands: list, k: int = 24) -> list:
    """What the model sees: the top-k fair candidates with numbers, in the shape of swarm.forecast rows."""
    return [{**x["actions"], "min_gap_in_path_m": x["min_gap_in_path_m"], "min_ttc_s": x["min_ttc_s"],
             "collision": x["collision"], "adversaries_touch": x["adversaries_touch"], "escape": x["escape"],
             "novel": x["novel"], "criticality": x["criticality"]} for x in cands if x["fair"]][:k]


def audit(cp: int, t: float, chosen: dict | None, cands: list) -> dict:
    """Per checkpoint: the model's joint choice vs the best-by-forecast fair candidate."""
    best = next((x for x in cands if x["fair"]), None)
    keys = list(cands[0]["actions"]) if cands else []
    row = next((x for x in cands if chosen and all(chosen.get(c) == x["actions"][c] for c in keys)), None)
    return {"cp": cp, "sim_time_s": t, "chosen": chosen, "best": best and best["actions"],
            "best_criticality": best and best["criticality"], "best_min_ttc_s": best and best["min_ttc_s"], "chosen_criticality": row and row["criticality"],
            "chosen_rank": cands.index(row) if row else None, "chosen_fair": row["fair"] if row else None,
            "deviated": bool(chosen) and bool(best) and row is not best,
            "regret": _r(best["criticality"] - row["criticality"], 3) if best and row else None,
            "n_candidates": len(cands), "n_fair": sum(x["fair"] for x in cands)}


def realized_min_ttc(traj: list, t0: float, t1: float):
    v = [r["gt_ttc_s"] for r in traj if t0 <= r["t_s"] < t1 and r.get("gt_ttc_s") is not None]
    return min(v) if v else None


def summarize(audits: list, traj: list, cp_s: float = 1.0) -> dict:
    """Per episode: how often the LLM deviated from the best-by-forecast candidate and whether it paid off
    (realized in-path min TTC over the next checkpoint window vs the best candidate's forecast min TTC)."""
    dec = [a for a in audits if a["chosen"]]
    dev = [a for a in dec if a["deviated"]]
    paid = 0
    for a in dev:
        real = realized_min_ttc(traj, a["sim_time_s"], a["sim_time_s"] + cp_s)
        best_ttc = a.get("best_min_ttc_s")
        paid += real is not None and (best_ttc is None or real < best_ttc)
    reg = [a["regret"] for a in dec if a["regret"] is not None]
    return {"decisions": len(dec), "deviations": len(dev), "deviation_rate": _r(len(dev) / len(dec), 3) if dec else None,
            "deviations_paid_off": paid, "mean_regret": _r(statistics.mean(reg), 3) if reg else None,
            "chosen_fair_rate": _r(sum(bool(a["chosen_fair"]) for a in dec) / len(dec), 3) if dec else None,
            "top1_rate": _r(sum(a["chosen_rank"] == 0 for a in dec) / len(dec), 3) if dec else None}

