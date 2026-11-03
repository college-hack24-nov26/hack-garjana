"""Geometry export: STEP for engineering exchange, GLB for the browser.

The STEP file is the authoritative CAD artifact. The GLB is a *display*
tessellation only - it is never used as the analysis mesh and never as the
source of result fields (spec 5.1).
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np
import trimesh

import cadquery as cq

from app.core.logging import get_logger

log = get_logger(__name__)

#: Linear deflection for display tessellation, in metres.
PREVIEW_LINEAR_TOLERANCE_M = 4e-4
PREVIEW_ANGULAR_TOLERANCE_RAD = 0.25


def export_step(shape, path: Path) -> Path:
    """Write the solid as an ISO 10303 STEP file in metres."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cq.exporters.export(shape, str(path), exportType="STEP")
    if not path.exists() or path.stat().st_size == 0:
        raise RuntimeError(f"STEP export produced no data at {path}")
    return path


def iter_solids(shape) -> list:
    """Every solid in a Workplane, compound or bare shape.

    Multi-material assemblies (the spark-plug electrode / insulator / shell
    stack) are carried as several solids, so nothing downstream may assume one.
    """
    if hasattr(shape, "solids"):
        solids = shape.solids().vals()
        if solids:
            return solids
    if hasattr(shape, "val"):
        return [shape.val()]
    return [shape]


def tessellate(
    shape,
    linear_tolerance: float = PREVIEW_LINEAR_TOLERANCE_M,
    angular_tolerance: float = PREVIEW_ANGULAR_TOLERANCE_RAD,
) -> tuple[np.ndarray, np.ndarray]:
    """Triangulate every solid for display and for geometric measurement.

    Returns ``(vertices (N,3) in metres, faces (M,3) int)`` covering the whole
    assembly, with face indices remapped into the concatenated vertex array.
    """
    all_vertices: list[np.ndarray] = []
    all_faces: list[np.ndarray] = []
    offset = 0

    for solid in iter_solids(shape):
        verts, tris = solid.tessellate(linear_tolerance, angular_tolerance)
        if not verts or not tris:
            continue
        v = np.array([[p.x, p.y, p.z] for p in verts], dtype=np.float64)
        f = np.array(tris, dtype=np.int64) + offset
        all_vertices.append(v)
        all_faces.append(f)
        offset += len(v)

    if not all_vertices:
        raise RuntimeError("tessellation produced an empty mesh")
    return np.vstack(all_vertices), np.vstack(all_faces)


def export_preview_glb(shape, path: Path, linear_tolerance: Optional[float] = None) -> Path:
    """Write a GLB display asset. Units stay metres to match the analysis."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    v, f = tessellate(shape, linear_tolerance or PREVIEW_LINEAR_TOLERANCE_M)
    mesh = trimesh.Trimesh(vertices=v, faces=f, process=False)
    scene = trimesh.Scene(geometry={"component": mesh})
    data = scene.export(file_type="glb")
    path.write_bytes(data)
    if path.stat().st_size == 0:
        raise RuntimeError(f"GLB export produced no data at {path}")
    log.info("preview GLB written: %s (%d verts, %d tris)", path.name, len(v), len(f))
    return path


def export_preview_stl(shape, path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cq.exporters.export(shape, str(path), exportType="STL", tolerance=PREVIEW_LINEAR_TOLERANCE_M)
    return path
