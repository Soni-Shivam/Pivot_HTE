"""Extended episode metrics, deterministic from a run's trajectory rows, decision log and scenario (all families:
lead_brake, cut_in, swarm). Ground truth only; nothing here is shown to the ego or the model.

Definitions (ours, fixed here):
- tet_s / tit_s2: time / integrated (1.5 s - TTC) with ground-truth in-path TTC below 1.5 s (kinematics.tet/tit).
- min_thw_s: min gap / ego speed over in-path ticks with the car ahead and ego > 0.5 m/s.
- ego_max_jerk_mps3: max |d/dt| of the ego's 0.25 s moving-average acceleration (raw CARLA accel is noisy);
  comfort_index: share of ticks with |accel| <= 2 m/s² and |jerk| <= 2 m/s³ (common ride-comfort limits).
- brake_reaction_s: threat onset (first in-path TTC < 3 s) -> first ego brake > 0.2 or decel > 1 m/s².
- pet_s: post-encroachment time of cut-ins: a car enters the ego's path ahead at t1 with its rear at arc P; the ego's
  front reaches P at t2; PET = t2 - t1 (min over entries; None if no entry or the ego never reached P).
- escape_space_m: free length of the adjacent (left) lane around the ego at the critical moment (min TTC, else
  min gap), 50 m cap each side, 0 if a car is beside the ego; None for one-lane families.
- ego_efficiency: mean ego speed / scenario target speed.
- adversary_activity: per car, lane changes (crossings of the lane border) and brake events (onsets of > 2 m/s²
  deceleration) from the trajectory.
"""
import base64
import json

import numpy as np

from faultline.metrics.kinematics import tet, tit

THREAT_TTC_S = 3.0
EGO_LEN_M, ADV_LEN_M = 4.9, 4.7  # same as faultline.cutin (not imported: keeps this module dependency-free)
CAP_M = 50.0


def _r(x, nd=3):
    return None if x is None else round(float(x), nd)


def _tick(r):
    """(gap, ttc, in_path) from ground truth; lead_brake rows have no lateral fields (always in path)."""
    if "gt_in_path" in r:
        return r["gt_gap"], r["gt_ttc_s"], bool(r["gt_in_path"])
    gap, closing = r["gt_gap"], r["ego_v"] - r["lead_v"]
    return gap, (gap / closing if gap > 0 and closing > 1e-3 else None), True


def _cars(r, lw):
    """{car: (arc, lat, v, in_path)} for the adversaries of one row."""
    if "cars" in r:
        return {c: (v["arc"], v["lat"], v["v"], v["in_path"]) for c, v in r["cars"].items()}
    if "adv_lat_m" in r:
        return {"adv": (r["lead_x"], r["adv_lat_m"], r["lead_v"], r["gt_in_path"])}
    return {"lead": (r["lead_x"], 0.0, r["lead_v"], True)}


def usage_of_entry(e: dict):
    """(usage, cost_usd) of a logged 0G call: its own fields, else decoded from the logged raw body (older runs)."""
    from faultline.router import cost_usd, usage_of
    if e.get("usage") is not None or e.get("cost_usd") is not None:
        b = e.get("billing") if isinstance(e.get("billing"), dict) else None
        return e.get("usage"), e["cost_usd"] if e.get("cost_usd") is not None else cost_usd(e.get("usage"), b)
    if e.get("raw_b64"):
        try:
            return usage_of(json.loads(base64.b64decode(e["raw_b64"])))
        except (ValueError, TypeError):
            pass
    return None, None


def call_stats(decisions: list, plan: dict | None = None) -> dict:
    calls = [e for e in decisions if e.get("reason") != "plan_failed" and (e.get("request_id") or e.get("latency_ms"))]
    replied = [e for e in decisions if e.get("content") is not None]
    lat = [e["latency_ms"] for e in calls if e.get("latency_ms")]
    every = calls + ([plan] if plan and (plan.get("request_id") or plan.get("latency_ms")) else [])
    us = [usage_of_entry(e) for e in every]
    with_u = [u for u, _ in us if u]
    return {"decisions": len(decisions), "calls": len(every),
            "parse_rate": _r(sum(e.get("source") == "0g" for e in replied) / len(replied)) if replied else None,
            "latency_mean_ms": _r(np.mean(lat), 1) if lat else None,
            "latency_p95_ms": _r(np.percentile(lat, 95), 1) if lat else None,
            "plan_latency_ms": plan.get("latency_ms") if plan else None,
            "calls_with_usage": len(with_u),
            "prompt_tokens": sum(u.get("prompt_tokens") or 0 for u in with_u) if with_u else None,
            "completion_tokens": sum(u.get("completion_tokens") or 0 for u in with_u) if with_u else None,
            "cost_usd": _r(sum(c for _, c in us if c), 8) if any(c for _, c in us) else None}


def extended_metrics(rows: list, decisions: list, scenario: dict, plan: dict | None = None) -> dict:
    dt, lw = scenario.get("dt_s", 0.05), scenario.get("lane_width_m")
    target = scenario.get("ego_speed_mps") or 1.0
    ticks = [_tick(r) for r in rows]
    ttc = np.array([t if (p and t is not None and g > 0) else 60.0 for g, t, p in ticks])
    out = {"tet_s": _r(tet(ttc, 1.5, dt)), "tit_s2": _r(tit(ttc, 1.5, dt))}
    thw = [g / r["ego_v"] for (g, _, p), r in zip(ticks, rows) if p and g > 0 and r["ego_v"] > 0.5]
    out["min_thw_s"] = _r(min(thw)) if thw else None

    live = [r for r in rows if r["t_s"] > 0.25]  # spawn transient (CARLA), as in ground_truth_metrics
    a = np.array([r["ego_a"] for r in live])
    if len(a) > 6:
        sm = np.convolve(a, np.ones(5) / 5, mode="same")
        jerk = np.abs(np.diff(sm)) / dt
        out["ego_max_jerk_mps3"] = _r(jerk[2:-2].max() if len(jerk) > 4 else jerk.max())
        out["comfort_index"] = _r(np.mean((np.abs(sm[1:]) <= 2.0) & (jerk <= 2.0)))
    else:
        out["ego_max_jerk_mps3"] = out["comfort_index"] = None

    onset = next((i for i, (g, t, p) in enumerate(ticks) if p and t is not None and g > 0 and t < THREAT_TTC_S), None)
    out["threat_onset_t_s"] = _r(rows[onset]["t_s"]) if onset is not None else None
    react = None
    if onset is not None:
        react = next((r["t_s"] for r in rows[onset:] if (r.get("ego_brake") or 0) > 0.2 or -r["ego_a"] > 1.0), None)
    out["brake_reaction_s"] = _r(react - rows[onset]["t_s"]) if react is not None else None

    pets, entries = [], 0
    if rows and ("cars" in rows[0] or "adv_lat_m" in rows[0]):
        prev = _cars(rows[0], lw)
        for i, r in enumerate(rows[1:], start=1):
            now = _cars(r, lw)
            for c, (arc, _, _, inp) in now.items():
                if inp and c in prev and not prev[c][3] and arc > r["ego_x"]:
                    entries += 1
                    p = arc - ADV_LEN_M / 2
                    t2 = next((q["t_s"] for q in rows[i:] if q["ego_x"] + EGO_LEN_M / 2 >= p), None)
                    if t2 is not None:
                        pets.append(t2 - r["t_s"])
            prev = now
    out["pet_s"], out["encroachments"] = (_r(min(pets)) if pets else None), entries

    crit = [i for i, (g, t, p) in enumerate(ticks) if p and t is not None and g > 0]
    if crit:
        ci = min(crit, key=lambda i: ticks[i][1])
    else:
        inp = [i for i, (g, t, p) in enumerate(ticks) if p and g > 0]
        ci = min(inp, key=lambda i: ticks[i][0]) if inp else None
    out["critical_t_s"] = _r(rows[ci]["t_s"]) if ci is not None else None
    out["escape_space_m"] = None
    if ci is not None and lw and ("cars" in rows[ci] or "adv_lat_m" in rows[ci]):
        r = rows[ci]
        front, rear = r["ego_x"] + EGO_LEN_M / 2, r["ego_x"] - EGO_LEN_M / 2
        ahead, behind, blocked = CAP_M, CAP_M, False
        for arc, lat, _, _ in _cars(r, lw).values():
            if lat < lw / 2:
                continue
            cr, cf = arc - ADV_LEN_M / 2, arc + ADV_LEN_M / 2
            if cr >= front:
                ahead = min(ahead, cr - front)
            elif cf <= rear:
                behind = min(behind, rear - cf)
            else:
                blocked = True
        out["escape_space_m"] = 0.0 if blocked else _r(ahead + EGO_LEN_M + behind)

    out["ego_efficiency"] = _r(np.mean([r["ego_v"] for r in rows]) / target) if rows else None

    act = {}
    for i in range(1, len(rows)):
        p, q = _cars(rows[i - 1], lw), _cars(rows[i], lw)
        for c in q:
            if c not in p:
                continue
            s = act.setdefault(c, {"lane_changes": 0, "brake_events": 0, "_braking": False})
            if lw and (abs(p[c][1]) < lw / 2) != (abs(q[c][1]) < lw / 2):
                s["lane_changes"] += 1
            braking = (p[c][2] - q[c][2]) / dt > 2.0
            s["brake_events"] += braking and not s["_braking"]
            s["_braking"] = braking
    out["adversary_activity"] = {c: {k: v for k, v in s.items() if not k.startswith("_")} for c, s in act.items()}
    out["guard_ticks"] = sum(1 for r in rows if r.get("guarded"))
    return {**out, **call_stats(decisions, plan)}
