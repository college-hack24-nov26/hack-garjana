"""Deterministic candidate sampling (spec 3.5).

The exploration phase uses a seeded Latin-hypercube-style design of experiments
over the declared design variables, with the baseline always included as
candidate 0. It is deterministic for a given seed, so a run can be reproduced
exactly from the stored specification.

Samples are only proposed here. Whether a sample is *feasible* is decided later,
by geometry validation and by the solver, never by the sampler.
"""
from __future__ import annotations

import numpy as np

from app.engineering.cad.base import ComponentGenerator
from app.schemas.engineering import DesignVariableSpec


def _specs_for(
    generator: ComponentGenerator, names: list[str]
) -> list[DesignVariableSpec]:
    return [generator.spec_for(n) for n in names]


def latin_hypercube(
    generator: ComponentGenerator,
    variable_names: list[str],
    count: int,
    seed: int,
    baseline: dict[str, float] | None = None,
) -> list[dict[str, float]]:
    """Return ``count`` parameter vectors spanning the design space.

    Integer variables are rounded to their grid. Every returned vector is a
    complete parameter set: locked (preserved) parameters keep the baseline
    value so protected interfaces cannot drift.
    """
    rng = np.random.default_rng(seed)
    specs = _specs_for(generator, variable_names)
    base = dict(baseline or generator.default_parameters())

    if count <= 0 or not specs:
        return []

    dims = len(specs)
    # Stratified sample: one point per stratum per dimension, then shuffled.
    grid = np.empty((count, dims))
    for j in range(dims):
        strata = (np.arange(count) + rng.random(count)) / count
        grid[:, j] = rng.permutation(strata)

    out: list[dict[str, float]] = []
    for i in range(count):
        candidate = dict(base)
        for j, spec in enumerate(specs):
            raw = spec.minimum + grid[i, j] * (spec.maximum - spec.minimum)
            candidate[spec.name] = spec.clamp(raw)
        out.append(candidate)
    return out


def repair_towards_feasible(
    generator: ComponentGenerator,
    parameters: dict[str, float],
    variable_names: list[str],
    max_attempts: int = 12,
) -> tuple[dict[str, float], list[str]]:
    """Nudge a sample that violates a cross-parameter rule back into the space.

    This only adjusts *declared design variables* and only in the directions the
    generator's own feasibility rules imply. If it cannot find a valid vector it
    gives up and returns the attempted notes, so the candidate is recorded as
    rejected rather than silently replaced by something else.
    """
    notes: list[str] = []
    params = dict(parameters)
    adjustable = set(variable_names)

    for _ in range(max_attempts):
        result = generator.validate_parameters(params)
        if result.ok:
            return result.normalized, notes

        changed = False
        for error in result.errors:
            low = error.lower()
            # Spokes merging into a disc: fewer or narrower spokes.
            if "hub circumference" in low and "spoke_count" in adjustable:
                if params.get("spoke_count", 0) > generator.spec_for("spoke_count").minimum:
                    params["spoke_count"] = params["spoke_count"] - 1
                    notes.append("reduced spoke_count to clear the hub circumference rule")
                    changed = True
            elif "widen towards the rim" in low and "spoke_tip_width_m" in adjustable:
                params["spoke_tip_width_m"] = min(
                    params["spoke_tip_width_m"], params["spoke_root_width_m"]
                )
                notes.append("clamped spoke_tip_width_m to the root width")
                changed = True
            elif "overhang the rim" in low and "spoke_dish_offset_m" in adjustable:
                spec = generator.spec_for("spoke_dish_offset_m")
                params["spoke_dish_offset_m"] = spec.clamp(
                    params["spoke_dish_offset_m"] * 0.8
                )
                notes.append("reduced spoke_dish_offset_m to keep the spoke inside the rim")
                changed = True
        if not changed:
            break

    return params, notes


def sample_candidates(
    generator: ComponentGenerator,
    variable_names: list[str],
    count: int,
    seed: int,
    baseline: dict[str, float] | None = None,
) -> list[tuple[dict[str, float], list[str]]]:
    """Sample, then repair cross-parameter violations where the rules allow."""
    raw = latin_hypercube(generator, variable_names, count, seed, baseline)
    out: list[tuple[dict[str, float], list[str]]] = []
    for params in raw:
        repaired, notes = repair_towards_feasible(generator, params, variable_names)
        out.append((repaired, notes))
    return out
