import math, numpy as np
from faultline.metrics.kinematics import ttc_1d, thw, drac
from faultline.metrics.ccs_v2 import score, score_episode, badge, Thresholds

def test_kinematics_car_following():
    assert math.isclose(float(ttc_1d(np.array(21.0), np.array(5.6))), 3.75)  # 21/5.6 is 3.7500000000000004 in IEEE-754
    assert float(thw(np.array(21.0), np.array(23.1))) == 21.0 / 23.1
    assert math.isclose(float(drac(np.array(21.0), np.array(5.6))), 5.6**2 / 42.0)
    assert float(ttc_1d(np.array(21.0), np.array(-1.0))) == 60.0   # opening: clipped, not negative
    assert float(drac(np.array(21.0), np.array(-1.0))) == 0.0

def test_ccs_midpoints_and_fuzzy_or():
    b = score(drac=4.0, ttc2d=1.5, thw=1.0)
    assert all(math.isclose(v, 0.5, abs_tol=1e-9) for v in b.components.values())
    assert math.isclose(b.ccs, 1 - 0.5**3)
    assert score(None, None, None).ccs == 0.0
    assert score(drac=1e9, ttc2d=1e9, thw=1e9).ccs == 1.0 - (1.0 - 1.0) * 0.0  # no OverflowError, drac saturates to 1

def test_episode_is_max_over_steps_and_badge():
    ep = score_episode([0.5, 6.0, 0.5], [10.0, 1.2, 10.0], [3.0, 0.8, 3.0])
    assert ep["peak_step"] == 1 and badge(ep["ccs"]) == "red" and Thresholds().ttc2d_k == 4.0
