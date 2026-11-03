"""Geometry validation gate (spec 13.1).

A candidate may not reach the mesher or the solver until this passes. Every
check here is a real measurement on the built solid or its tessellation - no
check reports success by assumption.
"""
from __future__ import annotations

from types import SimpleNamespace

import numpy as np

from app.core.logging import get_logger
from app.engineering.cad.base import (
    ComponentGenerator,
    GeometryMetrics,
    GeometryValidationReport,
    PreservedInterfaceCheck,
)
from app.engineering.cad.exporter import iter_solids, tessellate

log = get_logger(__name__)


def _measure_bore_on_plane(vertices: np.ndarray, z: float, tol: float = 2e-5) -> float | None:
    """Minimum material radius on a planar face = that face's bore radius.

    Measured on the mounting face rather than through an axial band: the bore
    surface is tessellated only at its edges, so an interior band can miss it
    entirely and report the next feature outwards instead.
    """
    face = vertices[np.abs(vertices[:, 2] - z) <= tol]
    if len(face) < 8:
        return None
    r = np.hypot(face[:, 0], face[:, 1])
    return float(np.min(r))


def _measure(name: str, vertices: np.ndarray, params: dict[str, float]) -> float | None:
    """Dispatch a named preserved-interface measurement."""
    if name == "rim_outer_diameter":
        r = np.hypot(vertices[:, 0], vertices[:, 1])
        return float(2.0 * np.max(r))
    if name == "rim_width":
        return float(vertices[:, 2].max() - vertices[:, 2].min())
    if name == "center_bore_diameter":
        v = _measure_bore_on_plane(vertices, 0.0)
        return None if v is None else 2.0 * v
    if name == "overall_length":
        return float(vertices[:, 0].max() - vertices[:, 0].min())
    if name == "overall_height":
        return float(vertices[:, 1].max() - vertices[:, 1].min())
    if name == "overall_width":
        return float(vertices[:, 2].max() - vertices[:, 2].min())
    if name == "thread_outer_diameter":
        z_lo = params.get("_thread_z_lo")
        z_hi = params.get("_thread_z_hi")
        if z_lo is None or z_hi is None:
            return None
        band = vertices[(vertices[:, 2] >= z_lo) & (vertices[:, 2] <= z_hi)]
        if len(band) < 8:
            return None
        return float(2.0 * np.max(np.hypot(band[:, 0], band[:, 1])))
    return None


def validate_geometry(
    generator: ComponentGenerator,
    shape,
    parameters: dict[str, float],
    expected_solid_count: int | None = None,
) -> GeometryValidationReport:
    """Check solidity, volume, bounding box, regions and protected interfaces."""
    errors: list[str] = []
    warnings: list[str] = []

    if expected_solid_count is None:
        expected_solid_count = generator.expected_solid_count(parameters)

    solids = iter_solids(shape)
    solid_count = len(solids)

    # Volume and bounding box cover every solid: measuring only the first body
    # would silently ignore most of a multi-material assembly.
    is_valid = True
    volume = 0.0
    for solid in solids:
        try:
            if not solid.isValid():
                is_valid = False
        except Exception as exc:  # pragma: no cover - OCC guard
            is_valid = False
            errors.append(f"OpenCascade validity check raised: {exc}")
        volume += float(solid.Volume())

    boxes = [s.BoundingBox() for s in solids]
    bb = SimpleNamespace(
        xmin=min(b.xmin for b in boxes), xmax=max(b.xmax for b in boxes),
        ymin=min(b.ymin for b in boxes), ymax=max(b.ymax for b in boxes),
        zmin=min(b.zmin for b in boxes), zmax=max(b.zmax for b in boxes),
    )

    try:
        verts, faces = tessellate(shape)
    except Exception as exc:
        verts, faces = np.zeros((0, 3)), np.zeros((0, 3), dtype=int)
        errors.append(f"tessellation failed: {exc}")

    area = None
    if len(faces):
        try:
            import trimesh

            tm = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
            area = float(tm.area)
            # OCC tessellates each face separately, so vertices are duplicated
            # along shared edges; merge before judging watertightness.
            tm.merge_vertices()
            if not tm.is_watertight:
                warnings.append(
                    "display tessellation is not watertight; this affects the preview "
                    "mesh only, not the STEP solid or the analysis mesh"
                )
        except Exception as exc:  # pragma: no cover
            warnings.append(f"tessellation inspection skipped: {exc}")

    if not is_valid:
        errors.append("OpenCascade reports the solid as invalid")
    if volume <= 0.0:
        errors.append(f"solid volume is not positive ({volume:g} m3)")
    if solid_count != expected_solid_count:
        errors.append(
            f"expected {expected_solid_count} solid(s) but the build produced {solid_count}; "
            "disconnected bodies usually mean a parameter combination broke a union"
        )

    min_wall = generator.min_wall_thickness(parameters)
    if min_wall <= 0:
        errors.append(f"parameter set implies a non-positive wall thickness ({min_wall:g} m)")

    metrics = GeometryMetrics(
        volume_m3=volume,
        surface_area_m2=area,
        bounding_box_min_m=(bb.xmin, bb.ymin, bb.zmin),
        bounding_box_max_m=(bb.xmax, bb.ymax, bb.zmax),
        solid_count=solid_count,
        is_valid_solid=is_valid,
        min_wall_thickness_m=min_wall,
    )

    # ---- protected interfaces, measured against the tessellated solid -------
    checks: list[PreservedInterfaceCheck] = []
    if len(verts):
        measurement_params = {
            **parameters,
            **generator.preserved_interface_context(parameters),
        }
        for name, description, expected, tol in generator.preserved_interfaces(parameters):
            measured = _measure(name, verts, measurement_params)
            if measured is None:
                warnings.append(f"preserved interface {name!r} could not be measured")
                continue
            ok = abs(measured - expected) <= tol
            checks.append(
                PreservedInterfaceCheck(
                    name=name,
                    description=description,
                    expected_value_m=expected,
                    measured_value_m=measured,
                    tolerance_m=tol,
                    passed=ok,
                )
            )
            if not ok:
                errors.append(
                    f"preserved interface {name!r} moved: expected "
                    f"{expected * 1000:.3f} mm, measured {measured * 1000:.3f} mm "
                    f"(tolerance {tol * 1000:.3f} mm)"
                )

    # ---- every required named region must actually exist on the surface ----
    region_set = generator.named_regions(parameters)
    if len(verts):
        pts = verts.T
        for region in region_set.regions:
            hits = int(np.count_nonzero(region.mask(pts)))
            if region.required and hits == 0:
                errors.append(
                    f"named region {region.name!r} selects no geometry on this parameter set; "
                    "its selector no longer matches the rebuilt solid"
                )
            elif region.required and hits < 3:
                warnings.append(
                    f"named region {region.name!r} selects only {hits} tessellation vertices; "
                    "boundary-condition application may be poorly resolved"
                )

    passed = not errors
    if not passed:
        log.warning("geometry validation failed: %s", "; ".join(errors[:3]))
    return GeometryValidationReport(
        passed=passed, metrics=metrics, preserved_interface_checks=checks,
        errors=errors, warnings=warnings,
    )
