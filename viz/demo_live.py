"""Live-visualization harness (no 0G): CARLA lead-brake run with the chase camera and the ROS 2 bridge.

The lead is driven by a local script, MAINTAIN until checkpoint 3 then BRAKE_HARD, labelled source
"scripted-baseline" in decisions.jsonl and on /faultline/decision. It is never 0G and never shown as 0G.

    source /opt/ros/jazzy/setup.bash && .venv/bin/python viz/demo_live.py [--horizon 15] [--no-view]
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


class ScriptedBrake:
    source = model = "scripted-baseline"

    def __init__(self, world, brake_from_cp=3):
        self.world, self.brake_from_cp = world, brake_from_cp

    def decide(self, obs, history, available):
        cp = obs["checkpoint"]
        action = "BRAKE_HARD" if cp >= self.brake_from_cp else "MAINTAIN"
        self.world.last_decision = {"cp": cp, "action": action, "source": self.source, "reason": "ok",
                                    "request_id": None, "latency_ms": 0}
        return Decision(action=action, reason="ok", request_id=None, provider=None, zg_res_key=None, model=self.model,
                        latency_ms=0, http_status=None, raw_sha256=None, content=None, ratelimit_remaining=None)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=float, default=15.0)
    ap.add_argument("--no-view", action="store_true")
    ap.add_argument("--display", default=":2")
    a = ap.parse_args()
    os.environ["DISPLAY"] = a.display
    from faultline.carla_world import CarlaWorld
    from faultline.rosbridge import RosBridge

    out = ROOT / "runs" / f"viz-demo-{time.strftime('%Y%m%dT%H%M%S')}"
    view = None
    if not a.no_view:
        from faultline.viewer import ChaseView
        view = ChaseView(out, record=False)
    world, bridge = CarlaWorld(view=view), RosBridge()
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
        m = run_episode(world, ScriptedBrake(world), Scenario(seed=42, horizon_s=a.horizon), out)
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
