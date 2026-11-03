"""Explicit unit handling.

Canonical analysis units (spec 4.1) are SI base units:

    length m | force N | stress Pa | mass kg | density kg/m^3
    temperature K | conductivity W/(m·K) | heat flux W/m^2 | pressure Pa

Every numeric engineering value crossing a service boundary carries a unit via
:class:`Quantity`. Bare unlabelled numbers are never exchanged.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Final

CANONICAL: Final[dict[str, str]] = {
    "length": "m",
    "area": "m2",
    "volume": "m3",
    "force": "N",
    "stress": "Pa",
    "pressure": "Pa",
    "mass": "kg",
    "density": "kg/m3",
    "temperature": "K",
    "temperature_gradient": "K/m",
    "thermal_conductivity": "W/(m·K)",
    "specific_heat": "J/(kg·K)",
    "heat_flux": "W/m2",
    "heat_transfer_coefficient": "W/(m²·K)",
    "power": "W",
    "energy": "J",
    "angle": "rad",
    "dimensionless": "-",
}

# factor converts a value in the given unit INTO the canonical unit.
_LINEAR: Final[dict[str, tuple[str, float]]] = {
    # length
    "m": ("length", 1.0),
    "mm": ("length", 1e-3),
    "cm": ("length", 1e-2),
    "in": ("length", 0.0254),
    "inch": ("length", 0.0254),
    # area
    "m2": ("area", 1.0),
    "mm2": ("area", 1e-6),
    # volume
    "m3": ("volume", 1.0),
    "mm3": ("volume", 1e-9),
    "cm3": ("volume", 1e-6),
    # force
    "N": ("force", 1.0),
    "kN": ("force", 1e3),
    # stress / pressure
    "Pa": ("stress", 1.0),
    "kPa": ("stress", 1e3),
    "MPa": ("stress", 1e6),
    "GPa": ("stress", 1e9),
    "bar": ("stress", 1e5),
    "N/mm2": ("stress", 1e6),
    # mass
    "kg": ("mass", 1.0),
    "g": ("mass", 1e-3),
    # density
    "kg/m3": ("density", 1.0),
    "g/cm3": ("density", 1000.0),
    "kg/mm3": ("density", 1e9),
    # thermal
    "K/m": ("temperature_gradient", 1.0),
    "K/mm": ("temperature_gradient", 1e3),
    # Canonical spelling uses the middle dot, as the engineering research
    # dossier requires: W/(m·K), W/(m²·K), J/(kg·K). The ASCII forms below
    # are accepted aliases so a value typed or stored either way converts, but
    # anything this module emits uses the canonical spelling.
    "W/(m·K)": ("thermal_conductivity", 1.0),
    "W/(m.K)": ("thermal_conductivity", 1.0),
    "W/(mm·K)": ("thermal_conductivity", 1e3),
    "W/(mm.K)": ("thermal_conductivity", 1e3),
    "J/(kg·K)": ("specific_heat", 1.0),
    "J/(kg.K)": ("specific_heat", 1.0),
    "W/m2": ("heat_flux", 1.0),
    "W/m²": ("heat_flux", 1.0),
    "W/mm2": ("heat_flux", 1e6),
    "W/mm²": ("heat_flux", 1e6),
    "W/(m²·K)": ("heat_transfer_coefficient", 1.0),
    "W/(m2.K)": ("heat_transfer_coefficient", 1.0),
    "W/(m2·K)": ("heat_transfer_coefficient", 1.0),
    "W": ("power", 1.0),
    "J": ("energy", 1.0),
    # angle
    "rad": ("angle", 1.0),
    "deg": ("angle", 3.141592653589793 / 180.0),
    "-": ("dimensionless", 1.0),
}

_TEMPERATURE: Final[set[str]] = {"K", "C", "degC", "F", "degF"}


class UnitError(ValueError):
    """Raised when a unit is unknown or incompatible with its quantity kind."""


def quantity_kind(unit: str) -> str:
    if unit in _TEMPERATURE:
        return "temperature"
    try:
        return _LINEAR[unit][0]
    except KeyError as exc:
        raise UnitError(f"unknown unit {unit!r}") from exc


def to_canonical(value: float, unit: str) -> float:
    """Convert ``value`` expressed in ``unit`` into its canonical SI unit."""
    if unit in _TEMPERATURE:
        if unit == "K":
            return float(value)
        if unit in ("C", "degC"):
            return float(value) + 273.15
        return (float(value) - 32.0) * 5.0 / 9.0 + 273.15
    try:
        return float(value) * _LINEAR[unit][1]
    except KeyError as exc:
        raise UnitError(f"unknown unit {unit!r}") from exc


def from_canonical(value: float, unit: str) -> float:
    """Convert a canonical SI ``value`` into ``unit`` for display."""
    if unit in _TEMPERATURE:
        if unit == "K":
            return float(value)
        if unit in ("C", "degC"):
            return float(value) - 273.15
        return (float(value) - 273.15) * 9.0 / 5.0 + 32.0
    try:
        return float(value) / _LINEAR[unit][1]
    except KeyError as exc:
        raise UnitError(f"unknown unit {unit!r}") from exc


def convert(value: float, from_unit: str, to_unit: str) -> float:
    if quantity_kind(from_unit) != quantity_kind(to_unit):
        raise UnitError(
            f"incompatible units: {from_unit} ({quantity_kind(from_unit)}) -> "
            f"{to_unit} ({quantity_kind(to_unit)})"
        )
    return from_canonical(to_canonical(value, from_unit), to_unit)


@dataclass(frozen=True)
class Quantity:
    """A number that knows its own unit."""

    value: float
    unit: str

    @property
    def kind(self) -> str:
        return quantity_kind(self.unit)

    def canonical(self) -> float:
        return to_canonical(self.value, self.unit)

    def to(self, unit: str) -> "Quantity":
        return Quantity(convert(self.value, self.unit, unit), unit)

    def __str__(self) -> str:  # pragma: no cover - display helper
        return f"{self.value:g} {self.unit}"


# Display preferences used by the API when emitting engineering summaries.
DISPLAY_UNITS: Final[dict[str, str]] = {
    "length": "mm",
    "stress": "MPa",
    "pressure": "MPa",
    "mass": "kg",
    "force": "N",
    "temperature": "C",
    "temperature_gradient": "K/mm",
    "thermal_conductivity": "W/(m·K)",
    "heat_flux": "W/m²",
    "power": "W",
    "energy": "J",
    "density": "kg/m3",
    "dimensionless": "-",
}


def display(value: float, canonical_unit: str) -> tuple[float, str]:
    """Return ``(value, unit)`` converted into the preferred display unit."""
    kind = quantity_kind(canonical_unit)
    target = DISPLAY_UNITS.get(kind, canonical_unit)
    return convert(value, canonical_unit, target), target
