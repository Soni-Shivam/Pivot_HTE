import json

import pytest

from faultline.log import verify_chain
from faultline.replay import RecordedDecider, carla_playback_cmd, replay
from faultline.world import KinematicWorld
from test_episode import run


def test_kinematic_replay_reproduces_trajectory(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    run(src, ["MAINTAIN"] * 3 + ["BRAKE_HARD"] * 3 + ["COAST"] * 30)
    r = replay(src, KinematicWorld(), tmp_path / "re")
    assert r["trajectory_sha256_match"] and r["decisions_match"]
    assert r["max_abs_gap_diff_m"] == 0.0 and r["max_abs_v_diff_mps"] == 0.0
    assert json.loads((tmp_path / "re" / "replay.json").read_text()) == r
    d = RecordedDecider(src / "decisions.jsonl").decide({}, {}, ())
    assert (d.action, d.request_id, d.latency_ms) == ("MAINTAIN", "req-0", 0)


def test_halted_episode_replays_to_the_same_halt(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    m, *_ = run(src, ["MAINTAIN", "BRAKE_SOFT", "timeout"])
    r = replay(src, KinematicWorld(), tmp_path / "re")
    re_m = json.loads((tmp_path / "re" / "manifest.json").read_text())
    assert r["trajectory_sha256_match"] and r["decisions_match"]
    assert m["status"] == re_m["status"] == "interrupted" and re_m["decisions_halt"] == 1


def test_tampered_log_is_refused(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    run(src, ["MAINTAIN"] * 40)
    p = src / "decisions.jsonl"
    b = bytearray(p.read_bytes())
    b[b.index(b'"MAINTAIN"') + 1] = ord("N")  # MAINTAIN -> NAINTAIN in the first entry
    p.write_bytes(bytes(b))
    assert not verify_chain(p)
    with pytest.raises(ValueError, match="log chain broken"):
        replay(src, KinematicWorld(), tmp_path / "re")


def test_playback_cmd_names_the_run(tmp_path):
    assert carla_playback_cmd(tmp_path).endswith(f"-m faultline playback {tmp_path}")
