"""STEP import and inspection (spec 4.1, 13.1).

An imported STEP file is validated and measured, and its unit metadata is read
rather than assumed. If the file declares a length unit other than millimetres
or metres, or declares none at all, that is reported so the engineer can confirm
it instead of the platform silently guessing.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

import numpy as np

import cadquery as cq

from app.core.logging import get_logger

log = get_logger(__name__)

#: STEP unit names as they appear in the file's SI_UNIT / conversion entities.
_UNIT_PATTERNS = {
    "millimetre": 1e-3,
    "millimeter": 1e-3,
    "centimetre": 1e-2,
    "centimeter": 1e-2,
    "metre": 1.0,
    "meter": 1.0,
    "inch": 0.0254,
    "foot": 0.3048,
}


def read_declared_units(path: Path) -> dict[str, Any]:
    """Read the length unit the STEP file declares, without assuming one."""
    text = ""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            # The unit context sits in the header region of the data section.
            text = fh.read(400_000)
    except OSError as exc:  # pragma: no cover
        return {"declared_length_unit": None, "note": f"could not read header: {exc}"}

    lowered = text.lower()
    found: list[str] = []

    # SI_UNIT with a prefix, e.g. SI_UNIT(.MILLI.,.METRE.)
    for match in re.finditer(r"si_unit\s*\(\s*\.?(\w*)\.?\s*,\s*\.(\w+)\.\s*\)", lowered):
        prefix, unit = match.group(1), match.group(2)
        if unit in ("metre", "meter"):
            found.append("millimetre" if prefix == "milli" else
                         "centimetre" if prefix == "centi" else "metre")

    for name in _UNIT_PATTERNS:
        if f"'{name}'" in lowered and name not in found:
            found.append(name)

    unique = list(dict.fromkeys(found))
    if not unique:
        return {
            "declared_length_unit": None,
            "unit_scale_to_metres": None,
            "requires_unit_confirmation": True,
            "note": (
                "The file does not declare a length unit that could be read. Confirm "
                "the unit before analysing this model; it has not been assumed."
            ),
        }

    primary = unique[0]
    return {
        "declared_length_unit": primary,
        "unit_scale_to_metres": _UNIT_PATTERNS.get(primary),
        "all_units_seen": unique,
        "requires_unit_confirmation": primary not in ("millimetre", "metre"),
        "note": (
            f"The file declares {primary}. CadQuery imports STEP in millimetres and "
            "this platform converts to metres internally."
        ),
    }


def inspect_step(path: Path) -> dict[str, Any]:
    """Load a STEP file and report what is actually in it."""
    path = Path(path)
    shape = cq.importers.importStep(str(path))
    solids = shape.solids().vals()
    if not solids:
        raise ValueError("the STEP file contains no solid body")

    # CadQuery/OCC works in millimetres for STEP; convert to canonical metres.
    mm_to_m = 1e-3
    volumes_m3 = [float(s.Volume()) * mm_to_m**3 for s in solids]
    total_volume = float(sum(volumes_m3))

    val = shape.val()
    bb = val.BoundingBox()
    bbox_min = (bb.xmin * mm_to_m, bb.ymin * mm_to_m, bb.zmin * mm_to_m)
    bbox_max = (bb.xmax * mm_to_m, bb.ymax * mm_to_m, bb.zmax * mm_to_m)

    valid = True
    try:
        valid = bool(val.isValid())
    except Exception:  # pragma: no cover
        valid = False

    warnings: list[str] = []
    if total_volume <= 0:
        warnings.append("total solid volume is not positive")
    if len(solids) > 1:
        warnings.append(
            f"the file contains {len(solids)} separate solids; analysis treats them as "
            "one assembly and assumes perfectly bonded interfaces"
        )
    if not valid:
        warnings.append(
            "OpenCascade reports the imported solid as invalid; meshing may fail"
        )

    return {
        "solid_count": len(solids),
        "is_valid_solid": valid,
        "total_volume_m3": total_volume,
        "per_solid_volume_m3": volumes_m3,
        "bounding_box_min_m": bbox_min,
        "bounding_box_max_m": bbox_max,
        "bounding_box_size_m": tuple(b - a for a, b in zip(bbox_min, bbox_max)),
        "face_count": len(shape.faces().vals()),
        "units": read_declared_units(path),
        "warnings": warnings,
    }
