import math
import os
import struct

import numpy as np
import pytest

from faultline.rosbridge import CLOUD_FIELDS, decision_line, lidar_points, mode_of, to_map, ttc, yaw_quat


def _ros():
    try:
        from faultline.rosbridge import _import_ros
        _import_ros()
        return True
    except (RuntimeError, ImportError):
        return False


def test_to_map_flips_y():
    assert to_map(1.0, 2.0, 3.0) == (1.0, -2.0, 3.0)


def test_yaw_quat_right_handed():
    # CARLA yaw +90 deg points along +y_carla = -y_map, i.e. yaw_map = -90 deg
    x, y, z, w = yaw_quat(90.0)
    assert (x, y) == (0.0, 0.0) and z == pytest.approx(-math.sqrt(0.5)) and w == pytest.approx(math.sqrt(0.5))
    assert yaw_quat(0.0) == (0.0, 0.0, 0.0, 1.0)


def test_lidar_points_layout_and_y_flip():
    raw = np.array([[1, 2, 3, 0.5], [4, -5, 6, 0.25]], dtype=np.float32).tobytes()
    p = lidar_points(raw)
    assert p.dtype == np.float32 and p.shape == (2, 4)
    assert p.tolist() == [[1, -2, 3, 0.5], [4, 5, 6, 0.25]]
    b = p.tobytes()  # what goes into PointCloud2.data, point_step 16 at the CLOUD_FIELDS offsets
    assert dict(CLOUD_FIELDS) == {"x": 0, "y": 4, "z": 8, "intensity": 12}
    assert struct.unpack_from("<4f", b, 16) == (4.0, 5.0, 6.0, 0.25)


def test_mode_ttc_and_decision_line():
    assert mode_of(None, 1.0, 3.0, stalled=True) == "RUNUP"
    assert mode_of(None, 3.0, 3.0, stalled=True) == "AWAITING_0G"
    d = {"cp": 3, "action": "BRAKE_HARD", "source": "0g", "request_id": "ffa5d00d1234", "latency_ms": 2215}
    assert mode_of(d, 6.0, 3.0, stalled=False) == "EXECUTING"
    assert mode_of({**d, "action": None, "source": "none"}, 6.0, 3.0, stalled=True) == "SAFE_HALT"
    assert decision_line(d) == "cp 3 · BRAKE_HARD · 0g · req ffa5d0… · 2215 ms"
    assert ttc(20.0, 4.0) == 5.0 and math.isnan(ttc(20.0, 0.0)) and math.isnan(ttc(None, 3.0))


@pytest.mark.carla
@pytest.mark.skipif(os.environ.get("FAULTLINE_CARLA") != "1", reason="needs the CARLA server (FAULTLINE_CARLA=1)")
@pytest.mark.skipif(not _ros(), reason="needs ROS 2 (source /opt/ros/jazzy/setup.bash)")
def test_bridge_publishes_lidar_cloud():
    import rclpy
    from sensor_msgs.msg import PointCloud2

    from faultline.carla_world import CarlaWorld
    from faultline.config import DEMO
    from faultline.rosbridge import RosBridge

    w, bridge, got, sub = CarlaWorld(), RosBridge(), [], None
    try:
        w.reset(DEMO)
        bridge.attach(w)
        sub = rclpy.create_node("faultline_test_sub")
        sub.create_subscription(PointCloud2, "/faultline/lidar", got.append, 5)
        for _ in range(40):
            w.tick()
            rclpy.spin_once(sub, timeout_sec=0.05)
            if got:
                break
    finally:
        if sub:
            sub.destroy_node()
        bridge.close()
        w.close()
    assert got, "no PointCloud2 on /faultline/lidar"
    m = got[-1]
    assert m.header.frame_id == "lidar" and m.point_step == 16 and m.width > 1000
    assert w.world.get_settings().synchronous_mode is False
