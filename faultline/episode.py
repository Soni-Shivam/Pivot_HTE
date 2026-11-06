"""One episode: checkpoint loop, safe-halt state machine, hash-chained decision log and the on-disk bundle
(spec §5.4, §5.5). The decider (0G) only picks from ACTIONS; this code owns every physics step and the halt (I5)."""
import hashlib
import json
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from faultline import cutin
from faultline.config import Scenario, canonical, scenario_hash
from faultline.controller import G
from faultline.log import ChainLog
from faultline.metrics.ccs_v2 import score, score_episode
from faultline.metrics.kinematics import drac, thw, ttc_1d
from faultline.policy import ACTION_DECEL, ACTIONS, SAFE_HALT_DECEL, prompt_hash

HALT_MAX_S = 8.0
STOPPED_V = 0.3
STOPPED_HOLD_S = 2.0
RESPONSE_JERK_MPS3 = -0.4  # the follower "responds" at the first tick after the lead's onset with jerk below this


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _r(x, nd=6):
    return None if x is None else round(float(x), nd)


def _ttc(gap, closing):
    return float(ttc_1d(np.array(gap), np.array(closing))) if closing is not None and closing > 1e-3 else None


def _lidar_metrics(st: dict) -> dict:
    """Per-tick criticality from the (serialized) LiDAR fields only; nothing when the corridor was empty."""
    gap, closing = st["lidar_gap"], st["lidar_closing"]
    if gap is None:
        return {"ttc_s": None, "thw_s": None, "drac_mps2": None, "ccs": None, "applicable": False}
    t = float(ttc_1d(np.array(gap), np.array(closing))) if closing is not None else None
    h = float(thw(np.array(gap), np.array(st["ego_v"])))
    d = float(drac(np.array(gap), np.array(closing))) if closing is not None else None
    return {"ttc_s": t, "thw_s": h, "drac_mps2": d, "ccs": score(drac=d, ttc2d=t, thw=h).ccs, "applicable": True}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ground_truth_metrics(rows: list[dict], collision: bool) -> dict:
    """Cut-in outcome from ground truth (never shown to the ego): only ticks where the adversary's footprint overlaps
    the ego's lane path count for gap/TTC/CCS; plus when that first happened vs when the ego's LiDAR first saw it."""
    path = [r for r in rows if r["gt_in_path"]]
    ttc = [r["gt_ttc_s"] for r in path if r["gt_ttc_s"] is not None]
    gaps = [max(r["gt_gap"], 0.0) for r in path]
    closing = [r["ego_v"] - r["lead_v"] for r in path]
    ep = score_episode([float(drac(np.array(g), np.array(c))) for g, c in zip(gaps, closing)],
                       [float(ttc_1d(np.array(g), np.array(c))) if c > 1e-3 else None for g, c in zip(gaps, closing)],
                       [float(thw(np.array(g), np.array(r["ego_v"]))) for g, r in zip(gaps, path)])
    first = lambda pred: next((r["t_s"] for r in rows if pred(r)), None)
    return {"collision": collision, "ccs": ep["ccs"], "min_gap_in_path_m": min(gaps) if gaps else None,
            "min_ttc_s": min(ttc) if ttc else None, "in_path_from_t_s": first(lambda r: r["gt_in_path"]),
            "first_tracked_t_s": first(lambda r: r["n_tracks"] > 0),
            "first_lidar_in_lane_t_s": first(lambda r: r["lidar_gap"] is not None),
            # the first 0.25 s are the spawn transient (CARLA sets the ego's speed, its Chaos wheels spin up)
            "max_ego_decel_mps2": max([max(-r["ego_a"], 0.0) for r in rows if r["t_s"] > 0.25] or [0.0]),
            "max_ego_brake": max([r["ego_brake"] for r in rows] or [0.0])}


def run_episode(world, decider, scenario, out_dir: Path, clock=time, started_at: str | None = None,
                extra: dict | None = None) -> dict:
    """`started_at` lets --anchor fix the episode id before the loop; `extra` is merged into the manifest."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    s = scenario
    started_at = started_at or _iso(clock.time())
    s_hash = scenario_hash(s)
    (out_dir / "scenario.json").write_text(canonical(asdict(s)) + "\n")
    log = ChainLog(out_dir / "decisions.jsonl")
    traj_f = (out_dir / "trajectory.jsonl").open("w")

    dt = s.dt_s
    runup_n, cp_n, horizon_n = round(s.runup_s / dt), round(s.checkpoint_s / dt), round(s.horizon_s / dt)
    brake_hard = min(ACTION_DECEL["BRAKE_HARD"], 0.8 * G * s.friction_mu)
    cut = s.family == "cut_in"  # the cut-in family: its own actions, observation and adversary (faultline/cutin.py)

    world.reset(s)
    state = "READY"
    n, last, k = 0, None, 0
    items, decels = [], {"0g": 0, "none": 0, "scripted-baseline": 0, "replayed": 0}
    lead_decelerating, onset_t, reaction_delay, min_ttc, prev_a = False, None, None, None, None
    halt_n, stopped_n, collision = None, 0, False
    rows = []
    try:
        while True:
            if state in ("READY", "EXECUTING") and last is not None and n >= runup_n and (n - runup_n) % cp_n == 0 \
                    and n < horizon_n:
                state = "AWAITING_0G"
                gap, closing = last.gt_gap, last.ego_v - last.lead_v
                ttc_now = _ttc(gap, closing)
                avail = world.adv.available() if cut else ACTIONS
                obs = cutin.observation(world, last, s, k, avail) if cut else {"schema": "faultline.obs/v1", "checkpoint": k, "sim_time_s": _r(last.t_s, 3),
                       "lead_speed_mps": _r(last.lead_v, 3), "ego_speed_mps": _r(last.ego_v, 3), "gap_m": _r(gap, 3),
                       "closing_speed_mps": _r(closing, 3), "ttc_s": _r(ttc_now, 3),
                       "thw_s": _r(float(thw(np.array(gap), np.array(last.ego_v))), 3),
                       "ego_accel_mps2": _r(last.ego_a, 3), "road_friction": s.friction_mu,
                       "lead_max_brake_mps2": s.lead_max_brake_mps2, "available_actions": list(ACTIONS)}
                history = {"items": list(items), "ego_observed_reaction_delay_s": _r(reaction_delay, 3),
                           "ego_min_ttc_so_far_s": _r(min_ttc, 3)}
                d = decider.decide(obs, history, avail)
                ok = d.reason == "ok" and d.action in avail
                if ok:
                    source, state = getattr(decider, "source", "0g"), "EXECUTING"
                else:
                    source, state, halt_n = "none", "SAFE_HALT", n
                if cut:
                    ctl = world.command_adversary(d.action if ok else None)
                    hazard = d.action in cutin.HAZARD if ok else True
                else:
                    control = (brake_hard if d.action == "BRAKE_HARD" else ACTION_DECEL[d.action]) if ok \
                        else SAFE_HALT_DECEL
                    world.set_lead_decel(control or None)
                    ctl, hazard = {"control_decel_mps2": control}, bool(control)
                if hazard and not lead_decelerating:
                    onset_t = last.t_s
                lead_decelerating = hazard
                decels[source] += 1
                entry = {"cp": k, "sim_time_s": obs["sim_time_s"], "wall_clock_utc": _iso(clock.time()),
                         "observation": obs, "obs_sha256": hashlib.sha256(canonical(obs).encode()).hexdigest(),
                         "history": history, **ctl, "source": source, **asdict(d)}
                log.append(entry)
                world.last_decision = entry  # display hook (viewer / ROS bridge); never read back
                items.append({"cp": k, "your_action": d.action, "gap_m": obs["gap_m"],
                              "ego_speed_mps": obs["ego_speed_mps"], "ego_accel_mps2": obs["ego_accel_mps2"],
                              "ttc_s": obs["ttc_s"], **({"lateral_offset_m": obs["lateral_offset_m"]} if cut else {})})
                k += 1

            last = world.tick()
            n += 1
            st = {f: (_r(v) if isinstance(v, float) else v) for f, v in asdict(last).items()}
            st.update(_lidar_metrics(st))
            rows.append(st)
            traj_f.write(canonical(st) + "\n")

            t_now = last.gt_ttc_s if cut else _ttc(last.gt_gap, last.ego_v - last.lead_v)
            if t_now is not None:
                min_ttc = t_now if min_ttc is None else min(min_ttc, t_now)
            if onset_t is not None and prev_a is not None and (last.ego_a - prev_a) / dt <= RESPONSE_JERK_MPS3:
                reaction_delay, onset_t = round(last.t_s - onset_t, 6), None
            prev_a = last.ego_a
            stopped_n = stopped_n + 1 if last.ego_v < STOPPED_V and last.lead_v < STOPPED_V else 0
            if last.collision:
                collision = True
                break
            if state == "SAFE_HALT":
                if stopped_n > 0 or (n - halt_n) * dt >= HALT_MAX_S:
                    break
            elif n >= horizon_n or stopped_n * dt >= STOPPED_HOLD_S:
                break
    finally:
        traj_f.close()
        world.close()

    status = "interrupted" if state == "SAFE_HALT" else "completed"
    ok = [r for r in rows if r["applicable"]]
    ep = score_episode([r["drac_mps2"] for r in rows], [r["ttc_s"] for r in rows], [r["thw_s"] for r in rows])
    errs = [abs(r["lidar_gap"] - r["gt_gap"]) for r in ok]
    ttcs = [r["ttc_s"] for r in ok if r["ttc_s"] is not None]
    metrics = {**ep, "min_ttc_s": min(ttcs) if ttcs else None,
               "min_gap_m": min(r["lidar_gap"] for r in ok) if ok else None,
               # the first 0.25 s are the spawn transient (CARLA sets the ego's speed, its Chaos wheels spin up)
            "max_ego_decel_mps2": max([max(-r["ego_a"], 0.0) for r in rows if r["t_s"] > 0.25] or [0.0]), "collision": collision,
               "perception": {"mean_abs_gap_error_m": sum(errs) / len(errs) if errs else None,
                              "max_abs_gap_error_m": max(errs) if errs else None,
                              "scans_without_target": len(rows) - len(ok)}}
    if cut:
        metrics["ground_truth"] = ground_truth_metrics(rows, collision)
    (out_dir / "metrics.json").write_text(canonical(metrics) + "\n")

    files = {f: _sha(out_dir / f) for f in ("scenario.json", "decisions.jsonl", "trajectory.jsonl", "metrics.json")}
    manifest = {"schema": "faultline.episode/v1",
                "episode_id": hashlib.sha256(f"{s_hash}:{s.seed}:{started_at}".encode()).hexdigest(),
                "scenario_hash": s_hash, "family": s.family,
                "prompt_hash": cutin.prompt_hash() if cut else prompt_hash(), "ego": getattr(world, "ego_name", "idm"),
                "model": getattr(decider, "model", None),
                "trust_mode": "private", "status": status, "collision": collision,
                "decisions_total": sum(decels.values()), "decisions_0g": decels["0g"],
                "decisions_halt": decels["none"], "log_head": log.head, "files": files, "started_at": started_at,
                "finished_at": _iso(clock.time()), "world": getattr(world, "name", type(world).__name__), **(extra or {})}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    return manifest
