"""The deterministic checks. This module is the assurance plane.

Nothing here consults a language model, and nothing here is reachable from one.
Every verdict comes from a measurement compared against a threshold that is
written down in this file, which is the whole point: the component that decides
whether a physics setup is sound must be independent of the component that
proposed it. The research is unambiguous about why - a benchmark of language
agents on real finite-element setup found 88% produced runnable solver input
and none of them produced a correct physics setup. Self-review does not close
that gap; an independent checker does.

Two stages:

``pre_solver_input_checks`` and ``pre_solver_mesh_checks`` run before the
solver is invoked and can stop a candidate from consuming a solve at all.

``post_solver_checks`` runs on the returned result and decides whether that
result may be called numerically verified.

Thresholds are collected at the top of the module so they can be read in one
place and cited in a report.
"""
from __future__ import annotations

from typing import Optional

import numpy as np

from app.core import units as U
from app.engineering.assurance.benchmark_evidence import benchmark_status
from app.engineering.assurance.checks import (
    AssuranceCheck,
    AssuranceReport,
    CheckSeverity,
    CheckStage,
    CheckStatus,
)
from app.engineering.cad.base import GeneratedGeometry
from app.engineering.materials.catalog import MaterialRecord
from app.engineering.meshing.gmsh_runner import MeshResult
from app.engineering.solvers.base import SimulationResult
from app.engineering.solvers.linear_algebra import ACCEPT_RESIDUAL
from app.schemas.common import AnalysisType, ComponentType
from app.schemas.engineering import EngineeringSpecification, LoadCase

# ------------------------------------------------------------------ thresholds

#: The interface tolerance the research dossiers call for: ±0.001 mm.
#:
#: This build does not enforce it, and the check below says so rather than
#: reporting this number as though it had. Preserved interfaces are measured on
#: the tessellated solid, and a triangulation cannot resolve a micrometre, so
#: the generators declare a 1 mm measurement tolerance instead. The measured
#: deviations are in fact far smaller - the geometry is built directly from the
#: parameter vector, so a bead-seat diameter comes out exact - but the *gate*
#: only proves 1 mm, and the gate is what the result may claim.
#:
#: Closing this gap needs the interface measured against the analytic CAD
#: feature rather than against its triangulation. Until then the check reports
#: the tolerance it actually applied.
INTERFACE_TOLERANCE_TARGET_M = 1.0e-6

#: Relative disagreement allowed between the meshed volume and the CAD volume.
MESH_VOLUME_TOLERANCE = 0.02

#: Gmsh gamma-quality floor, and the share of elements allowed to sit below it.
MIN_ELEMENT_QUALITY = 0.10
MAX_POOR_ELEMENT_FRACTION = 0.01

#: Relative error allowed when an assembled load is integrated back.
LOAD_BALANCE_TOLERANCE = 0.02

#: Relative error allowed on the energy balance.
ENERGY_BALANCE_TOLERANCE = 0.02

#: Relative movement in the decision metric that still counts as converged.
MESH_CONVERGENCE_TOLERANCE = 0.05

#: Plausible overall size for each component, in metres. A model whose bounding
#: box falls outside its envelope has almost certainly been handed millimetres
#: as metres, which is seeded failure case F02.
SIZE_ENVELOPE_M: dict[ComponentType, tuple[float, float]] = {
    ComponentType.ALLOY_WHEEL: (0.20, 1.20),
    ComponentType.BRAKE_CALIPER: (0.03, 0.50),
    ComponentType.SPARK_PLUG: (0.01, 0.20),
}

#: Which named thermal regions are heat sources and which are sinks. Used to
#: catch a swapped hot/cold boundary - seeded failure case F07 - which a plain
#: "is there a temperature difference" test cannot see, because a swapped pair
#: has exactly the same temperature span as a correct one.
THERMAL_REGION_ROLE: dict[str, str] = {
    "combustion_exposed_surfaces": "source",
    "electrode_firing_tip": "source",
    "cylinder_head_seat": "sink",
    "terminal_end_surfaces": "sink",
}

#: The quantity each analysis exists to produce. Its absence invalidates the run.
DECISION_METRIC: dict[AnalysisType, str] = {
    AnalysisType.LINEAR_STATIC_STRUCTURAL: "max_von_mises_pa",
    AnalysisType.STEADY_STATE_THERMAL: "max_temperature_k",
    AnalysisType.REDUCED_ORDER_THERMAL: "max_temperature_k",
}


def _check(
    check_id: str,
    stage: CheckStage,
    title: str,
    description: str,
    status: CheckStatus,
    detail: str,
    *,
    severity: CheckSeverity = CheckSeverity.BLOCKING,
    measured: Optional[float] = None,
    threshold: Optional[float] = None,
    unit: Optional[str] = None,
) -> AssuranceCheck:
    return AssuranceCheck(
        check_id=check_id,
        stage=stage,
        title=title,
        description=description,
        status=status,
        severity=severity,
        measured=measured,
        threshold=threshold,
        unit=unit,
        detail=detail,
    )


# =========================================================== pre-solver: inputs


def pre_solver_input_checks(
    *,
    spec: EngineeringSpecification,
    geometry: GeneratedGeometry,
    materials: dict[str, MaterialRecord],
    case: LoadCase,
) -> AssuranceReport:
    """Everything checkable before a mesh exists."""
    checks: list[AssuranceCheck] = [
        _unit_consistency(spec, case),
        _dimensional_plausibility(geometry),
        _material_completeness(spec, materials),
        _geometry_integrity(geometry),
        _interface_invariance(geometry),
        _semantic_region_mapping(geometry, case),
        _force_path_declaration(spec, geometry, case),
        _thermal_boundary_consistency(spec, case),
    ]
    return AssuranceReport(stage=CheckStage.PRE_SOLVER, checks=checks)


def _unit_consistency(spec: EngineeringSpecification, case: LoadCase) -> AssuranceCheck:
    """Every quantity crossing into the solver carries a convertible unit.

    Seeded failure cases F01 and F02. A `Quantity` validates its unit on
    construction, so this check is looking for the cases that slip past that:
    a unit whose kind does not match the field it was placed in, and a value
    that cannot be converted to canonical SI.
    """
    problems: list[str] = []
    checked = 0

    def visit(obj: object, path: str) -> None:
        nonlocal checked
        if isinstance(obj, dict):
            if set(obj) >= {"value", "unit"} and isinstance(obj.get("unit"), str):
                checked += 1
                try:
                    U.to_canonical(float(obj["value"]), obj["unit"])
                except Exception as exc:
                    problems.append(f"{path}: {exc}")
                return
            for k, v in obj.items():
                visit(v, f"{path}.{k}" if path else str(k))
        elif isinstance(obj, (list, tuple)):
            for i, v in enumerate(obj):
                visit(v, f"{path}[{i}]")

    visit(case.model_dump(mode="json"), "load_case")
    for c in spec.all_constraints():
        visit(c.model_dump(mode="json"), f"constraint:{c.constraint_id}")

    if problems:
        return _check(
            "unit_consistency",
            CheckStage.PRE_SOLVER,
            "Unit consistency",
            "Every quantity entering the solver converts to canonical SI.",
            CheckStatus.FAILED,
            "Unconvertible or mismatched units: " + "; ".join(problems),
            measured=float(len(problems)),
            threshold=0.0,
        )
    if checked == 0:
        return _check(
            "unit_consistency",
            CheckStage.PRE_SOLVER,
            "Unit consistency",
            "Every quantity entering the solver converts to canonical SI.",
            CheckStatus.FAILED,
            "No unit-carrying quantity was found in the load case or the "
            "constraints, so nothing dimensional could be verified. A load case "
            "with no quantities cannot be solved.",
        )
    return _check(
        "unit_consistency",
        CheckStage.PRE_SOLVER,
        "Unit consistency",
        "Every quantity entering the solver converts to canonical SI.",
        CheckStatus.PASSED,
        f"{checked} unit-carrying quantities converted to canonical SI "
        f"(m, N, Pa, kg, K, W/(m·K)).",
        measured=float(checked),
    )


def _dimensional_plausibility(geometry: GeneratedGeometry) -> AssuranceCheck:
    """The built solid is the size this component actually is.

    Seeded failure case F02: millimetres read as metres make a wheel a thousand
    times too large, which every downstream number would absorb silently.
    """
    lo, hi = SIZE_ENVELOPE_M[geometry.component_type]
    size = max(geometry.validation.metrics.bbox_size_m)
    if not (lo <= size <= hi):
        return _check(
            "dimensional_plausibility",
            CheckStage.PRE_SOLVER,
            "Dimensional plausibility",
            "The solid's overall size falls inside the envelope for its component type.",
            CheckStatus.FAILED,
            f"The largest bounding-box dimension is {size:.4g} m, outside the "
            f"{lo}-{hi} m envelope for a {geometry.component_type.value}. This is "
            "the signature of a unit-scale error in the parameters.",
            measured=size,
            threshold=hi,
            unit="m",
        )
    return _check(
        "dimensional_plausibility",
        CheckStage.PRE_SOLVER,
        "Dimensional plausibility",
        "The solid's overall size falls inside the envelope for its component type.",
        CheckStatus.PASSED,
        f"Largest overall dimension {size * 1e3:.1f} mm, inside the "
        f"{lo * 1e3:.0f}-{hi * 1e3:.0f} mm envelope.",
        measured=size,
        unit="m",
    )


def _material_completeness(
    spec: EngineeringSpecification, materials: dict[str, MaterialRecord]
) -> AssuranceCheck:
    """Each assigned material carries the properties this analysis needs.

    Seeded failure case F03. A grade name is not a material card: if the
    analysis needs a yield strength and the record has none, the factor of
    safety is unavailable, and that must be stated rather than substituted.
    """
    structural = spec.analysis_type is AnalysisType.LINEAR_STATIC_STRUCTURAL
    problems: list[str] = []
    advisories: list[str] = []

    needs_yield = any(
        c.metric in ("min_factor_of_safety", "max_von_mises_pa")
        for c in spec.all_constraints()
    )

    for key, m in materials.items():
        if structural:
            for attr, label in (
                ("elastic_modulus", "elastic modulus"),
                ("poisson_ratio", "Poisson's ratio"),
                ("density", "density"),
            ):
                v = getattr(m, attr, None)
                if v is None or v <= 0:
                    problems.append(f"{key} ({m.material_id}) has no usable {label}")
            if needs_yield and not m.supports_yield_margin():
                advisories.append(
                    f"{key} ({m.material_id}) has no defined yield strength, so no "
                    "factor of safety can be reported"
                )
        else:
            k = getattr(m, "thermal_conductivity", None)
            if k is None or k <= 0:
                problems.append(
                    f"{key} ({m.material_id}) has no thermal conductivity, which a "
                    "conduction analysis cannot proceed without"
                )
            if getattr(m, "density", None) in (None, 0):
                advisories.append(f"{key} ({m.material_id}) has no density, so no mass is reported")

        if not getattr(m, "condition", None):
            advisories.append(
                f"{key} ({m.material_id}) does not declare a temper or heat-treatment "
                "condition, so its properties are grade-nominal only"
            )

    if problems:
        return _check(
            "material_completeness",
            CheckStage.PRE_SOLVER,
            "Material property completeness",
            "Every assigned material carries the properties this analysis consumes.",
            CheckStatus.FAILED,
            "; ".join(problems),
            measured=float(len(problems)),
            threshold=0.0,
        )
    if advisories:
        return _check(
            "material_completeness",
            CheckStage.PRE_SOLVER,
            "Material property completeness",
            "Every assigned material carries the properties this analysis consumes.",
            CheckStatus.WARNING,
            "; ".join(advisories),
            severity=CheckSeverity.ADVISORY,
        )
    return _check(
        "material_completeness",
        CheckStage.PRE_SOLVER,
        "Material property completeness",
        "Every assigned material carries the properties this analysis consumes.",
        CheckStatus.PASSED,
        f"{len(materials)} material assignment(s) carry every property this "
        "analysis consumes, each with a declared condition.",
        measured=float(len(materials)),
    )


def _geometry_integrity(geometry: GeneratedGeometry) -> AssuranceCheck:
    """Positive volume, a valid solid, and the solid count the template declares."""
    m = geometry.validation.metrics
    if not geometry.validation.passed:
        return _check(
            "geometry_integrity",
            CheckStage.PRE_SOLVER,
            "Geometry integrity",
            "The solid is valid, watertight and has positive volume.",
            CheckStatus.FAILED,
            "The geometry gate rejected this solid: "
            + "; ".join(geometry.validation.errors),
        )
    if m.volume_m3 <= 0 or not m.is_valid_solid:
        return _check(
            "geometry_integrity",
            CheckStage.PRE_SOLVER,
            "Geometry integrity",
            "The solid is valid, watertight and has positive volume.",
            CheckStatus.FAILED,
            f"Measured volume {m.volume_m3:.6g} m3, valid-solid flag "
            f"{m.is_valid_solid}.",
            measured=m.volume_m3,
            threshold=0.0,
            unit="m3",
        )
    return _check(
        "geometry_integrity",
        CheckStage.PRE_SOLVER,
        "Geometry integrity",
        "The solid is valid, watertight and has positive volume.",
        CheckStatus.PASSED,
        f"{m.solid_count} valid solid(s), {m.volume_m3 * 1e6:.1f} cm3 total.",
        measured=m.volume_m3,
        unit="m3",
    )


def _interface_invariance(geometry: GeneratedGeometry) -> AssuranceCheck:
    """Protected vehicle interfaces measured where the specification put them.

    A bolt circle, a centre bore or a thread diameter that drifts makes a part
    that cannot be fitted, however good its stress result.
    """
    checks = geometry.validation.preserved_interface_checks
    if not checks:
        return _check(
            "interface_invariance",
            CheckStage.PRE_SOLVER,
            "Preserved interface invariance",
            "Protected interfaces measure what the specification requires.",
            CheckStatus.NOT_RUN,
            "This template declares no preserved interfaces, so none were "
            "measured. That is a gap in the template, not a pass.",
            severity=CheckSeverity.ADVISORY,
        )
    failed = [c for c in checks if not c.passed]
    worst = max(
        (abs(c.measured_value_m - c.expected_value_m) for c in checks), default=0.0
    )
    # The tolerance actually applied, which is the loosest of the declared ones.
    # Reported in place of the target so the check cannot overstate what it proved.
    applied = max((c.tolerance_m for c in checks), default=0.0)

    if failed:
        detail = "; ".join(
            f"{c.name}: measured {c.measured_value_m * 1e3:.4f} mm against "
            f"{c.expected_value_m * 1e3:.4f} mm required "
            f"(tolerance {c.tolerance_m * 1e3:.4f} mm)"
            for c in failed
        )
        return _check(
            "interface_invariance",
            CheckStage.PRE_SOLVER,
            "Preserved interface invariance",
            "Protected interfaces measure what the specification requires.",
            CheckStatus.FAILED,
            detail,
            measured=worst,
            threshold=applied,
            unit="m",
        )

    caveat = ""
    if applied > INTERFACE_TOLERANCE_TARGET_M:
        caveat = (
            f" This proves the interface to {applied * 1e3:.3f} mm, not to the "
            f"{INTERFACE_TOLERANCE_TARGET_M * 1e3:.3f} mm target: the measurement is "
            "taken on the tessellated solid, which cannot resolve finer. The "
            "deviation measured is well inside that, but only the applied "
            "tolerance is proven."
        )

    return _check(
        "interface_invariance",
        CheckStage.PRE_SOLVER,
        "Preserved interface invariance",
        "Protected interfaces measure what the specification requires.",
        CheckStatus.PASSED,
        f"{len(checks)} protected interface(s) held; largest deviation "
        f"{worst * 1e3:.5f} mm against an applied tolerance of "
        f"{applied * 1e3:.3f} mm." + caveat,
        measured=worst,
        threshold=applied,
        unit="m",
    )


def _semantic_region_mapping(
    geometry: GeneratedGeometry, case: LoadCase
) -> AssuranceCheck:
    """Every region the load case names exists in the geometry's region set.

    Seeded failure case F04. Boundary conditions attach to named semantic
    regions built by the generator, never to face indices, because a face index
    means something different after any parameter change.
    """
    available = {r.name for r in geometry.region_set.regions}
    referenced: list[tuple[str, str]] = []
    for load in case.loads:
        referenced.append((load.region, f"load:{load.type}"))
    for support in case.supports:
        referenced.append((support.region, f"support:{support.type}"))
    for bc in case.thermal_boundary_conditions:
        referenced.append((bc.region, "thermal_boundary"))

    missing = [(name, role) for name, role in referenced if name not in available]
    if missing:
        return _check(
            "semantic_region_mapping",
            CheckStage.PRE_SOLVER,
            "Semantic region mapping",
            "Every boundary condition names a region the generator actually built.",
            CheckStatus.FAILED,
            "These boundary conditions name regions this geometry does not have: "
            + "; ".join(f"{role} -> {name!r}" for name, role in missing)
            + f". Available regions: {sorted(available)}.",
            measured=float(len(missing)),
            threshold=0.0,
        )
    if not referenced:
        return _check(
            "semantic_region_mapping",
            CheckStage.PRE_SOLVER,
            "Semantic region mapping",
            "Every boundary condition names a region the generator actually built.",
            CheckStatus.FAILED,
            "The load case names no regions at all, so no boundary condition "
            "would be applied and the model would be unconstrained.",
        )
    return _check(
        "semantic_region_mapping",
        CheckStage.PRE_SOLVER,
        "Semantic region mapping",
        "Every boundary condition names a region the generator actually built.",
        CheckStatus.PASSED,
        f"{len(referenced)} boundary condition(s) mapped to named semantic "
        f"regions out of {len(available)} available.",
        measured=float(len(referenced)),
    )


def _force_path_declaration(
    spec: EngineeringSpecification,
    geometry: GeneratedGeometry,
    case: LoadCase,
) -> AssuranceCheck:
    """A caliper's hydraulic pressure, piston force and pad reaction are distinct.

    Seeded failure case F05, and the most component-specific check here.
    Hydraulic pressure acts on the piston area; the resulting piston force is
    transferred to the pad, and the pad reacts against the disc. The three are
    related by an area and are not interchangeable. A pressure value used
    directly as a pad force is wrong by a factor of the bore area - roughly
    1800x for a 48 mm bore - and the result would still look plausible.
    """
    if geometry.component_type is not ComponentType.BRAKE_CALIPER:
        return _check(
            "force_path_declaration",
            CheckStage.PRE_SOLVER,
            "Force-path declaration",
            "Pressure, piston force and reaction force are distinguished, not conflated.",
            CheckStatus.NOT_APPLICABLE,
            f"No hydraulic force path applies to a {geometry.component_type.value}.",
        )

    pressure_loads = [l for l in case.loads if l.type == "pressure"]
    force_loads = [l for l in case.loads if l.type == "force"]

    if not pressure_loads:
        return _check(
            "force_path_declaration",
            CheckStage.PRE_SOLVER,
            "Force-path declaration",
            "Pressure, piston force and reaction force are distinguished, not conflated.",
            CheckStatus.FAILED,
            "The caliper case applies no pressure load. Hydraulic actuation must "
            "enter as a pressure on the piston bore so that the piston force is "
            "derived from it by area, rather than being asserted directly.",
        )

    bore = geometry.parameters.get("piston_bore_diameter_m")
    if not bore or bore <= 0:
        return _check(
            "force_path_declaration",
            CheckStage.PRE_SOLVER,
            "Force-path declaration",
            "Pressure, piston force and reaction force are distinguished, not conflated.",
            CheckStatus.FAILED,
            "A hydraulic pressure is applied but the piston bore diameter is not "
            "available from the geometry, so the pressure cannot be converted into "
            "a piston force. The conversion must not be assumed.",
        )

    area = np.pi * (float(bore) / 2.0) ** 2
    detail_parts = []
    for load in pressure_loads:
        p = load.magnitude.canonical() if load.magnitude else None
        if p is None:
            continue
        detail_parts.append(
            f"{p / 1e6:.2f} MPa on {load.region!r} over a {float(bore) * 1e3:.1f} mm "
            f"bore ({area * 1e6:.0f} mm2) gives a piston force of {p * area / 1e3:.2f} kN"
        )

    reaction = (
        f" The pad reaction enters separately as {len(force_loads)} force load(s), "
        "so the clamping path is self-equilibrating and each load is verified on "
        "its own."
        if force_loads
        else " No separate pad reaction load is declared, so the model is held only "
        "by its mounting supports."
    )

    return _check(
        "force_path_declaration",
        CheckStage.PRE_SOLVER,
        "Force-path declaration",
        "Pressure, piston force and reaction force are distinguished, not conflated.",
        CheckStatus.PASSED,
        ("; ".join(detail_parts) or "Pressure load declared on the piston bore.")
        + "." + reaction,
        measured=area,
        unit="m2",
    )


def _thermal_boundary_consistency(
    spec: EngineeringSpecification, case: LoadCase
) -> AssuranceCheck:
    """A conduction model needs a heat source, a sink, and the right sign.

    Seeded failure case F07. Steady-state conduction with no sink has no
    solution; with the hot and cold sides swapped it has a solution that is
    confidently backwards.
    """
    if spec.analysis_type is AnalysisType.LINEAR_STATIC_STRUCTURAL:
        return _check(
            "thermal_boundary_consistency",
            CheckStage.PRE_SOLVER,
            "Thermal boundary consistency",
            "A conduction model has both a heat input and a sink path, with consistent signs.",
            CheckStatus.NOT_APPLICABLE,
            "This is a structural analysis; it has no thermal boundary conditions.",
        )

    boundaries = list(case.thermal_boundary_conditions)
    if len(boundaries) < 2:
        return _check(
            "thermal_boundary_consistency",
            CheckStage.PRE_SOLVER,
            "Thermal boundary consistency",
            "A conduction model has both a heat input and a sink path, with consistent signs.",
            CheckStatus.FAILED,
            f"Only {len(boundaries)} thermal boundary condition(s) are defined. "
            "Steady-state conduction needs at least a heat input and a sink path; "
            "without both there is no steady solution.",
            measured=float(len(boundaries)),
            threshold=2.0,
        )

    temps: list[tuple[str, float]] = []
    for bc in boundaries:
        t = getattr(bc, "ambient_temperature", None) or getattr(
            bc, "temperature", None
        )
        if t is not None:
            temps.append((bc.region, t.canonical()))

    if len(temps) < 2:
        return _check(
            "thermal_boundary_consistency",
            CheckStage.PRE_SOLVER,
            "Thermal boundary consistency",
            "A conduction model has both a heat input and a sink path, with consistent signs.",
            CheckStatus.WARNING,
            "Fewer than two boundary temperatures are stated, so the direction of "
            "heat flow could not be checked before solving.",
            severity=CheckSeverity.ADVISORY,
        )

    # A swapped hot/cold pair has the same span as a correct one, so the span
    # alone proves nothing. Where the regions carry a known thermal role, check
    # the direction of heat flow against it.
    sources = [(r, t) for r, t in temps if THERMAL_REGION_ROLE.get(r) == "source"]
    sinks = [(r, t) for r, t in temps if THERMAL_REGION_ROLE.get(r) == "sink"]
    if sources and sinks:
        coldest_source = min(sources, key=lambda t: t[1])
        hottest_sink = max(sinks, key=lambda t: t[1])
        if coldest_source[1] <= hottest_sink[1]:
            return _check(
                "thermal_boundary_consistency",
                CheckStage.PRE_SOLVER,
                "Thermal boundary consistency",
                "A conduction model has both a heat input and a sink path, with consistent signs.",
                CheckStatus.FAILED,
                f"The heat source {coldest_source[0]!r} is at "
                f"{coldest_source[1] - 273.15:.0f} C, which is not hotter than the "
                f"sink {hottest_sink[0]!r} at {hottest_sink[1] - 273.15:.0f} C. Heat "
                "would flow backwards through the component: the hot and cold "
                "boundaries have been swapped.",
                measured=coldest_source[1] - hottest_sink[1],
                threshold=0.0,
                unit="K",
            )

    hottest = max(temps, key=lambda t: t[1])
    coldest = min(temps, key=lambda t: t[1])
    span = hottest[1] - coldest[1]
    if span <= 0:
        return _check(
            "thermal_boundary_consistency",
            CheckStage.PRE_SOLVER,
            "Thermal boundary consistency",
            "A conduction model has both a heat input and a sink path, with consistent signs.",
            CheckStatus.FAILED,
            "Every thermal boundary sits at the same temperature, so no heat would "
            "flow and the computed field would be uniform regardless of geometry.",
            measured=span,
            threshold=0.0,
            unit="K",
        )

    return _check(
        "thermal_boundary_consistency",
        CheckStage.PRE_SOLVER,
        "Thermal boundary consistency",
        "A conduction model has both a heat input and a sink path, with consistent signs.",
        CheckStatus.PASSED,
        f"Heat flows from {hottest[0]!r} at {hottest[1] - 273.15:.0f} C to "
        f"{coldest[0]!r} at {coldest[1] - 273.15:.0f} C, a {span:.0f} K span "
        f"across {len(boundaries)} boundary conditions.",
        measured=span,
        unit="K",
    )


# ============================================================= pre-solver: mesh


def pre_solver_mesh_checks(
    *, geometry: GeneratedGeometry, mesh: MeshResult
) -> AssuranceReport:
    """Mesh checks, run after meshing and before the solve."""
    return AssuranceReport(
        stage=CheckStage.PRE_SOLVER,
        checks=[_mesh_quality(mesh), _mesh_volume_fidelity(geometry, mesh)],
    )


def _mesh_quality(mesh: MeshResult) -> AssuranceCheck:
    q = mesh.metadata.quality
    if q.min_quality is None:
        return _check(
            "mesh_quality",
            CheckStage.PRE_SOLVER,
            "Mesh element quality",
            "No inverted or near-degenerate elements, measured by the gamma ratio.",
            CheckStatus.NOT_RUN,
            "The mesher reported no element-quality statistics for this mesh, so "
            "quality was not verified.",
        )
    if q.min_quality <= 0:
        return _check(
            "mesh_quality",
            CheckStage.PRE_SOLVER,
            "Mesh element quality",
            "No inverted or near-degenerate elements, measured by the gamma ratio.",
            CheckStatus.FAILED,
            f"The worst element has a gamma quality of {q.min_quality:.4f}, which "
            "means an inverted or degenerate tetrahedron. The stiffness matrix "
            "built from it would not be meaningful.",
            measured=q.min_quality,
            threshold=MIN_ELEMENT_QUALITY,
        )

    total = max(mesh.metadata.tet_count, 1)
    poor_fraction = q.poor_element_count / total
    if poor_fraction > MAX_POOR_ELEMENT_FRACTION:
        return _check(
            "mesh_quality",
            CheckStage.PRE_SOLVER,
            "Mesh element quality",
            "No inverted or near-degenerate elements, measured by the gamma ratio.",
            CheckStatus.WARNING,
            f"{q.poor_element_count} of {total} elements ({poor_fraction * 100:.2f}%) "
            f"fall below a gamma quality of {q.poor_element_threshold}. Local stress "
            "peaks near those elements should be treated with caution.",
            severity=CheckSeverity.ADVISORY,
            measured=poor_fraction,
            threshold=MAX_POOR_ELEMENT_FRACTION,
        )
    return _check(
        "mesh_quality",
        CheckStage.PRE_SOLVER,
        "Mesh element quality",
        "No inverted or near-degenerate elements, measured by the gamma ratio.",
        CheckStatus.PASSED,
        f"Worst element gamma {q.min_quality:.3f}, mean "
        f"{q.mean_quality:.3f} over {total} elements; "
        f"{q.poor_element_count} below {q.poor_element_threshold}."
        if q.mean_quality is not None
        else f"Worst element gamma {q.min_quality:.3f} over {total} elements.",
        measured=q.min_quality,
        threshold=MIN_ELEMENT_QUALITY,
    )


def _mesh_volume_fidelity(
    geometry: GeneratedGeometry, mesh: MeshResult
) -> AssuranceCheck:
    """The mesh represents the solid it was built from.

    A mesh whose volume disagrees with the CAD volume has lost or invented
    material, and every mass and stress figure derived from it inherits that.
    """
    cad = geometry.volume_m3
    meshed = mesh.total_volume()
    if cad <= 0:
        return _check(
            "mesh_volume_fidelity",
            CheckStage.PRE_SOLVER,
            "Mesh volume fidelity",
            "The meshed volume matches the CAD volume.",
            CheckStatus.FAILED,
            "The CAD volume is not positive, so no comparison is possible.",
        )
    error = abs(meshed - cad) / cad
    status = CheckStatus.PASSED if error <= MESH_VOLUME_TOLERANCE else CheckStatus.FAILED
    return _check(
        "mesh_volume_fidelity",
        CheckStage.PRE_SOLVER,
        "Mesh volume fidelity",
        "The meshed volume matches the CAD volume.",
        status,
        f"Meshed volume {meshed * 1e6:.1f} cm3 against a CAD volume of "
        f"{cad * 1e6:.1f} cm3, a {error * 100:.3f}% difference "
        f"(tolerance {MESH_VOLUME_TOLERANCE * 100:.0f}%).",
        measured=error,
        threshold=MESH_VOLUME_TOLERANCE,
    )


# ============================================================ post-solver checks


def post_solver_checks(
    *,
    result: SimulationResult,
    spec: EngineeringSpecification,
    mesh_convergence: Optional[dict] = None,
) -> AssuranceReport:
    """Whether this result may be called numerically verified.

    ``mesh_convergence`` is the study-level refinement comparison. It is
    ``None`` for an individual candidate, and that produces a ``NOT_RUN``
    check rather than a pass - a candidate nobody re-solved on a finer mesh has
    not been shown to be converged.
    """
    checks: list[AssuranceCheck] = [
        _result_field_integrity(result),
        _decision_metric_present(result, spec),
        _load_balance(result),
        _region_application_coverage(result),
        _energy_balance(result),
        _linear_solver_residual(result),
        _benchmark_verification(spec),
        _mesh_convergence(mesh_convergence),
        _mesh_convergence_region_metrics(mesh_convergence),
    ]
    return AssuranceReport(stage=CheckStage.POST_SOLVER, checks=checks)


def _result_field_integrity(result: SimulationResult) -> AssuranceCheck:
    """The solver's stored field is complete and finite.

    Seeded failure case F08: a solver can exit zero and still leave an
    incomplete or NaN-filled result behind. Exit status is not evidence.
    """
    art = result.field_artifact
    if art is None:
        return _check(
            "result_field_integrity",
            CheckStage.POST_SOLVER,
            "Result field integrity",
            "The stored result field is present, complete and finite.",
            CheckStatus.FAILED,
            "The solver returned no field artifact, so there is no field to "
            "visualise or verify.",
        )
    if art.node_count <= 0 or art.triangle_count <= 0:
        return _check(
            "result_field_integrity",
            CheckStage.POST_SOLVER,
            "Result field integrity",
            "The stored result field is present, complete and finite.",
            CheckStatus.FAILED,
            f"The field artifact reports {art.node_count} nodes and "
            f"{art.triangle_count} triangles. An empty field is not a result.",
            measured=float(art.node_count),
            threshold=1.0,
        )
    if not art.path.exists():
        return _check(
            "result_field_integrity",
            CheckStage.POST_SOLVER,
            "Result field integrity",
            "The stored result field is present, complete and finite.",
            CheckStatus.FAILED,
            f"The field artifact was recorded at {art.path} but that file does not exist.",
        )

    try:
        with np.load(art.path) as data:
            arrays = {k: data[k] for k in data.files}
    except Exception as exc:
        return _check(
            "result_field_integrity",
            CheckStage.POST_SOLVER,
            "Result field integrity",
            "The stored result field is present, complete and finite.",
            CheckStatus.FAILED,
            f"The stored field could not be read back: {exc}",
        )

    nonfinite = {
        k: int(np.count_nonzero(~np.isfinite(v)))
        for k, v in arrays.items()
        if np.issubdtype(v.dtype, np.floating)
    }
    bad = {k: n for k, n in nonfinite.items() if n}
    if bad:
        return _check(
            "result_field_integrity",
            CheckStage.POST_SOLVER,
            "Result field integrity",
            "The stored result field is present, complete and finite.",
            CheckStatus.FAILED,
            "The stored field contains non-finite values: "
            + ", ".join(f"{k}: {n}" for k, n in bad.items())
            + ". The run is rejected regardless of the solver's exit status.",
            measured=float(sum(bad.values())),
            threshold=0.0,
        )

    return _check(
        "result_field_integrity",
        CheckStage.POST_SOLVER,
        "Result field integrity",
        "The stored result field is present, complete and finite.",
        CheckStatus.PASSED,
        f"{art.node_count} nodes and {art.triangle_count} surface triangles read "
        f"back from {art.path.name}; every value finite across "
        f"{len(arrays)} stored arrays.",
        measured=float(art.node_count),
    )


def _decision_metric_present(
    result: SimulationResult, spec: EngineeringSpecification
) -> AssuranceCheck:
    """The quantity this analysis exists to produce was actually produced."""
    metric = DECISION_METRIC.get(spec.analysis_type)
    metrics = result.summary.as_metric_dict()
    if metric is None:
        return _check(
            "decision_metric_present",
            CheckStage.POST_SOLVER,
            "Decision metric present",
            "The analysis produced the quantity the decision depends on.",
            CheckStatus.NOT_APPLICABLE,
            f"No decision metric is declared for the {spec.analysis_type.value} path.",
        )
    value = metrics.get(metric)
    if value is None or not np.isfinite(value):
        return _check(
            "decision_metric_present",
            CheckStage.POST_SOLVER,
            "Decision metric present",
            "The analysis produced the quantity the decision depends on.",
            CheckStatus.FAILED,
            f"The decision metric {metric!r} is {'missing' if value is None else 'not finite'}, "
            "so this run cannot support a decision.",
        )
    return _check(
        "decision_metric_present",
        CheckStage.POST_SOLVER,
        "Decision metric present",
        "The analysis produced the quantity the decision depends on.",
        CheckStatus.PASSED,
        f"{metric} = {value:.6g} (canonical SI), alongside "
        f"{len(metrics) - 1} further computed metrics.",
        measured=float(value),
    )


def _load_balance(result: SimulationResult) -> AssuranceCheck:
    """Each assembled load integrates back to the resultant it was meant to be.

    Checked per load, not as a net sum: the caliper clamping case is correctly
    self-equilibrating, so its net resultant is legitimately near zero and a
    net-sum check would pass a model whose loads had both landed in the wrong
    place.
    """
    verifications = result.load_verifications
    if not verifications:
        if result.analysis_type is not AnalysisType.LINEAR_STATIC_STRUCTURAL:
            return _check(
                "load_balance",
                CheckStage.POST_SOLVER,
                "Load and reaction balance",
                "Each assembled load integrates back to its intended resultant.",
                CheckStatus.NOT_APPLICABLE,
                "A steady-state conduction run applies no mechanical loads; its "
                "equivalent check is the energy balance.",
            )
        return _check(
            "load_balance",
            CheckStage.POST_SOLVER,
            "Load and reaction balance",
            "Each assembled load integrates back to its intended resultant.",
            CheckStatus.NOT_RUN,
            "The solver recorded no load verifications for a structural run, so "
            "no load was independently checked.",
        )

    failed = [v for v in verifications if not v.passed]
    worst = max((v.relative_error or 0.0) for v in verifications)
    if failed:
        return _check(
            "load_balance",
            CheckStage.POST_SOLVER,
            "Load and reaction balance",
            "Each assembled load integrates back to its intended resultant.",
            CheckStatus.FAILED,
            "; ".join(
                f"{v.region!r} ({v.load_type}): requested "
                f"{v.requested_magnitude_n:.1f} N, assembled "
                f"{v.applied_magnitude_n:.1f} N, "
                f"{(v.relative_error or 0) * 100:.2f}% error against {v.reference_basis}"
                for v in failed
            ),
            measured=worst,
            threshold=LOAD_BALANCE_TOLERANCE,
        )
    return _check(
        "load_balance",
        CheckStage.POST_SOLVER,
        "Load and reaction balance",
        "Each assembled load integrates back to its intended resultant.",
        CheckStatus.PASSED,
        f"{len(verifications)} load(s) verified individually against an "
        f"independent reference; worst relative error {worst * 100:.3f}% "
        f"(tolerance {LOAD_BALANCE_TOLERANCE * 100:.0f}%).",
        measured=worst,
        threshold=LOAD_BALANCE_TOLERANCE,
    )


def _region_application_coverage(result: SimulationResult) -> AssuranceCheck:
    """Every boundary condition landed on a non-zero area of the mesh.

    A region that resolves to no facets applies nothing. The solve still
    completes, and the model is quietly unloaded or unconstrained.
    """
    apps = result.region_applications
    if not apps:
        return _check(
            "region_application_coverage",
            CheckStage.POST_SOLVER,
            "Boundary condition coverage",
            "Every boundary condition resolved to a non-zero mesh area.",
            CheckStatus.NOT_RUN,
            "The solver recorded no region applications, so boundary condition "
            "coverage could not be confirmed.",
        )
    empty = [a for a in apps if a.facet_count <= 0 or a.area_m2 <= 0.0]
    if empty:
        return _check(
            "region_application_coverage",
            CheckStage.POST_SOLVER,
            "Boundary condition coverage",
            "Every boundary condition resolved to a non-zero mesh area.",
            CheckStatus.FAILED,
            "These boundary conditions resolved to no mesh facets, so they applied "
            "nothing: "
            + "; ".join(f"{a.region!r} ({a.role})" for a in empty),
            measured=float(len(empty)),
            threshold=0.0,
        )
    smallest = min(a.area_m2 for a in apps)
    return _check(
        "region_application_coverage",
        CheckStage.POST_SOLVER,
        "Boundary condition coverage",
        "Every boundary condition resolved to a non-zero mesh area.",
        CheckStatus.PASSED,
        f"{len(apps)} boundary condition(s) applied; smallest resolved area "
        f"{smallest * 1e6:.1f} mm2.",
        measured=smallest,
        unit="m2",
    )


def _energy_balance(result: SimulationResult) -> AssuranceCheck:
    """What goes in comes out: external work against strain energy, or heat in
    against heat out.

    Seeded failure case F07's numerical counterpart. The solver computes this
    balance itself and records it; this check reads the record and turns it into
    a verdict rather than a warning that can be scrolled past.

    What it proves, precisely: that the discrete system was assembled and solved
    consistently and that every boundary was accounted for. It catches a
    boundary condition that applied nothing, a sign error in a flux, a missing
    Robin term, and a system that was not actually solved. Because both forms
    are identities of the assembled system, a correct model closes them to the
    linear solver's residual.

    What it does not prove: that the discretisation is fine enough. A coarse
    mesh conserves energy exactly while still getting the temperature wrong.
    That is the mesh-convergence check's job, and the two are deliberately
    separate - treating a closed balance as evidence of accuracy is exactly the
    conflation this module exists to prevent.
    """
    balance = result.energy_balance
    if balance is None:
        return _check(
            "energy_balance",
            CheckStage.POST_SOLVER,
            "Energy balance",
            "External work matches internal energy, or heat in matches heat out.",
            CheckStatus.NOT_RUN,
            "The solver recorded no energy balance for this run, so conservation "
            "was not verified.",
        )
    status = (
        CheckStatus.PASSED
        if balance.passed
        else CheckStatus.FAILED
    )
    return _check(
        "energy_balance",
        CheckStage.POST_SOLVER,
        "Energy balance",
        "Every boundary is accounted for and the assembled system conserves "
        "energy. This is a consistency check, not an accuracy one.",
        status,
        f"{balance.basis}: {balance.applied:.6g} {balance.unit} in against "
        f"{balance.recovered:.6g} {balance.unit} out, a "
        f"{(balance.relative_error or 0) * 100:.4f}% imbalance "
        f"(tolerance {balance.tolerance * 100:.0f}%). A closed balance shows the "
        "model is self-consistent; it does not show the mesh is fine enough, "
        "which the convergence check covers separately.",
        measured=balance.relative_error,
        threshold=balance.tolerance,
        unit=balance.unit,
    )


def _linear_solver_residual(result: SimulationResult) -> AssuranceCheck:
    """The linear system was actually solved to the required residual."""
    report = result.linear_solver_report or {}
    residual = report.get("relative_residual")
    if residual is None:
        return _check(
            "linear_solver_residual",
            CheckStage.POST_SOLVER,
            "Linear solve residual",
            "The linear system converged to the required relative residual.",
            CheckStatus.NOT_RUN,
            "No residual was recorded for the linear solve.",
        )
    ok = float(residual) <= ACCEPT_RESIDUAL
    return _check(
        "linear_solver_residual",
        CheckStage.POST_SOLVER,
        "Linear solve residual",
        "The linear system converged to the required relative residual.",
        CheckStatus.PASSED if ok else CheckStatus.FAILED,
        f"{report.get('method', 'linear solve')} reached a relative residual of "
        f"{float(residual):.3e} against an acceptance threshold of "
        f"{ACCEPT_RESIDUAL:.1e}"
        + (f" in {report['iterations']} iterations." if report.get("iterations") else "."),
        measured=float(residual),
        threshold=ACCEPT_RESIDUAL,
    )


def _benchmark_verification(spec: EngineeringSpecification) -> AssuranceCheck:
    """This solver path matched a closed-form solution."""
    passed, detail = benchmark_status(spec.analysis_type)
    status = {
        True: CheckStatus.PASSED,
        False: CheckStatus.FAILED,
        None: CheckStatus.NOT_RUN,
    }[passed]
    return _check(
        "benchmark_verification",
        CheckStage.POST_SOLVER,
        "Analytical benchmark",
        "This solver path reproduces a closed-form reference solution.",
        status,
        detail,
    )


def _mesh_convergence(report: Optional[dict]) -> AssuranceCheck:
    """The decision quantity stopped moving when the mesh was refined.

    Judged on the decision quantity, which is what the research prescribes:
    "trend in the decision quantity as mesh is refined; include
    region-specific metrics." The decision quantity decides; the region
    metrics are reported beside it by ``_mesh_convergence_region_metrics``
    and are advisory.

    That split exists because the two kinds of metric behave differently
    under refinement. A decision quantity that keeps moving means the mesh
    was too coarse to answer the question, which is a verification failure.
    A peak gradient or peak stress at a material interface or a re-entrant
    corner is singular in this formulation and grows without bound however
    fine the mesh gets - refining further will never make it converge, so
    treating it as a failure would permanently block numerical verification
    for a result that is, on the quantity being decided, converged. The
    research provides a distinct ``inconclusive`` state for precisely this
    case, and the report names the offending metric either way.
    """
    if not report or not report.get("performed"):
        return _check(
            "mesh_convergence",
            CheckStage.POST_SOLVER,
            "Mesh convergence (decision quantity)",
            "The quantity the decision rests on is stable under mesh refinement.",
            CheckStatus.NOT_RUN,
            "This candidate was not re-solved on a refined mesh, so its result has "
            "not been shown to be mesh-independent.",
        )
    if report.get("verdict_changed"):
        return _check(
            "mesh_convergence",
            CheckStage.POST_SOLVER,
            "Mesh convergence (decision quantity)",
            "The quantity the decision rests on is stable under mesh refinement.",
            CheckStatus.FAILED,
            "Refining the mesh changed the feasibility verdict itself, which means "
            "the screening mesh was too coarse to decide this candidate: "
            + str(report.get("statement", "")),
        )
    converged = report.get("decision_metric_converged")
    if converged is None:
        return _check(
            "mesh_convergence",
            CheckStage.POST_SOLVER,
            "Mesh convergence (decision quantity)",
            "The quantity the decision rests on is stable under mesh refinement.",
            CheckStatus.NOT_RUN,
            "A refinement study ran, but the decision quantity was not among the "
            "compared metrics, so convergence is inconclusive: "
            + str(report.get("statement", "")),
        )
    change = report.get("decision_metric_change")
    return _check(
        "mesh_convergence",
        CheckStage.POST_SOLVER,
        "Mesh convergence (decision quantity)",
        "The quantity the decision rests on is stable under mesh refinement.",
        CheckStatus.PASSED if converged else CheckStatus.FAILED,
        str(report.get("statement", "")),
        measured=abs(change) if isinstance(change, (int, float)) else None,
        threshold=report.get("tolerance", MESH_CONVERGENCE_TOLERANCE),
    )


def _mesh_convergence_region_metrics(report: Optional[dict]) -> AssuranceCheck:
    """Every other compared metric is also stable under refinement.

    Advisory, not blocking. A metric here that does not converge makes the
    study inconclusive rather than failed, and the detail names it so an
    engineer can judge whether it is a genuine singularity or a modelling
    problem. It is never silently dropped.
    """
    if not report or not report.get("performed"):
        return _check(
            "mesh_convergence_region_metrics",
            CheckStage.POST_SOLVER,
            "Mesh convergence (region metrics)",
            "The region-specific metrics are stable under mesh refinement.",
            CheckStatus.NOT_RUN,
            "No refinement study was run, so there is nothing to compare.",
            severity=CheckSeverity.ADVISORY,
        )
    unconverged = [
        m for m in (report.get("unconverged_region_metrics") or []) if m
    ]
    if not unconverged:
        return _check(
            "mesh_convergence_region_metrics",
            CheckStage.POST_SOLVER,
            "Mesh convergence (region metrics)",
            "The region-specific metrics are stable under mesh refinement.",
            CheckStatus.PASSED,
            "Every compared metric beside the decision quantity also held within "
            f"{float(report.get('tolerance', MESH_CONVERGENCE_TOLERANCE)) * 100:.0f}% "
            "under refinement.",
            severity=CheckSeverity.ADVISORY,
        )
    metrics = report.get("metrics") or {}
    named = ", ".join(
        f"{m} {metrics[m]['percent_change']:+.1f}%"
        if isinstance(metrics.get(m), dict) and "percent_change" in metrics[m]
        else m
        for m in unconverged
    )
    return _check(
        "mesh_convergence_region_metrics",
        CheckStage.POST_SOLVER,
        "Mesh convergence (region metrics)",
        "The region-specific metrics are stable under mesh refinement.",
        CheckStatus.WARNING,
        f"These metrics kept moving under refinement: {named}. They are reported "
        "but did not decide feasibility. A peak gradient or peak stress at a "
        "material interface is singular in this formulation and will not converge "
        "at any mesh density; read it as an indicator of where the part works "
        "hardest, not as a magnitude.",
        severity=CheckSeverity.ADVISORY,
        threshold=report.get("tolerance", MESH_CONVERGENCE_TOLERANCE),
    )
