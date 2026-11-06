"""Safety memory (no network): model refs, config hash binding, Merkle scheme (shared vector with
packages/memory/test/merkle.test.ts), categories, Wilson CI, claims, snapshots."""
import hashlib
import json

from faultline import memory as M
from faultline.config import canonical

P = {"ego_speed_mps": 15.0, "initial_gap_m": 30.0, "lead_decel_mps2": 6.0, "friction_mu": 0.8, "reaction_delay_s": 0.6,
     "brake_onset_s": 5.0}
# shared with packages/memory/test/merkle.test.ts: raw lines, 35.0 stays "35.0" because bytes are hashed, not values
VECTOR_LINES = [b'{"a":35.0}', b'{"b":1}', b'{"c":[1,2]}']
VECTOR_ROOT = "0x" + hashlib.sha256(b"\x01" + hashlib.sha256(b"\x01" + hashlib.sha256(VECTOR_LINES[0]).digest()
                                                         + hashlib.sha256(VECTOR_LINES[1]).digest()).digest()
                                    + hashlib.sha256(VECTOR_LINES[2]).digest()).hexdigest()


def test_model_refs_digest_and_config_hash():
    m = M.models()
    assert m["1.0"]["params"] == {"min_gap_m": 2.0, "comfort_decel_mps2": 3.0, "max_accel_mps2": 1.5, "min_time_headway_s": 0.0}
    assert m["1.1"]["params"] == M.V11_CTRL
    assert m["1.0"]["artifact_digest"] != m["1.1"]["artifact_digest"] and m["1.0"] == M.models()["1.0"]
    assert M.config_hash(P, m["1.0"]) != M.config_hash(P, m["1.1"])
    forged = {**m["1.0"], "artifact_digest": "00" * 32}  # same params, different digest -> different config hash
    assert M.config_hash(P, forged) != M.config_hash(P, m["1.0"])


def test_merkle_vector_and_edges():
    assert M.lines_root(VECTOR_LINES) == VECTOR_ROOT == "0xf2ab04ece48236d5d89bfafa6f81c3d6edf3282c303d6ad5f482d8cad032a41b"
    assert M.merkle_root([]) == "0x" + hashlib.sha256(b"").hexdigest()
    one = hashlib.sha256(b"x").hexdigest()
    assert M.merkle_root([one]) == "0x" + one
    assert M.lines_root([b'{"a":35}']) != M.lines_root([b'{"a":35.0}'])


def test_category_rules():
    assert M.category({**P, "friction_mu": 0.4, "reaction_delay_s": 1.2}) == "low_friction"
    assert M.category({**P, "reaction_delay_s": 1.0}) == "slow_reaction"
    assert M.category({**P, "lead_decel_mps2": 6.0}) == "hard_brake"
    assert M.category({**P, "lead_decel_mps2": 3.0}) == "lead_brake"


def test_wilson():
    assert M.wilson(0, 0) == [0.0, 1.0]
    lo, hi = M.wilson(2, 129)
    assert 0 < lo < 2 / 129 < hi < 0.06
    assert M.wilson(10, 10)[1] == 1.0


def test_memory_claims_snapshot(tmp_path):
    m = M.models()
    mem = M.Memory(tmp_path / "records.jsonl")
    for p in (P, {**P, "initial_gap_m": 15.0}, {**P, "friction_mu": 0.3}):
        for v in ("1.0", "1.1"):
            mem.append(M.run_record(p, m[v], "test", "t"))
    lines = mem.lines()
    assert [json.loads(l)["i"] for l in lines] == list(range(6)) and all(canonical(json.loads(l)).encode() == l for l in lines)
    cl = M.claims(lines, "idm-follower")
    hb = [c for c in cl if c["category"] == "hard_brake"]
    assert {c["version"] for c in hb} == {"1.0", "1.1"} and all(c["n_tests"] == 2 for c in hb)
    for c in cl:
        sub = [lines[i] for i in c["record_indices"]]
        assert c["records_merkle_root"] == M.lines_root(sub)
        assert c["rate"] == round(c["n_collisions"] / c["n_tests"], 6)
    s = M.write_snapshot(tmp_path, mem, m["1.1"], 2, "0x" + "ab" * 32, [{"text": "h"}])
    pub = json.loads((tmp_path / "snap-2" / "public.json").read_text())
    snap = json.loads((tmp_path / "snap-2" / "snapshot.json").read_text())
    assert pub["records_root"] == s["records_root"] == M.lines_root(M.Memory(tmp_path / "snap-2" / "records.jsonl").lines())
    assert pub["claims_root"] == M.merkle_root([hashlib.sha256(c.encode()).hexdigest() for c in pub["claim_lines"]])
    assert pub["prev_snapshot_root"] == "0x" + "ab" * 32 and snap["open_hypotheses"] == [{"text": "h"}]
    assert "params" not in json.dumps(pub["claim_lines"]) and "explored_regions" not in pub  # aggregates only
    assert "Merkle scheme" in pub["merkle_scheme"]
