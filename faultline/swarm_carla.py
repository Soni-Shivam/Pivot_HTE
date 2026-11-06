"""CARLA world for the swarm_box_v1 prototype: CutInCarlaWorld (PDM-Lite ego on its own LiDAR, kinematic taxi = car
B in the left lane) plus car A, a kinematic Dodge Charger in the ego's lane. Adapter only; the base class is unchanged."""
import carla

from faultline import cutin
from faultline.carla_cutin import CutInCarlaWorld
from faultline.cutin import CutInAdversary
from faultline.swarm import guard, nearest_state


class SwarmCarlaWorld(CutInCarlaWorld):
    name = "carla-0.10.0-swarm-box"

    def reset(self, s) -> None:
        super().reset(s)  # flock, sync mode, ego, LiDAR, car B (self.lead / self.adv), viewer
        bl = self.world.get_blueprint_library()
        ego_arc, _ = self._ego_sl()
        t = self._pose(ego_arc + self.ego_len / 2 + s.a_gap_m + 2.5)
        t.location.z += 0.5
        self.car_a = self.world.spawn_actor(bl.find("vehicle.dodge.charger"), t)
        self.actors.append(self.car_a)  # destroyed by close() with the rest
        self.car_a.set_simulate_physics(False)
        ab = self.car_a.bounding_box
        self.a_len, self.a_wid, self.a_off = 2 * ab.extent.x, 2 * ab.extent.y, -ab.location.x
        self.advs = {"A": CutInAdversary(s, arc=ego_arc + self.ego_len / 2 + s.a_gap_m + self.a_len / 2,
                                         v=s.a_speed_mps, lat=0.0), "B": self.adv}
        self._place_a()
        self.guarded = []

    def dims(self, c):
        return (self.ego_len, self.ego_wid) + ((self.a_len, self.a_wid) if c == "A" else (self.adv_len, self.adv_wid))

    @property
    def control_label(self) -> str:
        return " ".join(f"{c}:{a.mode}" for c, a in self.advs.items()) if getattr(self, "advs", None) else "-"

    def _place_a(self) -> None:
        a = self.advs["A"]
        t = self._lateral(self._pose(a.arc + self.a_off), a.lat, a.rel_yaw_deg)
        self.client.apply_batch_sync([carla.command.ApplyTransform(self.car_a.id, t)], False)

    def tick(self):
        prev = {c: a.v for c, a in self.advs.items()}
        saved = guard(self.advs, -cutin.action_accel("BRAKE_HARD", self.s))
        self.advs["A"].step(self.s.dt_s)
        self._place_a()
        st = super().tick()  # steps and places B, ticks CARLA, LiDAR -> tracker -> PDM-Lite, B-only ground truth
        for c, acc in saved.items():
            self.advs[c].a = acc
        self.guarded = sorted(saved)
        out = nearest_state(st.t_s, st.ego_x, st.ego_lat_m, st.ego_v, st.ego_a, self.advs, prev, self.dims,
                            st.lidar_gap, st.lidar_closing, st.collision, st.n_tracks,
                            (st.ego_steer, st.ego_throttle, st.ego_brake), dt=self.s.dt_s)
        self.collided = out.collision
        return out
