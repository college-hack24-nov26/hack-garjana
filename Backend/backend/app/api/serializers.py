"""Database records to API responses.

Display values are derived from the stored canonical-SI numbers at this layer,
so the UI never has to guess a unit and the stored value stays authoritative.
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.core import units as U
from app.db.models import Candidate, OptimizationRun
from app.engineering.materials.catalog import MaterialRecord, get_catalog
from app.engineering.profiles.base import MESH_PRESETS, ComponentProfile
from app.engineering.solvers.registry import get_solver
from app.schemas.api import (
    CandidateOut,
    DisplayValue,
    EngineeringInputOut,
    MaterialOut,
    ParameterSpecOut,
    ProfileOut,
)
from app.schemas.engineering import KNOWN_METRICS
from app.services.artifact_store import get_store

#: Metrics surfaced with display units in every candidate response.
DISPLAY_METRICS = [
    "mass_kg",
    "volume_m3",
    "max_von_mises_pa",
    "max_displacement_m",
    "compliance_j",
    "min_factor_of_safety",
    "max_temperature_k",
    "min_temperature_k",
    "max_temperature_gradient_k_per_m",
    "heat_flow_w",
    "min_wall_thickness_m",
]


def asset_url(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    try:
        rel = get_store().relative(path)
    except Exception:
        return None
    return f"/api/assets/{quote(rel)}"


def display_metrics(metrics: dict[str, float]) -> dict[str, DisplayValue]:
    out: dict[str, DisplayValue] = {}
    for name in DISPLAY_METRICS:
        if name not in metrics or metrics[name] is None:
            continue
        kind = KNOWN_METRICS.get(name)
        if kind is None:
            continue
        canonical_unit = U.CANONICAL[kind]
        value, unit = U.display(float(metrics[name]), canonical_unit)
        out[name] = DisplayValue(
            value=value,
            unit=unit,
            canonical_value=float(metrics[name]),
            canonical_unit=canonical_unit,
        )
    return out


_EVALUATED = {"solved", "feasible", "infeasible"}


def candidate_to_out(candidate: Candidate) -> CandidateOut:
    return CandidateOut(
        candidate_id=candidate.id,
        index=candidate.candidate_index,
        generation=candidate.generation,
        status=candidate.status,
        is_baseline=candidate.is_baseline,
        from_cache=candidate.from_cache,
        parameters=candidate.parameters or {},
        geometry_hash=candidate.geometry_hash or "",
        metrics=candidate.metrics or {},
        display_metrics=display_metrics(candidate.metrics or {}),
        constraint_results=candidate.constraint_results or [],
        objective_values=candidate.objective_values or [],
        is_feasible=candidate.is_feasible,
        infeasibility_reasons=candidate.infeasibility_reasons or [],
        failure_stage=candidate.failure_stage,
        failure_reason=candidate.failure_reason,
        rank=candidate.rank,
        pareto_front=candidate.pareto_front,
        evaluated=candidate.status in _EVALUATED,
        design_version_id=candidate.design_version_id,
        preview_url=asset_url(candidate.preview_glb_path),
        step_url=asset_url(candidate.step_path),
        fields_url=(
            f"/api/candidates/{candidate.id}/visualization"
            if candidate.field_artifact_path
            else None
        ),
        solve_time_seconds=candidate.solve_time_seconds,
        mesh_node_count=candidate.mesh_node_count,
        warnings=candidate.warnings or [],
        assurance=candidate.assurance,
    )


def material_to_out(m: MaterialRecord) -> MaterialOut:
    return MaterialOut(
        material_id=m.material_id,
        name=m.name,
        family=m.family,
        typical_use=m.typical_use,
        density=m.density,
        elastic_modulus=m.elastic_modulus,
        poisson_ratio=m.poisson_ratio,
        yield_strength=m.yield_strength,
        thermal_conductivity=m.thermal_conductivity,
        specific_heat=m.specific_heat,
        max_service_temperature=m.max_service_temperature,
        source_status=m.source_status,
        notes=m.notes,
        supports_structural=m.supports_structural(),
        supports_thermal=m.supports_thermal(),
        supports_yield_margin=m.supports_yield_margin(),
    )


def profile_to_out(profile: ComponentProfile) -> ProfileOut:
    generator = profile.generator
    solver = get_solver(profile.solver_id)
    catalog = get_catalog()

    # Preserve the profile's own ordering: a component lists its typical
    # material first, and the UI defaults to the first entry. Iterating the
    # catalog instead would silently default a caliper to whichever allowed
    # alloy happens to appear earliest in materials.json.
    allowed = profile.material_choices()
    if allowed:
        by_id = {m.material_id: m for m in catalog.materials}
        materials = [
            material_to_out(by_id[material_id])
            for material_id in allowed
            if material_id in by_id
        ]
    else:
        materials = [material_to_out(m) for m in catalog.materials]

    inputs: list[EngineeringInputOut] = []
    for f in profile.required_inputs():
        display_default = None
        if f.demo_default is not None:
            try:
                display_default = U.from_canonical(f.demo_default, f.unit)
            except Exception:
                display_default = f.demo_default
        inputs.append(
            EngineeringInputOut(
                key=f.key,
                label=f.label,
                kind=f.kind,
                unit=f.unit,
                required=f.required,
                demo_default=f.demo_default,
                demo_default_display=display_default,
                help_text=f.help_text,
                why_required=f.why_required,
            )
        )

    defaults = generator.default_parameters()
    return ProfileOut(
        component_type=profile.component_type,
        display_name=profile.display_name,
        summary=profile.summary,
        analysis_type=profile.analysis_type,
        solver_id=profile.solver_id,
        solver_name=solver.solver_name,
        result_kind=solver.result_kind.value,
        method_statement=solver.method_statement,
        scope_statement=profile.scope_statement,
        not_in_scope=list(profile.not_in_scope),
        capability_note=generator.capability_note,
        parameters=[
            ParameterSpecOut(**s.model_dump()) for s in generator.parameter_specs()
        ],
        design_variables=generator.design_variable_names(),
        engineering_inputs=inputs,
        materials=materials,
        material_assignments=profile.default_material_assignments(),
        objectives=[o.model_dump(mode="json") for o in profile.default_objectives()],
        region_names=generator.named_regions(defaults).names(),
        demo_assumptions=profile.demo_fixture_assumptions(),
        mesh_presets=[
            {
                **p.model_dump(),
                "target_element_size_mm": round(
                    profile.mesh_settings(defaults, key).target_element_size_m * 1000, 2
                ),
            }
            for key, p in MESH_PRESETS.items()
        ],
    )


def optimization_run_summary(session: Session, run: OptimizationRun) -> dict:
    candidates = (
        session.query(Candidate)
        .filter(Candidate.optimization_run_id == run.id)
        .all()
    )
    solve_times = [c.solve_time_seconds for c in candidates if c.solve_time_seconds]
    return {
        "candidates_generated": run.candidates_generated,
        "candidates_evaluated": run.candidates_evaluated,
        "candidates_feasible": run.candidates_feasible,
        "candidates_failed": run.candidates_failed,
        "cache_hits": run.cache_hits,
        "total_seconds": run.total_seconds,
        "mean_solve_seconds": (sum(solve_times) / len(solve_times)) if solve_times else None,
        "max_solve_seconds": max(solve_times) if solve_times else None,
    }
