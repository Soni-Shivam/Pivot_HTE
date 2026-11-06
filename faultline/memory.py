"""Faultline safety memory: model refs, private MemoryRecord JSONL, Merkle roots, per-category claims, snapshots.

Merkle scheme (identical in packages/memory/src/merkle.ts; never re-serialize JSON across languages, Python prints
35.0 where JS prints 35, so only raw bytes are hashed):
  record_hash = sha256(raw UTF-8 bytes of one JSONL line, without the trailing newline)
  leaves      = record hashes in file order
  parent      = sha256(0x01 || left || right); an odd last node is carried up unchanged (no duplication)
  root of []  = sha256(b"")
A record line is canonical JSON (sort_keys, no spaces) starting with '{', so it can never be a 65-byte 0x01 node.
Claims are hashed the same way over their canonical lines (`claim_lines` in public.json are those exact strings).
"""
import hashlib
import json
import math
from pathlib import Path

from faultline import research as R
from faultline.config import canonical
from faultline.experiment import CTRL0, CTRL_BOUNDS, run_experiment

ROOT = R.ROOT
AGENT_ID = 579  # ERC-8004 agent on Galileo (docs/evidence/faultline-erc8004.log)
RECORD_SCHEMA, SNAPSHOT_SCHEMA, PUBLIC_SCHEMA = ("faultline.memory.record/v1", "faultline.memory.snapshot/v1",
                                                 "faultline.memory.public/v1")
Z95 = 1.959963984540054

# idm-follower@1.1 = the classical grid fix from the research mission (runs/research-mission-001/research.json
# fix_baseline.fewest_suite_unsafe; docs/evidence/faultline-research.md "Fix": suite unsafe 19 -> 0, no regressions).
V11_CTRL = {"min_gap_m": 5.0, "comfort_decel_mps2": 2.0, "max_accel_mps2": 3.0, "min_time_headway_s": 2.0}


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def model_ref(model_id: str, version: str, ctrl: dict) -> dict:
    """artifact_digest = sha256(canonical({params, source})): the full controller params (CTRL0 overlaid with ctrl)
    plus the sha256 of the controller source (controller.py: IDM law; experiment.py: idm_for headway rule)."""
    params = {**CTRL0, **ctrl}
    assert all(CTRL_BOUNDS[k][0] <= v <= CTRL_BOUNDS[k][1] for k, v in params.items()), params
    src = {f: _sha((ROOT / "faultline" / f).read_bytes()) for f in ("controller.py", "experiment.py")}
    return {"model_id": model_id, "version": version, "params": params, "source_sha256": src,
            "artifact_digest": _sha(canonical({"params": params, "source": src}).encode())}


def models() -> dict:
    """v1.0 = experiment.CTRL0 (min_gap 2, comfort decel 3, max accel 1.5 = IdmParams defaults; no headway floor)."""
    return {"1.0": model_ref("idm-follower", "1.0", {}), "1.1": model_ref("idm-follower", "1.1", V11_CTRL)}


def config_hash(p: dict, ref: dict, chooser_model: str | None = None, prompt_sha: str | None = None) -> str:
    """research.config_hash (controller, simulator + code, scenario, who chose it) bound to the model artifact digest."""
    ctrl = {k: v for k, v in ref["params"].items() if CTRL0[k] != v} or None
    return _sha(canonical({"experiment": R.config_hash(p, ctrl, chooser_model, prompt_sha),
                           "model": f"{ref['model_id']}@{ref['version']}", "artifact_digest": ref["artifact_digest"]}).encode())


# ---------------------------------------------------------------- categories (deterministic, first match wins)
CATEGORIES = (("low_friction", "friction_mu < 0.5"), ("slow_reaction", "reaction_delay_s >= 1.0"),
              ("hard_brake", "lead_decel_mps2 >= 6.0"), ("lead_brake", "everything else"))


def category(p: dict) -> str:
    if p["friction_mu"] < 0.5:
        return "low_friction"
    if p["reaction_delay_s"] >= 1.0:
        return "slow_reaction"
    if p["lead_decel_mps2"] >= 6.0:
        return "hard_brake"
    return "lead_brake"


# ---------------------------------------------------------------- records
def run_record(p: dict, ref: dict, chosen_by: str, campaign: str, extra: dict | None = None,
               chooser_model=None, prompt_sha=None) -> dict:
    ctrl = {k: v for k, v in ref["params"].items() if CTRL0[k] != v} or None
    o = run_experiment(p, ctrl=ctrl, keep_rows=True)
    fp = R.fingerprint(p, o)
    eff = R.efficiency(o.pop("rows"), o["onset_t_s"])
    p = {k: float(p[k]) for k in R.SPACE}
    return {"schema": RECORD_SCHEMA, "model": {k: ref[k] for k in ("model_id", "version", "artifact_digest")},
            "category": category(p), "params": p, "config_hash": config_hash(p, ref, chooser_model, prompt_sha),
            "outcome": {k: o[k] for k in ("safe", "collision", "min_gap_m", "min_ttc_s", "ego_max_decel_mps2")} | eff,
            "fingerprint": fp["key"] if fp else None, "chosen_by": chosen_by, "campaign": campaign, **(extra or {})}


class Memory:
    """Append-only JSONL; each line is canonical JSON with its index `i`. Only the raw lines are ever hashed."""

    def __init__(self, path):
        self.path = Path(path)

    def lines(self) -> list[bytes]:
        return [l for l in self.path.read_bytes().split(b"\n") if l] if self.path.exists() else []

    def records(self) -> list[dict]:
        return [json.loads(l) for l in self.lines()]

    def append(self, rec: dict) -> dict:
        rec = {**rec, "i": len(self.lines())}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("ab") as f:
            f.write(canonical(rec).encode() + b"\n")
        return rec


def record_hash(line: bytes) -> str:
    return _sha(line)


def merkle_root(leaves: list[str]) -> str:
    """Root over hex leaf hashes (see module docstring). Returns 0x-prefixed hex."""
    level = [bytes.fromhex(h.removeprefix("0x")) for h in leaves]
    if not level:
        return "0x" + _sha(b"")
    while len(level) > 1:
        nxt = [hashlib.sha256(b"\x01" + level[i] + level[i + 1]).digest() for i in range(0, len(level) - 1, 2)]
        level = nxt + ([level[-1]] if len(level) % 2 else [])
    return "0x" + level[0].hex()


def lines_root(lines: list[bytes]) -> str:
    return merkle_root([record_hash(l) for l in lines])


# ---------------------------------------------------------------- claims
def wilson(k: int, n: int) -> list:
    if n == 0:
        return [0.0, 1.0]
    p, z2 = k / n, Z95 * Z95
    c, h = (p + z2 / (2 * n)) / (1 + z2 / n), Z95 * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n)
    return [round(max(0.0, c - h), 6), round(min(1.0, c + h), 6)]


def claims(lines: list[bytes], model_id: str, agent_id: int = AGENT_ID) -> list[dict]:
    """One claim per (version, category) over the records in `lines`. n/rates are recomputed by the TS auditor."""
    recs = [(l, json.loads(l)) for l in lines]
    out = []
    for v in sorted({r["model"]["version"] for _, r in recs if r["model"]["model_id"] == model_id}):
        for cat, _ in CATEGORIES:
            sub = [(l, r) for l, r in recs if r["model"]["model_id"] == model_id and r["model"]["version"] == v
                   and r["category"] == cat]
            if not sub:
                continue
            n, kc, ku = len(sub), sum(r["outcome"]["collision"] for _, r in sub), sum(not r["outcome"]["safe"] for _, r in sub)
            out.append({"schema": "faultline.memory.claim/v1", "agent_id": agent_id, "model_id": model_id, "version": v,
                        "artifact_digest": sub[0][1]["model"]["artifact_digest"], "category": cat, "n_tests": n,
                        "n_collisions": kc, "rate": round(kc / n, 6), "ci95": wilson(kc, n), "n_unsafe": ku,
                        "unsafe_rate": round(ku / n, 6), "unsafe_ci95": wilson(ku, n),
                        "mean_speed_mps": round(sum(r["outcome"]["mean_speed_mps"] for _, r in sub) / n, 4),
                        "records_merkle_root": lines_root([l for l, _ in sub]), "record_indices": [r["i"] for _, r in sub],
                        "safety_definition": R.SAFETY_DEFINITION})
    return out


def fingerprint_summary(recs: list[dict]) -> dict:
    s = {}
    for r in recs:
        if r["fingerprint"]:
            d = s.setdefault(r["fingerprint"], {})
            d[r["model"]["version"]] = d.get(r["model"]["version"], 0) + 1
    return dict(sorted(s.items()))


def explored_regions(recs: list[dict]) -> dict:
    """Per (version, category): how many runs and the parameter box they span."""
    out = {}
    for r in recs:
        b = out.setdefault(f"{r['model']['version']}/{r['category']}", {"runs": 0, "box": {}})
        b["runs"] += 1
        for k, x in r["params"].items():
            lo, hi = b["box"].get(k, [x, x])
            b["box"][k] = [min(lo, x), max(hi, x)]
    return dict(sorted(out.items()))


def write_snapshot(out: Path, mem: Memory, ref: dict, seq: int, prev_root: str | None, open_hypotheses: list,
                   extra_public: dict | None = None, agent_id: int = AGENT_ID) -> dict:
    """snap-<seq>/{records.jsonl (bytes as of now), snapshot.json (private), public.json (aggregates only)}."""
    d = Path(out) / f"snap-{seq}"
    d.mkdir(parents=True, exist_ok=False)
    raw = mem.path.read_bytes()
    (d / "records.jsonl").write_bytes(raw)
    lines = mem.lines()
    recs = [json.loads(l) for l in lines]
    cl = claims(lines, ref["model_id"], agent_id)
    cl_lines = [canonical(c) for c in cl]
    mv = f"{ref['model_id']}@{ref['version']}#{seq}"
    head = {"agent_id": agent_id, "memory_version": mv, "model_ref": ref, "seq": seq, "prev_snapshot_root": prev_root,
            "records_root": lines_root(lines), "record_count": len(lines), "records_file_sha256": _sha(raw),
            "claims_root": merkle_root([_sha(c.encode()) for c in cl_lines]), "merkle_scheme": __doc__.split("\n\n")[1]}
    snap = {"schema": SNAPSHOT_SCHEMA, **head, "claims": cl, "fingerprint_summary": fingerprint_summary(recs),
            "open_hypotheses": open_hypotheses, "explored_regions": explored_regions(recs)}
    pub = {"schema": PUBLIC_SCHEMA, **head, "claim_lines": cl_lines, "fingerprint_summary": snap["fingerprint_summary"],
           "safety_definition": R.SAFETY_DEFINITION, "categories": dict(CATEGORIES),
           "note": "aggregates only; trajectories, configs and per-test params are in the sealed snapshot", **(extra_public or {})}
    (d / "snapshot.json").write_text(json.dumps(snap, indent=1, sort_keys=True) + "\n")
    (d / "public.json").write_text(json.dumps(pub, indent=1, sort_keys=True) + "\n")
    return {"dir": str(d), **head}
