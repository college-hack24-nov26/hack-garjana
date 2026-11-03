"""Health and capability endpoints.

The capability endpoint is how the UI learns what this installation can
genuinely do: which solvers exist, whether they were verified against their
benchmarks, and which external solvers are absent. The UI renders that
truthfully rather than claiming a fixed feature set.
"""
from __future__ import annotations

import platform
import sys
from typing import Any

from fastapi import APIRouter

from app.core.config import get_settings
from app.engineering.profiles.registry import available_profiles
from app.engineering.solvers.registry import solver_capability_report

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.app_name,
        "environment": settings.app_env,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "component_profiles": [p.component_type.value for p in available_profiles()],
        "llm_configured": settings.llm_available,
    }


def _benchmark_cache() -> list[dict]:
    """The verification benchmark evidence.

    Delegates to the assurance plane's cache so that the UI and the gate that
    decides whether a result is numerically verified read the same record,
    rather than each running the benchmarks and forming its own opinion.
    """
    from app.engineering.assurance import benchmark_evidence

    return benchmark_evidence()


@router.get("/capabilities")
def capabilities(run_benchmarks: bool = True) -> dict[str, Any]:
    """What this installation can actually compute, with benchmark evidence."""
    settings = get_settings()
    report = solver_capability_report()

    payload: dict[str, Any] = {
        "solvers": report,
        "cad_kernel": "OpenCascade via CadQuery",
        "mesher": "Gmsh (OpenCascade kernel)",
        "optimizers": [
            "seeded Latin-hypercube design of experiments",
            "NSGA-II (pymoo)",
        ],
        "limits": {
            "max_mesh_nodes": settings.max_mesh_nodes,
            "max_candidates_per_run": settings.max_candidates_per_run,
            "solver_timeout_seconds": settings.solver_timeout_seconds,
            "max_upload_bytes": settings.max_upload_bytes,
        },
        "standing_limitations": [
            "Results are virtual-prototyping predictions under the configured model. "
            "They are not a regulatory certification and do not replace the physical "
            "validation your process requires.",
            "Material properties in the shipped catalog are illustrative handbook-class "
            "values, not supplier-certified data.",
            "Uploaded STEP geometry can be viewed and analysed, but it cannot be "
            "regenerated parametrically unless it matches a built-in template.",
        ],
    }

    # What the platform may and may not claim, and how far up each component's
    # validation ladder this build actually reaches. Served from the assurance
    # plane so the UI cannot show a rung the backend has not attained.
    from app.engineering.assurance import (
        EVIDENCE_REQUIREMENTS,
        FIDELITY_LADDER,
        PROHIBITED_AT_LEVEL,
        PROHIBITED_CLAIM_STATEMENTS,
        MaturityLevel,
        ladder_for,
    )

    payload["assurance"] = {
        "maturity_levels": [
            {
                "level": level.value,
                "ordinal": level.ordinal,
                "label": level.label,
                "evidence_required": EVIDENCE_REQUIREMENTS[level],
                "prohibited_claims": list(PROHIBITED_AT_LEVEL[level]),
            }
            for level in MaturityLevel
        ],
        "attained_maturity": MaturityLevel.NUMERICALLY_VERIFIED.value,
        "attained_maturity_note": (
            "The highest level this installation can reach is 'numerically "
            "verified', and only for a candidate whose refinement study showed "
            "the decision quantity converged. Every level above it requires "
            "physical measurement, which this installation has none of."
        ),
        "mesh_convergence_states": {
            "passed": "The decision quantity and every compared metric held "
                      "within tolerance under refinement.",
            "failed": "The quantity the feasibility decision rests on kept "
                      "moving under refinement.",
            "inconclusive": "The decision quantity converged, but a "
                            "region-specific metric did not. Recorded as its "
                            "own state - neither a pass nor a failure.",
            "not_run": "No refinement study is on record. Not a pass.",
        },
        "validation_ladders": [
            {
                "component_type": p.component_type.value,
                "title": ladder_for(p.component_type).title,
                "attained_level": ladder_for(p.component_type).attained_level,
                "rungs": [
                    r.model_dump(mode="json") for r in ladder_for(p.component_type).rungs
                ],
            }
            for p in available_profiles()
        ],
        "fidelity_ladder": [r.model_dump(mode="json") for r in FIDELITY_LADDER],
        "prohibited_claims": PROHIBITED_CLAIM_STATEMENTS,
    }

    if run_benchmarks:
        payload["benchmarks"] = _benchmark_cache()
        payload["benchmarks_all_passed"] = all(
            b["passed"] for b in payload["benchmarks"]
        )
    return payload
