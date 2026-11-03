"""Component profile registry (spec 2.2)."""
from __future__ import annotations

from app.engineering.profiles.alloy_wheel import AlloyWheelProfile
from app.engineering.profiles.base import ComponentProfile
from app.schemas.common import ComponentType

_PROFILES: dict[ComponentType, ComponentProfile] = {}


def register(profile: ComponentProfile) -> None:
    _PROFILES[profile.component_type] = profile


register(AlloyWheelProfile())

try:  # Registered as they are implemented; the wheel slice never depends on them.
    from app.engineering.profiles.brake_caliper import BrakeCaliperProfile

    register(BrakeCaliperProfile())
except ImportError:  # pragma: no cover
    pass

try:
    from app.engineering.profiles.spark_plug import SparkPlugProfile

    register(SparkPlugProfile())
except ImportError:  # pragma: no cover
    pass


def get_profile(component_type: ComponentType) -> ComponentProfile:
    try:
        return _PROFILES[component_type]
    except KeyError as exc:
        raise KeyError(
            f"no profile registered for {component_type}; "
            f"registered: {[c.value for c in _PROFILES]}"
        ) from exc


def available_profiles() -> list[ComponentProfile]:
    return list(_PROFILES.values())


def available_component_types() -> list[ComponentType]:
    return list(_PROFILES.keys())
