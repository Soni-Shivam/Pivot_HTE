import os

import pytest

from faultline.config import DEMO

pytestmark = [pytest.mark.carla,
              pytest.mark.skipif(os.environ.get("FAULTLINE_CARLA") != "1", reason="needs the CARLA server (FAULTLINE_CARLA=1)")]


def test_carla_world_maintain_then_brake_hard():
    from faultline.carla_world import CarlaWorld

    w = CarlaWorld()
    try:
        w.reset(DEMO)
        st = [w.tick() for _ in range(60)]
        assert all(abs(s.gt_gap - 35) < 3 for s in st), [round(s.gt_gap, 2) for s in st]
        good = [s for s in st if s.lidar_gap is not None and abs(s.lidar_gap - s.gt_gap) <= 1.5]
        assert len(good) >= 0.8 * len(st)
        assert all(15 <= s.ego_v <= 22 for s in st), [round(s.ego_v, 2) for s in st]
        w.set_lead_decel(6.0)
        br = [w.tick() for _ in range(40)]
        assert br[-1].lead_v < st[-1].lead_v - 8
        assert br[-1].lidar_closing is not None and br[-1].lidar_closing > 3
        assert not any(s.collision for s in st + br)
    finally:
        w.close()
    assert w.world.get_settings().synchronous_mode is False
