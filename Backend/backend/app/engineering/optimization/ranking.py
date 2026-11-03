"""Candidate ranking and Pareto fronts (spec 3.4).

Only candidates a solver actually evaluated can be ranked. Feasible candidates
always rank ahead of infeasible ones, and candidates that failed geometry,
meshing or the solver are never ranked at all - they keep their failure reason.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
from pydantic import BaseModel

from app.engineering.optimization.evaluation import CandidateRecord
from app.schemas.common import ObjectiveSense, canonical_quantity
from app.schemas.engineering import KNOWN_METRICS, Objective

#: Readable names for metrics quoted in prose.
_METRIC_PROSE: dict[str, str] = {
    "mass_kg": "mass",
    "max_von_mises_pa": "peak von Mises stress",
    "max_displacement_m": "peak displacement",
    "compliance_j": "strain energy",
    "min_factor_of_safety": "factor of safety",
    "max_temperature_k": "peak temperature",
    "min_temperature_k": "minimum temperature",
    "max_temperature_gradient_k_per_m": "peak temperature gradient",
    "heat_flow_w": "heat flow",
    "min_wall_thickness_m": "minimum wall thickness",
}


def _cost_vector(record: CandidateRecord, objectives: list[Objective]) -> np.ndarray | None:
    """Objective values as 'lower is better'. None if any value is missing."""
    costs: list[float] = []
    for o in objectives:
        value = record.metrics.get(o.metric)
        if value is None:
            return None
        costs.append(float(value) if o.sense == ObjectiveSense.MINIMIZE else -float(value))
    return np.asarray(costs, dtype=float)


def non_dominated_fronts(costs: np.ndarray) -> list[list[int]]:
    """Fast non-dominated sorting. ``costs`` is (N, M), all minimised."""
    n = costs.shape[0]
    if n == 0:
        return []

    dominated_by = np.zeros(n, dtype=int)
    dominates: list[list[int]] = [[] for _ in range(n)]

    for i in range(n):
        for j in range(i + 1, n):
            le = np.all(costs[i] <= costs[j])
            lt = np.any(costs[i] < costs[j])
            ge = np.all(costs[j] <= costs[i])
            gt = np.any(costs[j] < costs[i])
            if le and lt:
                dominates[i].append(j)
                dominated_by[j] += 1
            elif ge and gt:
                dominates[j].append(i)
                dominated_by[i] += 1

    fronts: list[list[int]] = []
    current = [i for i in range(n) if dominated_by[i] == 0]
    remaining = dominated_by.copy()
    while current:
        fronts.append(sorted(current))
        nxt: list[int] = []
        for i in current:
            for j in dominates[i]:
                remaining[j] -= 1
                if remaining[j] == 0:
                    nxt.append(j)
        current = nxt
    return fronts


def crowding_distance(costs: np.ndarray) -> np.ndarray:
    """NSGA-II crowding distance, used to spread the recommended candidates."""
    n, m = costs.shape
    dist = np.zeros(n)
    if n <= 2:
        return np.full(n, np.inf)
    for k in range(m):
        order = np.argsort(costs[:, k])
        dist[order[0]] = np.inf
        dist[order[-1]] = np.inf
        span = costs[order[-1], k] - costs[order[0], k]
        if span <= 0:
            continue
        for idx in range(1, n - 1):
            dist[order[idx]] += (
                costs[order[idx + 1], k] - costs[order[idx - 1], k]
            ) / span
    return dist


def rank_candidates(
    records: list[CandidateRecord], objectives: list[Objective]
) -> list[CandidateRecord]:
    """Assign ``pareto_front`` and ``rank`` in place, then return the records.

    Ordering: feasible candidates by Pareto front then crowding distance, then
    infeasible-but-evaluated candidates by constraint violation severity.
    Unevaluated and failed candidates are left unranked.
    """
    feasible: list[tuple[int, np.ndarray]] = []
    infeasible: list[tuple[int, float]] = []

    for idx, r in enumerate(records):
        r.rank = None
        r.pareto_front = None
        if not r.evaluated:
            continue
        costs = _cost_vector(r, objectives)
        if costs is None:
            continue
        if r.is_feasible:
            feasible.append((idx, costs))
        else:
            # Severity = worst relative violation across failed constraints.
            worst = 0.0
            for c in r.constraint_results:
                if c.passed is False and c.margin_fraction is not None:
                    worst = max(worst, -c.margin_fraction)
            infeasible.append((idx, worst))

    order: list[int] = []

    if feasible:
        idxs = [i for i, _ in feasible]
        costs = np.vstack([c for _, c in feasible])
        fronts = non_dominated_fronts(costs)
        for front_number, front in enumerate(fronts):
            # Within a front every candidate is a valid trade-off, so the order
            # is decided by the primary (first-declared) objective. Ordering by
            # crowding distance instead would surface whichever extreme of the
            # front happens to be least crowded, which reads as the platform
            # recommending a design that ignores the engineer's stated priority.
            primary = [costs[local, 0] for local in front]
            for local in [front[k] for k in np.argsort(primary)]:
                global_idx = idxs[local]
                records[global_idx].pareto_front = front_number
                order.append(global_idx)

    for idx, _severity in sorted(infeasible, key=lambda t: t[1]):
        order.append(idx)

    for position, idx in enumerate(order, start=1):
        records[idx].rank = position

    return records


class RecommendationOutcome(BaseModel):
    """The recommended candidate and an honest verdict about it."""

    candidate_id: Optional[str] = None
    improves_on_baseline: Optional[bool] = None
    primary_metric: Optional[str] = None
    baseline_value: Optional[float] = None
    candidate_value: Optional[float] = None
    percent_change: Optional[float] = None
    statement: str = ""


def recommended_candidate(
    records: list[CandidateRecord], objectives: list[Objective]
) -> CandidateRecord | None:
    """The best feasible, solver-evaluated candidate on the primary objective.

    A candidate that was never evaluated can never be recommended (spec 13.3),
    and the baseline itself is not a generated recommendation.
    """
    if not objectives:
        return None
    primary = objectives[0]
    pool = [
        r
        for r in records
        if r.evaluated
        and r.is_feasible
        and not r.is_baseline
        and primary.metric in r.metrics
    ]
    if not pool:
        return None
    sign = 1.0 if primary.sense == ObjectiveSense.MINIMIZE else -1.0
    return min(pool, key=lambda r: sign * r.metrics[primary.metric])


def describe_recommendation(
    records: list[CandidateRecord],
    objectives: list[Objective],
    baseline: CandidateRecord | None,
) -> RecommendationOutcome:
    """State plainly whether the search actually beat the baseline.

    If no feasible candidate improved on the baseline, that is reported as the
    result. It is a real and useful outcome, and dressing it up as a success
    would misrepresent the search.
    """
    best = recommended_candidate(records, objectives)
    if not objectives:
        return RecommendationOutcome(statement="No objective was declared.")
    primary = objectives[0]

    if best is None:
        evaluated = sum(1 for r in records if r.evaluated and not r.is_baseline)
        return RecommendationOutcome(
            primary_metric=primary.metric,
            statement=(
                f"No generated candidate satisfied every configured constraint. "
                f"{evaluated} candidate(s) were evaluated. Widen the design bounds, "
                "relax a constraint that is not a hard requirement, or increase the "
                "candidate budget."
            ),
        )

    outcome = RecommendationOutcome(
        candidate_id=best.candidate_id,
        primary_metric=primary.metric,
        candidate_value=best.metrics.get(primary.metric),
    )

    # Prose must never quote a bare number: every value in the statement is
    # converted to its display unit and carries that unit.
    kind = KNOWN_METRICS[primary.metric]
    label = _METRIC_PROSE.get(primary.metric, primary.metric.replace("_", " "))

    def shown(canonical: float) -> str:
        display = canonical_quantity(canonical, kind)
        return f"{display.value:.4g} {display.unit}"

    if baseline is None or not baseline.evaluated or primary.metric not in baseline.metrics:
        outcome.statement = (
            f"Candidate {best.index} is the best feasible design on {label} "
            f"({shown(outcome.candidate_value)}). No evaluated baseline was available "
            "to compare against."
        )
        return outcome

    base_value = baseline.metrics[primary.metric]
    outcome.baseline_value = base_value
    delta = outcome.candidate_value - base_value
    outcome.percent_change = (delta / base_value * 100.0) if base_value else None

    better = (
        outcome.candidate_value < base_value
        if primary.sense == ObjectiveSense.MINIMIZE
        else outcome.candidate_value > base_value
    )
    outcome.improves_on_baseline = bool(better)

    direction = "lower" if primary.sense == ObjectiveSense.MINIMIZE else "higher"
    if better:
        outcome.statement = (
            f"Candidate {best.index} is feasible and improves {label} by "
            f"{abs(outcome.percent_change or 0):.1f}% against the baseline "
            f"({shown(base_value)} to {shown(outcome.candidate_value)})."
        )
    else:
        outcome.statement = (
            f"Candidate {best.index} is the best feasible generated design, but it does "
            f"not beat the baseline on {label} "
            f"({shown(base_value)} to {shown(outcome.candidate_value)}). Every candidate "
            f"that reached a {direction} value violated a constraint. The baseline "
            "remains the best feasible design in the space searched so far."
        )
    return outcome


def compare_to_baseline(
    candidate: CandidateRecord, baseline: CandidateRecord, metrics: list[str]
) -> dict[str, dict]:
    """Per-metric baseline comparison using only values both runs produced."""
    out: dict[str, dict] = {}
    for metric in metrics:
        a = baseline.metrics.get(metric)
        b = candidate.metrics.get(metric)
        if a is None or b is None:
            out[metric] = {"available": False}
            continue
        delta = b - a
        out[metric] = {
            "available": True,
            "baseline": baseline.display_metric(metric).model_dump(),
            "candidate": candidate.display_metric(metric).model_dump(),
            "absolute_change": delta,
            "percent_change": (delta / a * 100.0) if a else None,
        }
    return out
