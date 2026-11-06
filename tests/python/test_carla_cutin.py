import os

import pytest

from faultline.cutin import CutInScenario

pytestmark = [pytest.mark.carla,
              pytest.mark.skipif(os.environ.get("FAULTLINE_CARLA") != "1", reason="needs the CARLA server (FAULTLINE_CARLA=1)")]


def test_pdm_lite_on_lidar_handles_an_aggressive_cut_in_and_hard_brake():
    from faultline.carla_cutin import CutInCarlaWorld

    s = CutInScenario(seed=7)
    w = CutInCarlaWorld()
    try:
        w.reset(s)
        run = [w.tick() for _ in range(40)]  # run-up: lane keeping at the target speed, adversary tracked
        assert all(abs(x.ego_lat_m) < 0.3 for x in run) and 7.5 < run[-1].ego_v < 8.5
        assert run[-1].lidar_gap is None and len(w.tracks) == 1 and abs(w.tracks[0].l - 3.5) < 0.3
        assert abs(w.tracks[0].speed - 9.0) < 1.5
        w.command_adversary("CUT_IN_AGGRESSIVE")
        cut = [w.tick() for _ in range(20)]
        w.command_adversary("BRAKE_HARD")
        brake = [w.tick() for _ in range(80)]
        assert cut[-1].gt_in_path and cut[-1].lidar_gap is not None and abs(cut[-1].lidar_gap - cut[-1].gt_gap) < 1.0, \
            [(x.t_s, x.adv_lat_m, x.gt_gap, x.lidar_gap) for x in cut]
        assert w.pdm.leading_ids == [w.tracks[0].id]
        assert max(x.ego_brake for x in brake) == 1.0 and brake[-1].ego_v < 1.0
        assert not any(x.collision for x in run + cut + brake) and min(x.gt_gap for x in brake) > 1.0
    finally:
        w.close()
    assert w.world.get_settings().synchronous_mode is False
