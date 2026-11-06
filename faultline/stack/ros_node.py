"""Example external ROS 2 stack: PdmLiteStack behind ROS topics, to prove the RosStack path end to end.

source viz/env.sh && .venv/bin/python -m faultline.stack.ros_node
Subscribes what RosStack publishes, answers each odometry message with one AckermannDriveStamped on
/faultline/stack/control. Only ROS messages cross: it has no CARLA connection. Throttle/brake are not an Ackermann
field, so it sends target speed + wheel angle (+ acceleration -8 when PDM-Lite brakes); RosStack converts locally.
"""
import math

import numpy as np

from faultline.rosbridge import _import_ros
from faultline.stack.interface import EgoState
from faultline.stack.mission import Mission
from faultline.stack.reference import PdmLiteStack

MAX_STEER_DEG = 70.0  # must match the ego's max wheel angle (RosStack divides by EgoState.max_steer_deg)


def main() -> None:
    _import_ros()
    import rclpy
    from ackermann_msgs.msg import AckermannDriveStamped
    from nav_msgs.msg import Odometry, Path
    from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
    from sensor_msgs.msg import PointCloud2

    rclpy.init()
    n = rclpy.create_node("pdm_lite_ros_stack")
    latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL, reliability=ReliabilityPolicy.RELIABLE)
    pub = n.create_publisher(AckermannDriveStamped, "/faultline/stack/control", 10)
    st = {"stack": None, "cloud": None}

    def on_route(msg):
        xyz = tuple((p.pose.position.x, -p.pose.position.y, p.pose.position.z) for p in msg.poses)
        s = PdmLiteStack()
        s.setup(Mission("ros", xyz[0], 0.0, xyz), "")
        st["stack"] = s
        n.get_logger().info(f"route received: {len(xyz)} poses")

    def on_cloud(msg):
        p = np.frombuffer(bytes(msg.data), dtype=np.float32).reshape(-1, 4).copy()
        p[:, 1] *= -1  # back to the CARLA sensor frame (y right)
        st["cloud"] = (msg.header.stamp.sec, p)

    def on_odom(msg):
        if st["stack"] is None:
            return
        q, pos = msg.pose.pose.orientation, msg.pose.pose.position
        yaw_map = 2 * math.atan2(q.z, q.w)
        e = EgoState(x=pos.x, y=-pos.y, z=pos.z, yaw_deg=-math.degrees(yaw_map), speed_mps=msg.twist.twist.linear.x,
                     max_steer_deg=MAX_STEER_DEG)
        obs = {"LIDAR": st["cloud"]} if st["cloud"] is not None else {}
        s = st["stack"]
        c = s.run_step(obs, e, msg.header.stamp.sec + msg.header.stamp.nanosec * 1e-9)
        out = AckermannDriveStamped()
        out.header = msg.header
        out.drive.speed = 0.0 if c.brake > 0 else float(s.pdm.target_speed_out)
        out.drive.acceleration = -8.0 * c.brake
        out.drive.steering_angle = -math.radians(c.steer * MAX_STEER_DEG)  # CARLA right-positive -> ROS left-positive
        pub.publish(out)

    n.create_subscription(Path, "/faultline/stack/route", on_route, latched)
    n.create_subscription(PointCloud2, "/faultline/stack/LIDAR", on_cloud, 5)
    n.create_subscription(Odometry, "/faultline/stack/odom", on_odom, 10)
    rclpy.spin(n)


if __name__ == "__main__":
    main()
