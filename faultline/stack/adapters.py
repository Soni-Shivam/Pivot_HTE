"""Adapters that turn existing stacks into an AVStack.

LeaderboardAgentStack wraps any CARLA Leaderboard-style agent (setup(path_to_conf_file), sensors(),
run_step(input_data, timestamp), destroy(), optional set_global_plan) by duck typing; leaderboard is never
imported. Interface read from carla_garage/leaderboard/leaderboard/autoagents/autonomous_agent.py and
agent_wrapper.py (MIT, CARLA). Faultline already produces observations in the Leaderboard input_data format.

RosStack drives a ROS 2 stack (Autoware, SeDriCa, ...): it publishes the declared sensors, odometry, TF, /clock,
the mission route (nav_msgs/Path) and the Lanelet2 map path, then waits up to the latency budget for one control
message (ackermann_msgs/AckermannDriveStamped or geometry_msgs/Twist). No control in time = full brake for that
step, counted as a stack timeout (not a crash).
"""
import math
import time

import numpy as np

from faultline.stack.interface import Control, EgoState, SensorSpec, ackermann_to_control, twist_to_control

LB_TYPES = {"sensor.lidar.ray_cast": "lidar", "sensor.camera.rgb": "camera", "sensor.other.gnss": "gnss",
            "sensor.other.imu": "imu", "sensor.speedometer": "odometry"}
POSE_KEYS = ("id", "type", "x", "y", "z", "roll", "pitch", "yaw", "reading_frequency")


class UnsupportedSensor(ValueError):
    pass


def from_leaderboard_sensor(d: dict, dt_s: float = 0.05) -> SensorSpec:
    if d["type"] not in LB_TYPES:  # radar / opendrive_map: not bridged yet
        raise UnsupportedSensor(f"{d.get('id')}: {d['type']} is not supported by the Faultline bridge yet")
    params = {k: str(v) for k, v in d.items() if k not in POSE_KEYS}
    return SensorSpec(id=d["id"], type=LB_TYPES[d["type"]], x=d.get("x", 0.0), y=d.get("y", 0.0), z=d.get("z", 0.0),
                      roll=d.get("roll", 0.0), pitch=d.get("pitch", 0.0), yaw=d.get("yaw", 0.0),
                      rate_hz=float(d.get("reading_frequency", 1 / dt_s)), params=params)


class LeaderboardAgentStack:
    """`agent`: an instance (or a class, built with (host, port, debug) like the Leaderboard does)."""

    def __init__(self, agent, path_to_conf_file: str = "", host: str = "127.0.0.1", port: int = 2000):
        self.agent = agent(host, port, False) if isinstance(agent, type) else agent
        self.conf = path_to_conf_file
        self.name = type(self.agent).__name__

    def sensors(self) -> list[SensorSpec]:
        return [from_leaderboard_sensor(d) for d in self.agent.sensors()]

    def setup(self, mission, hd_map_path: str) -> None:
        self.agent.setup(self.conf)
        if hasattr(self.agent, "set_global_plan") and mission.route_xyz:
            import carla
            world = [(carla.Transform(carla.Location(*p)), 4) for p in mission.route_xyz]  # 4 = RoadOption.LANEFOLLOW
            gps = [({"lat": g[0], "lon": g[1], "z": g[2]}, 4) for g in mission.route_gps]
            self.agent.set_global_plan(gps, world)

    def run_step(self, observations: dict, ego_state: EgoState, t_s: float) -> Control:
        c = self.agent.run_step(observations, t_s)
        return Control(float(c.throttle), float(c.brake), float(c.steer))

    def destroy(self) -> None:
        self.agent.destroy()


def control_from_msg(msg, ego: EgoState) -> Control:
    """AckermannDriveStamped (has .drive) or Twist (has .linear) -> Control."""
    if hasattr(msg, "drive"):
        d = msg.drive
        return ackermann_to_control(d.speed, d.steering_angle, ego, accel_mps2=d.acceleration)
    return twist_to_control(msg.linear.x, msg.angular.z, ego)


class RosStack:
    """ROS 2 side of the bridge. Topics (ROS_DOMAIN_ID from viz/env.sh, frame `map` = CARLA with y flipped, as in
    faultline/rosbridge.py): /faultline/stack/<sensor id> (PointCloud2 for lidar), /faultline/stack/odom
    (nav_msgs/Odometry), /tf (map->ego), /clock, /faultline/stack/route (nav_msgs/Path, latched),
    /faultline/stack/map_path (std_msgs/String, latched: the Lanelet2 .osm). Control in: /faultline/stack/control."""

    def __init__(self, sensors: list[SensorSpec], control_type: str = "ackermann", latency_budget_s: float = 0.2,
                 name: str = "ros2-stack"):
        assert control_type in ("ackermann", "twist")
        self._sensors, self.control_type, self.budget, self.name = sensors, control_type, latency_budget_s, name
        self.timeouts, self.steps, self._last = 0, 0, None

    def sensors(self) -> list[SensorSpec]:
        return list(self._sensors)

    def setup(self, mission, hd_map_path: str) -> None:
        from faultline.rosbridge import _import_ros
        _import_ros()
        import rclpy
        from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
        from nav_msgs.msg import Odometry, Path
        from geometry_msgs.msg import PoseStamped, TransformStamped, Twist
        from rosgraph_msgs.msg import Clock
        from sensor_msgs.msg import PointCloud2, PointField
        from std_msgs.msg import String
        from tf2_msgs.msg import TFMessage
        from ackermann_msgs.msg import AckermannDriveStamped
        self.M = dict(Odometry=Odometry, PointCloud2=PointCloud2, PointField=PointField, Clock=Clock, TFMessage=TFMessage,
                      TransformStamped=TransformStamped)
        if not rclpy.ok():
            rclpy.init()
        self.rclpy = rclpy
        n = self.node = rclpy.create_node("faultline_stack_bridge")
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL, reliability=ReliabilityPolicy.RELIABLE)
        self.pub = {s.id: n.create_publisher(PointCloud2, f"/faultline/stack/{s.id}", 5)
                    for s in self._sensors if s.type == "lidar"}
        self.pub["odom"] = n.create_publisher(Odometry, "/faultline/stack/odom", 10)
        self.pub["tf"] = n.create_publisher(TFMessage, "/tf", 10)
        self.pub["clock"] = n.create_publisher(Clock, "/clock", 10)
        route = Path()
        route.header.frame_id = "map"
        for x, y, z in mission.route_xyz:
            p = PoseStamped()
            p.header.frame_id = "map"
            p.pose.position.x, p.pose.position.y, p.pose.position.z = float(x), float(-y), float(z)
            route.poses.append(p)
        n.create_publisher(Path, "/faultline/stack/route", latched).publish(route)
        n.create_publisher(String, "/faultline/stack/map_path", latched).publish(String(data=str(hd_map_path)))
        typ = AckermannDriveStamped if self.control_type == "ackermann" else Twist
        n.create_subscription(typ, "/faultline/stack/control", lambda m: setattr(self, "_last", m), 10)

    def publish(self, observations: dict, e: EgoState, t_s: float) -> None:
        from faultline.rosbridge import CLOUD_FIELDS, lidar_points, yaw_quat
        M = self.M
        sec, nsec = int(t_s), int(round((t_s - int(t_s)) * 1e9))
        clk = M["Clock"]()
        clk.clock.sec, clk.clock.nanosec = sec, nsec
        self.pub["clock"].publish(clk)
        for sid, pub in ((k, v) for k, v in self.pub.items() if k in observations):
            raw = np.asarray(observations[sid][1], dtype=np.float32).tobytes()
            pts = lidar_points(raw)
            msg = M["PointCloud2"]()
            msg.header.stamp.sec, msg.header.stamp.nanosec, msg.header.frame_id = sec, nsec, sid
            msg.height, msg.width, msg.point_step, msg.is_dense = 1, len(pts), 16, True
            msg.row_step = 16 * len(pts)
            msg.fields = [M["PointField"](name=f, offset=o, datatype=7, count=1) for f, o in CLOUD_FIELDS]
            msg.data = pts.tobytes()
            pub.publish(msg)
        od = M["Odometry"]()
        od.header.stamp.sec, od.header.stamp.nanosec, od.header.frame_id, od.child_frame_id = sec, nsec, "map", "ego"
        p = od.pose.pose
        p.position.x, p.position.y, p.position.z = e.x, -e.y, e.z
        p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w = yaw_quat(e.yaw_deg)
        od.twist.twist.linear.x = e.speed_mps
        self.pub["odom"].publish(od)
        tf = M["TransformStamped"]()
        tf.header, tf.child_frame_id = od.header, "ego"
        tf.transform.translation.x, tf.transform.translation.y, tf.transform.translation.z = e.x, -e.y, e.z
        tf.transform.rotation = p.orientation
        self.pub["tf"].publish(M["TFMessage"](transforms=[tf]))

    def run_step(self, observations: dict, ego_state: EgoState, t_s: float) -> Control:
        self._last = None
        self.publish(observations, ego_state, t_s)
        self.steps += 1
        return self.wait_control(ego_state)

    def wait_control(self, ego_state: EgoState, clock=time.monotonic) -> Control:
        end = clock() + self.budget
        while self._last is None and clock() < end:
            self.rclpy.spin_once(self.node, timeout_sec=max(0.0, min(0.01, end - clock())))
        if self._last is None:
            self.timeouts += 1
            return Control(brake=1.0)  # stack timeout: brake this step
        return control_from_msg(self._last, ego_state)

    def destroy(self) -> None:
        if getattr(self, "node", None):
            self.node.destroy_node()
            self.node = None
