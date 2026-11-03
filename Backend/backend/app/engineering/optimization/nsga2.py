"""Multi-objective search with NSGA-II (spec 3.3, 3.5, 5.1).

pymoo provides the search algorithm only. Geometry still comes from the CAD
generator, physics still comes from the solver, and feasibility still comes from
the configured constraints - NSGA-II just decides which parameter vectors to try
next.

On penalties for failed candidates: a candidate that fails geometry, meshing or
the solver has **no metrics**, and its stored record keeps that failure and is
excluded from the results ranking. But a gradient-free search still has to be
told "do not go there", so the optimizer's internal matrices receive a large
constraint violation for that point. That penalty lives only inside the search;
it is never written into a candidate's metrics, never shown as a result, and
never makes a failed candidate rankable.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from app.core.ids import new_id
from app.core.logging import get_logger
from app.engineering.optimization.evaluation import CandidateRecord
from app.engineering.profiles.base import ComponentProfile
from app.schemas.common import ConstraintOperator, ObjectiveSense
from app.schemas.engineering import Constraint, EngineeringSpecification
from app.services.pipeline import EvaluationCache, EvaluationOutput, evaluate_candidate

log = get_logger(__name__)

#: Internal-only penalty for a point the pipeline could not evaluate.
_FAILED_VIOLATION = 1.0e3


def constraint_violation(metrics: dict[str, float], constraint: Constraint) -> Optional[float]:
    """Normalized violation: <= 0 satisfied, > 0 violated. None if unavailable."""
    value = metrics.get(constraint.metric)
    if value is None:
        return None
    if constraint.operator == ConstraintOperator.LTE:
        limit = constraint.limit.canonical()
        return (value - limit) / abs(limit) if limit else value - limit
    if constraint.operator == ConstraintOperator.GTE:
        limit = constraint.limit.canonical()
        return (limit - value) / abs(limit) if limit else limit - value
    lo, hi = constraint.lower.canonical(), constraint.upper.canonical()
    span = abs(hi - lo) or 1.0
    return max(lo - value, value - hi) / span


@dataclass
class Nsga2Result:
    run_id: str
    algorithm: str = "NSGA-II (pymoo)"
    seed: int = 0
    population_size: int = 8
    generations: int = 3
    candidates: list[CandidateRecord] = field(default_factory=list)
    outputs: dict[str, EvaluationOutput] = field(default_factory=dict)
    evaluations: int = 0
    cache_hits: int = 0
    total_seconds: float = 0.0
    termination_reason: str = ""


def run_nsga2(
    *,
    profile: ComponentProfile,
    spec: EngineeringSpecification,
    baseline_parameters: dict[str, float],
    storage_dir: Path,
    population_size: int = 8,
    generations: int = 3,
    run_id: Optional[str] = None,
    progress: Optional[Callable[[float, str, str], None]] = None,
    time_budget_seconds: Optional[float] = None,
) -> Nsga2Result:
    """Run a small constrained NSGA-II search over the declared design variables."""
    from pymoo.algorithms.moo.nsga2 import NSGA2
    from pymoo.core.problem import Problem
    from pymoo.operators.crossover.sbx import SBX
    from pymoo.operators.mutation.pm import PM
    from pymoo.operators.sampling.rnd import FloatRandomSampling
    from pymoo.optimize import minimize
    from pymoo.termination import get_termination

    started = time.perf_counter()
    rid = run_id or new_id("opt")
    storage_dir = Path(storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)

    generator = profile.generator
    var_names = list(spec.design_variables)
    specs = [generator.spec_for(n) for n in var_names]
    xl = np.array([s.minimum for s in specs], dtype=float)
    xu = np.array([s.maximum for s in specs], dtype=float)

    constraints = spec.all_constraints()
    objectives = spec.objectives
    cache = EvaluationCache()

    result = Nsga2Result(
        run_id=rid,
        seed=spec.random_seed,
        population_size=population_size,
        generations=generations,
    )

    max_evaluations = population_size * (generations + 1)
    state = {"index": 0, "stopped": False}
    #: Worst objective values seen so far, used to place failed points without
    #: inventing a value that looks like a measurement.
    worst = np.full(len(objectives), -np.inf)

    def evaluate_vector(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        idx = state["index"]
        state["index"] += 1

        params = dict(baseline_parameters)
        for name, spec_i, value in zip(var_names, specs, x):
            params[name] = spec_i.clamp(float(value))

        if progress:
            progress(
                min(idx / max(max_evaluations, 1), 0.98),
                "optimizing",
                f"NSGA-II evaluation {idx + 1} of about {max_evaluations}",
            )

        output = evaluate_candidate(
            profile=profile,
            spec=spec,
            parameters=params,
            output_dir=storage_dir / f"cand_{idx:03d}",
            index=idx,
            generation=idx // max(population_size, 1),
            cache=cache,
            candidate_id=new_id("cand"),
        )
        record = output.record
        result.candidates.append(record)
        result.outputs[record.candidate_id] = output
        result.evaluations += 1
        if record.from_cache:
            result.cache_hits += 1

        if not record.evaluated:
            # No metrics exist for this point. Steer the search away from it
            # without writing any value into the candidate's results.
            f = np.where(np.isfinite(worst), worst, 1.0)
            g = np.full(max(len(constraints), 1), _FAILED_VIOLATION)
            return f.astype(float), g

        f_vals = []
        for o in objectives:
            raw = record.metrics.get(o.metric)
            if raw is None:
                f_vals.append(float(np.nanmax([worst[len(f_vals)], 1.0])))
                continue
            f_vals.append(float(raw) if o.sense == ObjectiveSense.MINIMIZE else -float(raw))
        f = np.asarray(f_vals, dtype=float)
        np.maximum(worst, f, out=worst)

        g_vals = []
        for c in constraints:
            v = constraint_violation(record.metrics, c)
            g_vals.append(_FAILED_VIOLATION if v is None else float(v))
        g = np.asarray(g_vals or [0.0], dtype=float)
        return f, g

    class DesignProblem(Problem):
        def __init__(self) -> None:
            super().__init__(
                n_var=len(var_names),
                n_obj=len(objectives),
                n_ieq_constr=max(len(constraints), 1),
                xl=xl,
                xu=xu,
            )

        def _evaluate(self, X, out, *args, **kwargs):
            F, G = [], []
            for row in np.atleast_2d(X):
                if time_budget_seconds is not None and (
                    time.perf_counter() - started > time_budget_seconds
                ):
                    state["stopped"] = True
                    F.append(np.where(np.isfinite(worst), worst, 1.0).astype(float))
                    G.append(np.full(max(len(constraints), 1), _FAILED_VIOLATION))
                    continue
                f, g = evaluate_vector(row)
                F.append(f)
                G.append(g)
            out["F"] = np.vstack(F)
            out["G"] = np.vstack(G)

    # Seed generation zero with the baseline so the search always has a known
    # reference point in the population.
    initial = FloatRandomSampling().do(DesignProblem(), population_size).get("X")
    initial = np.atleast_2d(np.asarray(initial, dtype=float))
    baseline_vector = np.array(
        [float(baseline_parameters[n]) for n in var_names], dtype=float
    )
    initial[0] = np.clip(baseline_vector, xl, xu)

    algorithm = NSGA2(
        pop_size=population_size,
        sampling=initial,
        crossover=SBX(prob=0.9, eta=15),
        mutation=PM(eta=20),
        eliminate_duplicates=True,
    )

    minimize(
        DesignProblem(),
        algorithm,
        get_termination("n_gen", generations + 1),
        seed=spec.random_seed,
        verbose=False,
    )

    result.total_seconds = time.perf_counter() - started
    result.termination_reason = (
        f"time budget of {time_budget_seconds:.0f} s reached after "
        f"{result.evaluations} evaluations"
        if state["stopped"]
        else f"completed {generations + 1} generations of {population_size} individuals "
        f"({result.evaluations} evaluations)"
    )
    log.info("NSGA-II %s: %s in %.1fs", rid, result.termination_reason, result.total_seconds)
    return result
