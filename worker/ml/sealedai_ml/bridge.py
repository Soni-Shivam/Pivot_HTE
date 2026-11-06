"""JSON-lines bridge between the worker control plane (TS) and the ML plane. stdin/stdout only, no sockets: the
control plane launches this process without network access (`unshare -rn` where available).

Request:  {"id": n, "op": "...", ...}        Response: {"id": n, "ok": true, "result": ...} | {"id": n, "ok": false, "error": "..."}
Ops: load_model{dir} · load_data{rows, seed} · baseline{} · train{runId, recipe, gpuSecondsLeft} · holdout{runId} ·
     predict{runId, text}
"""
from __future__ import annotations

import os

# Defence in depth for "the ML plane has no network" (T13). The kernel-level control is the runtime's (TEE image:
# separate network-less container or `unshare -rn`); in-process, refuse every non-local socket and force the
# Hugging Face libraries offline before they are imported.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
import socket as _socket  # noqa: E402

_RealSocket = _socket.socket


class _LocalOnlySocket(_RealSocket):
    def __init__(self, family=-1, *a, **kw):
        fam = _socket.AF_INET if family == -1 else family
        if fam != _socket.AF_UNIX:
            raise PermissionError("network access is disabled in the ML plane")
        super().__init__(family, *a, **kw)


_socket.socket = _LocalOnlySocket  # type: ignore[misc]

import hashlib  # noqa: E402
import json  # noqa: E402
import sys  # noqa: E402
import traceback  # noqa: E402

from . import engine  # noqa: E402
from .data import split, summary
from .loader import load_bundle


class Plane:
    def __init__(self) -> None:
        self.base = self.tok = self.card = self.splits = None
        self.models: dict[str, object] = {}
        self.seed = b""

    def load_model(self, dir: str):
        self.base, self.tok, self.card = load_bundle(dir)
        self.models = {"baseline": self.base}
        return {"architecture": self.card["architecture"], "parameters": self.base.num_parameters(), "labels": self.card["labels"]}

    def load_data(self, rows: list[dict], seed: str):
        labels = set(self.card["labels"])
        bad = [i for i, r in enumerate(rows) if set(r) != {"text", "label"} or not isinstance(r["text"], str) or r["label"] not in labels]
        if bad:
            raise ValueError(f"{len(bad)} rows are malformed or use labels outside the model's label set")
        self.seed = bytes.fromhex(seed.removeprefix("0x"))
        self.splits = split(rows, self.seed)
        return {"summary": summary(self.splits, self.tok), "holdoutRows": self.splits.holdout_size}

    def baseline(self):
        return engine.evaluate(self.base, self.tok, self.splits.val, self.card["labels"], self.card.get("maxLen", 128))

    def train(self, runId: str, recipe: dict, gpuSecondsLeft: float):
        if runId in self.models:
            raise ValueError(f"run {runId} already exists")
        seed = int.from_bytes(hashlib.sha256(self.seed + runId.encode()).digest()[:4], "big")
        model, info = engine.train(self.base, self.tok, self.splits.train, self.card["labels"], recipe, seed, gpuSecondsLeft)
        self.models[runId] = model
        metrics = engine.evaluate(model, self.tok, self.splits.val, self.card["labels"], recipe["maxLen"])
        metrics["trainLoss"] = info["trainLoss"]
        return {"metrics": metrics, "gpuSeconds": info["gpuSeconds"], "stoppedByBudget": info["stoppedByBudget"]}

    def holdout(self, runId: str):
        self.splits.unlock()
        rows = self.splits.holdout()  # raises if already used
        self.selected = runId
        return engine.evaluate(self.models[runId], self.tok, rows, self.card["labels"], self.card.get("maxLen", 128))

    def predict(self, runId: str, text: str):
        if getattr(self, "selected", None) != runId:
            raise ValueError("only the selected, holdout-evaluated version can serve")
        return {"label": engine.predict(self.models[runId], self.tok, text, self.card["labels"], self.card.get("maxLen", 128))}


OPS = {"load_model", "load_data", "baseline", "train", "holdout", "predict"}


def main() -> None:
    plane = Plane()
    out = sys.stdout
    sys.stdout = sys.stderr  # library chatter must never corrupt the protocol stream
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        rid = req.pop("id", None)
        op = req.pop("op", "")
        try:
            if op not in OPS:
                raise ValueError(f"unknown op {op!r}")
            resp = {"id": rid, "ok": True, "result": getattr(plane, op)(**req)}
        except Exception as e:  # report, keep serving
            traceback.print_exc(file=sys.stderr)
            resp = {"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"}
        out.write(json.dumps(resp) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
