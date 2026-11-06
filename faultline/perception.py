"""Gap and closing speed to the lead vehicle from the ego's LiDAR point cloud (CARLA sensor frame: x fwd, y right, z up)."""
from collections import deque

import numpy as np


def corridor_gap(points: np.ndarray, front_offset_m: float, half_width_m: float = 1.4, z_min: float = -1.5,
                 z_max: float = 0.8, min_points: int = 3) -> float | None:
    """Bumper-to-bumper gap = 5th percentile of x over points in the ego's lane corridor, minus the sensor-to-bumper
    offset. None (never 0) when the corridor has fewer than `min_points` points."""
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    m = (x > 0) & (np.abs(y) <= half_width_m) & (z >= z_min) & (z <= z_max)
    if np.count_nonzero(m) < min_points:
        return None
    return float(np.percentile(x[m], 5)) - front_offset_m


class GapTracker:
    """Closing speed = negative least-squares slope over the last `window` consecutive valid gaps (≥ 3 needed)."""

    def __init__(self, window: int = 5, dt_s: float = 0.05):
        self.dt_s = dt_s
        self.gaps = deque(maxlen=window)

    def update(self, gap: float | None) -> tuple[float | None, float | None]:
        if gap is None:
            self.gaps.clear()
            return None, None
        self.gaps.append(gap)
        if len(self.gaps) < 3:
            return gap, None
        t = np.arange(len(self.gaps)) * self.dt_s
        return gap, -float(np.polyfit(t, np.array(self.gaps), 1)[0])
