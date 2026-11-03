"""Report generation endpoints (spec 8.1)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.ids import is_safe_id
from app.db.session import get_session
from app.services.artifact_store import get_store
from app.services.report_service import build_report, render_markdown, write_report

router = APIRouter(tags=["reports"])


class ReportRequest(BaseModel):
    optimization_run_id: str


def _safe(identifier: str) -> str:
    if not is_safe_id(identifier):
        raise HTTPException(status_code=400, detail="malformed study id")
    return identifier


@router.post("/reports/generate")
def generate_report(
    payload: ReportRequest, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Build and persist the report, returning its download links."""
    try:
        md_path, report = write_report(session, _safe(payload.optimization_run_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    store = get_store()
    run_id = _safe(payload.optimization_run_id)
    rel_md = store.relative(md_path)
    rel_json = store.relative(md_path.with_name(md_path.stem + ".json").with_suffix(".json"))
    rel_manifest = store.relative(
        md_path.with_name(f"{run_id}_evidence_manifest.json")
    )

    assurance = (report.get("assurance") or {}).get("recommended_design") or {}
    return {
        "optimization_run_id": payload.optimization_run_id,
        "title": report["title"],
        "markdown_url": f"/api/assets/{rel_md}",
        "json_url": f"/api/assets/{rel_json}",
        #: The machine-readable evidence manifest, meant to travel alongside
        #: the exported STEP file so the geometry stays accountable.
        "evidence_manifest_url": f"/api/assets/{rel_manifest}",
        "inline_url": f"/api/reports/{payload.optimization_run_id}/markdown",
        "candidate_count": len(report["candidates"]),
        "recommended_candidate_id": report.get("recommended_candidate_id"),
        "maturity_level": assurance.get("maturity_level"),
        "verification_status": assurance.get("verification_status"),
        "validation_status": assurance.get("validation_status"),
    }


@router.get("/reports/{run_id}")
def get_report(run_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return build_report(session, _safe(run_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/reports/{run_id}/markdown", response_class=PlainTextResponse)
def get_report_markdown(run_id: str, session: Session = Depends(get_session)) -> str:
    try:
        return render_markdown(build_report(session, _safe(run_id)))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
