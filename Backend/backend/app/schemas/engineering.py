"""The engineering specification contract (spec 4.2).

A simulation request is only accepted when it carries a complete, typed
engineering specification: material, design variables, load cases, boundary
conditions, objectives, constraints, mesh settings and solver settings. Missing
values are reported back as :class:`~app.schemas.common.MissingField` entries
and never guessed.
"""
from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import (
    AnalysisType,
    Assumption,
    ComponentType,
    ConstraintOperator,
    DesignMode,
    ObjectiveSense,
    Quantity,
    SourceStatus,
)

# --------------------------------------------------------------------------- #
# Design variables
# --------------------------------------------------------------------------- #


class DesignVariableSpec(BaseModel):
    """One bounded, named parameter the generator and optimizer may change."""

    name: str
    label: str
    kind: Literal["continuous", "integer"]
    unit: str
    minimum: float
    maximum: float
    default: float
    step: Optional[float] = None
    description: Optional[str] = None
    is_design_variable: bool = True
    preserved_reason: Optional[str] = Field(
        default=None,
        description="When is_design_variable is False, why this value is locked "
        "(for example: a vehicle interface that must not change).",
    )

    @model_validator(mode="after")
    def _check_bounds(self) -> "DesignVariableSpec":
        if self.minimum > self.maximum:
            raise ValueError(f"{self.name}: minimum {self.minimum} > maximum {self.maximum}")
        if not (self.minimum <= self.default <= self.maximum):
            raise ValueError(
                f"{self.name}: default {self.default} outside [{self.minimum}, {self.maximum}]"
            )
        if self.kind == "integer" and self.step is None:
            self.step = 1.0
        return self

    def clamp(self, value: float) -> float:
        v = min(max(float(value), self.minimum), self.maximum)
        if self.kind == "integer":
            v = float(round(v))
            v = min(max(v, self.minimum), self.maximum)
        return v

    def in_bounds(self, value: float) -> bool:
        if self.kind == "integer" and abs(value - round(value)) > 1e-9:
            return False
        return self.minimum - 1e-12 <= value <= self.maximum + 1e-12


# --------------------------------------------------------------------------- #
# Loads, supports and thermal boundary conditions
# --------------------------------------------------------------------------- #


class ForceLoad(BaseModel):
    """A resultant force spread over a named region as uniform traction."""

    type: Literal["force"] = "force"
    region: str
    magnitude: Quantity = Field(description="force quantity, e.g. 4500 N")
    direction: tuple[float, float, float]
    note: Optional[str] = None

    @model_validator(mode="after")
    def _check(self) -> "ForceLoad":
        self.magnitude.require_kind("force")
        if sum(abs(c) for c in self.direction) == 0:
            raise ValueError(f"force on {self.region!r} has a zero direction vector")
        return self


class PressureLoad(BaseModel):
    """A normal pressure acting on a named region."""

    type: Literal["pressure"] = "pressure"
    region: str
    magnitude: Quantity = Field(description="pressure quantity, e.g. 8 MPa")
    note: Optional[str] = None

    @model_validator(mode="after")
    def _check(self) -> "PressureLoad":
        self.magnitude.require_kind("stress")
        return self


Load = Union[ForceLoad, PressureLoad]


class Support(BaseModel):
    """A displacement constraint on a named region."""

    type: Literal["fixed", "normal_fixed"] = "fixed"
    region: str
    note: Optional[str] = None


class FixedTemperatureBC(BaseModel):
    type: Literal["fixed_temperature"] = "fixed_temperature"
    region: str
    temperature: Quantity
    note: Optional[str] = None

    @model_validator(mode="after")
    def _check(self) -> "FixedTemperatureBC":
        self.temperature.require_kind("temperature")
        return self


class HeatFluxBC(BaseModel):
    type: Literal["heat_flux"] = "heat_flux"
    region: str
    heat_flux: Quantity = Field(description="heat flux into the surface, W/m2")
    note: Optional[str] = None

    @model_validator(mode="after")
    def _check(self) -> "HeatFluxBC":
        self.heat_flux.require_kind("heat_flux")
        return self


class TotalHeatInputBC(BaseModel):
    """A total thermal power applied over a region (converted to flux by area)."""

    type: Literal["total_heat_input"] = "total_heat_input"
    region: str
    power: Quantity = Field(description="total power into the region, W")
    note: Optional[str] = None

    @model_validator(mode="after")
    def _check(self) -> "TotalHeatInputBC":
        self.power.require_kind("power")
        return self


class ConvectionBC(BaseModel):
    type: Literal["convection"] = "convection"
    region: str
    film_coefficient: Quantity = Field(description="h, W/(m²·K)")
    ambient_temperature: Quantity
    note: Optional[str] = None

    @model_validator(mode="after")
    def _check(self) -> "ConvectionBC":
        self.film_coefficient.require_kind("heat_transfer_coefficient")
        self.ambient_temperature.require_kind("temperature")
        return self


ThermalBC = Union[FixedTemperatureBC, HeatFluxBC, TotalHeatInputBC, ConvectionBC]


class LoadCase(BaseModel):
    """One complete, solvable engineering scenario."""

    case_id: str
    name: str
    analysis_type: AnalysisType
    description: Optional[str] = None
    loads: list[Load] = Field(default_factory=list)
    supports: list[Support] = Field(default_factory=list)
    thermal_boundary_conditions: list[ThermalBC] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_case_is_solvable(self) -> "LoadCase":
        if self.analysis_type == AnalysisType.LINEAR_STATIC_STRUCTURAL:
            if not self.loads:
                raise ValueError(f"load case {self.case_id!r}: a structural case needs at least one load")
            if not self.supports:
                raise ValueError(
                    f"load case {self.case_id!r}: a structural case needs at least one support, "
                    "otherwise the stiffness matrix is singular"
                )
            if self.thermal_boundary_conditions:
                raise ValueError(
                    f"load case {self.case_id!r}: thermal boundary conditions are not used by a "
                    "linear static structural analysis"
                )
        else:
            bcs = self.thermal_boundary_conditions
            if not bcs:
                raise ValueError(f"load case {self.case_id!r}: a thermal case needs boundary conditions")
            grounded = [b for b in bcs if b.type in ("fixed_temperature", "convection")]
            if not grounded:
                raise ValueError(
                    f"load case {self.case_id!r}: a steady-state thermal case needs at least one "
                    "fixed-temperature or convection boundary condition, otherwise the temperature "
                    "level is undetermined"
                )
            if self.loads or self.supports:
                raise ValueError(
                    f"load case {self.case_id!r}: mechanical loads/supports are not used by a "
                    "steady-state thermal analysis"
                )
        return self

    def regions_used(self) -> set[str]:
        out: set[str] = set()
        for group in (self.loads, self.supports, self.thermal_boundary_conditions):
            for item in group:
                out.add(item.region)
        return out


# --------------------------------------------------------------------------- #
# Objectives and constraints
# --------------------------------------------------------------------------- #

#: Metrics the optimizer and the constraint checker are allowed to reference.
#: Every entry must be produced by a solver or computed from geometry - nothing
#: here may be estimated or invented.
KNOWN_METRICS: dict[str, str] = {
    "mass_kg": "mass",
    "volume_m3": "volume",
    "max_von_mises_pa": "stress",
    "max_displacement_m": "length",
    "compliance_j": "energy",
    "min_factor_of_safety": "dimensionless",
    "max_temperature_k": "temperature",
    "min_temperature_k": "temperature",
    "max_temperature_gradient_k_per_m": "temperature_gradient",
    "heat_flow_w": "power",
    "min_wall_thickness_m": "length",
}


class Objective(BaseModel):
    objective_id: str
    metric: str
    sense: ObjectiveSense
    weight: float = 1.0
    label: Optional[str] = None

    @model_validator(mode="after")
    def _known(self) -> "Objective":
        if self.metric not in KNOWN_METRICS:
            raise ValueError(
                f"objective {self.objective_id!r}: unknown metric {self.metric!r}; "
                f"allowed: {sorted(KNOWN_METRICS)}"
            )
        return self


class Constraint(BaseModel):
    """A pass/fail engineering limit with an explicit provenance."""

    constraint_id: str
    metric: str
    operator: ConstraintOperator
    limit: Optional[Quantity] = None
    lower: Optional[Quantity] = None
    upper: Optional[Quantity] = None
    source_status: SourceStatus
    source_reference: Optional[str] = None
    label: Optional[str] = None

    @model_validator(mode="after")
    def _check(self) -> "Constraint":
        if self.metric not in KNOWN_METRICS:
            raise ValueError(
                f"constraint {self.constraint_id!r}: unknown metric {self.metric!r}; "
                f"allowed: {sorted(KNOWN_METRICS)}"
            )
        kind = KNOWN_METRICS[self.metric]
        if self.operator == ConstraintOperator.BETWEEN:
            if self.lower is None or self.upper is None:
                raise ValueError(
                    f"constraint {self.constraint_id!r}: 'between' needs both lower and upper"
                )
            self.lower.require_kind(kind)
            self.upper.require_kind(kind)
            if self.lower.canonical() > self.upper.canonical():
                raise ValueError(f"constraint {self.constraint_id!r}: lower > upper")
        else:
            if self.limit is None:
                raise ValueError(
                    f"constraint {self.constraint_id!r}: operator {self.operator.value} needs a limit"
                )
            self.limit.require_kind(kind)
        return self

    def describe(self) -> str:
        if self.operator == ConstraintOperator.BETWEEN:
            return f"{self.metric} in [{self.lower.value} {self.lower.unit}, {self.upper.value} {self.upper.unit}]"
        sym = "<=" if self.operator == ConstraintOperator.LTE else ">="
        return f"{self.metric} {sym} {self.limit.value} {self.limit.unit}"


# --------------------------------------------------------------------------- #
# Mesh and solver settings
# --------------------------------------------------------------------------- #


class MeshSettings(BaseModel):
    """Mesh controls. Recorded with every run so results are reproducible."""

    target_element_size_m: float = Field(gt=0, description="Gmsh Mesh.MeshSizeMax")
    min_element_size_m: Optional[float] = Field(default=None, gt=0)
    element_order: Literal[1, 2] = Field(
        default=2,
        description="Displacement interpolation order. Order 2 (10-node tets) is "
        "the default because linear tets are excessively stiff in bending.",
    )
    optimize_quality: bool = True
    max_nodes: int = Field(default=200_000, gt=0)

    @model_validator(mode="after")
    def _check(self) -> "MeshSettings":
        if self.min_element_size_m and self.min_element_size_m > self.target_element_size_m:
            raise ValueError("min_element_size_m cannot exceed target_element_size_m")
        return self

    def cache_key(self) -> dict:
        return self.model_dump(mode="json")


class SolverSettings(BaseModel):
    solver_id: str = Field(
        description="Registered solver adapter id, e.g. skfem_linear_static."
    )
    timeout_seconds: int = Field(default=600, gt=0)
    options: dict = Field(default_factory=dict)

    def cache_key(self) -> dict:
        return self.model_dump(mode="json")


# --------------------------------------------------------------------------- #
# The full specification
# --------------------------------------------------------------------------- #


class EngineeringSpecification(BaseModel):
    """Everything needed to build, mesh, solve and judge one design."""

    model_config = ConfigDict(extra="forbid")

    component_type: ComponentType
    design_mode: DesignMode
    analysis_type: AnalysisType
    unit_system: Literal["SI_canonical"] = "SI_canonical"

    objective_summary: str = Field(min_length=3)

    material_id: str
    #: component-specific extra materials, e.g. spark-plug insulator/electrode
    material_assignments: dict[str, str] = Field(default_factory=dict)

    parameters: dict[str, float] = Field(
        default_factory=dict,
        description="Full parameter vector in canonical SI units, including "
        "preserved (non-design) values.",
    )
    design_variables: list[str] = Field(
        default_factory=list,
        description="Subset of parameter names the optimizer may change.",
    )

    load_cases: list[LoadCase] = Field(min_length=1)
    objectives: list[Objective] = Field(min_length=1)
    constraints: list[Constraint] = Field(default_factory=list)
    manufacturing_constraints: list[Constraint] = Field(default_factory=list)

    mesh_settings: MeshSettings
    solver_settings: SolverSettings

    assumptions: list[Assumption] = Field(default_factory=list)
    requested_candidate_budget: int = Field(default=8, ge=1, le=200)
    random_seed: int = 20261102

    @model_validator(mode="after")
    def _consistency(self) -> "EngineeringSpecification":
        ids = [c.case_id for c in self.load_cases]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate load-case ids")
        for case in self.load_cases:
            if case.analysis_type != self.analysis_type:
                raise ValueError(
                    f"load case {case.case_id!r} is {case.analysis_type.value} but the "
                    f"specification declares {self.analysis_type.value}"
                )
        for name in self.design_variables:
            if name not in self.parameters:
                raise ValueError(
                    f"design variable {name!r} has no value in parameters"
                )
        return self

    def all_constraints(self) -> list[Constraint]:
        return list(self.constraints) + list(self.manufacturing_constraints)

    def unconfirmed_assumptions(self) -> list[Assumption]:
        return [a for a in self.assumptions if a.requires_confirmation and not a.confirmed]
