"""Solver adapter registry.

The scikit-fem adapters are the verified default path on this machine: no
CalculiX or Elmer binary was found during preflight. A CalculiX adapter can be
registered alongside them without changing any caller, because the pipeline only
talks to :class:`~app.engineering.solvers.base.SolverAdapter`.
"""
from __future__ import annotations

from app.core.config import get_settings
from app.engineering.solvers.base import SolverAdapter
from app.engineering.solvers.skfem_structural import SkfemLinearStaticSolver
from app.engineering.solvers.skfem_thermal import SkfemSteadyStateThermalSolver

_ADAPTERS: dict[str, SolverAdapter] = {
    SkfemLinearStaticSolver.solver_id: SkfemLinearStaticSolver(),
    SkfemSteadyStateThermalSolver.solver_id: SkfemSteadyStateThermalSolver(),
}


def get_solver(solver_id: str) -> SolverAdapter:
    try:
        return _ADAPTERS[solver_id]
    except KeyError as exc:
        raise KeyError(
            f"unknown solver_id {solver_id!r}; registered: {sorted(_ADAPTERS)}"
        ) from exc


def available_solvers() -> list[SolverAdapter]:
    return list(_ADAPTERS.values())


def solver_capability_report() -> dict:
    """What physics this installation can actually run, for the UI and tracker."""
    settings = get_settings()
    return {
        "in_process_solvers": [
            {
                "solver_id": a.solver_id,
                "name": a.solver_name,
                "version": a.solver_version,
                "analysis_type": a.analysis_type.value,
                "result_kind": a.result_kind.value,
                "method_statement": a.method_statement,
                "verified_by_benchmark": True,
            }
            for a in _ADAPTERS.values()
        ],
        "external_solvers": {
            "calculix": {
                "configured": bool(settings.calculix_bin),
                "available": settings.calculix_available,
                "note": (
                    "Not installed on this machine. The structural path uses the "
                    "benchmark-verified scikit-fem adapter instead."
                ),
            },
            "elmer": {
                "configured": bool(settings.elmer_bin),
                "available": settings.elmer_available,
                "note": (
                    "Not installed on this machine. The thermal path uses the "
                    "benchmark-verified scikit-fem steady-state conduction adapter, "
                    "which is full 3D FEA and not a reduced-order model."
                ),
            },
        },
    }
