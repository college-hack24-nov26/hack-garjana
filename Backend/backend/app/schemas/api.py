"""Request and response models for the HTTP API (spec 8.1)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.schemas.common import (
    AnalysisType,
    Assumption,
    CandidateStatus,
    ComponentType,
    DesignMode,
    MissingField,
)


# --------------------------------------------------------------------------- #
# Projects and components
# --------------------------------------------------------------------------- #


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)


class ProjectOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    component_count: int = 0
    design_count: int = 0
    job_count: int = 0


class ComponentCreate(BaseModel):
    project_id: str
    component_type: ComponentType
    design_mode: DesignMode
    name: str = Field(min_length=1, max_length=200)


class ComponentOut(BaseModel):
    id: str
    project_id: str
    component_type: ComponentType
    design_mode: DesignMode
    name: str
    unit_system: str
    source_asset_path: Optional[str] = None
    source_metadata: Optional[dict] = None
    source_is_parametric: bool = False
    created_at: datetime


# --------------------------------------------------------------------------- #
# Component profile catalog
# --------------------------------------------------------------------------- #


class ParameterSpecOut(BaseModel):
    name: str
    label: str
    kind: str
    unit: str
    minimum: float
    maximum: float
    default: float
    step: Optional[float] = None
    description: Optional[str] = None
    is_design_variable: bool
    preserved_reason: Optional[str] = None


class EngineeringInputOut(BaseModel):
    key: str
    label: str
    kind: str
    unit: str
    required: bool
    demo_default: Optional[float] = None
    demo_default_display: Optional[float] = None
    help_text: str
    why_required: str


class MaterialOut(BaseModel):
    material_id: str
    name: str
    family: str
    typical_use: Optional[str] = None
    density: float
    elastic_modulus: Optional[float] = None
    poisson_ratio: Optional[float] = None
    yield_strength: Optional[float] = None
    thermal_conductivity: Optional[float] = None
    specific_heat: Optional[float] = None
    max_service_temperature: Optional[float] = None
    source_status: str
    notes: Optional[str] = None
    supports_structural: bool
    supports_thermal: bool
    supports_yield_margin: bool


class ProfileOut(BaseModel):
    component_type: ComponentType
    display_name: str
    summary: str
    analysis_type: AnalysisType
    solver_id: str
    solver_name: str
    result_kind: str
    method_statement: str
    scope_statement: str
    not_in_scope: list[str]
    capability_note: str
    parameters: list[ParameterSpecOut]
    design_variables: list[str]
    engineering_inputs: list[EngineeringInputOut]
    materials: list[MaterialOut]
    material_assignments: dict[str, str] = Field(default_factory=dict)
    #: Objectives this profile can optimise, in its own default order.
    objectives: list[dict] = Field(default_factory=list)
    region_names: list[str] = Field(default_factory=list)
    demo_assumptions: list[Assumption] = Field(default_factory=list)
    mesh_presets: list[dict] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Study requests
# --------------------------------------------------------------------------- #


class StudyRequest(BaseModel):
    """Start a generative study: baseline plus a searched candidate set."""

    component_instance_id: str
    material_id: str
    objective_summary: str = Field(min_length=3, max_length=500)

    #: Engineering values in the units the profile declared.
    engineering_inputs: dict[str, float] = Field(default_factory=dict)
    #: Parameter overrides in canonical SI. Omitted parameters use the default.
    parameters: dict[str, float] = Field(default_factory=dict)
    #: Subset of design variables to search. Empty means all of them.
    design_variables: list[str] = Field(default_factory=list)
    #: Objective ids to optimise, most important first. Empty means the
    #: profile's own defaults. Unknown ids are rejected rather than ignored,
    #: so a typo cannot silently change what is being optimised.
    objectives: list[str] = Field(default_factory=list)

    strategy: str = Field(default="doe", pattern="^(doe|nsga2)$")
    candidate_budget: int = Field(default=7, ge=1, le=60)
    population_size: int = Field(default=6, ge=2, le=24)
    generations: int = Field(default=3, ge=1, le=12)
    mesh_preset: str = Field(default="exploration", pattern="^(screening|exploration|verification)$")
    verify_winner: bool = True
    random_seed: int = 20261102
    time_budget_seconds: Optional[int] = Field(default=None, ge=30, le=14400)
    #: The engineer must accept the labelled demo fixtures before a run starts.
    confirm_demo_assumptions: bool = False


class SingleRunRequest(BaseModel):
    """Evaluate one explicit parameter set (used for baselines and re-runs)."""

    component_instance_id: str
    material_id: str
    objective_summary: str = Field(default="Single design evaluation", max_length=500)
    engineering_inputs: dict[str, float] = Field(default_factory=dict)
    parameters: dict[str, float] = Field(default_factory=dict)
    mesh_preset: str = Field(default="exploration", pattern="^(screening|exploration|verification)$")
    confirm_demo_assumptions: bool = False


class ValidationResponse(BaseModel):
    """Returned with HTTP 422 when a request is not runnable as submitted."""

    ok: bool = False
    message: str
    missing_fields: list[MissingField] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    unconfirmed_assumptions: list[Assumption] = Field(default_factory=list)


class JobAccepted(BaseModel):
    job_id: str
    status: str
    deduplicated: bool = False
    poll_url: str


# --------------------------------------------------------------------------- #
# Jobs
# --------------------------------------------------------------------------- #


class JobOut(BaseModel):
    id: str
    job_type: str
    status: str
    stage: str
    progress: float
    message: Optional[str] = None
    error: Optional[str] = None
    project_id: Optional[str] = None
    component_instance_id: Optional[str] = None
    optimization_run_id: Optional[str] = None
    stage_history: list[Any] = Field(default_factory=list)
    result_payload: Optional[dict] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    log_available: bool = False


# --------------------------------------------------------------------------- #
# Results
# --------------------------------------------------------------------------- #


class DisplayValue(BaseModel):
    value: float
    unit: str
    canonical_value: float
    canonical_unit: str


class CandidateOut(BaseModel):
    candidate_id: str
    index: int
    generation: int
    status: CandidateStatus
    is_baseline: bool
    from_cache: bool
    parameters: dict[str, float]
    geometry_hash: str

    metrics: dict[str, float] = Field(default_factory=dict)
    display_metrics: dict[str, DisplayValue] = Field(default_factory=dict)
    constraint_results: list[dict] = Field(default_factory=list)
    objective_values: list[dict] = Field(default_factory=list)

    is_feasible: Optional[bool] = None
    infeasibility_reasons: list[str] = Field(default_factory=list)
    failure_stage: Optional[str] = None
    failure_reason: Optional[str] = None

    rank: Optional[int] = None
    pareto_front: Optional[int] = None
    evaluated: bool = False

    design_version_id: Optional[str] = None
    preview_url: Optional[str] = None
    step_url: Optional[str] = None
    fields_url: Optional[str] = None

    solve_time_seconds: Optional[float] = None
    mesh_node_count: Optional[int] = None
    warnings: list[str] = Field(default_factory=list)

    #: The deterministic assurance outcome: every check and its measurement,
    #: the verification verdict, the physical-validation status, the evidence
    #: record and the derived maturity level. ``None`` means the gate did not
    #: run, which the UI must show as such rather than defaulting it.
    assurance: Optional[dict] = None


class StudyResultOut(BaseModel):
    optimization_run_id: str
    component_instance_id: str
    component_type: ComponentType
    analysis_type: AnalysisType
    algorithm: str
    random_seed: int
    status: str
    #: When the solver finished. A demo that falls back to an earlier study is
    #: showing a stored result, and the UI says so rather than letting it read
    #: as something just computed on stage.
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    solver_name: str
    solver_version: str
    method_statement: str
    mesh_preset: str

    summary: dict = Field(default_factory=dict)
    termination_reason: str = ""

    candidates: list[CandidateOut] = Field(default_factory=list)
    baseline_candidate_id: Optional[str] = None
    recommended_candidate_id: Optional[str] = None
    recommendation: Optional[dict] = None
    comparison: dict = Field(default_factory=dict)
    mesh_convergence: dict = Field(default_factory=dict)

    objectives: list[dict] = Field(default_factory=list)
    constraints: list[dict] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)
    specification: dict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class VisualizationPayload(BaseModel):
    """What the 3D viewer needs, with its provenance attached (spec 6.2)."""

    candidate_id: str
    result_kind: str
    analysis_type: str
    geometry_asset_url: Optional[str] = None

    node_count: int
    triangle_count: int
    nodes: list[list[float]] = Field(default_factory=list)
    faces: list[list[int]] = Field(default_factory=list)
    displacement: Optional[list[list[float]]] = None
    von_mises: Optional[list[float]] = None
    temperature: Optional[list[float]] = None

    stress_location: Optional[str] = None
    temperature_location: Optional[str] = None
    stress_range_pa: Optional[tuple[float, float]] = None
    temperature_range_k: Optional[tuple[float, float]] = None
    displacement_range_m: Optional[tuple[float, float]] = None

    #: Exaggeration applied for display only, with the true maximum alongside.
    recommended_deformation_scale: float = 1.0
    max_displacement_m: Optional[float] = None
    visualization_note: str = ""
    method_statement: str = ""
