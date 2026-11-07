"""CARLA world and runner for the swarm prototype (swarm_v3): CutInCarlaWorld (PDM-Lite ego on its own LiDAR; the taxi is
car B) plus cars A, C, D, all kinematic (physics off), coloured per car, placed every tick on the route shifted by
their lateral offset. The episode loop, parser, guard and planner are faultline.swarm's; the director video, ROS
bridge and desktop recording are display only.

    source viz/env.sh && .venv/bin/python -m faultline.carla_swarm --out runs/swarm-carla-002 --ros [--avoid "Pincer"]
"""
import json
import os
import subprocess
import time
from pathlib import Path

import carla

from faultline import cutin
from faultline.carla_cutin import CutInCarlaWorld
from faultline.director import BLUEPRINTS, COLORS
from faultline.swarm import SwarmCar, guard, nearest_state

ROOT = Path(__file__).resolve().parent.parent


class SwarmCarlaWorld(CutInCarlaWorld):
    name = "carla-0.10.0-swarm"

    def __init__(self, *a, director=None, **kw):
        super().__init__(*a, **kw)
        self.director, self.car_actors, self.advs, self.guarded = director, {}, {}, []

    def _reset(self, s) -> None:  # inside CutInCarlaWorld.reset's cleanup-on-failure, so extra spawns are covered too
        super()._reset(s)  # flock, sync mode, ego, LiDAR, car B (self.lead / self.adv)
        bl = self.world.get_blueprint_library()
        ego_arc, _ = self._ego_sl()
        self.dim, self.off = {"B": (self.adv_len, self.adv_wid)}, {"B": self.adv_off}
        self.car_actors, self.advs = {}, {}
        for c, lat, dx, v in s.cars:
            if c == "B":  # the base world's taxi, driven by a SwarmCar (swarm_v3 primitives)
                self.adv = SwarmCar(s, arc=ego_arc + dx, v=v, lat=lat)
                self.advs[c] = self.adv
                continue
            bp = bl.find(BLUEPRINTS[c][0])
            if BLUEPRINTS[c][1] and bp.has_attribute("color"):
                bp.set_attribute("color", BLUEPRINTS[c][1])
            t = self._lateral(self._pose(ego_arc + dx), lat)
            t.location.z += 30.0  # spawn clear of the base taxi's initial pose; _place_all() puts it on the road
            a = self.world.spawn_actor(bp, t)
            self.actors.append(a)  # destroyed by close() with the rest
            a.set_simulate_physics(False)
            bb = a.bounding_box
            self.car_actors[c], self.dim[c], self.off[c] = a, (2 * bb.extent.x, 2 * bb.extent.y), -bb.location.x
            self.advs[c] = SwarmCar(s, arc=ego_arc + dx, v=v, lat=lat)
        self._place_all()
        self.guarded = []
        if self.director:
            self.director.attach(self)

    def dims(self, c):
        return (self.ego_len, self.ego_wid) + self.dim[c]

    @property
    def control_label(self) -> str:
        return " ".join(f"{c}:{a.mode}" for c, a in self.advs.items()) if self.advs else "-"

    def _place_all(self) -> None:
        cmds = []
        for c, act in self.car_actors.items():
            a = self.advs[c]
            cmds.append(carla.command.ApplyTransform(act.id, self._lateral(self._pose(a.arc + self.off[c]), a.lat,
                                                                           a.rel_yaw_deg)))
        self._place_adv()
        self.client.apply_batch_sync(cmds, False)

    def tick(self):
        prev = {c: a.v for c, a in self.advs.items()}
        ego_arc, ego_lat = self._ego_sl()
        for c, a in self.advs.items():
            a.steer(ego_arc, self.ego.get_velocity().length(), self.ego_len, self.dim[c][0])
        saved = guard(self.advs, -cutin.action_accel("BRAKE_HARD", self.s),
                      (ego_arc, ego_lat, self.ego.get_velocity().length()))
        for c, a in self.advs.items():
            if c != "B":
                a.step(self.s.dt_s)
        self._place_all()
        on_tick, self.on_tick = self.on_tick, None  # the base tick's on_tick would see the B-only state
        try:
            st = super().tick()  # steps and places B, ticks CARLA, LiDAR -> tracker -> PDM-Lite
        finally:
            self.on_tick = on_tick
        for c, acc in saved.items():
            self.advs[c].a = acc
        self.guarded = sorted(saved)
        out = nearest_state(st.t_s, st.ego_x, st.ego_lat_m, st.ego_v, st.ego_a, self.advs, prev, self.dims,
                            st.lidar_gap, st.lidar_closing, st.collision, st.n_tracks,
                            (st.ego_steer, st.ego_throttle, st.ego_brake), dt=self.s.dt_s)
        self.collided = out.collision
        if self.on_tick:
            self.on_tick(self, out)
        return out

    def close(self) -> None:
        try:
            if self.director:
                self.director.close()
        finally:
            super().close()


def swarm_bridge():
    """RosBridge that also publishes a ground-truth box per car (colour, id, current action) in RViz."""
    from faultline.rosbridge import RosBridge

    class SwarmRosBridge(RosBridge):
        def on_tick(self, world, st) -> None:
            super().on_tick(world, st)
            stamp = self._stamp(st.t_s)
            gt = self._gt_box(world.ego, "gt", 0, (0.2, 0.9, 0.3, 0.35), stamp, "EGO (AV stack)")
            actors = {"B": world.lead, **world.car_actors}
            for i, c in enumerate(sorted(actors), start=1):
                r, g, b = (x / 255 for x in COLORS[c])
                gt += self._gt_box(actors[c], "gt", i, (r, g, b, 0.45), stamp,
                                   f"{c} {world.advs[c].mode} {world.advs[c].v:.1f} m/s")
            self.pub["gt"].publish(self.M["MarkerArray"](markers=gt))
            from std_msgs.msg import String
            self.pub["adversary_action"].publish(String(data=world.control_label))

    return SwarmRosBridge()


def log_live(msg: str) -> None:
    with open(ROOT / "runs" / "agent-live.log", "a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} [swarm-agent] {msg}\n")


def main(argv=None) -> int:
    import argparse

    from faultline.cli import load_dotenv
    from faultline.director import Director, decisions_html
    from faultline.stitch import DeskRecorder, find_windows, stitch
    from faultline.swarm import JointRouter, PlannerRouter, SwarmScenario, run_planner, run_swarm_episode, summary
    p = argparse.ArgumentParser(prog="faultline.carla_swarm")
    p.add_argument("--out", required=True)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--avoid", default="", help="comma-separated plan names the planner must not reuse")
    p.add_argument("--ros", action="store_true", help="publish to ROS 2 (source viz/env.sh first)")
    p.add_argument("--display", default=":2", help="desktop to record for the stitched video ('' = none)")
    p.add_argument("--elite", help="campaign episode dir: re-run its start and its recorded 0G plan (no new plan "
                                   "call); the executor still decides live")
    p.add_argument("--lookahead", type=int, choices=(0, 1), default=1)
    a = p.parse_args(argv)
    load_dotenv()
    out = Path(a.out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"refusing to overwrite {out}")
    out.mkdir(parents=True, exist_ok=True)
    url, key = os.environ["ZG_ROUTER_URL"], os.environ["ZG_API_KEY"]
    s, elite = SwarmScenario(seed=a.seed), None
    if a.elite:
        elite = Path(a.elite)
        sd = json.loads((elite / "scenario.json").read_text())
        s = SwarmScenario(**{**sd, "cars": tuple(tuple(c) for c in sd["cars"])})
    desk = None
    if a.display:
        (out / "windows.json").write_text(json.dumps(find_windows(a.display)) + "\n")
        desk = DeskRecorder(out / "desk.mkv", a.display).start()
    try:
        if elite:  # the elite's own 0G plan entry (request id, content hash), marked as reused, not re-asked
            pe = {**json.loads((elite / "plan.json").read_text()), "reused_from": str(elite)}
            (out / "plan.json").write_text(json.dumps(pe, indent=2, sort_keys=True) + "\n")
        else:
            pe = run_planner(PlannerRouter(url, key), s, out, [x for x in a.avoid.split(",") if x])
        log_live(f"{out.name} plan: {(pe.get('plan') or {}).get('name')} ({pe['source']}, req {pe.get('request_id')}, "
                 f"{pe.get('latency_ms')} ms)")
        world = SwarmCarlaWorld(recorder_path=out / "recorder.log", director=Director(out))
        bridge = None
        if a.ros:
            bridge, reset = swarm_bridge(), world.reset
            world.reset = lambda sc: (reset(sc), bridge.attach(world))
        try:
            run_swarm_episode(world, JointRouter(url, key), s, out, lookahead=bool(a.lookahead), plan_entry=pe)
        finally:
            if bridge:
                bridge.close()
    finally:
        if desk:
            time.sleep(1.0)
            desk.stop()
    if elite:
        mp = out / "manifest.json"
        mp.write_text(json.dumps({**json.loads(mp.read_text()), "elite_of": str(elite)}, sort_keys=True, indent=2) + "\n")
    decisions_html(out)
    summary(out)
    if desk and (out / "desk.mkv").exists():
        try:
            stitch(out)
        except (OSError, ValueError, subprocess.CalledProcessError) as e:
            print("stitch failed:", e)
    m = json.loads((out / "manifest.json").read_text())
    gt = json.loads((out / "metrics.json").read_text())["ground_truth"]
    log_live(f"{out.name} done: plan {m.get('plan_name')}, {m['decisions_0g']} 0G / {m['decisions_halt']} halt, "
             f"collision {m['collision']}, GT CCS {gt['ccs']:.2f}, min gap {gt['min_gap_in_path_m']}, "
             f"min TTC {gt['min_ttc_s']}; director.mp4 stitched.mp4 decisions.html; not anchored")
    subprocess.run(["python3", str(ROOT / "scripts" / "video_index.py")], check=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
