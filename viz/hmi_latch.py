#!/usr/bin/env python3
"""Long-lived helper started by viz/launch_viz.sh (display only):
- republishes the Lanelet2 map markers and the ego->lidar static TF every 2 s, so any viewer that connects or
  subscribes late (Lichtblick via foxglove_bridge did not get the one-shot latched copy) still has them;
- holds publishers for the HMI topics without publishing, so foxglove_bridge advertises them before the layout
  loads (Lichtblick's Indicator panels only bind topics present at load; same finding as SeDriCa's 4 s delay).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from faultline.rosbridge import HMI_SPEED_CARS, RosBridge, _import_ros, lidar_static_tf  # noqa: E402

_import_ros()
import rclpy  # noqa: E402
from rclpy.qos import DurabilityPolicy, QoSProfile  # noqa: E402
from sensor_msgs.msg import JointState  # noqa: E402
from std_msgs.msg import Bool, Float64, String  # noqa: E402
from tf2_msgs.msg import TFMessage  # noqa: E402
from visualization_msgs.msg import MarkerArray  # noqa: E402

rclpy.init()
node = rclpy.create_node("faultline_hmi_latch")
latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
map_pub = node.create_publisher(MarkerArray, "/faultline/lanelet_map", latched)
tf_pub = node.create_publisher(TFMessage, "/tf_static", latched)
hold = [node.create_publisher(Float64, f"/faultline/{n}", 10)
        for n in ("ego/speed", "ego/accel", "ego/steer", "adversary/speed", "gap_lidar", "gap_gt", "ttc")]
hold += [node.create_publisher(String, f"/faultline/{n}", 10) for n in ("adversary_action", "decision", "mode")]
hold.append(node.create_publisher(Bool, "/faultline/safe_halt", 10))
hold += [node.create_publisher(JointState, f"/faultline/hmi/{n}", 10)
         for n in ("gap", "ttc", *(f"speed/{c}" for c in HMI_SPEED_CARS))]
markers, tf = RosBridge()._lanelet_markers(), lidar_static_tf()


def tick():
    map_pub.publish(markers)
    tf_pub.publish(tf)


tick()
node.create_timer(2.0, tick)
try:
    rclpy.spin(node)
except KeyboardInterrupt:
    pass
