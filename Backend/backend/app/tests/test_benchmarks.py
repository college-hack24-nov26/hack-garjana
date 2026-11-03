"""Solver verification against closed-form solutions (spec 4.6, 13.2).

These are the gate that permits the platform to display automotive numbers at
all. They exercise the production solver code paths, not a separate
implementation, so a regression in the real assembly or stress recovery fails
here.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.tests.benchmarks import run_structural_benchmark, run_thermal_benchmark


@pytest.mark.benchmark
@pytest.mark.slow
class TestStructuralBenchmark:
    """End-loaded cantilever beam against beam theory."""

    @pytest.fixture(scope="class")
    def outcome(self):
        return run_structural_benchmark()

    def test_passes(self, outcome):
        assert outcome.passed, f"structural benchmark failed: {outcome.quantities}"

    def test_tip_deflection_matches_timoshenko(self, outcome):
        q = outcome.quantities["tip_deflection"]
        assert q["relative_error"] < 0.05, (
            f"tip deflection is {q['relative_error'] * 100:.2f}% from the Timoshenko "
            "reference; the element formulation or the material handling is wrong"
        )

    def test_tip_deflection_matches_euler_bernoulli(self, outcome):
        # The beam is slender enough that shear is a sub-percent correction, so
        # agreement with the simpler reference is also expected.
        q = outcome.quantities["tip_deflection_vs_euler_bernoulli"]
        assert q["relative_error"] < 0.02

    def test_peak_stress_matches_beam_theory(self, outcome):
        q = outcome.quantities["max_bending_stress"]
        assert q["relative_error"] < 0.10, (
            "recovered peak stress disagrees with M c / I by more than 10 percent"
        )

    def test_reference_source_is_recorded(self, outcome):
        """Evidence must name what it was compared against."""
        assert "Euler-Bernoulli" in outcome.reference_source
        for q in outcome.quantities.values():
            assert q["reference_basis"]


@pytest.mark.benchmark
@pytest.mark.slow
class TestThermalBenchmark:
    """1D steady-state conduction against the analytical solution."""

    @pytest.fixture(scope="class")
    def outcome(self):
        return run_thermal_benchmark()

    def test_passes(self, outcome):
        assert outcome.passed, f"thermal benchmark failed: {outcome.quantities}"

    def test_temperature_field_is_essentially_exact(self, outcome):
        # The exact solution is linear and P2 elements represent it exactly, so
        # the only error here is floating point.
        q = outcome.quantities["max_nodal_temperature_error"]
        assert q["computed"] < 1e-6, f"temperature error {q['computed']} K is too large"

    def test_heat_flow_matches_analytical(self, outcome):
        q = outcome.quantities["heat_flow_through_cold_face"]
        assert q["relative_error"] < 0.01, (
            "integrated heat flow disagrees with k A dT / L, so the flux recovery "
            "or the conductivity handling is wrong"
        )

    def test_gradient_matches_analytical(self, outcome):
        assert outcome.quantities["temperature_gradient"]["relative_error"] < 0.01


@pytest.mark.slow
class TestMeshRefinement:
    """A refinement study on the flagship structural case (spec 4.6).

    Refining the mesh must move the answer towards the analytical reference, not
    away from it. A solver that does not converge under refinement cannot be
    trusted whatever a single run reports.
    """

    def test_refinement_reduces_error(self):
        coarse = run_structural_benchmark(element_size=0.008)
        fine = run_structural_benchmark(element_size=0.004)

        coarse_error = coarse.quantities["tip_deflection"]["relative_error"]
        fine_error = fine.quantities["tip_deflection"]["relative_error"]

        assert fine_error <= coarse_error + 0.005, (
            f"refining the mesh increased the deflection error "
            f"({coarse_error:.4f} -> {fine_error:.4f}); the solve is not converging"
        )
        assert fine_error < 0.03


@pytest.mark.slow
def test_amg_and_direct_solvers_agree():
    """The iterative path must reproduce the direct factorisation.

    The product solves large systems with AMG-preconditioned CG for speed. That
    is only acceptable if it gives the same answer as a direct solve, so this
    compares the two on the same system.
    """
    import scipy.sparse as sp
    from skfem import (
        Basis,
        ElementTetP2,
        ElementVector,
        FacetBasis,
        LinearForm,
        MeshTet,
        asm,
        condense,
    )
    from skfem.models.elasticity import lame_parameters, linear_elasticity

    from app.engineering.solvers.linear_algebra import (
        rigid_body_modes,
        solve_direct,
        solve_elasticity,
    )
    from app.tests.benchmarks import _box_mesh

    mesh = _box_mesh(0.2, 0.02, 0.02, 0.0035)
    m = MeshTet(mesh.nodes.T.copy(order="C"), mesh.tets.T.copy(order="C"))
    element = ElementVector(ElementTetP2())
    basis = Basis(m, element, intorder=2)

    lam, mu = lame_parameters(210e9, 0.3)
    K = asm(linear_elasticity(lam, mu), basis)

    tip = m.facets_satisfying(lambda x: np.isclose(x[0], 0.2))
    fb = FacetBasis(m, element, facets=tip, intorder=2)

    @LinearForm
    def load(v, w):
        return -2.5e6 * v[2]

    f = asm(load, fb)
    clamped = m.facets_satisfying(lambda x: np.isclose(x[0], 0.0))
    D = basis.get_dofs(facets=clamped).all()

    K_c, f_c, x_full, free = condense(K, f, D=D)

    iterative, report = solve_elasticity(
        K_c, f_c, near_nullspace=rigid_body_modes(basis)[free]
    )
    direct, _ = solve_direct(K_c, f_c)

    scale = np.abs(direct).max()
    assert scale > 0
    difference = np.abs(iterative - direct).max() / scale
    assert difference < 1e-6, (
        f"the iterative solve differs from the direct factorisation by {difference:.2e} "
        "relative; results would depend on which solver happened to run"
    )
    assert report.relative_residual < 1e-5
