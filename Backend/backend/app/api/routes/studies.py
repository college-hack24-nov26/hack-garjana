"""Study endpoints: start a generative run and read its results."""
from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.serializers import (
    asset_url,
    candidate_to_out,
    optimization_run_summary,
)
from app.core.ids import is_safe_id
from app.core.logging import get_logger
from app.db.models import (
    Candidate,
    ComponentInstance,
    EngineeringSpecificationRecord,
    OptimizationRun,
    SimulationResultRecord,
    SimulationRun,
)
from app.db.session import get_session
from app.engineering.profiles.registry import get_profile
from app.engineering.solvers.registry import get_solver
from app.schemas.api import (
    CandidateOut,
    JobAccepted,
    StudyRequest,
    StudyResultOut,
    VisualizationPayload,
)
from app.schemas.common import Assumption, ComponentType, JobType
from app.services.artifact_store import get_store
from app.services.job_manager import get_job_manager
from app.services.study_service import StudyValidationError, build_specification, run_study_job

log = get_logger(__name__)
router = APIRouter(tags=["studies"])


def _safe(identifier: str, label: str) -> str:
    if not is_safe_id(identifier):
        raise HTTPException(status_code=400, detail=f"malformed {label}")
    return identifier


@router.post("/studies/validate")
def validate_study(payload: StudyRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    """Dry-run the validation so the UI can show problems before committing."""
    component = session.get(
        ComponentInstance, _safe(payload.component_instance_id, "component id")
    )
    if component is None:
        raise HTTPException(status_code=404, detail="component not found")

    profile = get_profile(ComponentType(component.component_type))
    try:
        spec, parameters, inputs = build_specification(profile, payload)
    except StudyValidationError as exc:
        return JSONResponse(status_code=422, content=exc.response.model_dump(mode="json"))

    return {
        "ok": True,
        "message": "The specification is complete and runnable.",
        "resolved_parameters": parameters,
        "canonical_engineering_inputs": inputs,
        "constraints": [c.describe() for c in spec.all_constraints()],
        "objectives": [o.model_dump(mode="json") for o in spec.objectives],
        "mesh_settings": spec.mesh_settings.model_dump(mode="json"),
        "design_variables": spec.design_variables,
        "assumptions": [a.model_dump(mode="json") for a in spec.assumptions],
    }


@router.post("/studies", response_model=JobAccepted, status_code=202)
def start_study(payload: StudyRequest, session: Session = Depends(get_session)) -> Any:
    """Queue a generative study. Long work never runs in the request (spec 5.5)."""
    component = session.get(
        ComponentInstance, _safe(payload.component_instance_id, "component id")
    )
    if component is None:
        raise HTTPException(status_code=404, detail="component not found")

    profile = get_profile(ComponentType(component.component_type))
    try:
        build_specification(profile, payload)
    except StudyValidationError as exc:
        return JSONResponse(status_code=422, content=exc.response.model_dump(mode="json"))

    component_id = component.id
    project_id = component.project_id
    request_copy = payload.model_copy(deep=True)

    job_id, deduplicated = get_job_manager().submit(
        job_type=JobType.OPTIMIZATION,
        fn=lambda ctx: run_study_job(
            ctx=ctx, component_instance_id=component_id, request=request_copy
        ),
        payload=request_copy.model_dump(mode="json"),
        project_id=project_id,
        component_instance_id=component_id,
    )
    return JobAccepted(
        job_id=job_id,
        status="queued",
        deduplicated=deduplicated,
        poll_url=f"/api/jobs/{job_id}",
    )


@router.get("/studies", response_model=list[dict])
def list_studies(
    component_instance_id: str | None = None, session: Session = Depends(get_session)
) -> list[dict]:
    query = session.query(OptimizationRun)
    if component_instance_id:
        query = query.filter(
            OptimizationRun.component_instance_id
            == _safe(component_instance_id, "component id")
        )
    runs = query.order_by(OptimizationRun.started_at.desc()).limit(100).all()
    return [
        {
            "optimization_run_id": r.id,
            "component_instance_id": r.component_instance_id,
            "algorithm": r.algorithm,
            "status": r.status,
            "candidates_generated": r.candidates_generated,
            "candidates_feasible": r.candidates_feasible,
            "started_at": r.started_at,
            "completed_at": r.completed_at,
            "total_seconds": r.total_seconds,
        }
        for r in runs
    ]


@router.get("/studies/{run_id}", response_model=StudyResultOut)
def get_study(run_id: str, session: Session = Depends(get_session)) -> StudyResultOut:
    run = session.get(OptimizationRun, _safe(run_id, "run id"))
    if run is None:
        raise HTTPException(status_code=404, detail="study not found")

    component = session.get(ComponentInstance, run.component_instance_id)
    if component is None:
        raise HTTPException(status_code=404, detail="component not found")
    profile = get_profile(ComponentType(component.component_type))
    solver = get_solver(profile.solver_id)

    candidates = (
        session.query(Candidate)
        .filter(Candidate.optimization_run_id == run.id)
        .order_by(Candidate.candidate_index.asc())
        .all()
    )

    spec_payload: dict = {}
    assumptions: list[Assumption] = []
    if run.specification_id:
        record = session.get(EngineeringSpecificationRecord, run.specification_id)
        if record is not None:
            spec_payload = record.payload or {}
            assumptions = [Assumption.model_validate(a) for a in (record.assumptions or [])]

    summary = _study_summary_file(candidates)

    baseline = next((c for c in candidates if c.is_baseline), None)
    recommended_id = (summary.get("recommendation") or {}).get("candidate_id")

    warnings: list[str] = []
    for c in candidates:
        warnings.extend(c.warnings or [])

    return StudyResultOut(
        optimization_run_id=run.id,
        component_instance_id=run.component_instance_id,
        component_type=ComponentType(component.component_type),
        analysis_type=profile.analysis_type,
        algorithm=summary.get("algorithm") or run.algorithm,
        random_seed=run.random_seed,
        status=run.status,
        started_at=run.started_at,
        completed_at=run.completed_at,
        solver_name=solver.solver_name,
        solver_version=solver.solver_version,
        method_statement=solver.method_statement,
        mesh_preset=_mesh_preset_of(session, candidates),
        summary=optimization_run_summary(session, run),
        termination_reason=run.termination_reason or summary.get("termination_reason", ""),
        candidates=[candidate_to_out(c) for c in candidates],
        baseline_candidate_id=baseline.id if baseline else None,
        recommended_candidate_id=recommended_id,
        recommendation=summary.get("recommendation"),
        comparison=summary.get("comparison") or {},
        mesh_convergence=summary.get("mesh_convergence") or {},
        objectives=run.objective_definitions or [],
        constraints=run.constraint_definitions or [],
        assumptions=assumptions,
        specification=spec_payload,
        warnings=sorted(set(warnings)),
    )


def _study_summary_file(candidates: list[Candidate]) -> dict:
    """Read the study-level JSON written next to the candidate artifacts."""
    import json

    for c in candidates:
        if not c.step_path:
            continue
        from pathlib import Path

        path = Path(c.step_path).parent.parent / "study_summary.json"
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return {}
    return {}


def _mesh_preset_of(session: Session, candidates: list[Candidate]) -> str:
    for c in candidates:
        if c.simulation_run_id:
            run = session.get(SimulationRun, c.simulation_run_id)
            if run is not None:
                return run.mesh_preset
    return "exploration"


@router.get("/candidates/{candidate_id}", response_model=CandidateOut)
def get_candidate(candidate_id: str, session: Session = Depends(get_session)) -> CandidateOut:
    candidate = session.get(Candidate, _safe(candidate_id, "candidate id"))
    if candidate is None:
        raise HTTPException(status_code=404, detail="candidate not found")
    return candidate_to_out(candidate)


@router.get("/candidates/{candidate_id}/diagnostics")
def candidate_diagnostics(
    candidate_id: str, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """The provenance of one result: regions, mesh, solver, load check (spec 8.4)."""
    candidate = session.get(Candidate, _safe(candidate_id, "candidate id"))
    if candidate is None:
        raise HTTPException(status_code=404, detail="candidate not found")

    out: dict[str, Any] = {
        "candidate_id": candidate.id,
        "status": candidate.status,
        "geometry_hash": candidate.geometry_hash,
        "parameters": candidate.parameters,
        "failure_stage": candidate.failure_stage,
        "failure_reason": candidate.failure_reason,
        "warnings": candidate.warnings or [],
    }

    if not candidate.simulation_run_id:
        out["note"] = (
            "This candidate produced no simulation run, so there is nothing to show "
            "beyond the failure above."
        )
        return out

    run = session.get(SimulationRun, candidate.simulation_run_id)
    result = (
        session.query(SimulationResultRecord)
        .filter(SimulationResultRecord.simulation_run_id == candidate.simulation_run_id)
        .first()
    )
    if run is not None:
        out["solver"] = {
            "solver_id": run.solver_id,
            "name": run.solver_name,
            "version": run.solver_version,
            "result_kind": run.result_kind,
            "analysis_type": run.analysis_type,
            "load_case_id": run.load_case_id,
            "degrees_of_freedom": run.degrees_of_freedom,
            "solve_time_seconds": run.solve_time_seconds,
            "linear_solver": run.linear_solver_report,
        }
        out["mesh"] = run.mesh_metadata
        out["mesh_settings"] = run.mesh_settings
        out["mesh_preset"] = run.mesh_preset
        out["material_snapshot"] = run.material_snapshot
    if result is not None:
        out["region_applications"] = result.region_applications
        out["load_verifications"] = result.load_verifications
        out["constraint_results"] = result.constraint_results
        out["method_statement"] = result.method_statement
        out["field_artifact"] = result.field_artifact_metadata
    return out


@router.get("/candidates/{candidate_id}/visualization", response_model=VisualizationPayload)
def candidate_visualization(
    candidate_id: str,
    deformation_scale: float | None = None,
    session: Session = Depends(get_session),
) -> VisualizationPayload:
    """Result fields for the 3D viewer, labelled with what they actually are."""
    candidate = session.get(Candidate, _safe(candidate_id, "candidate id"))
    if candidate is None:
        raise HTTPException(status_code=404, detail="candidate not found")
    if not candidate.field_artifact_path:
        raise HTTPException(
            status_code=404,
            detail=(
                "this candidate has no stored result field; it did not complete a solve"
            ),
        )

    store = get_store()
    try:
        path = store.resolve(candidate.field_artifact_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.exists():
        raise HTTPException(status_code=410, detail="the stored result field is missing")

    data = np.load(path)
    nodes = data["nodes"].astype(float)
    faces = data["faces"].astype(int)

    run = session.get(SimulationRun, candidate.simulation_run_id) if candidate.simulation_run_id else None
    result = (
        session.query(SimulationResultRecord)
        .filter(SimulationResultRecord.simulation_run_id == candidate.simulation_run_id)
        .first()
        if candidate.simulation_run_id
        else None
    )
    meta = (result.field_artifact_metadata or {}) if result else {}

    payload = VisualizationPayload(
        candidate_id=candidate.id,
        result_kind=(run.result_kind if run else "unknown"),
        analysis_type=(run.analysis_type if run else "unknown"),
        geometry_asset_url=asset_url(candidate.preview_glb_path),
        node_count=int(nodes.shape[0]),
        triangle_count=int(faces.shape[0]),
        nodes=nodes.tolist(),
        faces=faces.tolist(),
        stress_location=meta.get("stress_location"),
        temperature_location=meta.get("temperature_location"),
        method_statement=(result.method_statement if result else ""),
    )

    if "displacement" in data:
        disp = data["displacement"].astype(float)
        magnitude = np.linalg.norm(disp, axis=1)
        true_max = float(magnitude.max())
        payload.displacement = disp.tolist()
        payload.displacement_range_m = (float(magnitude.min()), true_max)
        payload.max_displacement_m = true_max

        # Choose an exaggeration that makes the shape readable relative to the
        # model size, and state it. The true maximum travels with it.
        model_size = float(np.ptp(nodes, axis=0).max())
        if deformation_scale is not None:
            scale = max(float(deformation_scale), 0.0)
        elif true_max > 0:
            scale = float(np.clip((0.04 * model_size) / true_max, 1.0, 2000.0))
            scale = float(round(scale, -int(np.floor(np.log10(scale)))) if scale >= 10 else round(scale))
        else:
            scale = 1.0
        payload.recommended_deformation_scale = scale
        payload.visualization_note = (
            f"Displacement is exaggerated {scale:g}x for display. The computed maximum "
            f"displacement is {true_max * 1000:.4f} mm. Animating from zero to the "
            "solved shape is a visualization of one linear static solution, not a "
            "transient or dynamic analysis."
        )

    if "von_mises" in data:
        vm = data["von_mises"].astype(float)
        payload.von_mises = vm.tolist()
        payload.stress_range_pa = (float(vm.min()), float(vm.max()))

    if "temperature" in data:
        temp = data["temperature"].astype(float)
        payload.temperature = temp.tolist()
        payload.temperature_range_k = (float(temp.min()), float(temp.max()))
        payload.visualization_note = (
            "Colours show the computed steady-state temperature field. A ramp from "
            "ambient to this field is a steady-state result visualization, not a "
            "transient thermal simulation."
        )

    return payload
