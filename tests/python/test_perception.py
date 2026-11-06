import numpy as np
from faultline.perception import corridor_gap, GapTracker

def _box(x0, n=200):  # points on the rear face of a car at longitudinal x0, 1.8 m wide, 0.3..1.2 m above ground (sensor at 1.9 m → z in [-1.6, -0.7])
    rng = np.random.default_rng(0); return np.column_stack([np.full(n, x0) + rng.normal(0, 0.02, n), rng.uniform(-0.9, 0.9, n), rng.uniform(-1.6, -0.7, n), np.ones(n)]).astype(np.float32)

def _ground(n=2000):  # z = -1.9 ± 0.02, x in [2, 60], y in [-6, 6]
    rng = np.random.default_rng(1); return np.column_stack([rng.uniform(2, 60, n), rng.uniform(-6, 6, n), -1.9 + rng.normal(0, 0.02, n), np.ones(n)]).astype(np.float32)

def test_gap_ignores_ground_and_side_lane():
    pts = np.vstack([_ground(), _box(20.0), _box(12.0) + np.array([0, 3.6, 0, 0], np.float32)])  # second car one lane to the right
    assert abs(corridor_gap(pts, front_offset_m=2.4) - 17.6) < 0.1

def test_empty_corridor_is_none_not_zero():
    assert corridor_gap(_ground(), 2.4) is None and corridor_gap(_box(20.0)[:2], 2.4) is None

def test_tracker_closing_speed_and_reset():
    t = GapTracker(window=5, dt_s=0.05); out = [t.update(30.0 - 0.3 * i) for i in range(5)]   # 6 m/s closing
    assert out[0] == (30.0, None) and out[1][1] is None and abs(out[4][1] - 6.0) < 1e-6
    assert t.update(None) == (None, None) and t.update(28.0)[1] is None
