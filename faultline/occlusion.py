"""LiDAR-occlusion robustness experiment on a recorded cut-in episode.

The adversary replays the episode's logged decisions (no 0G call; its motion depends only on its own actions, so it
is identical in every condition) while the ego's LiDAR is degraded before it reaches the tracker and PDM-Lite:
random point dropout, or a blackout sector on the side the cut-in comes from. Outcomes are ground truth.
"""
import json
from pathlib import Path

import numpy as np

from faultline.config import canonical, load_scenario
from faultline.episode import run_episode
from faultline.log import verify_chain
from faultline.replay import RecordedDecider
from faultline.router import Decision

DROPOUT = (0.0, 0.25, 0.5, 0.75, 0.9)
# Frozen before any occlusion run, from geometry: at the 12-20 m gaps of cut_in_v1 the adjacent-lane car spans ~7-20
# deg left of the sensor axis, and its near edge drops below 3 deg only once it is inside the ego lane corridor.
SECTOR_LEFT_DEG = (3.0, 60.0)


def dropout(p: float, rng: np.random.Generator):
    return lambda pts: pts[rng.random(len(pts)) >= p]


def sector_blackout(lo: float, hi: float):
    def f(pts):
        az = np.degrees(np.arctan2(-pts[:, 1], pts[:, 0]))  # sensor frame x fwd, y right: left of the axis = +az
        return pts[~((az >= lo) & (az <= hi))]
    return f


class ReplayedDecider(RecordedDecider):
    """Logged decisions in order, labelled source "replayed". If the degraded run outlives the log, the adversary
    gets SAFE_HALT (reason replay_exhausted): never a made-up decision."""

    source = "replayed"

    def __init__(self, path):
        super().__init__(path)
        self.source = "replayed"

    def decide(self, obs, history, available) -> Decision:
        if self.n >= len(self.entries):
            self.n += 1
            return Decision(action=None, reason="replay_exhausted", request_id=None, provider=None, zg_res_key=None,
                            model=self.model, latency_ms=0, http_status=None, raw_sha256=None, content=None,
                            ratelimit_remaining=None)
        return super().decide(obs, history, available)


def conditions(seed: int) -> list[tuple[str, dict, object]]:
    out = [(f"dropout-{p:.2f}", {"kind": "dropout", "p": p, "seed": seed + i},
            dropout(p, np.random.default_rng(seed + i)) if p > 0 else None) for i, p in enumerate(DROPOUT)]
    lo, hi = SECTOR_LEFT_DEG
    out.append((f"sector-left-{lo:g}-{hi:g}", {"kind": "sector", "side": "left", "deg": [lo, hi]},
                sector_blackout(lo, hi)))
    return out


def row(name: str, spec: dict, run: Path) -> dict:
    m = json.loads((run / "metrics.json").read_text())
    man = json.loads((run / "manifest.json").read_text())
    gt, per = m["ground_truth"], m["perception"]
    lag = lambda t: None if t is None or gt["in_path_from_t_s"] is None else round(t - gt["in_path_from_t_s"], 3)
    return {"condition": name, **spec, "status": man["status"], "collision": gt["collision"],
            "min_gt_gap_in_path_m": gt["min_gap_in_path_m"], "min_gt_ttc_s": gt["min_ttc_s"], "gt_ccs": gt["ccs"],
            "in_path_from_t_s": gt["in_path_from_t_s"], "first_tracked_t_s": gt["first_tracked_t_s"],
            "first_lidar_in_lane_t_s": gt["first_lidar_in_lane_t_s"],
            "lidar_in_lane_lag_s": lag(gt["first_lidar_in_lane_t_s"]),
            "mean_abs_gap_error_m": per["mean_abs_gap_error_m"], "max_abs_gap_error_m": per["max_abs_gap_error_m"],
            "pdm_max_decel_mps2": gt["max_ego_decel_mps2"], "pdm_max_brake": gt["max_ego_brake"]}


def sweep(run_dir: Path, out: Path, seed: int, only, make_world) -> dict:
    manifest = json.loads((run_dir / "manifest.json").read_text())
    if not verify_chain(run_dir / "decisions.jsonl", manifest["log_head"]):
        raise ValueError("log chain broken")
    scenario = load_scenario(json.loads((run_dir / "scenario.json").read_text()))
    if scenario.family != "cut_in":
        raise ValueError("occlusion needs a cut_in episode")
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, spec, deg in conditions(seed):
        if only and name not in only:
            continue
        d = out / name
        if (d / "metrics.json").exists():
            raise SystemExit(f"refusing to overwrite {d}")
        d.mkdir(parents=True, exist_ok=True)
        run_episode(make_world(deg, d), ReplayedDecider(run_dir / "decisions.jsonl"), scenario, d,
                    extra={"replay_of": manifest["episode_id"], "occlusion": spec})
        rows.append(row(name, spec, d))
        print(json.dumps(rows[-1], sort_keys=True))
    summary = {"schema": "faultline.occlusion/v1", "source_episode": manifest["episode_id"],
               "source_run": str(run_dir), "decisions": "replayed decisions (logged 0G actions, no new 0G calls)",
               "dropout_seed": seed, "sector_left_deg": list(SECTOR_LEFT_DEG), "runs": rows}
    (out / "summary.json").write_text(json.dumps(summary, sort_keys=True, indent=2) + "\n")
    return summary
