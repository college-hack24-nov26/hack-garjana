"""Gmsh meshing (spec 5.1).

Gmsh is a process-global singleton, so every use is serialized behind a module
lock: the job manager runs candidates on worker threads and concurrent
``gmsh.initialize`` calls would corrupt each other's model.

Note on element order: Gmsh produces *linear* 4-node tetrahedra here. Quadratic
interpolation is applied by the finite-element layer (``ElementTetP2``), which
adds its own edge degrees of freedom on the same tet connectivity. Linear tets
are far too stiff in bending to report honest structural results, so
``MeshSettings.element_order`` defaults to 2 and refers to that FE order.
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import numpy as np
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.engineering.cad.base import Subdomain
from app.schemas.engineering import MeshSettings

log = get_logger(__name__)

_GMSH_LOCK = threading.Lock()

#: Gmsh element type ids
_TET4 = 4
_TRI3 = 2


class MeshQuality(BaseModel):
    min_quality: Optional[float] = None
    mean_quality: Optional[float] = None
    quality_measure: str = "gamma (inscribed/circumscribed radius ratio)"
    poor_element_count: int = 0
    poor_element_threshold: float = 0.1


class MeshMetadata(BaseModel):
    """Recorded with every run so a result can be reproduced and judged."""

    node_count: int
    tet_count: int
    boundary_triangle_count: int
    target_element_size_m: float
    min_element_size_m: Optional[float] = None
    fe_element_order: int
    gmsh_version: str
    quality: MeshQuality = Field(default_factory=MeshQuality)
    subdomain_element_counts: dict[str, int] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class MeshResult(BaseModel):
    """A linear tetrahedral mesh plus the data needed to apply physics."""

    model_config = {"arbitrary_types_allowed": True}

    nodes: np.ndarray = Field(description="(N, 3) coordinates in metres")
    tets: np.ndarray = Field(description="(M, 4) vertex indices")
    #: Per-element subdomain name; empty for single-material parts.
    element_subdomain: Optional[np.ndarray] = None
    metadata: MeshMetadata

    def element_centroids(self) -> np.ndarray:
        return self.nodes[self.tets].mean(axis=1)

    def total_volume(self) -> float:
        """Sum of signed tet volumes - a mesh-side cross-check on the CAD volume."""
        p = self.nodes[self.tets]
        v = np.einsum(
            "ij,ij->i",
            p[:, 1] - p[:, 0],
            np.cross(p[:, 2] - p[:, 0], p[:, 3] - p[:, 0]),
        ) / 6.0
        return float(np.abs(v).sum())


class MeshingError(RuntimeError):
    """Raised when meshing fails or produces an unusable mesh."""


@contextmanager
def _gmsh_session(verbose: bool = False):
    """Exclusive, thread-safe access to the Gmsh singleton.

    Two things matter here:

    ``interruptible=False`` - by default ``gmsh.initialize`` installs POSIX
    signal handlers, which raises "signal only works in main thread of the main
    interpreter" on any thread that is not the main one. The job manager meshes
    every candidate on a worker thread and the API serves sync endpoints from a
    threadpool, so initialising interruptibly would break all meshing in the
    running application.

    Initialise once, clear between uses - repeatedly initialising and
    finalising is slower and leaves Gmsh in a half-initialised state if a call
    in between fails. The model is cleared instead, which is exact because the
    lock guarantees a single user at a time.
    """
    import gmsh

    with _GMSH_LOCK:
        if gmsh.isInitialized():
            gmsh.clear()
        else:
            gmsh.initialize(interruptible=False)
        gmsh.option.setNumber("General.Terminal", 1 if verbose else 0)
        try:
            yield gmsh
        finally:
            try:
                gmsh.clear()
            except Exception:  # pragma: no cover - defensive
                pass


def _extract(gmsh) -> tuple[np.ndarray, np.ndarray, int]:
    node_tags, coords, _ = gmsh.model.mesh.getNodes()
    if len(node_tags) == 0:
        raise MeshingError("gmsh returned no nodes")
    coords = np.asarray(coords, dtype=np.float64).reshape(-1, 3)
    order = np.argsort(node_tags)
    sorted_tags = np.asarray(node_tags)[order]
    nodes = coords[order]
    index_of = {int(t): i for i, t in enumerate(sorted_tags)}

    _, tet_nodes = gmsh.model.mesh.getElementsByType(_TET4)
    if len(tet_nodes) == 0:
        raise MeshingError(
            "gmsh produced no tetrahedra: the imported solid may be a shell or "
            "the mesh size may be too coarse for the geometry"
        )
    tets = np.fromiter((index_of[int(t)] for t in tet_nodes), dtype=np.int64)
    tets = tets.reshape(-1, 4)

    try:
        _, tri_nodes = gmsh.model.mesh.getElementsByType(_TRI3)
        n_tri = len(tri_nodes) // 3
    except Exception:
        n_tri = 0
    return nodes, tets, n_tri


def _quality(gmsh, tet_tags) -> MeshQuality:
    try:
        q = np.asarray(gmsh.model.mesh.getElementQualities(tet_tags), dtype=float)
        if q.size == 0:
            return MeshQuality()
        return MeshQuality(
            min_quality=float(q.min()),
            mean_quality=float(q.mean()),
            poor_element_count=int(np.count_nonzero(q < 0.1)),
        )
    except Exception as exc:  # pragma: no cover
        log.debug("element quality unavailable: %s", exc)
        return MeshQuality()


def mesh_step_file(
    step_path: Path,
    settings: MeshSettings,
    subdomains: Optional[list[Subdomain]] = None,
) -> MeshResult:
    """Mesh a STEP solid into linear tetrahedra.

    Raises :class:`MeshingError` with the gmsh reason on failure; the pipeline
    marks the candidate ``mesh_failed`` rather than substituting a result.
    """
    step_path = Path(step_path)
    if not step_path.exists():
        raise MeshingError(f"STEP file not found: {step_path}")

    warnings: list[str] = []
    with _gmsh_session() as gmsh:
        gmsh.model.add("component")
        try:
            gmsh.model.occ.importShapes(str(step_path))
            gmsh.model.occ.synchronize()
        except Exception as exc:
            raise MeshingError(f"STEP import failed: {exc}") from exc

        volumes = gmsh.model.getEntities(3)
        if not volumes:
            raise MeshingError("imported STEP contains no 3D volume")

        if len(volumes) > 1:
            # A multi-solid assembly (the spark-plug shell / insulator /
            # electrode stack) imports as separate volumes with duplicated
            # coincident faces. Without fragmenting, each volume is meshed
            # independently and the parts share no nodes, so heat could not
            # cross an interface and the assembly would solve as disconnected
            # bodies. Fragmenting imprints the shared faces so the mesh is
            # conformal across every interface.
            try:
                fragments, _ = gmsh.model.occ.fragment(volumes, [])
                gmsh.model.occ.synchronize()
                volumes = [t for t in fragments if t[0] == 3] or gmsh.model.getEntities(3)
            except Exception as exc:
                raise MeshingError(
                    f"could not make the {len(volumes)}-solid assembly conformal: {exc}"
                ) from exc

        gmsh.option.setNumber("Mesh.MeshSizeMax", settings.target_element_size_m)
        if settings.min_element_size_m:
            gmsh.option.setNumber("Mesh.MeshSizeMin", settings.min_element_size_m)
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
        gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 1)
        gmsh.option.setNumber("Mesh.Optimize", 1 if settings.optimize_quality else 0)
        gmsh.option.setNumber("Mesh.OptimizeNetgen", 0)
        gmsh.option.setNumber("Mesh.Algorithm3D", 1)  # Delaunay

        try:
            gmsh.model.mesh.generate(3)
        except Exception as exc:
            raise MeshingError(f"3D mesh generation failed: {exc}") from exc

        nodes, tets, n_tri = _extract(gmsh)
        tet_tags, _ = gmsh.model.mesh.getElementsByType(_TET4)
        quality = _quality(gmsh, tet_tags)
        gmsh_version = gmsh.__version__

    if len(nodes) > settings.max_nodes:
        raise MeshingError(
            f"mesh has {len(nodes)} nodes, above the configured limit of "
            f"{settings.max_nodes}. Increase target_element_size_m or raise max_nodes."
        )

    if quality.min_quality is not None and quality.poor_element_count:
        warnings.append(
            f"{quality.poor_element_count} tetrahedra have quality below 0.1 "
            f"(minimum {quality.min_quality:.3f}); stress near those elements is less reliable"
        )

    metadata = MeshMetadata(
        node_count=int(len(nodes)),
        tet_count=int(len(tets)),
        boundary_triangle_count=int(n_tri),
        target_element_size_m=settings.target_element_size_m,
        min_element_size_m=settings.min_element_size_m,
        fe_element_order=settings.element_order,
        gmsh_version=gmsh_version,
        quality=quality,
        warnings=warnings,
    )

    result = MeshResult(nodes=nodes, tets=tets, metadata=metadata)

    if subdomains:
        result.element_subdomain = assign_subdomains(result, subdomains)
        names, counts = np.unique(result.element_subdomain, return_counts=True)
        metadata.subdomain_element_counts = {
            str(n): int(c) for n, c in zip(names, counts)
        }
        unassigned = int(np.count_nonzero(result.element_subdomain == ""))
        if unassigned:
            raise MeshingError(
                f"{unassigned} of {len(tets)} elements fall outside every declared material "
                "subdomain; the subdomain selectors do not cover the solid"
            )

    log.info(
        "meshed %s: %d nodes, %d tets, min quality %s",
        step_path.name,
        metadata.node_count,
        metadata.tet_count,
        f"{quality.min_quality:.3f}" if quality.min_quality is not None else "n/a",
    )
    return result


def assign_subdomains(mesh: MeshResult, subdomains: list[Subdomain]) -> np.ndarray:
    """Label each element with its material subdomain from element centroids."""
    centroids = mesh.element_centroids().T  # (3, M)
    labels = np.full(mesh.tets.shape[0], "", dtype=object)
    for sd in subdomains:
        mask = sd.mask(centroids)
        # First matching subdomain wins, so overlapping selectors stay deterministic.
        labels[mask & (labels == "")] = sd.name
    return labels
