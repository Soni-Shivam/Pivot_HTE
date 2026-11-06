"""One lead-brake experiment for the failure hunter: six frozen parameters in, one deterministic outcome out.

Safety definition (used everywhere in the hunt): `safe` = no collision AND min bumper-to-bumper gap >= 2.0 m.
The ego is the stand-in IDM follower (faultline/controller.py) with the proposed reaction delay, tuned to follow at
the initial gap (idm_for); the lead holds the
common start speed, then brakes at `lead_decel_mps2` (clamped by the world to 0.8*g*mu) from `brake_onset_s` until
it stops. Metrics are the per-tick functions episode.py uses, on the ground-truth gap (exact in KinematicWorld).
"""
import math

from faultline.config import IdmParams, Scenario
from faultline.controller import G
from faultline.episode import RESPONSE_JERK_MPS3, STOPPED_V, _lidar_metrics
from faultline.metrics.ccs_v2 import score_episode
from faultline.world import KinematicWorld

SPACE = {"ego_speed_mps": (8.0, 30.0), "initial_gap_m": (5.0, 80.0), "lead_decel_mps2": (1.0, 9.0),
         "friction_mu": (0.3, 1.0), "reaction_delay_s": (0.2, 1.5), "brake_onset_s": (3.0, 10.0)}
SAFE_GAP_M = 2.0
SAFETY_DEFINITION = f"safe = no collision AND min bumper-to-bumper gap >= {SAFE_GAP_M} m"
HORIZON_S, STOPPED_HOLD_S = 30.0, 1.0
V0_FACTOR = 2.0  # IDM desired speed = 2x the start speed, so an equilibrium gap exists at the start speed


def idm_for(p: dict) -> IdmParams:
    """The ego follows at `initial_gap_m` like an ACC time-gap setting: the IDM headway is chosen so its equilibrium
    gap at the start speed equals the initial gap. Deviation from the brief (desired speed = ego speed): with that,
    the IDM re-chooses its own gap during the run-up and the initial gap stops mattering (see faultline-hunt.md)."""
    v, base = float(p["ego_speed_mps"]), IdmParams()
    k = math.sqrt(1 - (1 / V0_FACTOR) ** 4)  # s_eq = s*(v) / sqrt(1 - (v/v0)^4) with dv = 0
    return IdmParams(desired_speed_mps=V0_FACTOR * v, time_headway_s=max((float(p["initial_gap_m"]) * k - base.min_gap_m) / v, 0.0),
                     reaction_delay_s=float(p["reaction_delay_s"]))


def validate(p) -> str | None:
    """None if `p` is a runnable experiment, else the reason it is rejected (never run)."""
    if not isinstance(p, dict):
        return "not_an_object"
    if set(p) != set(SPACE):
        missing, extra = sorted(set(SPACE) - set(p)), sorted(set(p) - set(SPACE))
        return f"keys: missing {missing} extra {extra}"
    for k, (lo, hi) in SPACE.items():
        v = p[k]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            return f"{k}: not a number"
        if not lo <= v <= hi:
            return f"{k}={v} outside [{lo}, {hi}]"
    return None


def run_experiment(p: dict, world=None, seed: int = 0) -> dict:
    """Run a validated experiment. `world` defaults to KinematicWorld; CARLA confirmation passes a CarlaWorld."""
    assert validate(p) is None, validate(p)
    p = {k: float(p[k]) for k in SPACE}
    v = p["ego_speed_mps"]
    s = Scenario(seed=seed, version="hunt_lead_brake_v1", ego_speed_mps=v, lead_speed_mps=v,
                 initial_gap_m=p["initial_gap_m"], friction_mu=p["friction_mu"], lead_max_brake_mps2=p["lead_decel_mps2"],
                 horizon_s=HORIZON_S)
    if world is None:
        world = KinematicWorld(idm=idm_for(p))
    applied = min(p["lead_decel_mps2"], 0.8 * G * p["friction_mu"])
    dt = s.dt_s
    onset_n, horizon_n = round(p["brake_onset_s"] / dt), round(HORIZON_S / dt)
    world.reset(s)
    rows, n, stopped_n, prev_a, reaction, gap_at_onset, collision, lidar_min = [], 0, 0, None, None, None, False, None
    try:
        while n < horizon_n:
            if n == onset_n:
                world.set_lead_decel(p["lead_decel_mps2"])
                gap_at_onset = rows[-1]["lidar_gap"] if rows else p["initial_gap_m"]
            st = world.tick()
            n += 1
            # metrics on the ground-truth gap; CARLA's LiDAR gap is kept separately
            m = _lidar_metrics({"lidar_gap": st.gt_gap, "lidar_closing": st.ego_v - st.lead_v, "ego_v": st.ego_v})
            rows.append({"t": st.t_s, "lidar_gap": st.gt_gap, "ego_v": st.ego_v, "lead_v": st.lead_v,
                         "ego_a": st.ego_a, **m})
            if st.lidar_gap is not None:
                lidar_min = st.lidar_gap if lidar_min is None else min(lidar_min, st.lidar_gap)
            if n > onset_n and reaction is None and prev_a is not None and (st.ego_a - prev_a) / dt <= RESPONSE_JERK_MPS3:
                reaction = round(st.t_s - onset_n * dt, 6)
            prev_a = st.ego_a
            if st.collision:
                collision = True
                break
            stopped_n = stopped_n + 1 if st.ego_v < STOPPED_V and st.lead_v < STOPPED_V else 0
            if stopped_n * dt >= STOPPED_HOLD_S:
                break
    finally:
        world.close()
    ep = score_episode([r["drac_mps2"] for r in rows], [r["ttc_s"] for r in rows], [r["thw_s"] for r in rows])
    closing = [r["ttc_s"] for r in rows if r["ttc_s"] is not None and r["ttc_s"] < 60.0]
    min_gap = min(r["lidar_gap"] for r in rows)
    return {"collision": collision, "min_gap_m": round(min_gap, 4), "min_ttc_s": round(min(closing), 4) if closing else None,
            "max_drac_mps2": round(max(r["drac_mps2"] for r in rows), 4), "ccs": round(ep["ccs"], 4),
            "ego_max_decel_mps2": round(max(max(-r["ego_a"], 0.0) for r in rows), 4),
            "measured_reaction_s": reaction, "gap_at_onset_m": round(gap_at_onset, 4) if gap_at_onset is not None else None,
            "lead_decel_applied_mps2": round(applied, 4), "lead_decel_clamped": applied < p["lead_decel_mps2"],
            "end_t_s": rows[-1]["t"], "safe": (not collision) and min_gap >= SAFE_GAP_M,
            **({"lidar_min_gap_m": round(lidar_min, 4)} if lidar_min is not None and world.__class__ is not KinematicWorld else {})}
