"""The bridge as the control plane uses it: a subprocess speaking JSON lines, launched without network."""
import json
import shutil
import subprocess
import sys

import pytest

from conftest import ROOT
from sealedai_ml.synthetic import tickets

UNSHARE = shutil.which("unshare")


def _no_net_prefix():
    """Kernel-level isolation when the host allows unprivileged network namespaces (not on stock Ubuntu 24.04)."""
    if UNSHARE and subprocess.run([UNSHARE, "-rn", "true"], capture_output=True).returncode == 0:
        return [UNSHARE, "-rn"]
    return []


PROBE = "import socket\ntry:\n socket.create_connection(('1.1.1.1',443),timeout=3); print('CONNECTED')\nexcept OSError as e: print('BLOCKED', e)"


def test_bridge_process_refuses_network():
    """In-process guard: once the bridge module is imported, no TCP/UDP socket can be opened."""
    code = "import sealedai_ml.bridge\n" + PROBE
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=60).stdout
    assert out.startswith("BLOCKED"), out


def test_kernel_namespace_isolation():
    if not _no_net_prefix():
        pytest.skip("unprivileged network namespaces are blocked on this host (AppArmor); the TEE image isolates instead")
    out = subprocess.run(_no_net_prefix() + [sys.executable, "-c", PROBE], capture_output=True, text=True, timeout=30).stdout
    assert out.startswith("BLOCKED"), out


class Bridge:
    def __init__(self):
        self.p = subprocess.Popen(_no_net_prefix() + [sys.executable, "-m", "sealedai_ml.bridge"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.n = 0

    def __call__(self, op, **kw):
        self.n += 1
        self.p.stdin.write(json.dumps({"id": self.n, "op": op, **kw}) + "\n")
        self.p.stdin.flush()
        resp = json.loads(self.p.stdout.readline())
        assert resp["id"] == self.n
        return resp

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=30)


def test_bridge_end_to_end(seller_bundle):
    b = Bridge()
    try:
        assert b("load_model", dir=str(seller_bundle))["ok"]
        assert b("eval", code="print(1)")["error"].startswith("ValueError: unknown op")
        bad = b("load_data", rows=[{"text": "x", "label": "spam"}], seed="0x01")
        assert not bad["ok"] and "label set" in bad["error"]
        data = b("load_data", rows=tickets("B", 400, seed=9), seed="0x" + "ab" * 32)["result"]
        assert data["summary"]["rows"]["train"] > 0 and data["holdoutRows"] > 0
        base = b("baseline")["result"]
        recipe = {"method": "lora", "lora": {"r": 8, "alpha": 16, "dropout": 0.05, "targets": ["q_lin", "v_lin"]},
                  "optim": {"lr": 2e-4, "epochs": 1, "batch": 16, "warmup": 0}, "classWeights": "none", "maxLen": 128}
        run = b("train", runId="run1", recipe=recipe, gpuSecondsLeft=120)["result"]
        assert run["metrics"]["valMacroF1"] >= 0 and "trainLoss" in run["metrics"]
        assert not b("predict", runId="run1", text="no signal")["ok"]  # only after holdout selection
        ho = b("holdout", runId="run1")["result"]
        assert 0 <= ho["valMacroF1"] <= 1
        assert not b("holdout", runId="run1")["ok"]  # once only
        assert b("predict", runId="run1", text="no signal in Thane since 9am")["result"]["label"] in ["billing", "outage", "other"]
        print("baseline", round(base["valMacroF1"], 3), "run1", round(run["metrics"]["valMacroF1"], 3), "holdout", round(ho["valMacroF1"], 3))
    finally:
        b.close()
