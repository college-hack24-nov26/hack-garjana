"""Semantic geometry regions (spec 4.4).

Boundary conditions are never attached to OpenCascade face indices, because
those are not stable when a parameter changes and the solid is rebuilt. Instead
each component generator emits a :class:`NamedRegion` whose membership is
defined by a *selector*: a small, serializable geometric predicate derived from
the same parameters that built the solid.

Because the selector is rebuilt from the parameter vector on every regeneration,
``fixed_hub_mounting_face`` means the same thing on candidate 1 and candidate 40,
and the selector itself is stored with the run so the mapping is reproducible.
"""
from __future__ import annotations

import math
from enum import Enum
from typing import Annotated, Literal, Optional, Union

import numpy as np
from pydantic import BaseModel, Field


class RegionKind(str, Enum):
    """The roles declared in spec 4.4."""

    FIXED = "fixed_regions"
    LOAD = "load_regions"
    PRESSURE = "pressure_regions"
    THERMAL_HOT = "thermal_hot_regions"
    THERMAL_SINK = "thermal_cold_or_sink_regions"
    NON_DESIGN = "non_design_regions"
    INTERFACE = "interface_regions"


_AXIS_INDEX = {"x": 0, "y": 1, "z": 2}


def _axis_split(axis: str) -> tuple[int, int, int]:
    """Return (axial, radial_a, radial_b) coordinate indices for an axis name."""
    a = _AXIS_INDEX[axis]
    others = [i for i in (0, 1, 2) if i != a]
    return a, others[0], others[1]


class _Base(BaseModel):
    def evaluate(self, pts: np.ndarray) -> np.ndarray:  # pragma: no cover - abstract
        raise NotImplementedError


class PlaneSelector(_Base):
    """Points lying on a plane normal to ``axis`` at ``value``."""

    type: Literal["plane"] = "plane"
    axis: Literal["x", "y", "z"]
    value: float
    tol: float = 1e-5

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        a = _AXIS_INDEX[self.axis]
        return np.abs(pts[a] - self.value) <= self.tol


class CylinderSelector(_Base):
    """Points on a cylindrical surface of given radius about ``axis``."""

    type: Literal["cylinder"] = "cylinder"
    axis: Literal["x", "y", "z"]
    radius: float
    tol: float = 1e-4
    axial_min: Optional[float] = None
    axial_max: Optional[float] = None

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        a, i, j = _axis_split(self.axis)
        r = np.hypot(pts[i], pts[j])
        mask = np.abs(r - self.radius) <= self.tol
        if self.axial_min is not None:
            mask &= pts[a] >= self.axial_min - 1e-9
        if self.axial_max is not None:
            mask &= pts[a] <= self.axial_max + 1e-9
        return mask


class OffsetCylinderSelector(_Base):
    """Points on a cylinder whose axis is parallel to ``axis`` but off-centre.

    ``center_a`` and ``center_b`` are the coordinates in the two non-axial
    directions, in ascending coordinate-index order (for ``axis="y"`` that is
    x then z). Needed for features such as mounting holes that are not
    concentric with the part axis.
    """

    type: Literal["offset_cylinder"] = "offset_cylinder"
    axis: Literal["x", "y", "z"]
    center_a: float
    center_b: float
    radius: float
    tol: float = 4e-4
    axial_min: Optional[float] = None
    axial_max: Optional[float] = None

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        a, i, j = _axis_split(self.axis)
        r = np.hypot(pts[i] - self.center_a, pts[j] - self.center_b)
        mask = np.abs(r - self.radius) <= self.tol
        if self.axial_min is not None:
            mask &= pts[a] >= self.axial_min - 1e-9
        if self.axial_max is not None:
            mask &= pts[a] <= self.axial_max + 1e-9
        return mask


class RadialBandSelector(_Base):
    """Points whose radius about ``axis`` lies in [r_min, r_max]."""

    type: Literal["radial_band"] = "radial_band"
    axis: Literal["x", "y", "z"]
    r_min: float = 0.0
    r_max: float = float("inf")
    axial_min: Optional[float] = None
    axial_max: Optional[float] = None

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        a, i, j = _axis_split(self.axis)
        r = np.hypot(pts[i], pts[j])
        mask = (r >= self.r_min - 1e-9) & (r <= self.r_max + 1e-9)
        if self.axial_min is not None:
            mask &= pts[a] >= self.axial_min - 1e-9
        if self.axial_max is not None:
            mask &= pts[a] <= self.axial_max + 1e-9
        return mask


class AngularSectorSelector(_Base):
    """Points inside an angular wedge about ``axis`` (used for a tyre contact patch)."""

    type: Literal["angular_sector"] = "angular_sector"
    axis: Literal["x", "y", "z"]
    center_deg: float
    half_angle_deg: float

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        _, i, j = _axis_split(self.axis)
        ang = np.degrees(np.arctan2(pts[j], pts[i])) % 360.0
        delta = np.abs((ang - (self.center_deg % 360.0) + 180.0) % 360.0 - 180.0)
        return delta <= self.half_angle_deg


class BoxSelector(_Base):
    type: Literal["box"] = "box"
    min: tuple[float, float, float]
    max: tuple[float, float, float]
    tol: float = 1e-9

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        lo = np.asarray(self.min, dtype=float)[:, None] - self.tol
        hi = np.asarray(self.max, dtype=float)[:, None] + self.tol
        return np.all((pts >= lo) & (pts <= hi), axis=0)


class BoltHolesSelector(_Base):
    """Points on the barrel of any bolt hole on a given pitch-circle diameter."""

    type: Literal["bolt_holes"] = "bolt_holes"
    axis: Literal["x", "y", "z"]
    pcd_radius: float
    hole_radius: float
    count: int
    first_angle_deg: float = 0.0
    tol: float = 3e-4
    axial_min: Optional[float] = None
    axial_max: Optional[float] = None

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        a, i, j = _axis_split(self.axis)
        mask = np.zeros(pts.shape[1], dtype=bool)
        for k in range(self.count):
            ang = math.radians(self.first_angle_deg + k * 360.0 / self.count)
            cx = self.pcd_radius * math.cos(ang)
            cy = self.pcd_radius * math.sin(ang)
            d = np.hypot(pts[i] - cx, pts[j] - cy)
            mask |= d <= self.hole_radius + self.tol
        if self.axial_min is not None:
            mask &= pts[a] >= self.axial_min - 1e-9
        if self.axial_max is not None:
            mask &= pts[a] <= self.axial_max + 1e-9
        return mask


class AndSelector(_Base):
    type: Literal["and"] = "and"
    of: list["Selector"]

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        out = np.ones(pts.shape[1], dtype=bool)
        for s in self.of:
            out &= s.evaluate(pts)
        return out


class OrSelector(_Base):
    type: Literal["or"] = "or"
    of: list["Selector"]

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        out = np.zeros(pts.shape[1], dtype=bool)
        for s in self.of:
            out |= s.evaluate(pts)
        return out


class NotSelector(_Base):
    type: Literal["not"] = "not"
    of: "Selector"

    def evaluate(self, pts: np.ndarray) -> np.ndarray:
        return ~self.of.evaluate(pts)


Selector = Annotated[
    Union[
        PlaneSelector,
        CylinderSelector,
        OffsetCylinderSelector,
        RadialBandSelector,
        AngularSectorSelector,
        BoxSelector,
        BoltHolesSelector,
        AndSelector,
        OrSelector,
        NotSelector,
    ],
    Field(discriminator="type"),
]

AndSelector.model_rebuild()
OrSelector.model_rebuild()
NotSelector.model_rebuild()


class NamedRegion(BaseModel):
    """A semantic region that boundary conditions and checks can refer to."""

    name: str
    kind: RegionKind
    description: str
    selector: Selector
    #: When True, the pipeline aborts if the region captures no mesh facet.
    required: bool = True
    #: Minimum facet count expected; a region that is far too small usually
    #: means a parameter change moved the feature out from under its selector.
    min_facets: int = 1

    def mask(self, points: np.ndarray) -> np.ndarray:
        """``points`` is a (3, N) array of coordinates in metres."""
        pts = np.asarray(points, dtype=float)
        if pts.ndim != 2 or pts.shape[0] != 3:
            raise ValueError(f"expected a (3, N) point array, got {pts.shape}")
        return self.selector.evaluate(pts)


class RegionSet(BaseModel):
    """All named regions a generated solid exposes."""

    regions: list[NamedRegion]

    def by_name(self, name: str) -> NamedRegion:
        for r in self.regions:
            if r.name == name:
                return r
        raise KeyError(
            f"unknown region {name!r}; available: {[r.name for r in self.regions]}"
        )

    def names(self) -> list[str]:
        return [r.name for r in self.regions]

    def of_kind(self, kind: RegionKind) -> list[NamedRegion]:
        return [r for r in self.regions if r.kind == kind]

    def require(self, names: set[str]) -> None:
        missing = names - set(self.names())
        if missing:
            raise KeyError(
                f"load case refers to regions this geometry does not expose: {sorted(missing)}; "
                f"available: {self.names()}"
            )
