"""python -m faultline run ... (plan Task 7). Reads ZG_ROUTER_URL / ZG_API_KEY from .env; never prints them."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from urllib.parse import urlparse
from dataclasses import asdict
from pathlib import Path

from faultline.chaos import MODES, TIMEOUT_S as CHAOS_TIMEOUT_S, FakeRouter
from faultline import cutin
from faultline.config import Scenario, canonical, scenario_hash
from faultline.episode import _iso, run_episode
from faultline.log import verify_chain
from faultline.router import DEFAULT_MODEL, Decision, ZgRouter

ROOT = Path(__file__).resolve().parent.parent
UNREACHABLE_URL = "http://127.0.0.1:1"  # a real refused connection, not a fake Router
FAKE_MODES = tuple(m for m in MODES if m != "ok")


def load_dotenv(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        k, sep, v = line.strip().partition("=")
        if sep and k and not k.startswith("#"):
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


class MaintainBaseline:
    """Local scripted contrast run. Every entry is labelled source "scripted-baseline"; never used with --decider 0g."""
    source = "scripted-baseline"
    model = "scripted-baseline"

    def decide(self, obs, history, available):
        # available[0] is MAINTAIN (lead_brake) / KEEP_LANE (cut_in)
        return Decision(action=available[0], reason="ok", request_id=None, provider=None, zg_res_key=None,
                        model=self.model, latency_ms=0, http_status=None, raw_sha256=None, content=None,
                        ratelimit_remaining=None)


def make_world(name: str, out: Path, view: bool, display: str = ":2", family: str = "lead_brake", degrade=None,
               record: bool = True, ros: bool = False):
    w = _make_world(name, out, view, display, family, degrade, record)
    if ros:  # publish to ROS 2 (source viz/env.sh first): attach after reset, close with the world
        from faultline.rosbridge import RosBridge
        bridge, reset, close = RosBridge(), w.reset, w.close
        w.reset = lambda s: (reset(s), bridge.attach(w))
        w.close = lambda: (bridge.close(), close())
    return w


def _make_world(name, out, view, display, family, degrade, record):
    if name == "kinematic":
        if family == "cut_in":
            return cutin.KinematicCutInWorld()
        from faultline.world import KinematicWorld
        return KinematicWorld()
    v = None
    if view:
        os.environ["DISPLAY"] = display
        from faultline.viewer import ChaseView
        v = ChaseView(out)
    rec = out / "recorder.log" if record else None
    if family == "cut_in":
        from faultline.carla_cutin import CutInCarlaWorld
        return CutInCarlaWorld(recorder_path=rec, view=v, degrade=degrade)
    from faultline.carla_world import CarlaWorld
    return CarlaWorld(recorder_path=rec, view=v)


def print_summary(out: Path, m: dict) -> None:
    import json
    print(f"\nepisode {m['episode_id']}  world {m['world']}  status {m['status']}  collision {m['collision']}")
    print(f"decisions total {m['decisions_total']}  0g {m['decisions_0g']}  halt {m['decisions_halt']}  "
          f"log_head {m['log_head']}  chain_ok {verify_chain(out / 'decisions.jsonl', m['log_head'])}")
    met = json.loads((out / "metrics.json").read_text())
    print(f"ccs {met['ccs']:.4f}  min_ttc_s {met['min_ttc_s']}  min_gap_m {met['min_gap_m']}  "
          f"perception {met['perception']}")
    if "ground_truth" in met:
        print(f"ground truth {met['ground_truth']}")
    print(f"\n{'cp':>3} {'action':<10} {'source':<17} {'reason':<12} {'request_id':<40} {'provider':<44} latency_ms")
    for line in (out / "decisions.jsonl").read_text().splitlines():
        d = json.loads(line)
        print(f"{d['cp']:>3} {str(d['action']):<10} {d['source']:<17} {d['reason']:<12} {str(d['request_id']):<40} "
              f"{str(d['provider']):<44} {d['latency_ms']}")


def npm(cmd: str, out: Path) -> None:
    subprocess.run(["npm", "run", "-s", "faultline", "--", cmd, str(out)], cwd=ROOT, check=True)


def cmd_run(a) -> int:
    load_dotenv()
    out = Path(a.out or f"runs/{a.world}-{a.seed}-{time.strftime('%Y%m%dT%H%M%S')}")
    if out.exists() and any(out.iterdir()):
        sys.exit(f"refusing to overwrite {out}")
    out.mkdir(parents=True, exist_ok=True)
    extra, fake = {}, None
    from faultline.policy import SYSTEM_PROMPT, prompt_hash
    prompt = cutin.SYSTEM_PROMPT if a.family == "cut_in" else SYSTEM_PROMPT
    if a.decider == "maintain":
        decider = MaintainBaseline()
    elif a.chaos in FAKE_MODES:
        print(f"\033[31mCHAOS MODE: {a.chaos} (fake router, test only)\033[0m")
        fake = FakeRouter(a.chaos).__enter__()
        decider, extra = ZgRouter(fake.url, "chaos-test", model=a.model, timeout_s=CHAOS_TIMEOUT_S,
                                  system_prompt=prompt), {"chaos": a.chaos, "router_host": "in-process fake router"}
        decider.source = "chaos-fake"  # never "0g": any answer this fake gives is not a 0G decision (audit A4)
    else:
        url = UNREACHABLE_URL if a.chaos == "unreachable" else (a.router_url or os.environ.get("ZG_ROUTER_URL"))
        key = os.environ.get("ZG_API_KEY")
        if not url or not key:
            sys.exit("ZG_ROUTER_URL and ZG_API_KEY must be set in .env")
        decider = ZgRouter(url, key, model=a.model, system_prompt=prompt)
        extra["router_host"] = urlparse(url).hostname  # provenance (audit A4); host only, never the key
    s = cutin.CutInScenario(seed=a.seed) if a.family == "cut_in" else Scenario(seed=a.seed)
    mk = lambda: make_world(a.world, out, a.view, a.display, a.family, ros=a.ros)
    if not a.anchor:
        try:
            m = run_episode(mk(), decider, s, out, extra=extra)
        finally:
            if fake:
                fake.__exit__()
        print_summary(out, m)
        return 0
    if fake:
        sys.exit("--anchor is for evidence runs; it cannot be combined with a chaos mode")
    # Commit-before: scenario.json + preliminary manifest, Galileo commitScenario, only then the first 0G call.
    started_at = _iso(time.time())
    (out / "scenario.json").write_text(canonical(asdict(s)) + "\n")
    episode_id = hashlib.sha256(f"{scenario_hash(s)}:{s.seed}:{started_at}".encode()).hexdigest()
    git = lambda *c: subprocess.run(["git", *c], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    # configHash = keccak256(abi.encode(bytes32 prompt_hash, string model, string git_commit)), public on chain
    config = {"prompt_hash": cutin.prompt_hash() if a.family == "cut_in" else prompt_hash(),
              "model": getattr(decider, "model", None) or "", "git_commit": git("rev-parse", "HEAD"),
              "git_dirty": bool(git("status", "--porcelain", "--untracked-files=no"))}
    (out / "manifest.json").write_text(json.dumps({"episode_id": episode_id, "scenario_hash": scenario_hash(s),
                                                    "started_at": started_at, "preliminary": True, "config": config}) + "\n")
    npm("commit", out)
    anc = json.loads((out / "anchor.json").read_text())
    # Audit A3: every prompt carries the episode id and blockhash(commitBlock); the model must echo the nonce.
    binding = {"episode_id": episode_id, "commit_block": anc["commitBlock"], "commit_blockhash": anc["commitBlockHash"],
               "nonce": anc["commitBlockHash"][2:10]}
    if isinstance(decider, ZgRouter):
        decider.binding = binding
    m = run_episode(mk(), decider, s, out, started_at=started_at,
                    extra={**extra, "registry": anc["registry"], "commit_tx": anc["commitTx"], "evaluator": anc["evaluator"],
                           "config": config, "config_hash": anc["configHash"], "seq": anc["seq"], "binding": binding})
    print_summary(out, m)
    npm("publish", out)
    npm("finalize", out)
    pub, anc = json.loads((out / "publish.json").read_text()), json.loads((out / "anchor.json").read_text())
    # local copy only: the published manifest (inside public.json / sealed.bin) predates these fields
    m.update(public_root=pub["publicRoot"], sealed_root=pub["sealedRoot"], public_tx=pub["publicTx"],
             sealed_tx=pub["sealedTx"], finalize_tx=anc["finalizeTx"])
    (out / "manifest.json").write_text(json.dumps(m, sort_keys=True, indent=2) + "\n")
    print(f"anchored: commit {anc['commitTx']}  finalize {anc['finalizeTx']}  onchain_matches {anc['onchainMatches']}")
    return 0


def cmd_replay(a) -> int:
    import json

    from faultline.replay import playback, replay
    out = Path(a.out or f"{a.run_dir.rstrip('/')}-replay-{a.world}")
    if out.exists() and any(out.iterdir()):
        sys.exit(f"refusing to overwrite {out}")
    out.mkdir(parents=True, exist_ok=True)
    fam = json.loads((Path(a.run_dir) / "scenario.json").read_text()).get("family", "lead_brake")
    r = replay(Path(a.run_dir), make_world(a.world, out, a.view, a.display, fam), out)
    if a.world == "carla":
        r["playback_ok"] = playback(Path(a.run_dir))
        (out / "replay.json").write_text(json.dumps(r, sort_keys=True, separators=(",", ":")) + "\n")
    print(json.dumps(r, indent=2, sort_keys=True))
    return 0 if r["decisions_match"] else 1


def cmd_occlusion(a) -> int:
    from faultline.occlusion import sweep
    out = Path(a.out or f"{a.run_dir.rstrip('/')}-occlusion")
    summary = sweep(Path(a.run_dir), out, a.seed, a.only.split(",") if a.only else None,
                    lambda deg, o: make_world("carla", o, False, family="cut_in", degrade=deg, record=False))
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


def cmd_playback(a) -> int:
    from faultline.replay import playback
    ok = playback(Path(a.run_dir))
    print(f"playback_ok {ok}")
    return 0 if ok else 1


def main(argv=None) -> int:
    sys.stdout.reconfigure(line_buffering=True)  # keep our table in order with the npm subprocess output
    p = argparse.ArgumentParser(prog="faultline")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--world", choices=["carla", "kinematic"], default="carla")
    r.add_argument("--seed", type=int, default=42)
    r.add_argument("--out")
    r.add_argument("--model", default=DEFAULT_MODEL)
    r.add_argument("--router-url")
    r.add_argument("--chaos", choices=["none", "unreachable", *FAKE_MODES], default="none",
                   help="unreachable = real refused connection; the others use an in-process fake router (test only)")
    r.add_argument("--decider", choices=["0g", "maintain"], default="0g")
    r.add_argument("--family", choices=["lead_brake", "cut_in"], default="lead_brake")
    r.add_argument("--view", action="store_true", help="chase-camera window + screen.mp4 (CARLA only)")
    r.add_argument("--ros", action="store_true", help="publish LiDAR, boxes, map and HMI topics to ROS 2 (source viz/env.sh)")
    r.add_argument("--anchor", action="store_true", help="Galileo commit before the loop, publish + finalize after")
    r.add_argument("--display", default=":2", help="X display for --view (the VNC desktop)")
    r.set_defaults(fn=cmd_run)
    rp = sub.add_parser("replay")
    rp.add_argument("run_dir")
    rp.add_argument("--world", choices=["carla", "kinematic"], default="kinematic")
    rp.add_argument("--out")
    rp.add_argument("--view", action="store_true")
    rp.add_argument("--display", default=":2")
    rp.set_defaults(fn=cmd_replay)
    oc = sub.add_parser("occlusion", help="LiDAR-degradation sweep on a recorded cut-in episode (replayed decisions)")
    oc.add_argument("run_dir")
    oc.add_argument("--seed", type=int, default=0, help="seed of the point-dropout RNG")
    oc.add_argument("--out")
    oc.add_argument("--only", help="comma-separated condition names (default: all)")
    oc.set_defaults(fn=cmd_occlusion)
    pb = sub.add_parser("playback", help="play runs/<id>/recorder.log on the CARLA server")
    pb.add_argument("run_dir")
    pb.set_defaults(fn=cmd_playback)
    a = p.parse_args(argv)
    return a.fn(a)
