"""Cut-in family: lateral profile, action physics, adversary rules, prompt, episode + safe halt on the kinematic
two-lane world (no CARLA)."""
import json

import pytest

from faultline import cutin
from faultline.cutin import ACTIONS, CutInAdversary, CutInScenario, KinematicCutInWorld, action_accel, quintic
from faultline.episode import run_episode
from faultline.log import verify_chain
from faultline.config import scenario_hash

from test_episode import FakeDecider, FixedClock, dec, lines

S = CutInScenario(seed=7)


def test_quintic_profile_is_smooth_and_bounded():
    assert quintic(0) == 0 and quintic(1) == 1 and quintic(0.5) == 0.5 and quintic(-1) == 0 and quintic(2) == 1
    eps = 1e-4
    assert abs(quintic(eps) / eps) < 1e-6 and abs((1 - quintic(1 - eps)) / eps) < 1e-6  # zero lateral speed at ends
    assert all(quintic(i / 100) <= quintic((i + 1) / 100) for i in range(100))


def test_action_physics_table():
    assert [action_accel(a, S) for a in ACTIONS] == [0.0, 1.5, -2.5, 0.0, 0.0, -6.0]
    assert action_accel("BRAKE_HARD", CutInScenario(seed=1, friction_mu=0.5)) == pytest.approx(-0.8 * 9.81 * 0.5)
    assert action_accel(None, S) == -3.0


def test_cut_in_completes_in_its_duration_and_is_offered_only_in_own_lane():
    for action, dur in (("CUT_IN", 2.0), ("CUT_IN_AGGRESSIVE", 1.0)):
        a = CutInAdversary(S, arc=20.0, v=9.0, lat=3.5)
        assert a.available() == ACTIONS
        assert a.command(action) == {"control_accel_mps2": 0.0, "lane_change_s": dur}
        assert "CUT_IN" not in a.available()
        n = round(dur / 0.05)
        lats = []
        for _ in range(n):
            a.step(0.05)
            lats.append(a.lat)
        assert a.lat == 0.0 and a.lc is None and a.progress == 1.0 and a.v == 9.0
        assert abs(lats[n // 2 - 1] - 1.75) < 0.3 and all(x >= y for x, y in zip(lats, lats[1:]))
        a.command("KEEP_LANE")  # the next checkpoint cannot undo or repeat a cut-in
        assert "CUT_IN_AGGRESSIVE" not in a.available()
        with pytest.raises(ValueError):
            a.command("CUT_IN")


def test_lane_change_keeps_going_under_a_longitudinal_action():
    a = CutInAdversary(S, arc=20.0, v=9.0, lat=3.5)
    a.command("CUT_IN")
    for _ in range(20):
        a.step(0.05)
    a.command("BRAKE_HARD")  # second checkpoint inside the 2 s lane change
    for _ in range(20):
        a.step(0.05)
    assert a.lat == 0.0 and abs(a.v - 3.0) < 1e-9 and abs(a.rel_yaw_deg) < 0.5


def test_safe_halt_goes_to_nearest_lane_centre_and_stops():
    for steps, end_lat in ((5, 3.5), (15, 0.0)):  # before / after the lane-change midpoint
        a = CutInAdversary(S, arc=20.0, v=9.0, lat=3.5)
        a.command("CUT_IN_AGGRESSIVE")
        for _ in range(steps):
            a.step(0.05)
        assert a.command(None)["control_accel_mps2"] == -3.0 and a.halted
        for _ in range(80):
            a.step(0.05)
        assert a.lat == end_lat and a.v == 0.0
    a = CutInAdversary(S, arc=20.0, v=9.0, lat=3.5)
    assert a.command(None) == {"control_accel_mps2": -3.0, "lane_change_s": None}  # already on a lane centre


def run(tmp, script, s=S):
    d = FakeDecider(script)
    m = run_episode(KinematicCutInWorld(s), d, s, tmp, clock=FixedClock())
    return m, d, lines(tmp / "decisions.jsonl"), json.loads((tmp / "metrics.json").read_text())


def test_cut_in_episode_logs_numeric_observation_and_ground_truth(tmp_run_dir):
    m, d, entries, met = run(tmp_run_dir, ["KEEP_LANE", "CUT_IN_AGGRESSIVE", "BRAKE_HARD"] + ["KEEP_LANE"] * 10)
    assert len(d.calls) == 10 and m["status"] == "completed" and m["family"] == "cut_in"
    assert m["prompt_hash"] == cutin.prompt_hash() and m["ego"] == "idm-exact"
    assert m["scenario_hash"] == scenario_hash(S) and verify_chain(tmp_run_dir / "decisions.jsonl", m["log_head"])
    obs0, obs2 = d.calls[0][0], d.calls[2][0]
    assert obs0["available_actions"] == list(ACTIONS) and "CUT_IN" not in obs2["available_actions"]
    assert obs0["lateral_offset_m"] == 3.5 and obs2["lateral_offset_m"] == 0.0 and obs2["lane_change_progress"] == 1.0
    assert all(isinstance(v, (int, float)) or v is None for k, v in obs0.items() if k not in ("schema", "available_actions"))
    assert entries[1]["lane_change_s"] == 1.0 and entries[2]["control_accel_mps2"] == -6.0
    traj = lines(tmp_run_dir / "trajectory.jsonl")
    assert traj[0]["lidar_gap"] is None and not traj[0]["gt_in_path"] and traj[0]["gt_ttc_s"] is None
    assert isinstance(traj[0]["gt_gap"], float) and traj[-1]["lidar_gap"] is not None
    gt = met["ground_truth"]
    assert 2.0 < gt["in_path_from_t_s"] < 4.0 and gt["first_lidar_in_lane_t_s"] >= gt["in_path_from_t_s"] - 0.5
    assert gt["min_ttc_s"] is not None and gt["ccs"] > 0.1 and gt["max_ego_decel_mps2"] > 1.0
    assert entries[2]["history"]["items"][1]["lateral_offset_m"] == 3.5


def test_cut_in_failure_is_a_safe_halt_with_no_further_calls(tmp_run_dir):
    m, d, entries, _ = run(tmp_run_dir, ["KEEP_LANE", dec(None, "unreachable")] + ["KEEP_LANE"] * 10)
    assert len(d.calls) == 2 and [e["source"] for e in entries] == ["0g", "none"]
    assert entries[-1]["control_accel_mps2"] == -3.0 and m["status"] == "interrupted" and m["decisions_halt"] == 1
    last = lines(tmp_run_dir / "trajectory.jsonl")[-1]
    assert last["lead_v"] < 0.3 or last["t_s"] >= 2.0 + 8.0 - 1e-6
    # a cut-in that is out of the offered set (adversary already in the ego lane) is a failure too
    m, d, entries, _ = run(tmp_run_dir, ["CUT_IN_AGGRESSIVE", "CUT_IN"] + ["KEEP_LANE"] * 10)
    assert len(d.calls) == 2 and entries[-1]["source"] == "none" and m["status"] == "interrupted"
