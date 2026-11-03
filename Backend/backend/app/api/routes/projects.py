"""Project and component-instance endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.serializers import profile_to_out
from app.core.ids import is_safe_id
from app.core.logging import get_logger
from app.db.models import ComponentInstance, DesignVersion, Job, Project
from app.db.session import get_session
from app.engineering.profiles.registry import available_profiles, get_profile
from app.schemas.api import (
    ComponentCreate,
    ComponentOut,
    ProfileOut,
    ProjectCreate,
    ProjectOut,
)
from app.schemas.common import ComponentType
from app.services.artifact_store import get_store

log = get_logger(__name__)
router = APIRouter(tags=["projects"])


def _require_safe(identifier: str, label: str) -> str:
    if not is_safe_id(identifier):
        raise HTTPException(status_code=400, detail=f"malformed {label}")
    return identifier


# --------------------------------------------------------------------------- #
# Component profile catalog
# --------------------------------------------------------------------------- #


@router.get("/components/profiles", response_model=list[ProfileOut])
def list_profiles() -> list[ProfileOut]:
    return [profile_to_out(p) for p in available_profiles()]


@router.get("/components/profiles/{component_type}", response_model=ProfileOut)
def get_component_profile(component_type: ComponentType) -> ProfileOut:
    try:
        return profile_to_out(get_profile(component_type))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# --------------------------------------------------------------------------- #
# Projects
# --------------------------------------------------------------------------- #


@router.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, session: Session = Depends(get_session)) -> ProjectOut:
    project = Project(name=payload.name.strip(), description=payload.description)
    session.add(project)
    session.commit()
    session.refresh(project)
    log.info("created project %s (%s)", project.id, project.name)
    return _project_out(session, project)


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(session: Session = Depends(get_session)) -> list[ProjectOut]:
    projects = session.query(Project).order_by(Project.updated_at.desc()).all()
    return [_project_out(session, p) for p in projects]


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, session: Session = Depends(get_session)) -> ProjectOut:
    project = session.get(Project, _require_safe(project_id, "project id"))
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return _project_out(session, project)


@router.get("/projects/{project_id}/components", response_model=list[ComponentOut])
def list_project_components(
    project_id: str, session: Session = Depends(get_session)
) -> list[ComponentOut]:
    if session.get(Project, _require_safe(project_id, "project id")) is None:
        raise HTTPException(status_code=404, detail="project not found")
    rows = (
        session.query(ComponentInstance)
        .filter(ComponentInstance.project_id == project_id)
        .order_by(ComponentInstance.created_at.desc())
        .all()
    )
    return [_component_out(c) for c in rows]


def _project_out(session: Session, project: Project) -> ProjectOut:
    component_ids = [
        row[0]
        for row in session.query(ComponentInstance.id)
        .filter(ComponentInstance.project_id == project.id)
        .all()
    ]
    designs = (
        session.query(func.count(DesignVersion.id))
        .filter(DesignVersion.component_instance_id.in_(component_ids))
        .scalar()
        if component_ids
        else 0
    )
    jobs = (
        session.query(func.count(Job.id)).filter(Job.project_id == project.id).scalar() or 0
    )
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        created_at=project.created_at,
        updated_at=project.updated_at,
        component_count=len(component_ids),
        design_count=int(designs or 0),
        job_count=int(jobs),
    )


def _component_out(c: ComponentInstance) -> ComponentOut:
    return ComponentOut(
        id=c.id,
        project_id=c.project_id,
        component_type=c.component_type,
        design_mode=c.design_mode,
        name=c.name,
        unit_system=c.unit_system,
        source_asset_path=c.source_asset_path,
        source_metadata=c.source_metadata,
        source_is_parametric=c.source_is_parametric,
        created_at=c.created_at,
    )


# --------------------------------------------------------------------------- #
# Component instances
# --------------------------------------------------------------------------- #


@router.post("/components", response_model=ComponentOut, status_code=status.HTTP_201_CREATED)
def create_component(
    payload: ComponentCreate, session: Session = Depends(get_session)
) -> ComponentOut:
    if session.get(Project, _require_safe(payload.project_id, "project id")) is None:
        raise HTTPException(status_code=404, detail="project not found")
    try:
        get_profile(payload.component_type)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    component = ComponentInstance(
        project_id=payload.project_id,
        component_type=payload.component_type.value,
        design_mode=payload.design_mode.value,
        name=payload.name.strip(),
    )
    session.add(component)
    session.commit()
    session.refresh(component)
    get_store().component_paths(component.project_id, component.id)
    log.info("created component %s (%s)", component.id, component.component_type)
    return _component_out(component)


@router.get("/components/{component_id}", response_model=ComponentOut)
def get_component(component_id: str, session: Session = Depends(get_session)) -> ComponentOut:
    component = session.get(ComponentInstance, _require_safe(component_id, "component id"))
    if component is None:
        raise HTTPException(status_code=404, detail="component not found")
    return _component_out(component)


@router.post("/components/{component_id}/import")
async def import_cad(
    component_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Upload an existing STEP model for viewing and analysis.

    Importing is deliberately honest about its limits: an arbitrary STEP solid
    is accepted for display and meshing, but it carries no parametric feature
    model, so the generative search cannot regenerate it. That is reported in
    the response and shown in the UI (spec 1.1).
    """
    component = session.get(ComponentInstance, _require_safe(component_id, "component id"))
    if component is None:
        raise HTTPException(status_code=404, detail="component not found")

    data = await file.read()
    store = get_store()
    try:
        path, meta = store.store_upload(
            component.project_id, component.id, file.filename or "upload.step", data
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    from app.engineering.cad.importer import inspect_step

    try:
        inspection = inspect_step(path)
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"the uploaded file could not be read as a STEP solid: {exc}",
        ) from exc

    component.source_asset_path = str(path)
    component.source_metadata = {**meta, **inspection}
    component.source_is_parametric = False
    session.commit()

    return {
        "component_id": component.id,
        "stored_metadata": component.source_metadata,
        "parametric_regeneration_available": False,
        "capability_note": (
            "This model is imported for viewing, meshing and analysis. It has no "
            "parametric feature model, so the generative search cannot regenerate it. "
            "To explore design variants, use the matching built-in component template "
            "and set its parameters to match this part."
        ),
    }
