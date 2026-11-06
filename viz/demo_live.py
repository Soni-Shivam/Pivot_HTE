"""Live-visualization harness (no 0G): CARLA lead-brake run with the chase camera and the ROS 2 bridge.

The adversary is driven by a local script, labelled source "scripted-baseline" in decisions.jsonl and on
/faultline/decision; it is never 0G and never shown as 0G.
  lead_brake: MAINTAIN until checkpoint --brake-cp, then BRAKE_HARD (IDM ego, kinematic placement)
  cut_in:     KEEP_LANE, CUT_IN_AGGRESSIVE at checkpoint --brake-cp, then BRAKE_HARD (PDM-Lite ego on LiDAR)

    source viz/env.sh && .venv/bin/python viz/demo_live.py [--family cut_in] [--horizon 15] [--no-view]
"""
import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from faultline.config import Scenario  # noqa: E402
from faultline.episode import run_episode  # noqa: E402
from faultline.router import Decision  # noqa: E402

LOG = ROOT / "runs" / "agent-live.log"


class Scripted:
    source = model = "scripted-baseline"

    def __init__(self, plan):
        self.plan = plan  # cp -> action

    def decide(self, obs, history, available):
        action = self.plan(obs["checkpoint"])
        action = action if action in available else available[0]
        return Decision(action=action, reason="ok", request_id=None, provider=None, zg_res_key=None, model=self.model,
                        latency_ms=0, http_status=None, raw_sha256=None, content=None, ratelimit_remaining=None)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--family", choices=["lead_brake", "cut_in"], default="lead_brake")
    ap.add_argument("--horizon", type=float, default=15.0)
    ap.add_argument("--brake-cp", type=int, default=3, help="first checkpoint with BRAKE_HARD")
    ap.add_argument("--no-view", action="store_true")
    ap.add_argument("--display", default=":2")
    a = ap.parse_args()
    os.environ["DISPLAY"] = a.display
    from faultline.carla_cutin import CutInCarlaWorld
    from faultline.carla_world import CarlaWorld
    from faultline.cutin import CutInScenario
    from faultline.rosbridge import RosBridge

    out = ROOT / "runs" / f"viz-demo-{time.strftime('%Y%m%dT%H%M%S')}"
    view = None
    if not a.no_view:
        from faultline.viewer import ChaseView
        view = ChaseView(out, record=False)
    cut = a.family == "cut_in"
    world, bridge = (CutInCarlaWorld if cut else CarlaWorld)(view=view), RosBridge()
    reset = world.reset

    def reset_then_attach(s):  # the bridge needs the actors and wraps the on_tick hook ChaseView set in reset
        try:
            reset(s)
            bridge.attach(world)
        except BaseException:
            world.close()  # run_episode only closes the world once reset has returned
            raise
    world.reset = reset_then_attach

    t0 = time.monotonic()
    try:
        if cut:
            s = CutInScenario(seed=42, horizon_s=a.horizon)
            plan = lambda cp: "KEEP_LANE" if cp < a.brake_cp else "CUT_IN_AGGRESSIVE" if cp == a.brake_cp else "BRAKE_HARD"
        else:
            s = Scenario(seed=42, horizon_s=a.horizon)
            plan = lambda cp: "MAINTAIN" if cp < a.brake_cp else "BRAKE_HARD"
        m = run_episode(world, Scripted(plan), s, out)
    finally:
        bridge.close()  # run_episode already closed the world (async mode restored, actors destroyed)
    wall, st = time.monotonic() - t0, bridge.stats()
    line = (f"[viz-agent] demo_live {out.name}: status {m['status']}, {st['ticks']} ticks in {wall:.1f} s wall, "
            f"bridge publish mean {st['mean_ms']:.2f} ms p95 {st['p95_ms']:.2f} ms max {st['max_ms']:.2f} ms per tick")
    print(line)
    with LOG.open("a") as f:
        f.write(f"  {time.strftime('%H:%M:%S')} {line}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
