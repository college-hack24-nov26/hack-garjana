"""Which solver paths have a passing analytical benchmark, as recorded evidence.

The verification benchmarks compare each production solver path against a
closed-form solution. They were already run for the capabilities endpoint; this
module is the single place that caches and interprets them, so the assurance
gate and the UI read the same evidence rather than two independent opinions of
it.

The default when a benchmark has not run is ``None``, not ``False`` and
certainly not ``True``: "no benchmark evidence on record" is a distinct state
from "the benchmark failed", and only a recorded pass may raise a result to
numerically verified.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from app.core.logging import get_logger
from app.schemas.common import AnalysisType

log = get_logger(__name__)

#: Which benchmark verifies which analysis path.
BENCHMARK_FOR_ANALYSIS: dict[AnalysisType, str] = {
    AnalysisType.LINEAR_STATIC_STRUCTURAL: "cantilever_beam_linear_static",
    AnalysisType.STEADY_STATE_THERMAL: "bar_1d_steady_state_conduction",
}


@lru_cache
def benchmark_evidence() -> list[dict]:
    """Run the verification benchmarks once per process and cache the record."""
    from app.tests.benchmarks import run_all_benchmarks

    out: list[dict] = []
    try:
        outcomes = run_all_benchmarks()
    except Exception as exc:  # pragma: no cover - environment guard
        log.error("verification benchmarks could not be run: %s", exc)
        return out

    for outcome in outcomes:
        out.append(
            {
                "name": outcome.name,
                "description": outcome.description,
                "reference_source": outcome.reference_source,
                "passed": outcome.passed,
                "quantities": outcome.quantities,
                "notes": outcome.notes,
            }
        )
    return out


def benchmark_status(analysis: AnalysisType) -> tuple[Optional[bool], str]:
    """``(passed, detail)`` for the benchmark that verifies this analysis path.

    ``passed`` is ``None`` when no benchmark covers the path or none has been
    run in this process. The caller must treat that as missing evidence.
    """
    name = BENCHMARK_FOR_ANALYSIS.get(analysis)
    if name is None:
        return None, (
            f"No analytical benchmark is defined for the {analysis.value} path, so "
            "there is no verification evidence for it."
        )

    for record in benchmark_evidence():
        if record["name"] != name:
            continue
        worst = max(
            (q.get("relative_error", 0.0) for q in record["quantities"].values()),
            default=None,
        )
        margin = f" Worst quantity error {worst * 100:.3f}%." if worst is not None else ""
        if record["passed"]:
            return True, (
                f"{record['description']} matched its closed-form reference "
                f"({record['reference_source']}).{margin}"
            )
        return False, (
            f"{record['description']} did not match its closed-form reference "
            f"({record['reference_source']}).{margin}"
        )

    return None, (
        f"Benchmark {name!r} has not been run in this process, so there is no "
        "verification evidence for this solver path."
    )


def benchmark_id(analysis: AnalysisType) -> Optional[str]:
    return BENCHMARK_FOR_ANALYSIS.get(analysis)
