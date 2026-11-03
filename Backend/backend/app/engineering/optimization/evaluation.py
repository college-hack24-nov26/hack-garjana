"""Constraint evaluation and candidate records (spec 3.3, 13.3).

Feasibility is derived only from explicit constraints evaluated against metrics
that a solver computed. A candidate that was never solved can never be feasible,
and a metric that is missing makes its constraint ``not_evaluated`` rather than
quietly passing.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from pydantic import BaseModel, Field

from app.core import units as U
from app.schemas.common import (
    CandidateStatus,
    ConstraintOperator,
    DisplayQuantity,
    ObjectiveSense,
    SourceStatus,
    canonical_quantity,
)
from app.schemas.engineering import KNOWN_METRICS, Constraint, Objective

if TYPE_CHECKING:  # imported for the annotation only, to avoid a cycle
    from app.engineering.assurance.service import AssuranceOutcome


#: Relative slack applied when comparing a metric against a limit. A parameter
#: set that lands exactly on a limit - a 7.000 mm wall against a 7.000 mm
#: manufacturing minimum - must not be reported as a violation because of
#: floating-point representation. This is numerical slack only: it is twelve
#: orders of magnitude below any engineering tolerance.
_CONSTRAINT_RELATIVE_TOLERANCE = 1e-9


def _tol(limit: float) -> float:
    return abs(limit) * _CONSTRAINT_RELATIVE_TOLERANCE


class ConstraintResult(BaseModel):
    """Outcome of one explicit engineering limit."""

    constraint_id: str
    metric: str
    label: Optional[str] = None
    operator: ConstraintOperator
    description: str
    source_status: SourceStatus
    source_reference: Optional[str] = None

    value: Optional[DisplayQuantity] = None
    limit: Optional[DisplayQuantity] = None
    lower: Optional[DisplayQuantity] = None
    upper: Optional[DisplayQuantity] = None

    passed: Optional[bool] = Field(
        default=None,
        description="None means the metric was not available, so no verdict exists.",
    )
    #: Positive = inside the limit. Fraction of the limit, for ranking severity.
    margin_fraction: Optional[float] = None
    note: Optional[str] = None


def evaluate_constraints(
    metrics: dict[str, float], constraints: list[Constraint]
) -> list[ConstraintResult]:
    """Evaluate every constraint against canonical-SI solver metrics."""
    results: list[ConstraintResult] = []

    for c in constraints:
        kind = KNOWN_METRICS[c.metric]
        value = metrics.get(c.metric)

        res = ConstraintResult(
            constraint_id=c.constraint_id,
            metric=c.metric,
            label=c.label,
            operator=c.operator,
            description=c.describe(),
            source_status=c.source_status,
            source_reference=c.source_reference,
        )

        if c.operator == ConstraintOperator.BETWEEN:
            res.lower = canonical_quantity(c.lower.canonical(), kind)
            res.upper = canonical_quantity(c.upper.canonical(), kind)
        else:
            res.limit = canonical_quantity(c.limit.canonical(), kind)

        if value is None:
            res.passed = None
            res.note = (
                f"metric {c.metric!r} was not produced by this run, so this constraint "
                "could not be evaluated"
            )
            results.append(res)
            continue

        res.value = canonical_quantity(float(value), kind)

        if c.operator == ConstraintOperator.LTE:
            limit = c.limit.canonical()
            res.passed = value <= limit + _tol(limit)
            res.margin_fraction = (limit - value) / limit if limit else None
        elif c.operator == ConstraintOperator.GTE:
            limit = c.limit.canonical()
            res.passed = value >= limit - _tol(limit)
            res.margin_fraction = (value - limit) / limit if limit else None
        else:
            lo, hi = c.lower.canonical(), c.upper.canonical()
            res.passed = (lo - _tol(lo)) <= value <= (hi + _tol(hi))
            span = hi - lo
            res.margin_fraction = (
                min(value - lo, hi - value) / span if span > 0 else None
            )

        results.append(res)

    return results


def derive_feasibility(results: list[ConstraintResult]) -> tuple[bool, list[str]]:
    """``(is_feasible, reasons)``. Unevaluated constraints block feasibility."""
    reasons: list[str] = []
    feasible = True
    for r in results:
        if r.passed is None:
            feasible = False
            reasons.append(f"{r.constraint_id}: not evaluated ({r.note})")
        elif not r.passed:
            feasible = False
            val = f"{r.value.value:.4g} {r.value.unit}" if r.value else "n/a"
            reasons.append(f"{r.constraint_id}: {r.description} violated (actual {val})")
    return feasible, reasons


class ObjectiveValue(BaseModel):
    objective_id: str
    metric: str
    sense: ObjectiveSense
    label: Optional[str] = None
    value: Optional[DisplayQuantity] = None
    #: Always "lower is better" so the optimizer and the UI can rank uniformly.
    normalized_cost: Optional[float] = None


def evaluate_objectives(
    metrics: dict[str, float], objectives: list[Objective]
) -> list[ObjectiveValue]:
    out: list[ObjectiveValue] = []
    for o in objectives:
        kind = KNOWN_METRICS[o.metric]
        raw = metrics.get(o.metric)
        ov = ObjectiveValue(
            objective_id=o.objective_id, metric=o.metric, sense=o.sense, label=o.label
        )
        if raw is not None:
            ov.value = canonical_quantity(float(raw), kind)
            ov.normalized_cost = (
                float(raw) if o.sense == ObjectiveSense.MINIMIZE else -float(raw)
            )
        out.append(ov)
    return out


class CandidateRecord(BaseModel):
    """One generated design and everything known about it."""

    candidate_id: str
    index: int
    generation: int = 0
    parameters: dict[str, float]
    geometry_hash: str
    status: CandidateStatus = CandidateStatus.PENDING

    is_baseline: bool = False
    from_cache: bool = False

    #: Canonical-SI metrics, exactly as produced by the solver.
    metrics: dict[str, float] = Field(default_factory=dict)
    constraint_results: list[ConstraintResult] = Field(default_factory=list)
    objective_values: list[ObjectiveValue] = Field(default_factory=list)

    is_feasible: Optional[bool] = None
    infeasibility_reasons: list[str] = Field(default_factory=list)
    failure_reason: Optional[str] = None
    failure_stage: Optional[str] = None

    rank: Optional[int] = None
    pareto_front: Optional[int] = None

    step_path: Optional[str] = None
    preview_glb_path: Optional[str] = None
    field_artifact_path: Optional[str] = None
    simulation_run_id: Optional[str] = None

    solve_time_seconds: Optional[float] = None
    mesh_node_count: Optional[int] = None
    warnings: list[str] = Field(default_factory=list)

    #: What the deterministic assurance plane concluded about this candidate:
    #: every check with its measurement, the verification verdict, the physical
    #: validation status and the derived maturity level. ``None`` means the gate
    #: never ran, which is itself reported rather than read as a pass.
    assurance: Optional["AssuranceOutcome"] = None

    @property
    def evaluated(self) -> bool:
        """True only when a solver actually produced results for this candidate."""
        return self.status in (
            CandidateStatus.SOLVED,
            CandidateStatus.FEASIBLE,
            CandidateStatus.INFEASIBLE,
        )

    def display_metric(self, metric: str) -> Optional[DisplayQuantity]:
        if metric not in self.metrics:
            return None
        return canonical_quantity(self.metrics[metric], KNOWN_METRICS[metric])


# ``CandidateRecord.assurance`` is annotated as a string so that this module
# does not import the assurance service at module scope; the service imports the
# solver contract, which would close a cycle. Resolve it once, here.
from app.engineering.assurance.service import AssuranceOutcome  # noqa: E402

CandidateRecord.model_rebuild()
