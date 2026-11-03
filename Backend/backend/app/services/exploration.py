"""Generative design exploration (spec 3.4, phase 4).

Drives the candidate loop: sample the design space, evaluate every candidate
through the real pipeline, record failures with their reason, then rank the
feasible ones and compare the recommendation against the baseline.

Nothing here invents a metric. A candidate that failed geometry, meshing or the
solver stays in the results with its failure stage and message.
"""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Optional

from app.core.ids import new_id
from app.core.logging import get_logger
from app.engineering.assurance.gates import DECISION_METRIC
from app.engineering.optimization.evaluation import CandidateRecord
from app.engineering.optimization.ranking import (
    compare_to_baseline,
    describe_recommendation,
    rank_candidates,
    recommended_candidate,
)
from app.engineering.optimization.sampling import sample_candidates
from app.engineering.profiles.base import ComponentProfile
from app.schemas.common import CandidateStatus
from app.schemas.engineering import EngineeringSpecification
from app.services.pipeline import EvaluationCache, EvaluationOutput, evaluate_candidate

log = get_logger(__name__)

#: Metrics shown in the baseline-versus-candidate comparison, per analysis type.
STRUCTURAL_COMPARISON_METRICS = [
    "mass_kg",
    "max_von_mises_pa",
    "max_displacement_m",
    "min_factor_of_safety",
    "compliance_j",
]
THERMAL_COMPARISON_METRICS = [
    "mass_kg",
    "max_temperature_k",
    "min_temperature_k",
    "max_temperature_gradient_k_per_m",
    "heat_flow_w",
]


ProgressFn = Callable[[float, str, str], None]


@dataclass
class MeshConvergenceReport:
    """Re-evaluation of the recommended design on a refined mesh (spec 4.6).

    A screening or exploration mesh is chosen for throughput, so the winner is
    re-solved on a finer mesh and the two results are compared. If a metric
    moves materially, that is reported as 'not mesh-converged' rather than
    hidden.
    """

    performed: bool = False
    coarse_preset: str = ""
    fine_preset: str = ""
    coarse_nodes: Optional[int] = None
    fine_nodes: Optional[int] = None
    metrics: dict[str, dict] = field(default_factory=dict)
    converged: Optional[bool] = None
    tolerance: float = 0.10
    statement: str = ""
    fine_candidate_id: Optional[str] = None
    #: Feasibility on the coarse and refined meshes. If these disagree, the
    #: coarse verdict was wrong and that is the most important thing to say.
    coarse_feasible: Optional[bool] = None
    fine_feasible: Optional[bool] = None
    verdict_changed: Optional[bool] = None
    fine_constraint_results: list[dict] = field(default_factory=list)
    unconverged_metrics: list[str] = field(default_factory=list)

    # The research evidence schema records mesh convergence in four states,
    # not two: not_run | passed | failed | inconclusive. The distinction
    # matters because the documents judge convergence on "the trend in the
    # decision quantity ... include region-specific metrics" - the decision
    # quantity decides, region metrics are reported alongside it. A singular
    # region metric (a peak gradient at a material interface grows without
    # bound under refinement) therefore makes the study inconclusive, not
    # failed, provided the quantity the decision actually rests on converged.
    #: not_run | passed | failed | inconclusive
    status: str = "not_run"
    #: The quantity the feasibility decision rests on, per analysis type.
    decision_metric: Optional[str] = None
    decision_metric_converged: Optional[bool] = None
    decision_metric_change: Optional[float] = None
    #: Non-decision metrics that moved more than the tolerance. Reported in
    #: full; they make the study inconclusive rather than failed.
    unconverged_region_metrics: list[str] = field(default_factory=list)


@dataclass
class ExplorationResult:
    run_id: str
    algorithm: str
    seed: int
    candidate_budget: int
    candidates: list[CandidateRecord] = field(default_factory=list)
    outputs: dict[str, EvaluationOutput] = field(default_factory=dict)
    baseline_id: Optional[str] = None
    recommended_id: Optional[str] = None
    comparison: dict = field(default_factory=dict)
    recommendation: Optional[dict] = None
    mesh_convergence: MeshConvergenceReport = field(default_factory=MeshConvergenceReport)
    termination_reason: str = ""
    total_seconds: float = 0.0
    cache_hits: int = 0
    sampling_notes: dict[str, list[str]] = field(default_factory=dict)

    # ------------------------------------------------------------- summaries

    @property
    def generated(self) -> int:
        return len(self.candidates)

    @property
    def evaluated(self) -> int:
        return sum(1 for c in self.candidates if c.evaluated)

    @property
    def feasible(self) -> int:
        return sum(1 for c in self.candidates if c.is_feasible)

    @property
    def failed(self) -> int:
        return sum(
            1
            for c in self.candidates
            if c.status
            in (
                CandidateStatus.GEOMETRY_INVALID,
                CandidateStatus.MESH_FAILED,
                CandidateStatus.SOLVER_FAILED,
            )
        )

    def baseline(self) -> Optional[CandidateRecord]:
        return next((c for c in self.candidates if c.is_baseline), None)

    def recommended(self) -> Optional[CandidateRecord]:
        if not self.recommended_id:
            return None
        return next((c for c in self.candidates if c.candidate_id == self.recommended_id), None)

    def metrics_summary(self) -> dict:
        solve_times = [c.solve_time_seconds for c in self.candidates if c.solve_time_seconds]
        return {
            "candidates_generated": self.generated,
            "candidates_evaluated": self.evaluated,
            "candidates_feasible": self.feasible,
            "candidates_failed": self.failed,
            "cache_hits": self.cache_hits,
            "total_seconds": self.total_seconds,
            "mean_solve_seconds": (sum(solve_times) / len(solve_times)) if solve_times else None,
            "max_solve_seconds": max(solve_times) if solve_times else None,
        }


def run_exploration(
    *,
    profile: ComponentProfile,
    spec: EngineeringSpecification,
    baseline_parameters: dict[str, float],
    storage_dir: Path,
    run_id: Optional[str] = None,
    progress: Optional[ProgressFn] = None,
    time_budget_seconds: Optional[float] = None,
    strategy: str = "doe",
    population_size: int = 8,
    generations: int = 3,
    verify_winner: bool = False,
    mesh_preset: str = "exploration",
) -> ExplorationResult:
    """Evaluate the baseline, search the design space, then rank the candidates.

    ``strategy`` selects the search: ``"doe"`` is a seeded Latin-hypercube
    sweep that maps the trade-off space quickly; ``"nsga2"`` is a constrained
    multi-objective search that actually drives towards the feasible frontier.
    """
    started = time.perf_counter()
    rid = run_id or new_id("opt")
    storage_dir = Path(storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)

    cache = EvaluationCache()
    result = ExplorationResult(
        run_id=rid,
        algorithm=(
            "NSGA-II constrained multi-objective search (pymoo)"
            if strategy == "nsga2"
            else "seeded Latin-hypercube design of experiments"
        ),
        seed=spec.random_seed,
        candidate_budget=spec.requested_candidate_budget,
    )

    if strategy == "nsga2":
        return _run_nsga2_study(
            profile=profile,
            spec=spec,
            baseline_parameters=baseline_parameters,
            storage_dir=storage_dir,
            result=result,
            cache=cache,
            started=started,
            population_size=population_size,
            generations=generations,
            progress=progress,
            time_budget_seconds=time_budget_seconds,
            verify_winner=verify_winner,
            mesh_preset=mesh_preset,
        )

    samples = sample_candidates(
        profile.generator,
        spec.design_variables,
        spec.requested_candidate_budget,
        spec.random_seed,
        baseline_parameters,
    )

    #: Baseline first, so every comparison has a reference even if the run is cut short.
    plan: list[tuple[dict[str, float], bool, list[str]]] = [
        (dict(baseline_parameters), True, [])
    ]
    plan.extend((params, False, notes) for params, notes in samples)

    total = len(plan)
    comparison_metrics = (
        THERMAL_COMPARISON_METRICS
        if spec.analysis_type.value.endswith("thermal")
        else STRUCTURAL_COMPARISON_METRICS
    )

    def emit(fraction: float, stage: str, message: str) -> None:
        if progress:
            progress(min(max(fraction, 0.0), 1.0), stage, message)

    for index, (params, is_baseline, notes) in enumerate(plan):
        if time_budget_seconds is not None:
            elapsed = time.perf_counter() - started
            if elapsed > time_budget_seconds and not is_baseline:
                result.termination_reason = (
                    f"time budget of {time_budget_seconds:.0f} s reached after "
                    f"{index} of {total} candidates"
                )
                log.info("exploration %s stopped: %s", rid, result.termination_reason)
                break

        label = "baseline" if is_baseline else f"candidate {index}"
        candidate_dir = storage_dir / f"{'baseline' if is_baseline else f'cand_{index:03d}'}"

        emit(index / total, "generating_geometry", f"Evaluating {label}")

        output = evaluate_candidate(
            profile=profile,
            spec=spec,
            parameters=params,
            output_dir=candidate_dir,
            index=index,
            is_baseline=is_baseline,
            cache=cache,
            progress=lambda stage, msg, _i=index: emit(
                (_i + 0.5) / total, stage, msg
            ),
        )

        record = output.record
        if notes:
            record.warnings.extend(
                f"sampling repair: {n}" for n in notes
            )
            result.sampling_notes[record.candidate_id] = notes
        if record.from_cache:
            result.cache_hits += 1

        result.candidates.append(record)
        result.outputs[record.candidate_id] = output
        if is_baseline:
            result.baseline_id = record.candidate_id

        log.info(
            "exploration %s: %s -> %s%s",
            rid,
            label,
            record.status.value,
            f" ({record.failure_reason})" if record.failure_reason else "",
        )

    emit(0.92, "packaging", "Ranking candidates")

    if not result.termination_reason:
        result.termination_reason = (
            f"candidate budget of {spec.requested_candidate_budget} exhausted"
        )

    _finalize(
        profile=profile,
        spec=spec,
        result=result,
        comparison_metrics=comparison_metrics,
        storage_dir=storage_dir,
        cache=cache,
        verify_winner=verify_winner,
        mesh_preset=mesh_preset,
        progress=progress,
    )

    result.total_seconds = time.perf_counter() - started
    emit(1.0, "completed", "Exploration complete")

    log.info(
        "exploration %s finished: %d generated, %d evaluated, %d feasible, %d failed in %.1fs",
        rid, result.generated, result.evaluated, result.feasible, result.failed,
        result.total_seconds,
    )
    return result


def _run_nsga2_study(
    *,
    profile: ComponentProfile,
    spec: EngineeringSpecification,
    baseline_parameters: dict[str, float],
    storage_dir: Path,
    result: ExplorationResult,
    cache: EvaluationCache,
    started: float,
    population_size: int,
    generations: int,
    progress: Optional[ProgressFn],
    time_budget_seconds: Optional[float],
    verify_winner: bool,
    mesh_preset: str,
) -> ExplorationResult:
    """Baseline evaluation, then a constrained NSGA-II search over the variables."""
    from app.engineering.optimization.nsga2 import run_nsga2

    def emit(fraction: float, stage: str, message: str) -> None:
        if progress:
            progress(min(max(fraction, 0.0), 1.0), stage, message)

    comparison_metrics = (
        THERMAL_COMPARISON_METRICS
        if spec.analysis_type.value.endswith("thermal")
        else STRUCTURAL_COMPARISON_METRICS
    )

    emit(0.02, "generating_geometry", "Evaluating baseline design")
    baseline_output = evaluate_candidate(
        profile=profile,
        spec=spec,
        parameters=dict(baseline_parameters),
        output_dir=storage_dir / "baseline",
        index=0,
        is_baseline=True,
        cache=cache,
        progress=lambda stage, msg: emit(0.05, stage, msg),
    )
    result.candidates.append(baseline_output.record)
    result.outputs[baseline_output.record.candidate_id] = baseline_output
    result.baseline_id = baseline_output.record.candidate_id

    search = run_nsga2(
        profile=profile,
        spec=spec,
        baseline_parameters=baseline_parameters,
        storage_dir=storage_dir,
        population_size=population_size,
        generations=generations,
        run_id=result.run_id,
        progress=lambda f, s, m: emit(0.05 + 0.85 * f, s, m),
        time_budget_seconds=time_budget_seconds,
    )

    # Re-index so the baseline stays candidate 0 in the results table.
    for offset, record in enumerate(search.candidates, start=1):
        record.index = offset
    result.candidates.extend(search.candidates)
    result.outputs.update(search.outputs)
    result.cache_hits += search.cache_hits
    result.termination_reason = search.termination_reason
    result.algorithm = (
        f"NSGA-II (pymoo), population {population_size}, "
        f"{generations + 1} generations"
    )

    emit(0.92, "packaging", "Ranking candidates")
    _finalize(
        profile=profile,
        spec=spec,
        result=result,
        comparison_metrics=comparison_metrics,
        storage_dir=storage_dir,
        cache=cache,
        verify_winner=verify_winner,
        mesh_preset=mesh_preset,
        progress=progress,
    )
    result.total_seconds = time.perf_counter() - started
    emit(1.0, "completed", "Optimization complete")
    log.info(
        "nsga2 study %s finished: %d generated, %d evaluated, %d feasible, %d failed in %.1fs",
        result.run_id, result.generated, result.evaluated, result.feasible,
        result.failed, result.total_seconds,
    )
    return result


def _finalize(
    *,
    profile: ComponentProfile,
    spec: EngineeringSpecification,
    result: ExplorationResult,
    comparison_metrics: list[str],
    storage_dir: Path,
    cache: EvaluationCache,
    verify_winner: bool,
    mesh_preset: str,
    progress: Optional[ProgressFn],
) -> None:
    """Rank, choose a recommendation, compare to baseline, then verify the mesh."""
    rank_candidates(result.candidates, spec.objectives)
    baseline = result.baseline()
    outcome = describe_recommendation(result.candidates, spec.objectives, baseline)
    result.recommendation = outcome.model_dump()

    best = result.candidates and next(
        (c for c in result.candidates if c.candidate_id == outcome.candidate_id), None
    )
    if best is not None:
        result.recommended_id = best.candidate_id
        if baseline is not None and baseline.evaluated:
            result.comparison = compare_to_baseline(best, baseline, comparison_metrics)

    if verify_winner and best is not None:
        result.mesh_convergence = _verify_on_refined_mesh(
            profile=profile,
            spec=spec,
            winner=best,
            storage_dir=storage_dir,
            comparison_metrics=comparison_metrics,
            coarse_preset=mesh_preset,
            progress=progress,
        )
        _reassess_with_convergence(spec, profile, best, result)


def _reassess_with_convergence(
    spec: EngineeringSpecification,
    profile: ComponentProfile,
    winner: CandidateRecord,
    result: "ExplorationResult",
) -> None:
    """Re-derive the winner's maturity now that a refinement study exists.

    Mesh convergence is the one verification check that cannot be answered by
    looking at a single candidate: it needs two solves at different fidelities.
    So the per-candidate assessment records it as ``not_run``, and this runs
    afterwards to replace that gap with the study's actual finding.

    A candidate can move up here - from simulation-evaluated to numerically
    verified - and it can equally move nowhere, if refining the mesh showed the
    decision metric was still moving. That second case is the one worth having
    this function for.
    """
    from app.engineering.assurance import assess, post_solver

    outcome = result.outputs.get(winner.candidate_id)
    if outcome is None or outcome.result is None or winner.assurance is None:
        return

    convergence = asdict(result.mesh_convergence)
    post = post_solver(
        result=outcome.result, spec=spec, mesh_convergence=convergence
    )
    winner.assurance = assess(
        spec=spec,
        component_type=profile.component_type,
        pre=winner.assurance.verification.pre_solver,
        post=post,
        result=outcome.result,
        evidence=winner.assurance.evidence,
        geometry_valid=True,
        constraints_evaluated=bool(winner.constraint_results),
    )
    log.info(
        "recommended candidate %s reassessed after the refinement study: %s",
        winner.candidate_id,
        winner.assurance.maturity.statement,
    )


def _verify_on_refined_mesh(
    *,
    profile: ComponentProfile,
    spec: EngineeringSpecification,
    winner: CandidateRecord,
    storage_dir: Path,
    comparison_metrics: list[str],
    coarse_preset: str,
    progress: Optional[ProgressFn],
) -> MeshConvergenceReport:
    """Re-solve the recommended design on the verification mesh."""
    report = MeshConvergenceReport(
        coarse_preset=coarse_preset, fine_preset="verification"
    )
    if coarse_preset == "verification":
        report.statement = (
            "The search already ran at verification fidelity, so no separate "
            "refinement check was needed."
        )
        return report

    if progress:
        progress(0.95, "solving", "Re-solving the recommended design on a refined mesh")

    fine_settings = profile.mesh_settings(winner.parameters, "verification")
    fine_spec = spec.model_copy(update={"mesh_settings": fine_settings})

    output = evaluate_candidate(
        profile=profile,
        spec=fine_spec,
        parameters=dict(winner.parameters),
        output_dir=storage_dir / "verification",
        index=winner.index,
        generation=winner.generation,
    )
    fine = output.record
    report.performed = True
    report.fine_candidate_id = fine.candidate_id
    report.coarse_nodes = winner.mesh_node_count
    report.fine_nodes = fine.mesh_node_count

    if not fine.evaluated:
        report.converged = None
        report.statement = (
            "The refined-mesh re-run did not complete "
            f"({fine.failure_stage}: {fine.failure_reason}). The coarse-mesh result "
            "stands on its own and has not been mesh-verified."
        )
        return report

    worst = 0.0
    worst_metric = ""
    for metric in comparison_metrics:
        a = winner.metrics.get(metric)
        b = fine.metrics.get(metric)
        if a is None or b is None or a == 0:
            report.metrics[metric] = {"available": False}
            continue
        change = (b - a) / abs(a)
        if abs(change) > worst:
            worst, worst_metric = abs(change), metric
        if abs(change) > report.tolerance:
            report.unconverged_metrics.append(metric)
        report.metrics[metric] = {
            "available": True,
            "coarse": a,
            "fine": b,
            "relative_change": change,
            "percent_change": change * 100.0,
            "converged": abs(change) <= report.tolerance,
        }

    # The decisive question is not how much a number moved, but whether the
    # pass/fail verdict survives refinement.
    report.coarse_feasible = winner.is_feasible
    report.fine_feasible = fine.is_feasible
    report.verdict_changed = bool(winner.is_feasible != fine.is_feasible)
    report.fine_constraint_results = [
        c.model_dump(mode="json") for c in fine.constraint_results
    ]

    report.converged = worst <= report.tolerance

    # Which metric the decision rests on, and whether it held still.
    report.decision_metric = DECISION_METRIC.get(spec.analysis_type)
    decision_entry = report.metrics.get(report.decision_metric or "", {})
    if decision_entry.get("available"):
        report.decision_metric_converged = bool(decision_entry["converged"])
        report.decision_metric_change = decision_entry["relative_change"]
    report.unconverged_region_metrics = [
        m for m in report.unconverged_metrics if m != report.decision_metric
    ]

    if report.verdict_changed or report.decision_metric_converged is False:
        report.status = "failed"
    elif report.decision_metric_converged is None:
        # The decision quantity was not among the compared metrics, so the
        # study cannot settle the question either way.
        report.status = "inconclusive"
    elif report.converged:
        report.status = "passed"
    else:
        report.status = "inconclusive"

    nodes = f"{report.coarse_nodes} to {report.fine_nodes} nodes"

    if report.verdict_changed:
        flipped = [
            (c.label or c.constraint_id)
            for c in fine.constraint_results
            if c.passed is False
        ]
        report.statement = (
            f"The feasibility verdict CHANGED on refinement ({nodes}). On the "
            f"{coarse_preset} mesh this design was "
            f"{'feasible' if report.coarse_feasible else 'infeasible'}; on the "
            f"verification mesh it is "
            f"{'feasible' if report.fine_feasible else 'infeasible'}"
            + (f", failing: {', '.join(flipped)}" if flipped else "")
            + ". Treat the refined-mesh verdict as the correct one and re-run the "
            "search at a finer fidelity before selecting a design."
        )
    elif report.status == "passed":
        report.statement = (
            f"Re-solving the recommended design on a refined mesh ({nodes}) changed "
            f"every reported metric by at most {worst * 100:.1f}%, within the "
            f"{report.tolerance * 100:.0f}% tolerance, and the feasibility verdict is "
            "unchanged. The result is mesh-converged for these metrics."
        )
    elif report.status == "failed":
        change = (report.decision_metric_change or 0.0) * 100.0
        report.statement = (
            f"Re-solving the recommended design on a refined mesh ({nodes}) moved the "
            f"decision quantity {report.decision_metric} by {change:+.1f}%, outside "
            f"the {report.tolerance * 100:.0f}% tolerance. The quantity the "
            "feasibility decision rests on is not mesh-independent, so the absolute "
            "value cannot be relied on and this result is not numerically verified. "
            "Re-run the search at verification fidelity."
        )
    elif report.decision_metric_converged is None:
        report.statement = (
            f"A refinement study ran ({nodes}), but the decision quantity for this "
            f"analysis ({report.decision_metric or 'unknown'}) was not among the "
            "compared metrics, so convergence is inconclusive: the study cannot "
            "settle the question either way."
        )
    else:
        changes = ", ".join(
            f"{m} {report.metrics[m]['percent_change']:+.1f}%"
            for m in report.unconverged_region_metrics
            if report.metrics.get(m, {}).get("available")
        )
        decision_change = (report.decision_metric_change or 0.0) * 100.0
        report.statement = (
            f"Re-solving the recommended design on a refined mesh ({nodes}) left the "
            f"feasibility verdict unchanged and moved the decision quantity "
            f"{report.decision_metric} by only {decision_change:+.1f}%, within the "
            f"{report.tolerance * 100:.0f}% tolerance. These region-specific metrics "
            f"did NOT converge: {changes}. The largest change is {worst_metric} at "
            f"{worst * 100:.1f}%. A peak gradient or peak stress at a material "
            "interface or a re-entrant corner is singular in this formulation and "
            "grows without bound under refinement, so it is reported but not used to "
            "decide. Treat those values as mesh-dependent indicators of where the "
            "part is working hardest, not as magnitudes."
        )
    return report
