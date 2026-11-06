"""Recorded-decision replay (spec §5.4 step 11, plan Task 8): re-run an episode with the logged decisions on a fresh
world and compare trajectories. No 0G call is made; the decisions are the logged ones, request ids copied."""
import hashlib
import json
import sys
from pathlib import Path

from faultline.config import Scenario, canonical
from faultline.episode import run_episode
from faultline.log import verify_chain
from faultline.router import Decision


def _lines(p: Path) -> list[dict]:
    return [json.loads(l) for l in Path(p).read_text().splitlines()]


class RecordedDecider:
    def __init__(self, decisions_path: Path):
        self.entries = _lines(decisions_path)
        self.n = 0
        ok = [e for e in self.entries if e["source"] != "none"]
        self.source = ok[0]["source"] if ok else "0g"
        self.model = self.entries[0]["model"] if self.entries else None

    def decide(self, obs, history, available) -> Decision:
        if self.n >= len(self.entries):
            raise ValueError(f"replay asked for checkpoint {self.n}, log has {len(self.entries)}")
        e = self.entries[self.n]
        self.n += 1
        return Decision(action=e["action"], reason=e["reason"], request_id=e["request_id"], provider=e["provider"],
                        zg_res_key=e["zg_res_key"], model=e["model"], latency_ms=0, http_status=e["http_status"],
                        raw_sha256=e["raw_sha256"], content=e["content"], ratelimit_remaining=e["ratelimit_remaining"])


def replay(run_dir: Path, world, out_dir: Path) -> dict:
    run_dir, out_dir = Path(run_dir), Path(out_dir)
    manifest = json.loads((run_dir / "manifest.json").read_text())
    if not verify_chain(run_dir / "decisions.jsonl", manifest["log_head"]):
        raise ValueError("log chain broken")
    scenario = Scenario(**json.loads((run_dir / "scenario.json").read_text()))
    run_episode(world, RecordedDecider(run_dir / "decisions.jsonl"), scenario, out_dir)

    a, b = _lines(run_dir / "trajectory.jsonl"), _lines(out_dir / "trajectory.jsonl")
    pairs = list(zip(a, b))
    keys = ("cp", "action", "reason", "source")
    da, db = _lines(run_dir / "decisions.jsonl"), _lines(out_dir / "decisions.jsonl")
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    r = {"trajectory_sha256_match": sha(run_dir / "trajectory.jsonl") == sha(out_dir / "trajectory.jsonl"),
         "ticks_original": len(a), "ticks_replay": len(b),
         "max_abs_gap_diff_m": max((abs(x["gt_gap"] - y["gt_gap"]) for x, y in pairs), default=0.0),
         "max_abs_lidar_gap_diff_m": max((abs(x["lidar_gap"] - y["lidar_gap"]) for x, y in pairs
                                          if x["lidar_gap"] is not None and y["lidar_gap"] is not None), default=0.0),
         "max_abs_v_diff_mps": max((max(abs(x["ego_v"] - y["ego_v"]), abs(x["lead_v"] - y["lead_v"]))
                                    for x, y in pairs), default=0.0),
         "decisions_match": [[e[k] for k in keys] for e in da] == [[e[k] for k in keys] for e in db]}
    (out_dir / "replay.json").write_text(canonical(r) + "\n")
    return r


def carla_playback_cmd(run_dir: Path) -> str:
    return f"{sys.executable} -m faultline playback {run_dir}"


def playback(run_dir: Path, host="127.0.0.1", port=2000) -> bool:
    """Play runs/<id>/recorder.log on the running CARLA server (sync ticks at the recorded dt), then restore async.
    True if the recorded vehicles appeared during playback."""
    import carla

    log = str((Path(run_dir) / "recorder.log").resolve())
    c = carla.Client(host, port)
    c.set_timeout(120.0)
    info = c.show_recorder_file_info(log, False)
    print("\n".join(info.splitlines()[:6]))
    dur = next(float(l.split()[1]) for l in info.splitlines() if l.startswith("Duration:"))
    dt = json.loads((Path(run_dir) / "scenario.json").read_text())["dt_s"]
    w = c.get_world()
    st = w.get_settings()
    st.synchronous_mode, st.fixed_delta_seconds = True, dt
    w.apply_settings(st)
    seen = 0
    try:
        print(c.replay_file(log, 0.0, 0.0, 0))
        for i in range(int(dur / dt) + 5):
            w.tick()
            seen = max(seen, len(w.get_actors().filter("vehicle.*")))
    finally:
        c.stop_replayer(False)
        st = w.get_settings()
        st.synchronous_mode, st.fixed_delta_seconds = False, None
        w.apply_settings(st)
    print(f"playback ticks {int(dur / dt) + 5}  vehicles seen {seen}")
    return seen >= 2
