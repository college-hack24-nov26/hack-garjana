"""Solver adapter contract and the normalized result record (spec 4.5, 5.4).

Everything a solver returns is either computed by the solver or measured from
the mesh. There is no field in this module that may be filled in by estimate; a
missing value stays ``None`` and the UI shows it as not available.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import numpy as np
from pydantic import BaseModel, Field

from app.engineering.cad.base import GeneratedGeometry
from app.engineering.materials.catalog import MaterialRecord
from app.engineering.meshing.gmsh_runner import MeshMetadata, MeshResult
from app.schemas.common import AnalysisType, FieldLocation, ResultKind
from app.schemas.engineering import EngineeringSpecification, LoadCase


class SolverError(RuntimeError):
    """Raised when a solve cannot complete. Never swallowed into a fake result."""


class RegionApplication(BaseModel):
    """Evidence that a boundary condition actually landed on the mesh."""

    region: str
    role: str
    facet_count: int
    area_m2: float
    note: Optional[str] = None


class LoadVerification(BaseModel):
    """Cross-check that one assembled load equals its intended resultant.

    Each load is assembled on its own and integrated back to a resultant force,
    so a load that silently landed on the wrong region shows up as a mismatch
    instead of a plausible-looking result.

    Loads are checked individually rather than as a net sum, because a correct
    model may well be self-equilibrating: the caliper clamping case applies bore
    pressure and an equal, opposite pad reaction, so its net resultant is
    legitimately near zero.

    For a force load the reference is the requested magnitude and direction. For
    a pressure load the reference is ``-p`` times the surface normal integral,
    computed independently from the facet geometry rather than from the
    assembled form.
    """

    region: str
    load_type: str
    requested_magnitude_n: Optional[float] = None
    requested_vector_n: Optional[tuple[float, float, float]] = None
    applied_magnitude_n: Optional[float] = None
    applied_vector_n: Optional[tuple[float, float, float]] = None
    relative_error: Optional[float] = None
    tolerance: float = 0.02
    passed: bool = True
    reference_basis: str = ""
    note: Optional[str] = None


def outward_normal_integral(
    nodes: np.ndarray, facets: np.ndarray, adjacent_centroids: np.ndarray
) -> np.ndarray:
    """Compute the outward surface-normal integral over a facet set.

    Returns ``integral of n dA`` as a 3-vector, derived purely from the facet
    vertex coordinates. Orientation is fixed per facet by requiring the normal
    to point away from the centroid of the tetrahedron behind it, so the result
    is independent of the finite-element assembly it is used to check.
    """
    p = nodes[facets]
    v0, v1, v2 = p[:, 0], p[:, 1], p[:, 2]
    cross = np.cross(v1 - v0, v2 - v0)
    area_normals = 0.5 * cross
    face_centroids = p.mean(axis=1)
    outward = face_centroids - adjacent_centroids
    sign = np.sign(np.einsum("ij,ij->i", area_normals, outward))
    sign[sign == 0.0] = 1.0
    return (area_normals * sign[:, None]).sum(axis=0)


class BalanceCheck(BaseModel):
    """A conservation statement the solver computed on its own solution.

    For a structural solve this is external work against twice the strain
    energy; for a conduction solve it is applied thermal power against the
    power leaving through the sink surfaces. Either way it is a property of the
    discrete solution, independent of the quantity being reported, so it
    catches a solve that converged to the wrong thing.
    """

    basis: str
    applied: float
    recovered: float
    unit: str
    relative_error: Optional[float] = None
    tolerance: float = 0.02
    passed: bool = False

    @classmethod
    def from_values(
        cls, basis: str, applied: float, recovered: float, unit: str, tolerance: float = 0.02
    ) -> "BalanceCheck":
        denom = abs(applied)
        rel = abs(recovered - applied) / denom if denom > 0 else None
        return cls(
            basis=basis,
            applied=float(applied),
            recovered=float(recovered),
            unit=unit,
            relative_error=rel,
            tolerance=tolerance,
            passed=rel is not None and rel <= tolerance,
        )


class SummaryMetrics(BaseModel):
    """Canonical-SI summary metrics (spec 4.5). ``None`` means not computed."""

    mass_kg: Optional[float] = None
    volume_m3: Optional[float] = None

    # structural
    max_von_mises_pa: Optional[float] = None
    max_displacement_m: Optional[float] = None
    compliance_j: Optional[float] = None
    min_factor_of_safety: Optional[float] = None
    factor_of_safety_basis: Optional[str] = None

    # thermal
    max_temperature_k: Optional[float] = None
    min_temperature_k: Optional[float] = None
    max_temperature_gradient_k_per_m: Optional[float] = None
    heat_flow_w: Optional[float] = None

    # geometry-derived
    min_wall_thickness_m: Optional[float] = None

    def as_metric_dict(self) -> dict[str, float]:
        """Only the values that exist, for constraint and objective evaluation."""
        return {
            k: float(v)
            for k, v in self.model_dump().items()
            if isinstance(v, (int, float)) and v is not None
        }


class FieldArtifact(BaseModel):
    """Where the result field data was stored and what it actually is."""

    path: Path
    format: str = "npz"
    node_count: int
    triangle_count: int
    has_displacement: bool = False
    has_stress: bool = False
    has_temperature: bool = False
    stress_location: Optional[FieldLocation] = None
    temperature_location: Optional[FieldLocation] = None
    note: Optional[str] = None


class SimulationResult(BaseModel):
    """The single normalized record every solver adapter produces."""

    model_config = {"arbitrary_types_allowed": True}

    result_kind: ResultKind
    analysis_type: AnalysisType
    solver_name: str
    solver_version: str
    solve_time_seconds: float
    degrees_of_freedom: int

    summary: SummaryMetrics
    mesh_metadata: MeshMetadata
    region_applications: list[RegionApplication] = Field(default_factory=list)
    #: One entry per applied load, each verified on its own.
    load_verifications: list[LoadVerification] = Field(default_factory=list)
    field_artifact: Optional[FieldArtifact] = None

    @property
    def all_loads_verified(self) -> bool:
        return all(v.passed for v in self.load_verifications)

    material_snapshot: dict = Field(default_factory=dict)
    #: How the linear system was solved and the residual it reached.
    linear_solver_report: Optional[dict] = None
    #: Conservation check on this solution. ``None`` means it was not computed,
    #: which the assurance gate reports as missing evidence rather than a pass.
    energy_balance: Optional[BalanceCheck] = None
    load_case_id: str
    warnings: list[str] = Field(default_factory=list)
    #: Plain-language statement of what this analysis does and does not prove.
    method_statement: str = ""


class SolverAdapter(ABC):
    """One physics path. The pipeline never calls a solver any other way."""

    solver_id: str
    solver_name: str
    solver_version: str
    analysis_type: AnalysisType
    result_kind: ResultKind
    #: What this solver proves, and what it does not. Shown in the UI.
    method_statement: str = ""

    @abstractmethod
    def validate_case(
        self,
        geometry: GeneratedGeometry,
        case: LoadCase,
        spec: EngineeringSpecification,
    ) -> list[str]:
        """Return blocking problems with this case, before any meshing."""

    @abstractmethod
    def solve(
        self,
        geometry: GeneratedGeometry,
        mesh: MeshResult,
        case: LoadCase,
        spec: EngineeringSpecification,
        materials: dict[str, MaterialRecord],
        output_dir: Path,
    ) -> SimulationResult:
        """Run the analysis and return the normalized result."""


def facet_areas(nodes: np.ndarray, facets: np.ndarray) -> np.ndarray:
    """Triangle areas for a (K, 3) facet index array."""
    p = nodes[facets]
    return 0.5 * np.linalg.norm(
        np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1
    )


def facet_centroids(nodes: np.ndarray, facets: np.ndarray) -> np.ndarray:
    return nodes[facets].mean(axis=1)
