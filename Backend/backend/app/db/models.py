"""SQLite persistence (spec 8.2).

Large engineering artifacts (STEP, mesh, solver output, result fields) live on
disk under ``storage/``; the database holds records, metrics and the paths to
those artifacts, never the file contents.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.core.ids import new_id


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("proj"))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    components: Mapped[list["ComponentInstance"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class ComponentInstance(Base):
    """One component being worked on inside a project."""

    __tablename__ = "component_instances"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("comp"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    component_type: Mapped[str] = mapped_column(String(40))
    design_mode: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(200))
    unit_system: Mapped[str] = mapped_column(String(32), default="SI_canonical")

    #: Set when the engineer uploaded an existing CAD model.
    source_asset_path: Mapped[Optional[str]] = mapped_column(Text, default=None)
    source_metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=None)
    #: Whether the uploaded model can actually be regenerated parametrically.
    source_is_parametric: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    project: Mapped[Project] = relationship(back_populates="components")
    designs: Mapped[list["DesignVersion"]] = relationship(
        back_populates="component", cascade="all, delete-orphan"
    )


class EngineeringSpecificationRecord(Base):
    """The frozen specification a run was executed against."""

    __tablename__ = "engineering_specifications"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("spec"))
    component_instance_id: Mapped[str] = mapped_column(
        ForeignKey("component_instances.id", ondelete="CASCADE")
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    engineering_inputs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    assumptions: Mapped[list[Any]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class DesignVersion(Base):
    """A baseline or candidate geometry version."""

    __tablename__ = "design_versions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("dsgn"))
    component_instance_id: Mapped[str] = mapped_column(
        ForeignKey("component_instances.id", ondelete="CASCADE")
    )
    parent_design_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("design_versions.id"), default=None
    )
    optimization_run_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)

    label: Mapped[str] = mapped_column(String(120))
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False)
    generation: Mapped[int] = mapped_column(Integer, default=0)
    candidate_index: Mapped[int] = mapped_column(Integer, default=0)

    parameters: Mapped[dict[str, Any]] = mapped_column(JSON)
    geometry_hash: Mapped[str] = mapped_column(String(64))
    generator_name: Mapped[str] = mapped_column(String(80))
    generator_version: Mapped[str] = mapped_column(String(40))
    material_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    status: Mapped[str] = mapped_column(String(40), default="pending")
    is_feasible: Mapped[Optional[bool]] = mapped_column(Boolean, default=None)
    failure_stage: Mapped[Optional[str]] = mapped_column(String(60), default=None)
    failure_reason: Mapped[Optional[str]] = mapped_column(Text, default=None)

    step_path: Mapped[Optional[str]] = mapped_column(Text, default=None)
    preview_glb_path: Mapped[Optional[str]] = mapped_column(Text, default=None)
    geometry_validation: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=None)

    volume_m3: Mapped[Optional[float]] = mapped_column(Float, default=None)
    mass_kg: Mapped[Optional[float]] = mapped_column(Float, default=None)

    rank: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    pareto_front: Mapped[Optional[int]] = mapped_column(Integer, default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    component: Mapped[ComponentInstance] = relationship(back_populates="designs")
    runs: Mapped[list["SimulationRun"]] = relationship(
        back_populates="design", cascade="all, delete-orphan"
    )


class SimulationRun(Base):
    __tablename__ = "simulation_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("run"))
    design_version_id: Mapped[str] = mapped_column(
        ForeignKey("design_versions.id", ondelete="CASCADE")
    )
    specification_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)

    analysis_type: Mapped[str] = mapped_column(String(50))
    load_case_id: Mapped[str] = mapped_column(String(80))
    solver_id: Mapped[str] = mapped_column(String(60))
    solver_name: Mapped[str] = mapped_column(String(120))
    solver_version: Mapped[str] = mapped_column(String(60))
    result_kind: Mapped[str] = mapped_column(String(50))
    mesh_preset: Mapped[str] = mapped_column(String(40), default="exploration")

    mesh_settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    mesh_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    solver_settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    material_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    status: Mapped[str] = mapped_column(String(30), default="queued")
    degrees_of_freedom: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    solve_time_seconds: Mapped[Optional[float]] = mapped_column(Float, default=None)
    linear_solver_report: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=None)

    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    design: Mapped[DesignVersion] = relationship(back_populates="runs")
    result: Mapped[Optional["SimulationResultRecord"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", uselist=False
    )


class SimulationResultRecord(Base):
    __tablename__ = "simulation_results"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("res"))
    simulation_run_id: Mapped[str] = mapped_column(
        ForeignKey("simulation_runs.id", ondelete="CASCADE")
    )

    #: Canonical-SI metrics exactly as the solver produced them.
    summary_metrics: Mapped[dict[str, Any]] = mapped_column(JSON)
    constraint_results: Mapped[list[Any]] = mapped_column(JSON, default=list)
    objective_values: Mapped[list[Any]] = mapped_column(JSON, default=list)
    region_applications: Mapped[list[Any]] = mapped_column(JSON, default=list)
    #: One entry per applied load; each load is verified on its own.
    load_verifications: Mapped[list[Any]] = mapped_column(JSON, default=list)

    is_feasible: Mapped[Optional[bool]] = mapped_column(Boolean, default=None)
    infeasibility_reasons: Mapped[list[Any]] = mapped_column(JSON, default=list)

    field_artifact_path: Mapped[Optional[str]] = mapped_column(Text, default=None)
    field_artifact_metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=None)
    method_statement: Mapped[str] = mapped_column(Text, default="")
    warnings: Mapped[list[Any]] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    run: Mapped[SimulationRun] = relationship(back_populates="result")


class OptimizationRun(Base):
    __tablename__ = "optimization_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("opt"))
    component_instance_id: Mapped[str] = mapped_column(
        ForeignKey("component_instances.id", ondelete="CASCADE")
    )
    specification_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    baseline_design_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)

    algorithm: Mapped[str] = mapped_column(String(60))
    random_seed: Mapped[int] = mapped_column(Integer)
    candidate_budget: Mapped[int] = mapped_column(Integer)
    generations: Mapped[int] = mapped_column(Integer, default=1)
    design_variables: Mapped[list[Any]] = mapped_column(JSON, default=list)
    objective_definitions: Mapped[list[Any]] = mapped_column(JSON, default=list)
    constraint_definitions: Mapped[list[Any]] = mapped_column(JSON, default=list)

    status: Mapped[str] = mapped_column(String(30), default="queued")
    termination_reason: Mapped[Optional[str]] = mapped_column(Text, default=None)

    candidates_generated: Mapped[int] = mapped_column(Integer, default=0)
    candidates_evaluated: Mapped[int] = mapped_column(Integer, default=0)
    candidates_feasible: Mapped[int] = mapped_column(Integer, default=0)
    candidates_failed: Mapped[int] = mapped_column(Integer, default=0)
    cache_hits: Mapped[int] = mapped_column(Integer, default=0)

    total_seconds: Mapped[Optional[float]] = mapped_column(Float, default=None)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("cand"))
    optimization_run_id: Mapped[str] = mapped_column(
        ForeignKey("optimization_runs.id", ondelete="CASCADE")
    )
    design_version_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    simulation_run_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)

    candidate_index: Mapped[int] = mapped_column(Integer)
    generation: Mapped[int] = mapped_column(Integer, default=0)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON)
    geometry_hash: Mapped[str] = mapped_column(String(64))

    status: Mapped[str] = mapped_column(String(40))
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False)
    from_cache: Mapped[bool] = mapped_column(Boolean, default=False)

    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    constraint_results: Mapped[list[Any]] = mapped_column(JSON, default=list)
    objective_values: Mapped[list[Any]] = mapped_column(JSON, default=list)
    is_feasible: Mapped[Optional[bool]] = mapped_column(Boolean, default=None)
    infeasibility_reasons: Mapped[list[Any]] = mapped_column(JSON, default=list)

    failure_stage: Mapped[Optional[str]] = mapped_column(String(60), default=None)
    failure_reason: Mapped[Optional[str]] = mapped_column(Text, default=None)
    warnings: Mapped[list[Any]] = mapped_column(JSON, default=list)

    rank: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    pareto_front: Mapped[Optional[int]] = mapped_column(Integer, default=None)

    step_path: Mapped[Optional[str]] = mapped_column(Text, default=None)
    preview_glb_path: Mapped[Optional[str]] = mapped_column(Text, default=None)
    field_artifact_path: Mapped[Optional[str]] = mapped_column(Text, default=None)

    solve_time_seconds: Mapped[Optional[float]] = mapped_column(Float, default=None)
    mesh_node_count: Mapped[Optional[int]] = mapped_column(Integer, default=None)

    #: The full assurance outcome for this candidate: every check with its
    #: measurement, the verification verdict, the physical-validation status,
    #: the evidence hashes and the derived maturity level. Stored whole so the
    #: verdict can be re-read later without re-deriving it, and so a result
    #: cannot be shown without the evidence that produced it. ``None`` means
    #: the gate never ran for this candidate.
    assurance: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Job(Base):
    """A long-running engineering task tracked outside the request cycle."""

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("job"))
    job_type: Mapped[str] = mapped_column(String(40))
    project_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    component_instance_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    optimization_run_id: Mapped[Optional[str]] = mapped_column(String(64), default=None)

    status: Mapped[str] = mapped_column(String(30), default="queued")
    stage: Mapped[str] = mapped_column(String(40), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[Optional[str]] = mapped_column(Text, default=None)

    request_hash: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    request_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=None)
    result_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=None)

    error: Mapped[Optional[str]] = mapped_column(Text, default=None)
    log_path: Mapped[Optional[str]] = mapped_column(Text, default=None)
    stage_history: Mapped[list[Any]] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("art"))
    parent_type: Mapped[str] = mapped_column(String(40))
    parent_id: Mapped[str] = mapped_column(String(64))

    file_type: Mapped[str] = mapped_column(String(30))
    relative_path: Mapped[str] = mapped_column(Text)
    checksum_sha256: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    units: Mapped[Optional[str]] = mapped_column(String(40), default=None)
    note: Mapped[Optional[str]] = mapped_column(Text, default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
