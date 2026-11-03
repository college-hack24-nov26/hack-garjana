"""The component-generator contract (spec 5.4).

Every component profile implements :class:`ComponentGenerator`. The pipeline
only ever talks to this interface, so the wheel, caliper and spark plug share
one orchestration path while keeping their own geometry, regions and physics.
"""
from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import numpy as np
from pydantic import BaseModel, Field

from app.engineering.cad.regions import NamedRegion, RegionSet, Selector
from app.engineering.materials.catalog import MaterialRecord
from app.schemas.common import ComponentType
from app.schemas.engineering import DesignVariableSpec


class Subdomain(BaseModel):
    """A material region inside a multi-material solid (spark-plug assembly)."""

    name: str
    material_key: str = Field(
        description="Key into EngineeringSpecification.material_assignments."
    )
    description: str
    selector: Selector = Field(
        description="Evaluated on element centroids to assign material properties."
    )

    def mask(self, centroids: np.ndarray) -> np.ndarray:
        return self.selector.evaluate(np.asarray(centroids, dtype=float))


class GeometryMetrics(BaseModel):
    """Measured properties of the generated solid."""

    volume_m3: float
    surface_area_m2: Optional[float] = None
    bounding_box_min_m: tuple[float, float, float]
    bounding_box_max_m: tuple[float, float, float]
    solid_count: int
    is_valid_solid: bool
    #: Derived analytically from the parameter vector by the generator, not
    #: measured from the tessellation. Labelled as such in the UI.
    min_wall_thickness_m: Optional[float] = None
    min_wall_thickness_basis: str = "parameter_derived"

    @property
    def bbox_size_m(self) -> tuple[float, float, float]:
        return tuple(
            float(b - a)
            for a, b in zip(self.bounding_box_min_m, self.bounding_box_max_m)
        )


class PreservedInterfaceCheck(BaseModel):
    """Evidence that a protected vehicle interface did not move (spec 13.1)."""

    name: str
    description: str
    expected_value_m: float
    measured_value_m: float
    tolerance_m: float
    passed: bool


class GeometryValidationReport(BaseModel):
    """The gate a candidate must pass before it is allowed near a solver."""

    passed: bool
    metrics: GeometryMetrics
    preserved_interface_checks: list[PreservedInterfaceCheck] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class GeneratedGeometry(BaseModel):
    """The output of one deterministic geometry build."""

    component_type: ComponentType
    generator_name: str
    generator_version: str
    parameters: dict[str, float]
    step_path: Path
    preview_glb_path: Optional[Path] = None
    region_set: RegionSet
    subdomains: list[Subdomain] = Field(default_factory=list)
    validation: GeometryValidationReport
    geometry_hash: str

    @property
    def volume_m3(self) -> float:
        return self.validation.metrics.volume_m3

    def mass_kg(self, material: MaterialRecord) -> float:
        """Single-material mass. Multi-material parts use mass_from_subdomains."""
        return self.volume_m3 * material.density


class ParameterValidationResult(BaseModel):
    ok: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    normalized: dict[str, float] = Field(default_factory=dict)


def geometry_hash(
    component_type: ComponentType,
    generator_version: str,
    parameters: dict[str, float],
) -> str:
    """Stable hash of (generator, parameters) used for the evaluation cache."""
    payload = {
        "component": component_type.value,
        "generator_version": generator_version,
        # round to nanometres so float noise does not defeat the cache
        "parameters": {k: round(float(v), 12) for k, v in sorted(parameters.items())},
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


class ComponentGenerator(ABC):
    """One parameterized automotive component template."""

    component_type: ComponentType
    name: str
    version: str
    #: Human description of what the template can and cannot change.
    capability_note: str = ""

    # ---------------------------------------------------------------- schema

    @abstractmethod
    def parameter_specs(self) -> list[DesignVariableSpec]:
        """Full parameter schema, including locked (preserved) parameters."""

    def default_parameters(self) -> dict[str, float]:
        return {s.name: s.default for s in self.parameter_specs()}

    def design_variable_names(self) -> list[str]:
        return [s.name for s in self.parameter_specs() if s.is_design_variable]

    def spec_for(self, name: str) -> DesignVariableSpec:
        for s in self.parameter_specs():
            if s.name == name:
                return s
        raise KeyError(f"{self.name}: unknown parameter {name!r}")

    # ------------------------------------------------------------ validation

    def validate_parameters(self, parameters: dict[str, float]) -> ParameterValidationResult:
        """Bounds and cross-parameter feasibility, before any CAD work."""
        errors: list[str] = []
        warnings: list[str] = []
        merged = dict(self.default_parameters())

        for key, value in parameters.items():
            try:
                spec = self.spec_for(key)
            except KeyError:
                errors.append(f"unknown parameter {key!r}")
                continue
            try:
                fval = float(value)
            except (TypeError, ValueError):
                errors.append(f"{key}: {value!r} is not a number")
                continue
            if not np.isfinite(fval):
                errors.append(f"{key}: value must be finite")
                continue
            if not spec.in_bounds(fval):
                errors.append(
                    f"{key}: {fval:g} {spec.unit} is outside the validated range "
                    f"[{spec.minimum:g}, {spec.maximum:g}] {spec.unit}"
                )
                continue
            merged[key] = fval

        if not errors:
            errors.extend(self.check_feasibility(merged))
        return ParameterValidationResult(
            ok=not errors, errors=errors, warnings=warnings, normalized=merged
        )

    def check_feasibility(self, parameters: dict[str, float]) -> list[str]:
        """Component-specific cross-parameter rules (override in subclasses)."""
        return []

    # ------------------------------------------------------------- geometry

    @abstractmethod
    def build(self, parameters: dict[str, float]):
        """Return the CadQuery object(s) for a validated parameter vector."""

    @abstractmethod
    def named_regions(self, parameters: dict[str, float]) -> RegionSet:
        """Regions derived from the same parameters that built the solid."""

    def subdomains(self, parameters: dict[str, float]) -> list[Subdomain]:
        """Material subdomains. Single-material components return []."""
        return []

    @abstractmethod
    def min_wall_thickness(self, parameters: dict[str, float]) -> float:
        """Thinnest wall implied by the parameters, in metres."""

    @abstractmethod
    def preserved_interfaces(
        self, parameters: dict[str, float]
    ) -> list[tuple[str, str, float, float]]:
        """``(name, description, expected_value_m, tolerance_m)`` tuples that
        :mod:`app.engineering.cad.validation` measures against the built solid."""

    def expected_solid_count(self, parameters: dict[str, float]) -> int:
        """How many separate solids a correct build produces.

        One for a single-material part. A multi-material assembly returns the
        number of bodies, so the validation gate still catches a union that
        silently broke apart without rejecting a legitimate assembly.
        """
        return 1

    def preserved_interface_context(self, parameters: dict[str, float]) -> dict[str, float]:
        """Extra values a preserved-interface measurement needs.

        Some measurements only make sense over a specific band of the part - the
        spark-plug thread diameter must be measured between the shell start and
        the seat, not across the whole solid. Keys are merged into the parameter
        dict handed to the measurement functions.
        """
        return {}

    def mesh_size_hint(self, parameters: dict[str, float]) -> float:
        """A sensible default Gmsh element size for this template, in metres."""
        return 0.006
