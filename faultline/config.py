"""Frozen scenario and stand-in SUT parameters (spec §5.1, §5.2)."""
import hashlib
import json
from dataclasses import asdict, dataclass


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True)
class Scenario:
    seed: int
    family: str = "lead_brake"
    version: str = "lead_brake_demo_v1"
    ego_speed_mps: float = 20.0
    lead_speed_mps: float = 20.0
    initial_gap_m: float = 35.0
    friction_mu: float = 0.8
    lead_max_brake_mps2: float = 6.0
    horizon_s: float = 30.0
    checkpoint_s: float = 1.0
    runup_s: float = 3.0
    dt_s: float = 0.05


@dataclass(frozen=True)
class IdmParams:
    desired_speed_mps: float = 20.0
    time_headway_s: float = 1.2
    min_gap_m: float = 2.0
    max_accel_mps2: float = 1.5
    comfort_decel_mps2: float = 3.0
    reaction_delay_s: float = 0.6


def scenario_hash(s: Scenario) -> str:
    return hashlib.sha256(canonical(asdict(s)).encode()).hexdigest()


DEMO = Scenario(seed=42)
