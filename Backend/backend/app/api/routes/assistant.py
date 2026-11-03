"""AI assistant endpoints (spec 7).

Both endpoints work with no API key: the deterministic parser and the template
explainer are the default path, and an LLM is an optional enhancement that is
re-validated against the same schemas.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Candidate, OptimizationRun, SimulationRun
from app.db.session import get_session
from app.engineering.ai.requirement_parser import RequirementDraft, parse_requirements
from app.engineering.ai.result_explainer import (
    Explanation,
    explain_candidate,
    explain_study,
)
from app.engineering.optimization.evaluation import CandidateRecord
from app.schemas.common import ComponentType

router = APIRouter(tags=["assistant"])


class InterpretRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    component_type: Optional[ComponentType] = None
    use_llm: bool = True


@router.post("/assistant/interpret", response_model=RequirementDraft)
def interpret(payload: InterpretRequest) -> RequirementDraft:
    """Draft a structured requirement from free text. Never runs anything."""
    return parse_requirements(
        payload.text, payload.component_type, use_llm=payload.use_llm
    )


@router.get("/assistant/status")
def assistant_status() -> dict[str, Any]:
    settings = get_settings()
    return {
        "llm_configured": settings.llm_available,
        "llm_model": settings.llm_model if settings.llm_available else None,
        "default_parser": (
            "llm_validated" if settings.llm_available else "deterministic_offline"
        ),
        "note": (
            "The assistant drafts and explains. It cannot supply a load, a limit, a "
            "material property or a boundary condition, and it cannot mark a run as "
            "ready. Every value it proposes is re-validated against the component "
            "schema before it can be used."
        ),
        "works_without_llm": True,
    }


def _record_from_db(candidate: Candidate) -> CandidateRecord:
    """Rebuild the in-memory record from the stored row."""
    return CandidateRecord.model_validate(
        {
            "candidate_id": candidate.id,
            "index": candidate.candidate_index,
            "generation": candidate.generation,
            "parameters": candidate.parameters or {},
            "geometry_hash": candidate.geometry_hash or "",
            "status": candidate.status,
            "is_baseline": candidate.is_baseline,
            "from_cache": candidate.from_cache,
            "metrics": candidate.metrics or {},
            "constraint_results": candidate.constraint_results or [],
            "objective_values": candidate.objective_values or [],
            "is_feasible": candidate.is_feasible,
            "infeasibility_reasons": candidate.infeasibility_reasons or [],
            "failure_reason": candidate.failure_reason,
            "failure_stage": candidate.failure_stage,
            "rank": candidate.rank,
            "pareto_front": candidate.pareto_front,
            "solve_time_seconds": candidate.solve_time_seconds,
            "mesh_node_count": candidate.mesh_node_count,
            "warnings": candidate.warnings or [],
            "assurance": candidate.assurance,
        }
    )


def _recommended_maturity(
    records: list[CandidateRecord], recommendation: dict | None
) -> str | None:
    """The maturity level of the candidate the study recommends.

    Passed to the claim guard so that the narrative is checked against the
    evidence of the design it is actually recommending.
    """
    candidate_id = (recommendation or {}).get("candidate_id")
    for record in records:
        if record.candidate_id == candidate_id and record.assurance is not None:
            return record.assurance.maturity.level.value
    return None


@router.get("/assistant/explain/candidate/{candidate_id}", response_model=Explanation)
def explain_one(candidate_id: str, session: Session = Depends(get_session)) -> Explanation:
    """Explain a single candidate from its stored result only."""
    candidate = session.get(Candidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="candidate not found")

    baseline_row = (
        session.query(Candidate)
        .filter(
            Candidate.optimization_run_id == candidate.optimization_run_id,
            Candidate.is_baseline.is_(True),
        )
        .first()
    )
    run = (
        session.get(SimulationRun, candidate.simulation_run_id)
        if candidate.simulation_run_id
        else None
    )

    from app.api.routes.studies import _study_summary_file

    rows = [candidate] + ([baseline_row] if baseline_row else [])
    summary = _study_summary_file(rows)

    return explain_candidate(
        _record_from_db(candidate),
        baseline=_record_from_db(baseline_row) if baseline_row else None,
        method_statement=(run.solver_name if run else ""),
        solver_name=(run.solver_name if run else ""),
        mesh_nodes=candidate.mesh_node_count,
        mesh_preset=(run.mesh_preset if run else None),
        mesh_convergence=summary.get("mesh_convergence"),
    )


@router.get("/assistant/explain/study/{run_id}", response_model=Explanation)
def explain_whole_study(run_id: str, session: Session = Depends(get_session)) -> Explanation:
    """Explain a whole study: what was searched, found, and what failed."""
    run = session.get(OptimizationRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="study not found")

    candidates = (
        session.query(Candidate)
        .filter(Candidate.optimization_run_id == run_id)
        .order_by(Candidate.candidate_index.asc())
        .all()
    )
    records = [_record_from_db(c) for c in candidates]

    from app.api.routes.studies import _study_summary_file
    from app.api.serializers import optimization_run_summary

    summary_file = _study_summary_file(candidates)
    solver_name = ""
    for c in candidates:
        if c.simulation_run_id:
            sim = session.get(SimulationRun, c.simulation_run_id)
            if sim is not None:
                solver_name = sim.solver_name
                break

    return explain_study(
        candidates=records,
        recommendation=summary_file.get("recommendation"),
        comparison=summary_file.get("comparison"),
        algorithm=summary_file.get("algorithm") or run.algorithm,
        summary=optimization_run_summary(session, run),
        method_statement=solver_name,
        mesh_convergence=summary_file.get("mesh_convergence"),
        maturity=_recommended_maturity(records, summary_file.get("recommendation")),
    )
