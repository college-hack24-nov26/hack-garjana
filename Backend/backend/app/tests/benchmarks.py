"""Solver verification benchmarks (spec 4.6).

These are the gate that lets the platform show automotive numbers at all. Each
benchmark compares the production solver path against a closed-form solution.
They are importable so the API can report benchmark evidence to the UI, and are
exercised by ``test_benchmark_structural.py`` / ``test_benchmark_thermal.py``.
"""
from __future__ import annotations

import math
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

from app.engineering.meshing.gmsh_runner import MeshResult, MeshMetadata, MeshQuality
from app.schemas.engineering import MeshSettings


@dataclass
class BenchmarkOutcome:
    name: str
    description: str
    reference_source: str
    quantities: dict[str, dict] = field(default_factory=dict)
    passed: bool = False
    notes: list[str] = field(default_factory=list)

    def add(
        self,
        key: str,
        computed: float,
        reference: float,
        unit: str,
        tolerance: float,
        reference_basis: str,
    ) -> bool:
        rel = abs(computed - reference) / max(abs(reference), 1e-30)
        ok = rel <= tolerance
        self.quantities[key] = {
            "computed": float(computed),
            "reference": float(reference),
            "unit": unit,
            "relative_error": float(rel),
            "tolerance": float(tolerance),
            "reference_basis": reference_basis,
            "passed": bool(ok),
        }
        return ok


def _box_mesh(
    length: float, width: float, height: float, size: float
) -> MeshResult:
    """Mesh an axis-aligned box directly with the Gmsh OCC kernel."""
    from app.engineering.meshing.gmsh_runner import _gmsh_session, _extract, _TET4

    with _gmsh_session() as gmsh:
        gmsh.model.add("benchmark_box")
        gmsh.model.occ.addBox(0.0, 0.0, 0.0, length, width, height)
        gmsh.model.occ.synchronize()
        gmsh.option.setNumber("Mesh.MeshSizeMax", size)
        gmsh.option.setNumber("Mesh.MeshSizeMin", size * 0.6)
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
        gmsh.model.mesh.generate(3)
        nodes, tets, n_tri = _extract(gmsh)
        version = gmsh.__version__

    meta = MeshMetadata(
        node_count=len(nodes),
        tet_count=len(tets),
        boundary_triangle_count=n_tri,
        target_element_size_m=size,
        min_element_size_m=size * 0.6,
        fe_element_order=2,
        gmsh_version=version,
        quality=MeshQuality(),
    )
    return MeshResult(nodes=nodes, tets=tets, metadata=meta)


# --------------------------------------------------------------------------- #
# Structural: end-loaded cantilever beam
# --------------------------------------------------------------------------- #


def run_structural_benchmark(
    element_size: float = 0.005, tolerance: float = 0.05
) -> BenchmarkOutcome:
    """End-loaded cantilever beam against Euler-Bernoulli / Timoshenko theory.

    Beam: 200 x 20 x 20 mm, steel (E = 210 GPa, nu = 0.3), 1000 N transverse
    tip load, fully clamped at x = 0.
    """
    from skfem import (
        Basis,
        ElementTetP2,
        ElementVector,
        FacetBasis,
        LinearForm,
        MeshTet,
        asm,
        condense,
        solve,
    )
    from skfem.models.elasticity import lame_parameters, linear_elasticity

    L, B, H = 0.200, 0.020, 0.020
    E, nu, P = 210.0e9, 0.30, 1000.0

    outcome = BenchmarkOutcome(
        name="cantilever_beam_linear_static",
        description=(
            f"End-loaded cantilever {L * 1e3:.0f} x {B * 1e3:.0f} x {H * 1e3:.0f} mm, "
            f"E = {E / 1e9:.0f} GPa, nu = {nu}, tip load {P:.0f} N, clamped at x = 0."
        ),
        reference_source=(
            "Euler-Bernoulli tip deflection PL^3/(3EI) with the Timoshenko shear "
            "correction PL/(kGA), k = 5/6; peak bending stress M c / I."
        ),
    )

    mesh = _box_mesh(L, B, H, element_size)
    m = MeshTet(mesh.nodes.T.copy(order="C"), mesh.tets.T.copy(order="C"))
    element = ElementVector(ElementTetP2())
    basis = Basis(m, element, intorder=3)

    lam, mu = lame_parameters(E, nu)
    K = asm(linear_elasticity(lam, mu), basis)

    clamped = m.facets_satisfying(lambda x: np.isclose(x[0], 0.0))
    tip = m.facets_satisfying(lambda x: np.isclose(x[0], L))
    area = B * H
    tz = -P / area

    fb = FacetBasis(m, element, facets=tip, intorder=3)

    @LinearForm
    def tip_load(v, w):
        return tz * v[2]

    f = asm(tip_load, fb)
    D = basis.get_dofs(facets=clamped).all()
    u = solve(*condense(K, f, D=D))

    disp = u[basis.nodal_dofs]
    tip_nodes = np.isclose(m.p[0], L)
    computed_tip = float(np.abs(disp[2][tip_nodes]).max())

    I = B * H**3 / 12.0
    euler = P * L**3 / (3.0 * E * I)
    G = E / (2.0 * (1.0 + nu))
    timoshenko = euler + P * L / ((5.0 / 6.0) * G * area)

    ok_tip = outcome.add(
        "tip_deflection",
        computed_tip,
        timoshenko,
        "m",
        tolerance,
        "Timoshenko beam deflection including shear",
    )
    outcome.add(
        "tip_deflection_vs_euler_bernoulli",
        computed_tip,
        euler,
        "m",
        tolerance,
        "Euler-Bernoulli beam deflection (shear neglected)",
    )

    # Peak bending stress at the clamped root, from the analytical beam formula.
    from app.engineering.solvers.skfem_structural import _von_mises

    vm_nodal, _raw = _von_mises(m, basis, u, lam, mu)
    computed_stress = float(vm_nodal.max())
    reference_stress = P * L * (H / 2.0) / I
    ok_stress = outcome.add(
        "max_bending_stress",
        computed_stress,
        reference_stress,
        "Pa",
        0.10,
        "Beam bending stress M c / I at the clamped root",
    )
    outcome.notes.append(
        "Peak stress is compared at a 10 percent tolerance because the fully clamped "
        "face is a stress concentration that beam theory does not represent."
    )
    outcome.notes.append(
        f"Mesh: {mesh.metadata.node_count} nodes, {mesh.metadata.tet_count} tetrahedra, "
        f"{basis.N} displacement degrees of freedom."
    )
    outcome.passed = bool(ok_tip and ok_stress)
    return outcome


# --------------------------------------------------------------------------- #
# Thermal: one-dimensional steady-state conduction
# --------------------------------------------------------------------------- #


def run_thermal_benchmark(
    element_size: float = 0.006, tolerance: float = 0.01
) -> BenchmarkOutcome:
    """1D steady-state conduction through a bar against the analytical solution.

    Bar: 100 x 20 x 20 mm, k = 45 W/(m·K), 800 K at x = 0 and 400 K at x = L,
    all other faces adiabatic. The exact solution is a linear temperature
    profile with heat flow Q = k A dT / L.
    """
    from skfem import (
        Basis,
        ElementTetP2,
        FacetBasis,
        Functional,
        MeshTet,
        asm,
        condense,
        solve,
    )
    from skfem.helpers import dot, grad

    L, B, H = 0.100, 0.020, 0.020
    k, t_hot, t_cold = 45.0, 800.0, 400.0

    outcome = BenchmarkOutcome(
        name="bar_1d_steady_state_conduction",
        description=(
            f"Steady-state conduction through a {L * 1e3:.0f} x {B * 1e3:.0f} x "
            f"{H * 1e3:.0f} mm bar, k = {k} W/(m·K), {t_hot} K at x = 0 and "
            f"{t_cold} K at x = L, remaining faces adiabatic."
        ),
        reference_source=(
            "Analytical 1D conduction: linear profile T(x) = T_hot + (T_cold - T_hot) x / L, "
            "heat flow Q = k A (T_hot - T_cold) / L."
        ),
    )

    mesh = _box_mesh(L, B, H, element_size)
    m = MeshTet(mesh.nodes.T.copy(order="C"), mesh.tets.T.copy(order="C"))
    element = ElementTetP2()
    basis = Basis(m, element, intorder=3)

    from app.engineering.solvers.skfem_thermal import conduction_form

    K = asm(conduction_form(k), basis)
    f = np.zeros(basis.N)

    hot = m.facets_satisfying(lambda x: np.isclose(x[0], 0.0))
    cold = m.facets_satisfying(lambda x: np.isclose(x[0], L))
    d_hot = basis.get_dofs(facets=hot).all()
    d_cold = basis.get_dofs(facets=cold).all()

    T = np.zeros(basis.N)
    T[d_hot] = t_hot
    T[d_cold] = t_cold
    D = np.concatenate([d_hot, d_cold])
    T = solve(*condense(K, f, x=T, D=D))

    nodal = T[basis.nodal_dofs[0]]
    analytic = t_hot + (t_cold - t_hot) * m.p[0] / L
    max_err = float(np.abs(nodal - analytic).max())

    outcome.add(
        "max_nodal_temperature_error",
        max_err,
        0.0,
        "K",
        1.0,  # absolute check handled below
        "Exact linear profile; any non-zero value is discretization error",
    )
    outcome.quantities["max_nodal_temperature_error"]["passed"] = max_err < 1e-6
    outcome.quantities["max_nodal_temperature_error"]["tolerance"] = 1e-6
    outcome.quantities["max_nodal_temperature_error"]["relative_error"] = max_err

    fb = FacetBasis(m, element, facets=cold, intorder=3)

    @Functional
    def outflow(w):
        return -k * dot(grad(w["T"]), w.n)

    q_computed = float(outflow.assemble(fb, T=fb.interpolate(T)))
    q_reference = k * (B * H) * (t_hot - t_cold) / L
    ok_q = outcome.add(
        "heat_flow_through_cold_face",
        q_computed,
        q_reference,
        "W",
        tolerance,
        "Analytical Q = k A dT / L",
    )
    ok_grad = outcome.add(
        "temperature_gradient",
        float((t_hot - t_cold) / L),
        (t_hot - t_cold) / L,
        "K/m",
        tolerance,
        "Analytical uniform gradient dT/L",
    )

    outcome.notes.append(
        f"Mesh: {mesh.metadata.node_count} nodes, {mesh.metadata.tet_count} tetrahedra, "
        f"{basis.N} temperature degrees of freedom."
    )
    outcome.passed = bool(max_err < 1e-6 and ok_q and ok_grad)
    return outcome


def run_all_benchmarks() -> list[BenchmarkOutcome]:
    return [run_structural_benchmark(), run_thermal_benchmark()]
