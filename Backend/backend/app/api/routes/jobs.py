"""Job status endpoints (spec 5.5).

Progress is read by polling. A failed job returns its stage, message and error
so the engineer sees what actually went wrong instead of a blank failure.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.ids import is_safe_id
from app.db.models import Job
from app.db.session import get_session
from app.schemas.api import JobOut
from app.services.job_manager import get_job_manager

router = APIRouter(tags=["jobs"])


def _safe(identifier: str) -> str:
    if not is_safe_id(identifier):
        raise HTTPException(status_code=400, detail="malformed job id")
    return identifier


def _to_out(job: Job) -> JobOut:
    log_exists = bool(job.log_path and Path(job.log_path).exists())
    return JobOut(
        id=job.id,
        job_type=job.job_type,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        message=job.message,
        error=job.error,
        project_id=job.project_id,
        component_instance_id=job.component_instance_id,
        optimization_run_id=job.optimization_run_id,
        stage_history=job.stage_history or [],
        result_payload=job.result_payload,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        log_available=log_exists,
    )


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, session: Session = Depends(get_session)) -> JobOut:
    job = session.get(Job, _safe(job_id))
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return _to_out(job)


@router.get("/jobs", response_model=list[JobOut])
def list_jobs(
    project_id: str | None = None,
    component_instance_id: str | None = None,
    limit: int = 50,
    session: Session = Depends(get_session),
) -> list[JobOut]:
    query = session.query(Job)
    if project_id:
        query = query.filter(Job.project_id == _safe(project_id))
    if component_instance_id:
        query = query.filter(Job.component_instance_id == _safe(component_instance_id))
    jobs = query.order_by(Job.created_at.desc()).limit(min(max(limit, 1), 200)).all()
    return [_to_out(j) for j in jobs]


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    job = session.get(Job, _safe(job_id))
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    requested = get_job_manager().cancel(job_id)
    return {
        "job_id": job_id,
        "cancellation_requested": requested,
        "note": (
            "The worker stops at its next stage boundary. Artifacts already produced "
            "are kept."
            if requested
            else "This job is not currently running."
        ),
    }


@router.get("/jobs/{job_id}/log", response_class=PlainTextResponse)
def get_job_log(job_id: str, session: Session = Depends(get_session)) -> str:
    job = session.get(Job, _safe(job_id))
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if not job.log_path:
        raise HTTPException(status_code=404, detail="this job has no log")
    path = Path(job.log_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="the log file is no longer present")
    return path.read_text(encoding="utf-8", errors="replace")
