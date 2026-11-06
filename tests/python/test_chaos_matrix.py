"""Fault matrix (spec §10 T9) through the real CLI on KinematicWorld: every fake-Router failure is one logged safe
halt; the manifest carries `chaos` so a test run can never pass as evidence."""
import json

import pytest

from faultline.chaos import FakeRouter
from faultline.cli import main
from faultline.config import DEMO
from faultline.episode import run_episode
from faultline.router import ZgRouter
from faultline.world import KinematicWorld


@pytest.mark.parametrize("mode,reason", [("timeout", "timeout"), ("garbage", "invalid_json"), ("r429", "http_429"),
                                         ("r502", "http_5xx")])
def test_chaos_modes_halt_once(tmp_path, mode, reason, capsys):
    out = tmp_path / mode
    assert main(["run", "--world", "kinematic", "--chaos", mode, "--out", str(out)]) == 0
    assert "CHAOS MODE: " + mode in capsys.readouterr().out
    m = json.loads((out / "manifest.json").read_text())
    d = [json.loads(l) for l in (out / "decisions.jsonl").read_text().splitlines()]
    assert m["status"] == "interrupted" and m["chaos"] == mode
    assert [e["source"] for e in d] == ["none"] and d[0]["reason"] == reason


def test_fake_ok_server_completes(tmp_path):
    with FakeRouter("ok") as f:
        m = run_episode(KinematicWorld(), ZgRouter(f.url, "test"), DEMO, tmp_path)
    assert m["status"] == "completed" and m["decisions_0g"] == m["decisions_total"] == 27
    assert f.seen and all(s == ("0gm-1.0-35b-a3b", "private") for s in f.seen)
