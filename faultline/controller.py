"""Stand-in SUT (IDM follower with reaction delay) and the lead's longitudinal controller (spec §5.1).
Only + - * / min max sqrt, so trajectories are bit-identical across machines (spec §5.2)."""
import math
from collections import deque

from faultline.config import IdmParams

G = 9.81


class IdmFollower:
    def __init__(self, p: IdmParams, dt_s: float, mu: float = 0.8):
        self.p = p
        self.a_min = -0.8 * G * mu
        self.fifo = deque(maxlen=round(p.reaction_delay_s / dt_s) + 1)

    def observe(self, gap: float, v_lead: float) -> tuple[float, float]:
        """Push the sensed pair, return the one sensed `reaction_delay_s` ago (the oldest until the buffer fills)."""
        self.fifo.append((gap, v_lead))
        return self.fifo[0]

    def accel(self, v_ego: float, gap: float, v_lead: float) -> float:
        p = self.p
        s_star = p.min_gap_m + v_ego * p.time_headway_s + v_ego * (v_ego - v_lead) / (
            2 * math.sqrt(p.max_accel_mps2 * p.comfort_decel_mps2))
        r = v_ego / p.desired_speed_mps
        q = s_star / max(gap, 0.1)
        a = p.max_accel_mps2 * (1 - r * r * r * r - q * q)
        return min(max(a, self.a_min), p.max_accel_mps2)


class LeadLongitudinal:
    def __init__(self, dt_s: float):
        self.dt_s = dt_s
        self.decel = None  # None = MAINTAIN

    def set_decel(self, decel_mps2: float | None) -> None:
        self.decel = decel_mps2 or None

    def step(self, v_now: float, v_hold: float) -> float:
        if self.decel is None:
            return min(max(0.8 * (v_hold - v_now), -1.0), 1.5)
        return -self.decel if v_now > 0.05 else 0.0
