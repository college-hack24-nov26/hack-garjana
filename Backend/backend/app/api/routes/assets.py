"""Artifact download endpoints.

Every requested path is resolved through the artifact store, which refuses any
path that escapes the storage root, so a crafted URL cannot read arbitrary
files from the machine.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services.artifact_store import ArtifactPathError, get_store

router = APIRouter(tags=["assets"])

_MEDIA_TYPES = {
    ".step": "model/step",
    ".stp": "model/step",
    ".glb": "model/gltf-binary",
    ".stl": "model/stl",
    ".json": "application/json",
    ".npz": "application/octet-stream",
    ".msh": "application/octet-stream",
    ".log": "text/plain",
}


@router.get("/assets/{asset_path:path}")
def get_asset(asset_path: str, download: bool = False) -> FileResponse:
    store = get_store()
    try:
        path = store.resolve(asset_path)
    except ArtifactPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="artifact not found")

    media_type = _MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(
        path,
        media_type=media_type,
        filename=path.name if download else None,
    )
