"""python -m faultline run ... (plan Task 7). Reads ZG_ROUTER_URL / ZG_API_KEY from .env; never prints them."""
import argparse
import os
import sys
import time
from pathlib import Path

from faultline.config import Scenario
from faultline.episode import run_episode
from faultline.log import verify_chain
from faultline.router import DEFAULT_MODEL, Decision, ZgRouter

ROOT = Path(__file__).resolve().parent.parent
UNREACHABLE_URL = "http://127.0.0.1:1"  # a real refused connection, not a fake Router


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
        return Decision(action="MAINTAIN", reason="ok", request_id=None, provider=None, zg_res_key=None,
                        model=self.model, latency_ms=0, http_status=None, raw_sha256=None, content=None,
                        ratelimit_remaining=None)


def make_world(name: str, out: Path, view: bool, display: str = ":2"):
    if name == "kinematic":
        from faultline.world import KinematicWorld
        return KinematicWorld()
    from faultline.carla_world import CarlaWorld
    v = None
    if view:
        os.environ["DISPLAY"] = display
        from faultline.viewer import ChaseView
        v = ChaseView(out)
    return CarlaWorld(recorder_path=out / "recorder.log", view=v)


def print_summary(out: Path, m: dict) -> None:
    import json
    print(f"\nepisode {m['episode_id']}  world {m['world']}  status {m['status']}  collision {m['collision']}")
    print(f"decisions total {m['decisions_total']}  0g {m['decisions_0g']}  halt {m['decisions_halt']}  "
          f"log_head {m['log_head']}  chain_ok {verify_chain(out / 'decisions.jsonl', m['log_head'])}")
    met = json.loads((out / "metrics.json").read_text())
    print(f"ccs {met['ccs']:.4f}  min_ttc_s {met['min_ttc_s']}  min_gap_m {met['min_gap_m']}  "
          f"perception {met['perception']}")
    print(f"\n{'cp':>3} {'action':<10} {'source':<17} {'reason':<12} {'request_id':<40} {'provider':<44} latency_ms")
    for line in (out / "decisions.jsonl").read_text().splitlines():
        d = json.loads(line)
        print(f"{d['cp']:>3} {str(d['action']):<10} {d['source']:<17} {d['reason']:<12} {str(d['request_id']):<40} "
              f"{str(d['provider']):<44} {d['latency_ms']}")


def cmd_run(a) -> int:
    load_dotenv()
    out = Path(a.out or f"runs/{a.world}-{a.seed}-{time.strftime('%Y%m%dT%H%M%S')}")
    if out.exists() and any(out.iterdir()):
        sys.exit(f"refusing to overwrite {out}")
    out.mkdir(parents=True, exist_ok=True)
    if a.decider == "maintain":
        decider = MaintainBaseline()
    else:
        url = UNREACHABLE_URL if a.chaos == "unreachable" else (a.router_url or os.environ.get("ZG_ROUTER_URL"))
        key = os.environ.get("ZG_API_KEY")
        if not url or not key:
            sys.exit("ZG_ROUTER_URL and ZG_API_KEY must be set in .env")
        decider = ZgRouter(url, key, model=a.model)
    m = run_episode(make_world(a.world, out, a.view, a.display), decider, Scenario(seed=a.seed), out)
    print_summary(out, m)
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="faultline")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--world", choices=["carla", "kinematic"], default="carla")
    r.add_argument("--seed", type=int, default=42)
    r.add_argument("--out")
    r.add_argument("--model", default=DEFAULT_MODEL)
    r.add_argument("--router-url")
    r.add_argument("--chaos", choices=["none", "unreachable"], default="none")
    r.add_argument("--decider", choices=["0g", "maintain"], default="0g")
    r.add_argument("--view", action="store_true", help="chase-camera window + screen.mp4 (CARLA only)")
    r.add_argument("--display", default=":2", help="X display for --view (the VNC desktop)")
    r.set_defaults(fn=cmd_run)
    a = p.parse_args(argv)
    return a.fn(a)
