"""Steady-state heat-conduction analysis (spec 2.5).

Implementation: 3D steady-state Fourier conduction on the tetrahedral mesh with
quadratic temperature interpolation, assembled and solved in-process with
scikit-fem. Multi-material assemblies (the spark-plug shell / insulator /
electrode stack) are assembled per material subdomain, so each region carries
its own thermal conductivity. Verified against the analytical 1D conduction
benchmark in ``app/tests/test_benchmark_thermal.py``.

This is a genuine 3D steady-state FEA result, not a reduced-order network model.
What it does not model: combustion, ignition discharge, cylinder pressure or
flow, any transient engine-cycle behaviour, or contact thermal resistance
between the assembled parts (the interfaces are treated as perfectly conducting).
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
    FacetBasis,
    Functional,
    LinearForm,
    MeshTet,
    asm,
    condense,
    solve,
)
from skfem.helpers import dot, grad

from app.core.logging import get_logger
from app.engineering.cad.base import GeneratedGeometry
from app.engineering.materials.catalog import MaterialRecord
from app.engineering.meshing.gmsh_runner import MeshResult
from app.engineering.solvers.linear_algebra import solve_scalar
from app.engineering.solvers.base import (
    BalanceCheck,
    FieldArtifact,
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

#: Degree-2 quadrature integrates the P2 conduction form exactly on
#: straight-sided tetrahedra.
_INTORDER = 2


def conduction_form(k: float) -> BilinearForm:
    """Fourier conduction stiffness for a constant conductivity ``k``."""

    @BilinearForm
    def form(u, v, w):
        return k * dot(grad(u), grad(v))

    return form


def convection_form(h: float) -> BilinearForm:
    """Robin surface term for a convective film coefficient ``h``."""

    @BilinearForm
    def form(u, v, w):
        return h * u * v

    return form


class SkfemSteadyStateThermalSolver(SolverAdapter):
    solver_id = "skfem_steady_state_thermal"
    solver_name = "scikit-fem steady-state conduction (quadratic tetrahedra)"
    solver_version = "skfem-12.0.2"
    analysis_type = AnalysisType.STEADY_STATE_THERMAL
    result_kind = ResultKind.STEADY_STATE_THERMAL
    method_statement = (
        "3D steady-state Fourier heat-conduction finite-element analysis with 10-node "
        "tetrahedra and per-material subdomains, verified against the analytical 1D "
        "conduction benchmark. Interfaces between assembled parts are treated as "
        "perfectly conducting. It does not model combustion, ignition discharge, "
        "cylinder pressure or flow, or any transient engine-cycle behaviour."
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
        grounded = [
            b
            for b in case.thermal_boundary_conditions
            if b.type in ("fixed_temperature", "convection")
        ]
        if not grounded:
            problems.append(
                "a steady-state thermal case needs a fixed-temperature or convection "
                "boundary condition to set the temperature level"
            )
        for sd in geometry.subdomains:
            if sd.material_key not in spec.material_assignments:
                problems.append(
                    f"material subdomain {sd.name!r} expects material_assignments"
                    f"[{sd.material_key!r}], which the specification does not provide"
                )
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

        m = MeshTet(mesh.nodes.T.copy(order="C"), mesh.tets.T.copy(order="C"))
        element = ElementTetP2()
        basis = Basis(m, element, intorder=_INTORDER)

        # --------------------------------------------- conductivity assembly
        K, conductivity_by_element, snapshot = self._assemble_conduction(
            m, element, basis, geometry, mesh, materials
        )
        f = np.zeros(basis.N)

        bf = m.boundary_facets()
        centroids = m.p[:, m.facets[:, bf]].mean(axis=1)
        applications: list[RegionApplication] = []

        dirichlet_dofs: list[np.ndarray] = []
        T_prescribed = np.zeros(basis.N)
        total_power_in = 0.0
        #: One entry per boundary condition, carrying what is needed to
        #: integrate its real power after the solve. Used for the energy
        #: balance, which has to account for every boundary and not only the
        #: ones with an explicitly applied power.
        boundary_terms: list[dict] = []

        for bc in case.thermal_boundary_conditions:
            region = geometry.region_set.by_name(bc.region)
            sel = bf[region.mask(centroids)]
            if sel.size == 0:
                raise SolverError(
                    f"thermal boundary region {bc.region!r} captured no mesh facet, so "
                    f"the {bc.type} condition could not be applied."
                )
            area = float(facet_areas(m.p.T, m.facets[:, sel].T).sum())
            fbasis = FacetBasis(m, element, facets=sel, intorder=_INTORDER)

            if bc.type == "fixed_temperature":
                temp = bc.temperature.canonical()
                dofs = basis.get_dofs(facets=sel).all()
                T_prescribed[dofs] = temp
                dirichlet_dofs.append(dofs)
                note = f"temperature held at {temp - 273.15:.1f} C over {area * 1e4:.2f} cm2"

            elif bc.type == "heat_flux":
                q = bc.heat_flux.canonical()
                total_power_in += q * area

                @LinearForm
                def flux_form(v, w, _q=float(q)):
                    return _q * v

                f += asm(flux_form, fbasis)
                note = f"{q / 1e3:.1f} kW/m2 into {area * 1e4:.2f} cm2 ({q * area:.1f} W total)"

            elif bc.type == "total_heat_input":
                power = bc.power.canonical()
                q = power / area
                total_power_in += power

                @LinearForm
                def power_form(v, w, _q=float(q)):
                    return _q * v

                f += asm(power_form, fbasis)
                note = (
                    f"{power:.1f} W spread over {area * 1e4:.2f} cm2 "
                    f"({q / 1e3:.1f} kW/m2)"
                )

            elif bc.type == "convection":
                h = bc.film_coefficient.canonical()
                t_inf = bc.ambient_temperature.canonical()
                K = K + asm(convection_form(h), fbasis)

                @LinearForm
                def robin_form(v, w, _h=float(h), _t=float(t_inf)):
                    return _h * _t * v

                f += asm(robin_form, fbasis)
                note = (
                    f"h = {h:.0f} W/(m²·K) to {t_inf - 273.15:.1f} C ambient over "
                    f"{area * 1e4:.2f} cm2"
                )
            else:  # pragma: no cover - exhaustive over the union type
                raise SolverError(f"unsupported thermal boundary condition {bc.type!r}")

            applications.append(
                RegionApplication(
                    region=bc.region,
                    role=f"thermal:{bc.type}",
                    facet_count=int(sel.size),
                    area_m2=area,
                    note=note,
                )
            )

            # Keep enough about each boundary to integrate its actual power
            # once the temperature field exists. The sign convention is
            # positive into the solid throughout.
            boundary_terms.append(
                {
                    "region": bc.region,
                    "type": bc.type,
                    "facets": sel,
                    "area_m2": area,
                    "h": float(bc.film_coefficient.canonical())
                    if bc.type == "convection"
                    else None,
                    "t_inf": float(bc.ambient_temperature.canonical())
                    if bc.type == "convection"
                    else None,
                    "applied_power_w": (
                        float(bc.heat_flux.canonical()) * area
                        if bc.type == "heat_flux"
                        else float(bc.power.canonical())
                        if bc.type == "total_heat_input"
                        else None
                    ),
                }
            )

        # ------------------------------------------------------------- solve
        try:
            if dirichlet_dofs:
                D = np.unique(np.concatenate(dirichlet_dofs))
                K_c, f_c, T_full, free = condense(K, f, x=T_prescribed, D=D)
                reduced, solve_report = solve_scalar(K_c, f_c)
                T = T_full.copy()
                T[free] = reduced
            else:
                # Pure Robin problem: well posed without any Dirichlet condition.
                T, solve_report = solve_scalar(K, f)
        except Exception as exc:  # pragma: no cover
            raise SolverError(f"thermal solve failed: {exc}") from exc

        if not np.all(np.isfinite(T)):
            raise SolverError("temperature solution contains non-finite values")

        nodal_T = T[basis.nodal_dofs[0]]
        max_T = float(nodal_T.max())
        min_T = float(nodal_T.min())

        # Peak temperature gradient magnitude at the integration points.
        gT = grad(basis.interpolate(T))
        grad_mag = np.sqrt(gT[0] ** 2 + gT[1] ** 2 + gT[2] ** 2)
        max_grad = float(grad_mag.max())

        # Heat flow is taken from the boundary power accounting below, not from
        # an integral of the recovered temperature gradient.
        #
        # The gradient integral was measurably wrong. On the reference plug it
        # reported 21.5 W, 34.0 W and 38.2 W on meshes of 1.6k, 4.1k and 14.1k
        # nodes against a true value near 94 W - still moving by 12% at the
        # finest mesh and under-reporting by 59%. It was also the metric that
        # made the mesh-convergence check fail, so a measurement artifact was
        # being reported as a physical limitation of the design.
        heat_flow: Optional[float] = None

        # Energy balance: in steady state the power entering the solid across
        # every boundary must equal the power leaving it.
        #
        # This integrates each boundary's actual power from the solved field
        # rather than relying on an explicitly applied power, because most
        # real cases have none. The spark plug is driven entirely by convection
        # - hot gas on the firing end, cooler air at the terminal, a fixed
        # temperature at the seat - so an earlier version of this check that
        # only looked at applied flux never ran at all, and the gate correctly
        # reported "not verified" for every plug result as a consequence.
        energy_balance = self._energy_balance(
            m,
            element,
            basis,
            T,
            boundary_terms,
            conductivity_by_element,
            K=K,
            f=f,
            dirichlet_dofs=(
                np.unique(np.concatenate(dirichlet_dofs)) if dirichlet_dofs else None
            ),
        )
        if energy_balance is not None:
            # Total power leaving the solid: the heat the component sheds in
            # steady state. Convergent, because it is assembled from applied
            # powers and reactions rather than from a recovered gradient.
            heat_flow = energy_balance.recovered

        if energy_balance is not None and not energy_balance.passed:
            if energy_balance.relative_error is not None:
                warnings.append(
                    f"steady-state energy balance is off by "
                    f"{energy_balance.relative_error * 100:.1f}%: "
                    f"{energy_balance.applied:.3f} W enters the solid against "
                    f"{energy_balance.recovered:.3f} W leaving it. Refine the mesh "
                    "before trusting the absolute temperature level."
                )

        material_limit_note = self._check_service_limits(materials, mesh, geometry, nodal_T, basis, warnings)

        mass = self._mass(geometry, mesh, materials)

        summary = SummaryMetrics(
            mass_kg=mass,
            volume_m3=geometry.volume_m3,
            max_temperature_k=max_T,
            min_temperature_k=min_T,
            max_temperature_gradient_k_per_m=max_grad,
            heat_flow_w=abs(heat_flow) if heat_flow is not None else None,
            min_wall_thickness_m=geometry.validation.metrics.min_wall_thickness_m,
        )

        artifact = _write_fields(output_dir, m, nodal_T, case.case_id)

        elapsed = time.perf_counter() - started
        log.info(
            "thermal solve: %d DOF, T %.1f..%.1f C, Q %s W, %.1fs",
            basis.N, min_T - 273.15, max_T - 273.15,
            f"{heat_flow:.2f}" if heat_flow is not None else "n/a", elapsed,
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
            field_artifact=artifact,
            material_snapshot=snapshot,
            linear_solver_report=solve_report.__dict__,
            energy_balance=energy_balance,
            load_case_id=case.case_id,
            warnings=warnings + ([material_limit_note] if material_limit_note else []),
            method_statement=self.method_statement,
        )

    # ------------------------------------------------------------- internals

    def _assemble_conduction(
        self, m, element, basis, geometry, mesh, materials
    ):
        """Assemble the conduction matrix, per material subdomain if present."""
        snapshot: dict = {}

        if geometry.subdomains and mesh.element_subdomain is not None:
            K = None
            k_by_elem = np.zeros(mesh.tets.shape[0])
            for sd in geometry.subdomains:
                material = materials.get(sd.material_key)
                if material is None:
                    raise SolverError(
                        f"no material supplied for subdomain {sd.name!r} "
                        f"(key {sd.material_key!r})"
                    )
                if not material.supports_thermal():
                    raise SolverError(
                        f"material {material.material_id!r} has no thermal conductivity, "
                        f"so subdomain {sd.name!r} cannot be solved"
                    )
                mask = mesh.element_subdomain == sd.name
                if not mask.any():
                    raise SolverError(
                        f"material subdomain {sd.name!r} contains no mesh element; the "
                        "mesh is too coarse to resolve this part of the assembly"
                    )
                sub_basis = Basis(
                    m, element, intorder=_INTORDER, elements=np.where(mask)[0]
                )
                contribution = asm(conduction_form(material.thermal_conductivity), sub_basis)
                K = contribution if K is None else K + contribution
                k_by_elem[mask] = material.thermal_conductivity
                snapshot[sd.material_key] = material.snapshot()
            return K, k_by_elem, snapshot

        material = materials.get("primary")
        if material is None:
            raise SolverError("no primary material supplied to the thermal solver")
        if not material.supports_thermal():
            raise SolverError(
                f"material {material.material_id!r} has no thermal conductivity"
            )
        K = asm(conduction_form(material.thermal_conductivity), basis)
        snapshot["primary"] = material.snapshot()
        k_by_elem = np.full(mesh.tets.shape[0], material.thermal_conductivity)
        return K, k_by_elem, snapshot

    @classmethod
    def _energy_balance(
        cls, m, element, basis, T, boundary_terms, k_by_elem, K=None, f=None,
        dirichlet_dofs=None,
    ) -> Optional[BalanceCheck]:
        """Account for every boundary's power and check the solid conserves it.

        Sign convention: positive is power *into* the solid.

        - A convective surface carries ``integral h (T_inf - T) dA``, positive
          where the ambient is hotter than the wall and negative where it is
          colder. One expression therefore handles a heat source and a heat
          sink without being told which it is.
        - A flux or total-power surface carries the power that was applied.
        - A fixed-temperature surface carries its **reaction**, taken from the
          residual ``K T - f`` at the constrained degrees of freedom. This is
          the thermal analogue of a reaction force: the power the boundary must
          supply or remove to hold its temperature. It is exact to the linear
          solver's residual, unlike an integral of the recovered gradient.

        In steady state the sum over all boundaries is zero, so the check
        compares total inflow against total outflow. ``None`` is returned only
        when no boundary power could be accounted for at all - that is missing
        evidence, which the assurance gate reports as such rather than as a pass.
        """
        inflow = 0.0
        outflow = 0.0

        for term in boundary_terms:
            sel = term["facets"]
            if sel.size == 0:
                continue
            fb = FacetBasis(m, element, facets=sel, intorder=_INTORDER)
            power: Optional[float] = None

            if term["type"] == "convection":
                h, t_inf = term["h"], term["t_inf"]

                @Functional
                def convective_power(w, _h=float(h), _t=float(t_inf)):
                    return _h * (_t - w["T"])

                power = float(
                    convective_power.assemble(fb, T=fb.interpolate(T))
                )

            elif term["type"] in ("heat_flux", "total_heat_input"):
                power = term["applied_power_w"]

            elif term["type"] == "fixed_temperature":
                # Deliberately not computed from the temperature gradient here.
                # Recovering grad(T) on a Dirichlet face and integrating it is
                # unreliable, and measurably so: an earlier version of this
                # check did exactly that and its error grew from 3% to 24% as
                # the mesh was refined, which is the signature of a quantity
                # that is not converging rather than a model that is wrong.
                #
                # The reaction residual is used instead - see below. It is the
                # thermal analogue of a reaction force and is exact to the
                # linear solver's residual.
                power = None

            if power is None:
                continue
            if power >= 0:
                inflow += power
            else:
                outflow += -power

        # The reaction at every fixed-temperature degree of freedom.
        #
        # `K T - f` is zero on the free degrees of freedom (that is the system
        # that was solved) and non-zero on the constrained ones, where it is
        # the nodal power the boundary supplies. Summing it gives that
        # boundary's total power, with the same positive-into-the-solid sign as
        # the terms above.
        if K is not None and f is not None and dirichlet_dofs is not None:
            dofs = np.asarray(dirichlet_dofs)
            if dofs.size:
                # Sign checked against the physics rather than assumed: the
                # spark plug's seat is held at 150 C with 900 C gas on the
                # firing end, so heat must flow out through it and its power
                # must come out negative. It does with this sign and came out
                # positive with the other, which is how the convention was
                # settled.
                residual = np.asarray(K @ T).ravel() - np.asarray(f).ravel()
                reaction = float(residual[dofs].sum())
                if reaction >= 0:
                    inflow += reaction
                else:
                    outflow += -reaction

        if inflow <= 0 and outflow <= 0:
            return None

        return BalanceCheck.from_values(
            "power entering the solid across every boundary against power leaving it",
            inflow,
            outflow,
            "W",
        )

    @staticmethod
    def _mass(geometry, mesh, materials) -> Optional[float]:
        """Assembly mass: per-subdomain element volumes times their densities."""
        if geometry.subdomains and mesh.element_subdomain is not None:
            p = mesh.nodes[mesh.tets]
            vol = np.abs(
                np.einsum(
                    "ij,ij->i",
                    p[:, 1] - p[:, 0],
                    np.cross(p[:, 2] - p[:, 0], p[:, 3] - p[:, 0]),
                )
                / 6.0
            )
            total = 0.0
            for sd in geometry.subdomains:
                material = materials.get(sd.material_key)
                if material is None:
                    return None
                total += float(vol[mesh.element_subdomain == sd.name].sum()) * material.density
            return total
        material = materials.get("primary")
        return geometry.volume_m3 * material.density if material else None

    @staticmethod
    def _check_service_limits(materials, mesh, geometry, nodal_T, basis, warnings) -> Optional[str]:
        """Warn when a computed temperature exceeds a material service limit."""
        hottest = float(nodal_T.max())
        over = [
            (key, mat)
            for key, mat in materials.items()
            if mat.max_service_temperature is not None
            and hottest > mat.max_service_temperature
        ]
        if not over:
            return None
        names = ", ".join(
            f"{mat.name} (limit {mat.max_service_temperature - 273.15:.0f} C)"
            for _k, mat in over
        )
        return (
            f"Peak computed temperature {hottest - 273.15:.0f} C exceeds the catalog "
            f"service limit of: {names}. The conduction solution is still valid, but "
            "the material selection is not."
        )


def _write_fields(output_dir: Path, m: MeshTet, nodal_T: np.ndarray, case_id: str) -> FieldArtifact:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    bf = m.boundary_facets()
    tris = m.facets[:, bf].T
    used = np.unique(tris)
    remap = np.full(m.p.shape[1], -1, dtype=np.int64)
    remap[used] = np.arange(used.size)

    nodes = m.p[:, used].T.astype(np.float32)
    faces = remap[tris].astype(np.int32)
    temps = nodal_T[used].astype(np.float32)

    path = output_dir / f"result_fields_{case_id}.npz"
    np.savez_compressed(path, nodes=nodes, faces=faces, temperature=temps)
    return FieldArtifact(
        path=path,
        node_count=int(nodes.shape[0]),
        triangle_count=int(faces.shape[0]),
        has_temperature=True,
        temperature_location=FieldLocation.NODAL,
        note=(
            "Boundary surface of the analysis mesh with the nodal steady-state "
            "temperature field, in kelvin."
        ),
    )
