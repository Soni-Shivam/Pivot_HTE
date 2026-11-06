"""The contract any driving stack implements to be tested by Faultline.

Faultline owns the world, the adversary and the clock (synchronous stepping at the scenario's dt). The stack gets:
  * its own proprioception (EgoState: pose, speed, acceleration, dimensions) every step;
  * the mission (route, goal, time and speed limits) and the Lanelet2 map path once, in setup();
  * data only from the sensors it declares in sensors(): never a privileged list of other actors.
It returns one Control per step.

Observation format (the CARLA Leaderboard `input_data` format, so Leaderboard agents work unchanged):
  {sensor_id: (frame, data)}, data per type:
    lidar     np.float32 (N, 4) x, y, z, intensity in the sensor frame (CARLA: x forward, y right, z up)
    camera    np.uint8 (H, W, 4) BGRA
    gnss      np.float64 [lat, lon, alt]
    imu       np.float64 [accel x, y, z, gyro x, y, z, compass rad]
    odometry  {"speed": m/s}   (the Leaderboard's "sensor.speedometer")
"""
import math
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

SENSOR_BLUEPRINTS = {"lidar": "sensor.lidar.ray_cast", "camera": "sensor.camera.rgb", "gnss": "sensor.other.gnss",
                     "imu": "sensor.other.imu", "odometry": None}  # odometry = proprioception, no CARLA actor


@dataclass(frozen=True)
class SensorSpec:
    id: str
    type: str  # one of SENSOR_BLUEPRINTS
    x: float = 0.0  # mount pose in the ego frame (CARLA: m, deg; x forward, y right, z up)
    y: float = 0.0
    z: float = 0.0
    roll: float = 0.0
    pitch: float = 0.0
    yaw: float = 0.0
    rate_hz: float = 20.0
    params: dict = field(default_factory=dict)  # blueprint attributes, e.g. {"channels": "64"}


@dataclass(frozen=True)
class EgoState:
    x: float  # actor origin, CARLA world frame
    y: float
    z: float
    yaw_deg: float
    speed_mps: float
    accel_mps2: float = 0.0
    pitch_deg: float = 0.0
    roll_deg: float = 0.0
    length_m: float = 4.9
    width_m: float = 2.1
    height_m: float = 1.5
    bb_offset_x: float = 0.0  # bounding-box centre ahead of the actor origin
    max_steer_deg: float = 70.0  # front-wheel angle at steer = 1
    wheelbase_m: float = 2.9


@dataclass(frozen=True)
class Control:
    throttle: float = 0.0  # [0, 1]
    brake: float = 0.0  # [0, 1]
    steer: float = 0.0  # [-1, 1], positive = right (CARLA)

    def problems(self) -> list[str]:
        out = []
        for k, lo in (("throttle", 0.0), ("brake", 0.0), ("steer", -1.0)):
            v = getattr(self, k)
            if not isinstance(v, (int, float)) or math.isnan(v) or not lo <= v <= 1.0:
                out.append(f"{k}={v!r} outside [{lo:g}, 1]")
        return out


def ackermann_to_control(speed_mps: float, steering_angle_rad: float, ego: EgoState, accel_mps2: float = 0.0,
                         kp: float = 0.5, max_accel: float = 3.0, max_decel: float = 8.0) -> Control:
    """Target speed + front-wheel angle (ackermann_msgs convention: positive = left) -> pedal/steer, locally.
    Longitudinal: a = accel_mps2 if given, else kp * (target - v); throttle/brake scale against max_accel/max_decel."""
    a = accel_mps2 if accel_mps2 else kp * (speed_mps - ego.speed_mps)
    if speed_mps <= 0.0 and ego.speed_mps < 0.3:
        a = -max_decel  # hold the stop
    steer = -math.degrees(steering_angle_rad) / ego.max_steer_deg  # ROS left-positive -> CARLA right-positive
    return Control(throttle=min(max(a / max_accel, 0.0), 1.0), brake=min(max(-a / max_decel, 0.0), 1.0),
                   steer=min(max(steer, -1.0), 1.0))


def twist_to_control(v_mps: float, yaw_rate_rps: float, ego: EgoState, **kw) -> Control:
    """geometry_msgs/Twist (linear.x, angular.z; left-positive) via the bicycle model."""
    angle = math.atan(ego.wheelbase_m * yaw_rate_rps / v_mps) if abs(v_mps) > 0.1 else 0.0
    return ackermann_to_control(v_mps, angle, ego, **kw)


@runtime_checkable
class AVStack(Protocol):
    name: str

    def sensors(self) -> list[SensorSpec]: ...

    def setup(self, mission, hd_map_path: str) -> None: ...

    def run_step(self, observations: dict, ego_state: EgoState, t_s: float) -> Control: ...

    def destroy(self) -> None: ...
