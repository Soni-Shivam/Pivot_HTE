import math

import pytest

from faultline.lanelet_export import lane_borders


def test_borders_flip_y_and_keep_physical_sides():
    # CARLA lane heading +x (yaw 0): CARLA right = +y_carla = -y_map, so the right bound sits at y_map < 0
    left, right, centre = lane_borders([(10.0, 5.0, 0.2, 0.0, 4.0)])
    assert centre == [(10.0, -5.0, 0.2)]
    assert left[0] == pytest.approx((10.0, -3.0, 0.2)) and right[0] == pytest.approx((10.0, -7.0, 0.2))


def test_roundtrip_tiny_map(tmp_path):
    pytest.importorskip("lanelet2", exc_type=ImportError)
    from faultline.lanelet_export import build_map, load, write
    lanes = {(1, 0, -1): [(float(i), 2.0, 0.0, 0.0, 3.5) for i in range(20)],
             (2, 0, -1): [(20.0 + 5 * math.cos(math.radians(a)), 7.0 - 5 * math.sin(math.radians(a)), 0.0, -a, 3.5)
                          for a in range(0, 91, 10)]}
    p = tmp_path / "tiny.osm"
    write(build_map(lanes), p)
    m = load(p)
    assert len(m.laneletLayer) == 2
    lt = next(x for x in m.laneletLayer if x.attributes["carla_id"] == "1/0/-1")
    mid = ((lt.leftBound[5].x + lt.rightBound[5].x) / 2, (lt.leftBound[5].y + lt.rightBound[5].y) / 2)
    assert math.hypot(mid[0] - 5.0, mid[1] + 2.0) < 0.01
    assert lt.leftBound[0].y > lt.rightBound[0].y  # left of a +x lane is +y in the right-handed map frame
