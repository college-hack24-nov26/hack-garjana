"""Study orchestration: validate, run, persist, and read back (spec 8.2).

This is the layer the API talks to. It refuses to start a run that is missing
required engineering inputs or whose labelled demo fixtures have not been
accepted, and it writes every candidate - including failures - to the database.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core import units as U
from app.core.ids import new_id
from app.core.logging import get_logger
from app.db.models import (
    Candidate,
    ComponentInstance,
    DesignVersion,
    EngineeringSpecificationRecord,
    Job,
    OptimizationRun,
    SimulationResultRecord,
    SimulationRun,
)
from app.db.session import session_scope
from app.engineering.materials.catalog import get_catalog, get_material
from app.engineering.profiles.base import MESH_PRESETS, ComponentProfile
from app.engineering.profiles.registry import get_profile
from app.engineering.solvers.registry import get_solver
from app.schemas.api import StudyRequest, ValidationResponse
from app.schemas.common import (
    Assumption,
    CandidateStatus,
    ComponentType,
    DesignMode,
    JobStage,
    MissingField,
)
from app.schemas.engineering import EngineeringSpecification
from app.services.artifact_store import get_store
from app.services.exploration import ExplorationResult, run_exploration
from app.services.job_manager import JobContext

log = get_logger(__name__)


class StudyValidationError(Exception):
    def __init__(self, response: ValidationResponse) -> None:
        super().__init__(response.message)
        self.response = response


# --------------------------------------------------------------------------- #
# Validation and specification assembly
# --------------------------------------------------------------------------- #


def _to_canonical_inputs(
    profile: ComponentProfile, submitted: dict[str, float]
) -> tuple[dict[str, float], list[str]]:
    """Convert engineering inputs from their declared display unit into SI."""
    errors: list[str] = []
    out: dict[str, float] = {}
    by_key = {f.key: f for f in profile.required_inputs()}

    for key, raw in submitted.items():
        field = by_key.get(key)
        if field is None:
            errors.append(f"unknown engineering input {key!r}")
            continue
        if raw is None:
            continue
        try:
            out[key] = U.to_canonical(float(raw), field.unit)
        except Exception as exc:
            errors.append(f"{key}: {exc}")
    return out, errors


def build_specification(
    profile: ComponentProfile, request: StudyRequest
) -> tuple[EngineeringSpecification, dict[str, float], dict[str, float]]:
    """Validate the request and assemble a runnable specification.

    Raises :class:`StudyValidationError` describing exactly what is missing.
    """
    errors: list[str] = []

    # ---- material must exist in the controlled catalog --------------------
    try:
        material = get_material(request.material_id)
    except KeyError as exc:
        raise StudyValidationError(
            ValidationResponse(
                message="The requested material is not in the catalog.",
                errors=[str(exc)],
            )
        ) from exc

    if profile.analysis_type.value.endswith("thermal"):
        if not material.supports_thermal():
            errors.append(
                f"material {material.material_id!r} has no thermal conductivity, so it "
                "cannot be used for a thermal analysis"
            )
    elif not material.supports_structural():
        errors.append(
            f"material {material.material_id!r} has no elastic modulus or Poisson ratio, "
            "so it cannot be used for a structural analysis"
        )

    # ---- engineering inputs ------------------------------------------------
    canonical_inputs, unit_errors = _to_canonical_inputs(
        profile, request.engineering_inputs
    )
    errors.extend(unit_errors)

    missing: list[MissingField] = profile.missing_inputs(canonical_inputs)
    if missing:
        raise StudyValidationError(
            ValidationResponse(
                message=(
                    "Required engineering inputs are missing. The platform will not "
                    "assume values for loads, limits or material behaviour."
                ),
                missing_fields=missing,
                errors=errors,
            )
        )

    # ---- parameters --------------------------------------------------------
    parameters = dict(profile.generator.default_parameters())
    parameters.update(
        {k: float(v) for k, v in request.parameters.items() if v is not None}
    )
    param_check = profile.generator.validate_parameters(parameters)
    if not param_check.ok:
        errors.extend(param_check.errors)
    else:
        parameters = param_check.normalized

    design_variables = request.design_variables or profile.generator.design_variable_names()
    unknown = set(design_variables) - set(profile.generator.design_variable_names())
    if unknown:
        errors.append(
            f"these parameters are not design variables and cannot be searched: "
            f"{sorted(unknown)}. They are preserved interfaces."
        )

    # ---- objective selection ------------------------------------------------
    available = {o.objective_id: o for o in profile.default_objectives()}
    if request.objectives:
        unknown = [o for o in request.objectives if o not in available]
        if unknown:
            errors.append(
                f"unknown objective(s) {unknown}; this profile offers "
                f"{sorted(available)}"
            )
        chosen = [available[o] for o in request.objectives if o in available]
    else:
        chosen = list(available.values())

    if not chosen and not errors:
        errors.append("at least one optimisation objective must be selected")

    if errors:
        raise StudyValidationError(
            ValidationResponse(
                message="The request is not runnable as submitted.", errors=errors
            )
        )

    # ---- labelled demo fixtures must be accepted ---------------------------
    assumptions = profile.demo_fixture_assumptions()
    needs_confirmation = [a for a in assumptions if a.requires_confirmation]
    if needs_confirmation and not request.confirm_demo_assumptions:
        raise StudyValidationError(
            ValidationResponse(
                message=(
                    "This run relies on labelled demonstration assumptions. Review and "
                    "accept them, or supply your own engineering values, before running."
                ),
                unconfirmed_assumptions=needs_confirmation,
            )
        )
    for a in assumptions:
        if a.requires_confirmation:
            a.confirmed = True

    spec = profile.build_specification(
        design_mode=DesignMode.GENERATE_NEW,
        objective_summary=request.objective_summary,
        material_id=request.material_id,
        parameters=parameters,
        inputs=canonical_inputs,
        design_variables=design_variables,
        candidate_budget=request.candidate_budget,
        mesh_preset=request.mesh_preset,
    )
    # The chosen objectives replace the profile defaults, keeping the user's
    # ordering: the first is treated as primary when ranking candidates.
    spec = spec.model_copy(
        update={"random_seed": request.random_seed, "objectives": chosen}
    )
    return spec, parameters, canonical_inputs


# --------------------------------------------------------------------------- #
# Running and persisting
# --------------------------------------------------------------------------- #


def run_study_job(
    *,
    ctx: JobContext,
    component_instance_id: str,
    request: StudyRequest,
) -> dict[str, Any]:
    """Job entry point: run a study and persist everything it produced."""
    with session_scope() as session:
        component = session.get(ComponentInstance, component_instance_id)
        if component is None:
            raise ValueError(f"unknown component instance {component_instance_id!r}")
        project_id = component.project_id
        component_type = ComponentType(component.component_type)

    profile = get_profile(component_type)
    spec, parameters, canonical_inputs = build_specification(profile, request)

    store = get_store()
    paths = store.component_paths(project_id, component_instance_id)
    run_id = new_id("opt")
    run_dir = paths.simulations / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    with session_scope() as session:
        spec_record = EngineeringSpecificationRecord(
            component_instance_id=component_instance_id,
            payload=spec.model_dump(mode="json"),
            engineering_inputs=canonical_inputs,
            assumptions=[a.model_dump(mode="json") for a in spec.assumptions],
        )
        session.add(spec_record)
        session.flush()
        spec_id = spec_record.id

        session.add(
            OptimizationRun(
                id=run_id,
                component_instance_id=component_instance_id,
                specification_id=spec_id,
                algorithm=request.strategy,
                random_seed=spec.random_seed,
                candidate_budget=request.candidate_budget,
                generations=request.generations if request.strategy == "nsga2" else 1,
                design_variables=list(spec.design_variables),
                objective_definitions=[o.model_dump(mode="json") for o in spec.objectives],
                constraint_definitions=[
                    c.model_dump(mode="json") for c in spec.all_constraints()
                ],
                status="running",
            )
        )

    with session_scope() as session:
        job = session.get(Job, ctx.job_id)
        if job is not None:
            job.optimization_run_id = run_id

    ctx.update(stage=JobStage.VALIDATING.value, progress=0.01, message="Specification validated")

    def progress(fraction: float, stage: str, message: str) -> None:
        ctx.update(stage=stage, progress=0.02 + fraction * 0.95, message=message)

    result = run_exploration(
        profile=profile,
        spec=spec,
        baseline_parameters=parameters,
        storage_dir=run_dir,
        run_id=run_id,
        progress=progress,
        strategy=request.strategy,
        population_size=request.population_size,
        generations=request.generations,
        verify_winner=request.verify_winner,
        mesh_preset=request.mesh_preset,
        time_budget_seconds=request.time_budget_seconds,
    )

    ctx.update(stage=JobStage.PACKAGING.value, progress=0.98, message="Saving results")
    persist_study(
        run_id=run_id,
        spec_id=spec_id,
        component_instance_id=component_instance_id,
        spec=spec,
        request=request,
        result=result,
        profile=profile,
    )

    return {
        "optimization_run_id": run_id,
        "specification_id": spec_id,
        "candidates_generated": result.generated,
        "candidates_evaluated": result.evaluated,
        "candidates_feasible": result.feasible,
        "candidates_failed": result.failed,
        "recommended_candidate_id": result.recommended_id,
        "baseline_candidate_id": result.baseline_id,
        "results_url": f"/api/studies/{run_id}",
    }


def persist_study(
    *,
    run_id: str,
    spec_id: str,
    component_instance_id: str,
    spec: EngineeringSpecification,
    request: StudyRequest,
    result: ExplorationResult,
    profile: ComponentProfile,
) -> None:
    """Write designs, runs, results and candidates for every evaluated point."""
    solver = get_solver(spec.solver_settings.solver_id)

    with session_scope() as session:
        for record in result.candidates:
            output = result.outputs.get(record.candidate_id)
            geometry = output.geometry if output else None
            sim = output.result if output else None

            design = DesignVersion(
                component_instance_id=component_instance_id,
                optimization_run_id=run_id,
                label=("Baseline" if record.is_baseline else f"Candidate {record.index}"),
                is_baseline=record.is_baseline,
                generation=record.generation,
                candidate_index=record.index,
                parameters=record.parameters,
                geometry_hash=record.geometry_hash or "",
                generator_name=profile.generator.name,
                generator_version=profile.generator.version,
                material_snapshot=(sim.material_snapshot if sim else {}),
                status=record.status.value,
                is_feasible=record.is_feasible,
                failure_stage=record.failure_stage,
                failure_reason=record.failure_reason,
                step_path=record.step_path,
                preview_glb_path=record.preview_glb_path,
                geometry_validation=(
                    geometry.validation.model_dump(mode="json") if geometry else None
                ),
                volume_m3=record.metrics.get("volume_m3"),
                mass_kg=record.metrics.get("mass_kg"),
                rank=record.rank,
                pareto_front=record.pareto_front,
            )
            session.add(design)
            session.flush()

            sim_run_id: Optional[str] = None
            if sim is not None:
                run = SimulationRun(
                    design_version_id=design.id,
                    specification_id=spec_id,
                    analysis_type=sim.analysis_type.value,
                    load_case_id=sim.load_case_id,
                    solver_id=solver.solver_id,
                    solver_name=sim.solver_name,
                    solver_version=sim.solver_version,
                    result_kind=sim.result_kind.value,
                    mesh_preset=request.mesh_preset,
                    mesh_settings=spec.mesh_settings.model_dump(mode="json"),
                    mesh_metadata=sim.mesh_metadata.model_dump(mode="json"),
                    solver_settings=spec.solver_settings.model_dump(mode="json"),
                    material_snapshot=sim.material_snapshot,
                    status="completed",
                    degrees_of_freedom=sim.degrees_of_freedom,
                    solve_time_seconds=sim.solve_time_seconds,
                    linear_solver_report=sim.linear_solver_report,
                )
                session.add(run)
                session.flush()
                sim_run_id = run.id

                session.add(
                    SimulationResultRecord(
                        simulation_run_id=run.id,
                        summary_metrics=record.metrics,
                        constraint_results=[
                            c.model_dump(mode="json") for c in record.constraint_results
                        ],
                        objective_values=[
                            o.model_dump(mode="json") for o in record.objective_values
                        ],
                        region_applications=[
                            r.model_dump(mode="json") for r in sim.region_applications
                        ],
                        load_verifications=[
                            v.model_dump(mode="json") for v in sim.load_verifications
                        ],
                        is_feasible=record.is_feasible,
                        infeasibility_reasons=record.infeasibility_reasons,
                        field_artifact_path=record.field_artifact_path,
                        field_artifact_metadata=(
                            sim.field_artifact.model_dump(mode="json")
                            if sim.field_artifact
                            else None
                        ),
                        method_statement=sim.method_statement,
                        warnings=record.warnings,
                    )
                )

            session.add(
                Candidate(
                    id=record.candidate_id,
                    optimization_run_id=run_id,
                    design_version_id=design.id,
                    simulation_run_id=sim_run_id,
                    candidate_index=record.index,
                    generation=record.generation,
                    parameters=record.parameters,
                    geometry_hash=record.geometry_hash or "",
                    status=record.status.value,
                    is_baseline=record.is_baseline,
                    from_cache=record.from_cache,
                    metrics=record.metrics,
                    constraint_results=[
                        c.model_dump(mode="json") for c in record.constraint_results
                    ],
                    objective_values=[
                        o.model_dump(mode="json") for o in record.objective_values
                    ],
                    is_feasible=record.is_feasible,
                    infeasibility_reasons=record.infeasibility_reasons,
                    failure_stage=record.failure_stage,
                    failure_reason=record.failure_reason,
                    warnings=record.warnings,
                    rank=record.rank,
                    pareto_front=record.pareto_front,
                    step_path=record.step_path,
                    preview_glb_path=record.preview_glb_path,
                    field_artifact_path=record.field_artifact_path,
                    solve_time_seconds=record.solve_time_seconds,
                    mesh_node_count=record.mesh_node_count,
                    assurance=(
                        record.assurance.model_dump(mode="json")
                        if record.assurance is not None
                        else None
                    ),
                )
            )

        opt = session.get(OptimizationRun, run_id)
        if opt is not None:
            opt.status = "completed"
            opt.termination_reason = result.termination_reason
            opt.candidates_generated = result.generated
            opt.candidates_evaluated = result.evaluated
            opt.candidates_feasible = result.feasible
            opt.candidates_failed = result.failed
            opt.cache_hits = result.cache_hits
            opt.total_seconds = result.total_seconds
            from datetime import datetime, timezone

            opt.completed_at = datetime.now(timezone.utc)

    # Study-level artifact the report and the UI read back.
    _write_study_summary(run_id, spec, result)


def _write_study_summary(
    run_id: str, spec: EngineeringSpecification, result: ExplorationResult
) -> None:
    """Persist the study-level JSON next to the candidate artifacts."""
    import json

    first = next(
        (c.step_path for c in result.candidates if c.step_path), None
    )
    if not first:
        return
    run_dir = Path(first).parent.parent
    payload = {
        "optimization_run_id": run_id,
        "algorithm": result.algorithm,
        "random_seed": result.seed,
        "termination_reason": result.termination_reason,
        "summary": result.metrics_summary(),
        "recommendation": result.recommendation,
        "comparison": result.comparison,
        "mesh_convergence": result.mesh_convergence.__dict__,
        "specification": spec.model_dump(mode="json"),
    }
    (run_dir / "study_summary.json").write_text(
        json.dumps(payload, indent=2, default=str), encoding="utf-8"
    )
