import json
from dataclasses import replace

from faultline.config import DEMO, Scenario
from faultline.episode import run_episode
from faultline.log import verify_chain
from faultline.router import Decision
from faultline.world import KinematicWorld


def dec(action, reason="ok", i=0):
    return Decision(action=action, reason=reason, request_id=None if reason in ("timeout", "unreachable", "no_request_id") else f"req-{i}",
                    provider="0xabc", zg_res_key=f"k{i}", model="0gm-1.0-35b-a3b", latency_ms=5, http_status=200,
                    raw_sha256="0" * 64, content=None, ratelimit_remaining=None)


class FakeDecider:
    model = "0gm-1.0-35b-a3b"

    def __init__(self, script):
        self.script, self.calls = list(script), []

    def decide(self, obs, history, available):
        self.calls.append((obs, history))
        i = len(self.calls) - 1
        return self.script[i] if isinstance(self.script[i], Decision) else dec(self.script[i], i=i)


class FixedClock:
    t = 1_800_000_000.0

    def time(self):
        self.t += 0.001
        return self.t


def lines(path):
    return [json.loads(l) for l in path.read_text().splitlines()]


def run(tmp, script, s=DEMO, world=None):
    d = FakeDecider(script)
    m = run_episode(world or KinematicWorld(s), d, s, tmp, clock=FixedClock())
    return m, d, lines(tmp / "decisions.jsonl"), json.loads((tmp / "metrics.json").read_text())


def test_happy_path_logs_one_entry_per_checkpoint_with_chain(tmp_run_dir):
    m, d, entries, _ = run(tmp_run_dir, ["MAINTAIN"] * 28)
    n_cp = len(d.calls)
    assert n_cp == 27  # t = 3, 4, ..., 29 s
    assert m["status"] == "completed" and m["decisions_0g"] == n_cp == m["decisions_total"] and m["decisions_halt"] == 0
    assert verify_chain(tmp_run_dir / "decisions.jsonl", m["log_head"])
    assert all(e["request_id"] and e["source"] == "0g" for e in entries)
    assert [e["cp"] for e in entries] == list(range(n_cp)) and entries[0]["sim_time_s"] == 3.0
    assert set(m["files"]) == {"scenario.json", "decisions.jsonl", "trajectory.jsonl", "metrics.json"}
    assert m["world"] == "kinematic" and m["trust_mode"] == "private" and len(m["episode_id"]) == 64


def test_brake_hard_decision_changes_motion(tmp_run_dir):
    _, _, _, calm = run(tmp_run_dir, ["MAINTAIN"] * 28)
    _, _, entries, hard = run(tmp_run_dir, ["MAINTAIN"] * 3 + ["BRAKE_HARD"] * 25)
    assert calm["ccs"] < 0.4 and calm["min_gap_m"] > 30
    assert hard["min_gap_m"] < 20 and hard["ccs"] > 0.5
    assert entries[3]["action"] == "BRAKE_HARD" and entries[3]["control_decel_mps2"] == 6.0


def test_failure_reasons_trigger_safe_halt_once(tmp_run_dir):
    for reason in ["timeout", "unreachable", "http_429", "http_5xx", "invalid_json", "out_of_set", "no_request_id",
                   "no_provider_for_trust_mode"]:
        m, d, entries, _ = run(tmp_run_dir, ["MAINTAIN", "COAST", dec(None, reason)] + ["MAINTAIN"] * 25)
        assert len(d.calls) == 3, reason  # no 0G call after the failure
        assert [e["source"] for e in entries] == ["0g", "0g", "none"] and entries[-1]["reason"] == reason
        assert entries[-1]["action"] is None and entries[-1]["control_decel_mps2"] == 3.0
        assert m["status"] == "interrupted" and m["decisions_halt"] == 1
        last = lines(tmp_run_dir / "trajectory.jsonl")[-1]
        assert last["lead_v"] < 0.3


def test_collision_during_halt_records_both(tmp_run_dir):
    s = Scenario(seed=1, initial_gap_m=8.0, ego_speed_mps=25.0, lead_speed_mps=10.0, runup_s=0.05)
    m, d, entries, metrics = run(tmp_run_dir, [dec(None, "timeout")], s=s)
    assert len(d.calls) == 1 and entries[0]["source"] == "none"
    assert m["collision"] is True and metrics["collision"] is True and m["status"] == "interrupted"


class GappyWorld:
    """KinematicWorld whose LiDAR loses the target on ticks 100..110."""
    name = "kinematic"

    def __init__(self, s):
        self.w, self.n = KinematicWorld(s), 0

    def reset(self, s):
        self.w.reset(s)

    @property
    def t_s(self):
        return self.w.t_s

    def set_lead_decel(self, d):
        self.w.set_lead_decel(d)

    def tick(self):
        st = self.w.tick()
        if 100 <= self.n <= 110:
            st = replace(st, lidar_gap=None, lidar_closing=None)
        self.n += 1
        return st

    def close(self):
        pass


def test_metrics_use_lidar_fields_and_mark_gaps(tmp_run_dir):
    _, _, _, metrics = run(tmp_run_dir, ["MAINTAIN"] * 28, world=GappyWorld(DEMO))
    traj = lines(tmp_run_dir / "trajectory.jsonl")
    assert all(not t["applicable"] and t["ttc_s"] is None and t["ccs"] is None for t in traj[100:111])
    assert traj[99]["applicable"] and traj[111]["applicable"]
    assert metrics["perception"]["scans_without_target"] == 11


def test_history_grows_and_reaction_delay_is_estimated(tmp_run_dir):
    _, d, entries, _ = run(tmp_run_dir, ["MAINTAIN", "MAINTAIN", "MAINTAIN", "BRAKE_HARD", "MAINTAIN"] + ["MAINTAIN"] * 23)
    hist = [h for _, h in d.calls]
    assert len(hist[2]["items"]) == 2 and hist[2]["items"][1]["your_action"] == "MAINTAIN"
    assert hist[3]["ego_observed_reaction_delay_s"] is None
    assert 0.4 <= hist[4]["ego_observed_reaction_delay_s"] <= 1.0
    assert hist[4]["ego_min_ttc_so_far_s"] is not None and entries[4]["history"] == hist[4]
