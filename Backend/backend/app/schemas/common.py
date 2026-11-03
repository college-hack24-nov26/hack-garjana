"""Shared enums and the unit-carrying primitives used at every API boundary."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core import units as U


class ComponentType(str, Enum):
    ALLOY_WHEEL = "alloy_wheel"
    BRAKE_CALIPER = "brake_caliper"
    SPARK_PLUG = "spark_plug"


class DesignMode(str, Enum):
    IMPROVE_EXISTING = "improve_existing"
    GENERATE_NEW = "generate_new"


class AnalysisType(str, Enum):
    LINEAR_STATIC_STRUCTURAL = "linear_static_structural"
    STEADY_STATE_THERMAL = "steady_state_thermal"
    REDUCED_ORDER_THERMAL = "reduced_order_thermal"


class ResultKind(str, Enum):
    """What the stored field data actually is. The viewer must not relabel it."""

    LINEAR_STATIC = "linear_static"
    STEADY_STATE_THERMAL = "steady_state_thermal"
    REDUCED_ORDER_THERMAL = "reduced_order_thermal"


class FieldLocation(str, Enum):
    """Whether a scalar field lives on nodes or elements (spec 4.5)."""

    NODAL = "nodal"
    ELEMENTAL = "elemental"
    NODAL_L2_PROJECTED = "nodal_l2_projected"


class JobType(str, Enum):
    GEOMETRY = "geometry"
    SIMULATION = "simulation"
    OPTIMIZATION = "optimization"
    IMPORT = "import"


class JobStage(str, Enum):
    QUEUED = "queued"
    VALIDATING = "validating"
    GENERATING_GEOMETRY = "generating_geometry"
    MESHING = "meshing"
    SOLVING = "solving"
    OPTIMIZING = "optimizing"
    PACKAGING = "packaging"
    COMPLETED = "completed"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CandidateStatus(str, Enum):
    """Lifecycle of one generated candidate. Never skipped, never faked."""

    PENDING = "pending"
    GEOMETRY_VALID = "geometry_valid"
    GEOMETRY_INVALID = "geometry_invalid"
    MESHED = "meshed"
    MESH_FAILED = "mesh_failed"
    SOLVED = "solved"
    SOLVER_FAILED = "solver_failed"
    FEASIBLE = "feasible"
    INFEASIBLE = "infeasible"


class ConstraintOperator(str, Enum):
    LTE = "lte"
    GTE = "gte"
    BETWEEN = "between"


class ObjectiveSense(str, Enum):
    MINIMIZE = "minimize"
    MAXIMIZE = "maximize"


class SourceStatus(str, Enum):
    """Provenance of an engineering input. Drives the UI honesty labels."""

    USER_SUPPLIED = "user_supplied"
    OFFICIAL_PROBLEM_STATEMENT = "official_problem_statement"
    SUPPLIER_CERTIFIED = "supplier_certified"
    ILLUSTRATIVE_HANDBOOK_VALUE = "illustrative_handbook_value"
    DEMO_FIXTURE = "demo_fixture"
    LLM_DRAFT_UNCONFIRMED = "llm_draft_unconfirmed"


class Quantity(BaseModel):
    """A number that carries its unit across the API boundary (spec 4.1)."""

    model_config = ConfigDict(frozen=True)

    value: float
    unit: str

    @field_validator("unit")
    @classmethod
    def _known_unit(cls, v: str) -> str:
        U.quantity_kind(v)  # raises UnitError for unknown units
        return v

    @property
    def kind(self) -> str:
        return U.quantity_kind(self.unit)

    def canonical(self) -> float:
        return U.to_canonical(self.value, self.unit)

    def require_kind(self, kind: str) -> "Quantity":
        if self.kind != kind:
            raise ValueError(
                f"expected a {kind} quantity but got {self.unit} ({self.kind})"
            )
        return self

    def display(self) -> "DisplayQuantity":
        v, u = U.display(self.canonical(), U.CANONICAL[self.kind])
        return DisplayQuantity(value=v, unit=u, canonical_value=self.canonical(),
                               canonical_unit=U.CANONICAL[self.kind])


class DisplayQuantity(BaseModel):
    """What the UI renders: a display value plus the stored canonical value."""

    value: float
    unit: str
    canonical_value: float
    canonical_unit: str


def canonical_quantity(value: float, kind: str) -> DisplayQuantity:
    """Build a display quantity from an already-canonical SI value."""
    cu = U.CANONICAL[kind]
    v, u = U.display(value, cu)
    return DisplayQuantity(value=v, unit=u, canonical_value=value, canonical_unit=cu)


class Assumption(BaseModel):
    """An engineering assumption that must stay visible in the UI and report."""

    key: str
    statement: str
    source_status: SourceStatus
    source_reference: Optional[str] = None
    requires_confirmation: bool = False
    confirmed: bool = False


class ValidationIssue(BaseModel):
    field: str
    message: str
    severity: str = Field(default="error", pattern="^(error|warning)$")


class MissingField(BaseModel):
    """A required engineering input that the platform refuses to invent."""

    field: str
    label: str
    expected_kind: str
    why_required: str
    suggested_unit: Optional[str] = None
