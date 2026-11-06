"""World interface and the 1-D kinematic world used by tests and as the demo fallback."""
from dataclasses import dataclass
from typing import Protocol

from faultline.config import IdmParams, Scenario
from faultline.controller import G, IdmFollower, LeadLongitudinal

EGO_LEN_M, LEAD_LEN_M = 4.9, 4.7
HALF_LENS_M = (EGO_LEN_M + LEAD_LEN_M) / 2


@dataclass
class TickState:
    t_s: float
    ego_x: float
    ego_v: float
    ego_a: float
    lead_x: float
    lead_v: float
    lead_a: float
    gt_gap: float
    lidar_gap: float | None
    lidar_closing: float | None
    collision: bool


class World(Protocol):
    t_s: float

    def reset(self, s: Scenario) -> None: ...

    def tick(self) -> TickState: ...

    def set_lead_decel(self, decel_mps2: float | None) -> None: ...  # None = MAINTAIN

    def close(self) -> None: ...


class KinematicWorld:
    """Semi-implicit Euler at dt_s. The ego senses the true gap and lead speed through the reaction-delay FIFO;
    the 'LiDAR' gap is exact."""

    name = "kinematic"

    def __init__(self, s: Scenario | None = None, idm: IdmParams = IdmParams()):
        self.idm_params = idm
        if s is not None:
            self.reset(s)

    def reset(self, s: Scenario) -> None:
        self.s = s
        self.t_s = 0.0
        self.ego_x, self.ego_v = 0.0, s.ego_speed_mps
        self.lead_x, self.lead_v = s.initial_gap_m + HALF_LENS_M, s.lead_speed_mps
        self.v_hold = s.lead_speed_mps
        self.idm = IdmFollower(self.idm_params, s.dt_s, s.friction_mu)
        self.lead = LeadLongitudinal(s.dt_s)

    def set_lead_decel(self, decel_mps2: float | None) -> None:
        if decel_mps2:
            decel_mps2 = min(decel_mps2, 0.8 * G * self.s.friction_mu)
        else:
            self.v_hold = self.lead_v  # MAINTAIN holds the current speed
        self.lead.set_decel(decel_mps2)

    def tick(self) -> TickState:
        dt = self.s.dt_s
        gap = self.lead_x - self.ego_x - HALF_LENS_M
        ego_a = self.idm.accel(self.ego_v, *self.idm.observe(gap, self.lead_v))
        lead_a = self.lead.step(self.lead_v, self.v_hold)
        self.ego_v = max(0.0, self.ego_v + ego_a * dt)
        self.lead_v = max(0.0, self.lead_v + lead_a * dt)
        self.ego_x += self.ego_v * dt
        self.lead_x += self.lead_v * dt
        self.t_s = round(self.t_s + dt, 6)
        gap = self.lead_x - self.ego_x - HALF_LENS_M
        return TickState(self.t_s, self.ego_x, self.ego_v, ego_a, self.lead_x, self.lead_v, lead_a, gap,
                         gap, self.ego_v - self.lead_v, gap <= 0)

    def close(self) -> None:
        pass
