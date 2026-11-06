"""Measure nonce-echo omission on real private-tier 0G calls in kinematic episodes with a random binding."""
import json, os, secrets, sys, tempfile
from pathlib import Path
sys.path.insert(0, os.getcwd())  # run from the repo root: .venv/bin/python scripts/nonce_rate.py cut_in 30 tag
from faultline.cli import load_dotenv
from faultline import cutin, policy
from faultline.config import Scenario
from faultline.episode import run_episode
from faultline.router import ZgRouter
from faultline.world import KinematicWorld
load_dotenv()
fam, target, tag = sys.argv[1], int(sys.argv[2]), sys.argv[3]
url, key = os.environ["ZG_ROUTER_URL"], os.environ["ZG_API_KEY"]
n = bad = seed = 0; rows = []
while n < target:
    h = "0x" + secrets.token_hex(32)
    b = {"episode_id": secrets.token_hex(32), "commit_block": 1, "commit_blockhash": h, "nonce": h[2:10]}
    cut = fam == "cut_in"
    r = ZgRouter(url, key, system_prompt=cutin.SYSTEM_PROMPT if cut else policy.SYSTEM_PROMPT, binding=b)
    s = cutin.CutInScenario(seed=seed) if cut else Scenario(seed=seed)
    w = cutin.KinematicCutInWorld() if cut else KinematicWorld()
    out = Path(tempfile.mkdtemp())
    run_episode(w, r, s, out)
    for l in (out / "decisions.jsonl").read_text().splitlines():
        e = json.loads(l)
        if e["reason"] in ("ok", "bad_nonce"):
            n += 1; bad += e["reason"] == "bad_nonce"
        rows.append((e["reason"], e["request_id"]))
    seed += 1
print(json.dumps({"tag": tag, "family": fam, "decisions": n, "bad_nonce": bad, "episodes": seed,
                  "reasons": {k: sum(1 for x in rows if x[0] == k) for k in {x[0] for x in rows}},
                  "request_ids": [x[1] for x in rows]}))
