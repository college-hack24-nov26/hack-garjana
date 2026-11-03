"""Linear static structural analysis (spec 2.3, 2.4).

Implementation: 3D linear elasticity on the tetrahedral mesh using quadratic
(10-node) displacement interpolation, assembled and solved in-process with
scikit-fem. The solver is verified against the analytical cantilever benchmark
in ``app/tests/test_benchmark_structural.py``.

What this analysis proves: the small-displacement, linear-elastic response of
the meshed solid to the configured load case. What it does not prove: fatigue
life, impact or kerb strength, contact behaviour, bolt pretension, plasticity,
residual casting stress, or fitness for road use.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

import numpy as np
import scipy.sparse.linalg as spla
from skfem import (
    Basis,
    BilinearForm,
    ElementTetP1,
    ElementTetP2,
    ElementVector,
    FacetBasis,
    LinearForm,
    MeshTet,
    asm,
    condense,
    solve,
)
from skfem.helpers import ddot, sym_grad
from skfem.models.elasticity import lame_parameters, linear_elasticity, linear_stress

from app.core.logging import get_logger
from app.engineering.cad.base import GeneratedGeometry
from app.engineering.materials.catalog import MaterialRecord
from app.engineering.meshing.gmsh_runner import MeshResult
from app.engineering.solvers.linear_algebra import rigid_body_modes, solve_elasticity
from app.engineering.solvers.base import (
    BalanceCheck,
    FieldArtifact,
    outward_normal_integral,
    LoadVerification,
    RegionApplication,
    SimulationResult,
    SolverAdapter,
    SolverError,
    SummaryMetrics,
    facet_areas,
)
from app.schemas.common import AnalysisType, FieldLocation, ResultKind
from app.schemas.engineering import EngineeringSpecification, LoadCase

log = get_logger(__name__)

#: Degree-2 quadrature integrates the P2 stiffness form exactly on
#: straight-sided tetrahedra, so nothing is lost versus a higher rule.
_INTORDER = 2


def _boundary_facet_centroids(m: MeshTet) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(boundary facet indices, centroids (3, K))``."""
    bf = m.boundary_facets()
    centroids = m.p[:, m.facets[:, bf]].mean(axis=1)
    return bf, centroids


def _select(m: MeshTet, region, bf: np.ndarray, centroids: np.ndarray) -> np.ndarray:
    return bf[region.mask(centroids)]


class SkfemLinearStaticSolver(SolverAdapter):
    solver_id = "skfem_linear_static"
    solver_name = "scikit-fem linear elasticity (quadratic tetrahedra)"
    solver_version = "skfem-12.0.2"
    analysis_type = AnalysisType.LINEAR_STATIC_STRUCTURAL
    result_kind = ResultKind.LINEAR_STATIC
    method_statement = (
        "3D linear-elastic small-displacement finite-element analysis with 10-node "
        "tetrahedra, verified against the analytical cantilever-beam benchmark. "
        "It does not model fatigue, impact, contact, bolt pretension, plasticity or "
        "casting defects, and it is not a certification of road-worthiness."
    )

    # ----------------------------------------------------------- validation

    def validate_case(
        self,
        geometry: GeneratedGeometry,
        case: LoadCase,
        spec: EngineeringSpecification,
    ) -> list[str]:
        problems: list[str] = []
        available = set(geometry.region_set.names())
        for name in case.regions_used():
            if name not in available:
                problems.append(
                    f"load case {case.case_id!r} refers to region {name!r}, which this "
                    f"geometry does not expose (available: {sorted(available)})"
                )
        if not case.supports:
            problems.append("a linear static analysis needs at least one support region")
        if not case.loads:
            problems.append("a linear static analysis needs at least one load")
        return problems

    # ---------------------------------------------------------------- solve

    def solve(
        self,
        geometry: GeneratedGeometry,
        mesh: MeshResult,
        case: LoadCase,
        spec: EngineeringSpecification,
        materials: dict[str, MaterialRecord],
        output_dir: Path,
    ) -> SimulationResult:
        started = time.perf_counter()
        warnings: list[str] = list(mesh.metadata.warnings)

        material = materials.get("primary")
        if material is None:
            raise SolverError("no primary material supplied to the structural solver")
        if not material.supports_structural():
            raise SolverError(
                f"material {material.material_id!r} has no elastic modulus / Poisson "
                "ratio, so a structural analysis cannot be run with it"
            )

        m = MeshTet(mesh.nodes.T.copy(order="C"), mesh.tets.T.copy(order="C"))
        element = ElementVector(ElementTetP2())
        basis = Basis(m, element, intorder=_INTORDER)

        lam, mu = lame_parameters(material.elastic_modulus, material.poisson_ratio)
        K = asm(linear_elasticity(lam, mu), basis)

        bf, centroids = _boundary_facet_centroids(m)
        applications: list[RegionApplication] = []

        # ---------------------------------------------------------- supports
        fixed_facets: list[np.ndarray] = []
        for support in case.supports:
            region = geometry.region_set.by_name(support.region)
            sel = _select(m, region, bf, centroids)
            if sel.size == 0:
                raise SolverError(
                    f"support region {support.region!r} captured no mesh facet. The "
                    "mesh is too coarse for this feature or the selector no longer "
                    "matches the geometry."
                )
            fixed_facets.append(sel)
            applications.append(
                RegionApplication(
                    region=support.region,
                    role=f"support:{support.type}",
                    facet_count=int(sel.size),
                    area_m2=float(facet_areas(m.p.T, m.facets[:, sel].T).sum()),
                    note=region.description,
                )
            )

        all_fixed = np.unique(np.concatenate(fixed_facets))
        fixed_dofs = basis.get_dofs(facets=all_fixed).all()
        if fixed_dofs.size == 0:
            raise SolverError("support regions produced no constrained degrees of freedom")

        # ------------------------------------------------------------- loads
        # Each load is assembled on its own so it can be integrated back to a
        # resultant and checked against its intended value, then added into the
        # global right-hand side.
        f = np.zeros(basis.N)
        verifications: list[LoadVerification] = []

        for load in case.loads:
            region = geometry.region_set.by_name(load.region)
            sel = _select(m, region, bf, centroids)
            if sel.size == 0:
                raise SolverError(
                    f"load region {load.region!r} captured no mesh facet, so the load "
                    "could not be applied."
                )
            area = float(facet_areas(m.p.T, m.facets[:, sel].T).sum())
            if area <= 0.0:
                raise SolverError(f"load region {load.region!r} has zero area")

            fbasis = FacetBasis(m, element, facets=sel, intorder=_INTORDER)

            if load.type == "force":
                magnitude = load.magnitude.canonical()
                direction = np.asarray(load.direction, dtype=float)
                direction = direction / np.linalg.norm(direction)
                traction = direction * (magnitude / area)
                tx, ty, tz = (float(c) for c in traction)

                @LinearForm
                def load_form(v, w, _t=(tx, ty, tz)):
                    return _t[0] * v[0] + _t[1] * v[1] + _t[2] * v[2]

                expected = direction * magnitude
                reference_basis = (
                    "requested resultant force, spread as uniform traction over the "
                    "region area"
                )
                note = (
                    f"{magnitude:.1f} N resultant spread as uniform traction over "
                    f"{area * 1e4:.1f} cm2"
                )
            else:  # pressure, acting along the inward surface normal
                pressure = load.magnitude.canonical()
                p_val = float(pressure)

                @LinearForm
                def load_form(v, w, _p=p_val):
                    # Surface normals point outwards, so a positive pressure
                    # pushes inwards.
                    return -_p * (w.n[0] * v[0] + w.n[1] * v[1] + w.n[2] * v[2])

                # Reference resultant computed from the facet geometry alone,
                # independently of the assembled form: -p * integral(n dA).
                tris = m.facets[:, sel].T
                adjacent = m.p[:, m.t[:, m.f2t[0, sel]]].mean(axis=1).T
                normal_integral = outward_normal_integral(m.p.T, tris, adjacent)
                expected = -p_val * normal_integral
                reference_basis = (
                    "minus pressure times the outward surface-normal integral, "
                    "computed from the facet geometry"
                )
                note = (
                    f"{pressure / 1e6:.3f} MPa normal pressure over "
                    f"{area * 1e4:.1f} cm2"
                )

            f_load = asm(load_form, fbasis)
            f += f_load

            # Integrate this load alone back to a resultant. A P2 basis carries
            # load on edge degrees of freedom as well as vertices, so every DOF
            # of each axis is summed.
            applied = np.array(
                [float(f_load[_axis_dofs(basis, axis)].sum()) for axis in range(3)]
            )
            expected_magnitude = float(np.linalg.norm(expected))
            error = float(np.linalg.norm(applied - expected))
            relative = (
                error / expected_magnitude if expected_magnitude > 1e-9 else None
            )
            passed = relative is None or relative < 0.02

            verifications.append(
                LoadVerification(
                    region=load.region,
                    load_type=load.type,
                    requested_magnitude_n=expected_magnitude,
                    requested_vector_n=(
                        float(expected[0]), float(expected[1]), float(expected[2])
                    ),
                    applied_magnitude_n=float(np.linalg.norm(applied)),
                    applied_vector_n=(
                        float(applied[0]), float(applied[1]), float(applied[2])
                    ),
                    relative_error=relative,
                    passed=passed,
                    reference_basis=reference_basis,
                    note=note,
                )
            )

            if not passed:
                raise SolverError(
                    f"load check failed for region {load.region!r}: the intended "
                    f"resultant is {expected_magnitude:.1f} N "
                    f"({expected[0]:.1f}, {expected[1]:.1f}, {expected[2]:.1f}) but the "
                    f"assembled load integrates to {np.linalg.norm(applied):.1f} N "
                    f"({applied[0]:.1f}, {applied[1]:.1f}, {applied[2]:.1f}), "
                    f"a {relative * 100:.1f}% error. Reference: {reference_basis}."
                )

            applications.append(
                RegionApplication(
                    region=load.region,
                    role=f"load:{load.type}",
                    facet_count=int(sel.size),
                    area_m2=area,
                    note=note,
                )
            )

        # ------------------------------------------------------------- solve
        try:
            K_c, f_c, u_full, free = condense(K, f, D=fixed_dofs)
            nullspace = rigid_body_modes(basis)[free]
            reduced, solve_report = solve_elasticity(K_c, f_c, near_nullspace=nullspace)
            u = u_full.copy()
            u[free] = reduced
        except Exception as exc:  # pragma: no cover - linear algebra guard
            raise SolverError(f"linear solve failed: {exc}") from exc

        if not np.all(np.isfinite(u)):
            raise SolverError("solution contains non-finite values; the model is ill-posed")

        # ------------------------------------------------------- derived fields
        disp = u[basis.nodal_dofs]                      # (3, n_vertices)
        disp_magnitude = np.linalg.norm(disp, axis=0)
        max_disp = float(disp_magnitude.max())

        vm_nodal, vm_raw_max = _von_mises(m, basis, u, lam, mu)
        max_vm = float(vm_nodal.max())

        compliance = 0.5 * float(f @ u)

        # Conservation check on the solution itself: for linear elasticity the
        # external work f.u must equal u'Ku. Both sides are assembled from the
        # same solution but through different operators, so a disagreement
        # points at an incomplete solve rather than at a modelling choice.
        external_work = float(f @ u)
        internal_energy = float(u @ (K @ u))
        energy_balance = BalanceCheck.from_values(
            "external work f.u against internal strain energy u'Ku",
            external_work,
            internal_energy,
            "J",
        )
        if not energy_balance.passed and energy_balance.relative_error is not None:
            warnings.append(
                f"energy balance is off by {energy_balance.relative_error * 100:.2f}%: "
                f"{external_work:.6g} J of external work against "
                f"{internal_energy:.6g} J of strain energy. The linear system was "
                "not solved tightly enough to trust the magnitudes."
            )

        if vm_raw_max > 1.3 * max_vm:
            warnings.append(
                f"unsmoothed stress at integration points peaks at "
                f"{vm_raw_max / 1e6:.1f} MPa versus {max_vm / 1e6:.1f} MPa after nodal "
                "projection. The difference indicates a local stress concentration or "
                "a geometric singularity; treat the peak value as mesh-dependent."
            )

        fos: Optional[float] = None
        fos_basis: Optional[str] = None
        if material.supports_yield_margin() and max_vm > 0:
            fos = float(material.yield_strength / max_vm)
            fos_basis = (
                f"yield strength {material.yield_strength / 1e6:.0f} MPa divided by the "
                "peak nodal-projected von Mises stress"
            )
        elif not material.supports_yield_margin():
            warnings.append(
                f"material {material.material_id!r} has no defined yield strength, so "
                "no factor of safety is reported for this run"
            )

        mass = geometry.volume_m3 * material.density

        summary = SummaryMetrics(
            mass_kg=mass,
            volume_m3=geometry.volume_m3,
            max_von_mises_pa=max_vm,
            max_displacement_m=max_disp,
            compliance_j=compliance,
            min_factor_of_safety=fos,
            factor_of_safety_basis=fos_basis,
            min_wall_thickness_m=geometry.validation.metrics.min_wall_thickness_m,
        )

        artifact = _write_fields(
            output_dir, m, disp, vm_nodal, case.case_id
        )

        elapsed = time.perf_counter() - started
        log.info(
            "structural solve: %d DOF, max vM %.1f MPa, max u %.3f mm, %.1fs",
            basis.N, max_vm / 1e6, max_disp * 1e3, elapsed,
        )

        return SimulationResult(
            result_kind=self.result_kind,
            analysis_type=self.analysis_type,
            solver_name=self.solver_name,
            solver_version=self.solver_version,
            solve_time_seconds=elapsed,
            degrees_of_freedom=int(basis.N),
            summary=summary,
            mesh_metadata=mesh.metadata,
            region_applications=applications,
            load_verifications=verifications,
            field_artifact=artifact,
            material_snapshot={"primary": material.snapshot()},
            linear_solver_report=solve_report.__dict__,
            energy_balance=energy_balance,
            load_case_id=case.case_id,
            warnings=warnings,
            method_statement=self.method_statement,
        )


def _axis_dofs(basis: Basis, axis: int) -> np.ndarray:
    """All degrees of freedom (vertex and edge) belonging to one axis."""
    nodal = basis.nodal_dofs[axis]
    pieces = [nodal]
    edge = getattr(basis, "edge_dofs", None)
    if edge is not None and len(edge):
        pieces.append(edge[axis])
    facet = getattr(basis, "facet_dofs", None)
    if facet is not None and len(facet):
        pieces.append(facet[axis])
    interior = getattr(basis, "interior_dofs", None)
    if interior is not None and len(interior):
        pieces.append(interior[axis])
    return np.concatenate([np.asarray(p).ravel() for p in pieces])


def _von_mises(m, basis, u, lam, mu) -> tuple[np.ndarray, float]:
    """L2-project the von Mises field onto P1 nodes; also return the raw peak."""
    C = linear_stress(lam, mu)
    # The projection basis must share the displacement basis' quadrature rule,
    # because the displacement field is interpolated at those exact points.
    sbasis = Basis(m, ElementTetP1(), quadrature=(basis.X, basis.W))

    @BilinearForm
    def mass_form(p, q, w):
        return p * q

    @LinearForm
    def vm_form(q, w):
        s = C(sym_grad(w["disp"]))
        tr = (s[0, 0] + s[1, 1] + s[2, 2]) / 3.0
        dev = s.copy()
        for i in range(3):
            dev[i, i] = dev[i, i] - tr
        return np.sqrt(np.maximum(1.5 * ddot(dev, dev), 0.0)) * q

    M = asm(mass_form, sbasis)
    rhs = asm(vm_form, sbasis, disp=basis.interpolate(u))
    vm_nodal = spla.spsolve(M.tocsc(), rhs)

    # Raw, unsmoothed peak at the integration points for honesty about peaks.
    s = C(sym_grad(basis.interpolate(u)))
    tr = (s[0, 0] + s[1, 1] + s[2, 2]) / 3.0
    dev = s.copy()
    for i in range(3):
        dev[i, i] = dev[i, i] - tr
    raw = np.sqrt(np.maximum(1.5 * ddot(dev, dev), 0.0))
    return np.maximum(vm_nodal, 0.0), float(raw.max())


def _write_fields(
    output_dir: Path, m: MeshTet, disp: np.ndarray, vm_nodal: np.ndarray, case_id: str
) -> FieldArtifact:
    """Store the boundary surface plus its fields for the 3D viewer.

    Only the boundary surface is exported: the interior tetrahedra cannot be
    seen and would multiply the payload size for no visual gain.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    bf = m.boundary_facets()
    tris = m.facets[:, bf].T                         # (K, 3) vertex indices
    used = np.unique(tris)
    remap = np.full(m.p.shape[1], -1, dtype=np.int64)
    remap[used] = np.arange(used.size)

    nodes = m.p[:, used].T.astype(np.float32)
    faces = remap[tris].astype(np.int32)
    node_disp = disp[:, used].T.astype(np.float32)
    node_vm = vm_nodal[used].astype(np.float32)

    path = output_dir / f"result_fields_{case_id}.npz"
    np.savez_compressed(
        path,
        nodes=nodes,
        faces=faces,
        displacement=node_disp,
        von_mises=node_vm,
    )
    return FieldArtifact(
        path=path,
        node_count=int(nodes.shape[0]),
        triangle_count=int(faces.shape[0]),
        has_displacement=True,
        has_stress=True,
        stress_location=FieldLocation.NODAL_L2_PROJECTED,
        note=(
            "Boundary surface of the analysis mesh with nodal displacement vectors "
            "and L2-projected nodal von Mises stress, in metres and pascals."
        ),
    )
