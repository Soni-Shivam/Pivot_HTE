"""Occlusion experiment plumbing: LiDAR degraders and the replayed-decision sweep (kinematic world, no CARLA)."""
import json

import numpy as np

from faultline.cutin import CutInScenario, KinematicCutInWorld
from faultline.episode import run_episode
from faultline.occlusion import ReplayedDecider, dropout, sector_blackout, sweep

from test_episode import FakeDecider, FixedClock


def test_degraders():
    pts = np.array([[10.0, 0.0, 0, 0], [10.0, -3.0, 0, 0], [10.0, 3.0, 0, 0], [-5.0, -1.0, 0, 0]], dtype=np.float32)
    kept = sector_blackout(3.0, 60.0)(pts)  # -y is left in the sensor frame
    assert kept.tolist() == pts[[0, 2, 3]].tolist()
    big = np.zeros((10000, 4), dtype=np.float32)
    a, b = dropout(0.75, np.random.default_rng(3))(big), dropout(0.75, np.random.default_rng(3))(big)
    assert 2300 < len(a) < 2700 and len(a) == len(b)


def test_sweep_replays_logged_decisions_and_never_invents_one(tmp_path):
    s = CutInScenario(seed=7)
    src = tmp_path / "src"
    # a short log: 5 decisions for a 10-checkpoint episode -> the replay halts at checkpoint 5
    d = FakeDecider(["KEEP_LANE", "CUT_IN_AGGRESSIVE", "BRAKE_HARD", "KEEP_LANE", "KEEP_LANE",
                     *(["KEEP_LANE"] * 5)])
    run_episode(KinematicCutInWorld(s), d, s, src, clock=FixedClock())
    lines = (src / "decisions.jsonl").read_text().splitlines()[:5]
    (tmp_path / "short").mkdir()
    (tmp_path / "short" / "decisions.jsonl").write_text("\n".join(lines) + "\n")
    rd = ReplayedDecider(tmp_path / "short" / "decisions.jsonl")
    assert [rd.decide(None, None, None).action for _ in range(6)][-1] is None and rd.source == "replayed"
    summary = sweep(src, tmp_path / "occ", 11, ["dropout-0.00", "sector-left-3-60"],
                    lambda deg, o: KinematicCutInWorld())
    assert summary["dropout_seed"] == 11 and summary["decisions"].startswith("replayed decisions")
    assert [r["condition"] for r in summary["runs"]] == ["dropout-0.00", "sector-left-3-60"]
    r = summary["runs"][0]
    assert r["collision"] is False and r["min_gt_ttc_s"] is not None and r["in_path_from_t_s"] > 2
    entries = [json.loads(l) for l in (tmp_path / "occ" / "dropout-0.00" / "decisions.jsonl").read_text().splitlines()]
    assert {e["source"] for e in entries} == {"replayed"} and entries[1]["action"] == "CUT_IN_AGGRESSIVE"
    assert json.loads((tmp_path / "occ" / "summary.json").read_text()) == summary
