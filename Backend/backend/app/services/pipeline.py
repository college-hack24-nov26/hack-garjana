"""The candidate evaluation pipeline (spec 3.4).

One candidate moves through exactly these stages:

    validate parameters -> build CAD -> validate geometry -> export STEP/GLB
    -> mesh -> solve -> evaluate constraints -> record

A candidate that fails any stage is recorded with its stage and reason. It is
never dropped from the results and never given a substitute score.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from app.core.ids import new_id
from app.core.logging import get_logger
from app.engineering.assurance import (
    AssuranceOutcome,
    ProvenanceEntry,
    SourceType,
    assess,
    build_evidence_record,
    post_solver,
    pre_solver,
    stable_hash,
)
from app.engineering.cad.base import GeneratedGeometry, geometry_hash
from app.engineering.cad.exporter import export_preview_glb, export_step
from app.engineering.cad.validation import validate_geometry
from app.engineering.materials.catalog import MaterialRecord, get_material
from app.engineering.meshing.gmsh_runner import MeshingError, mesh_step_file
from app.engineering.optimization.evaluation import (
    CandidateRecord,
    derive_feasibility,
    evaluate_constraints,
    evaluate_objectives,
)
from app.engineering.profiles.base import ComponentProfile
from app.engineering.solvers.base import SimulationResult, SolverError
from app.engineering.solvers.registry import get_solver
from app.schemas.common import CandidateStatus
from app.schemas.engineering import EngineeringSpecification

log = get_logger(__name__)

ProgressFn = Callable[[str, str], None]


@dataclass
class EvaluationOutput:
    """Everything one candidate evaluation produced."""

    record: CandidateRecord
    geometry: Optional[GeneratedGeometry] = None
    result: Optional[SimulationResult] = None


class EvaluationCache:
    """Caches evaluations by (geometry, material, loads, mesh, solver) hash.

    The key deliberately includes the full specification fingerprint, so a
    cached result is only reused for a genuinely identical analysis (spec 13.3).
    """

    def __init__(self) -> None:
        self._store: dict[str, EvaluationOutput] = {}

    @staticmethod
    def key(spec: EngineeringSpecification, parameters: dict[str, float], g_hash: str) -> str:
        import hashlib
        import json

        payload = {
            "geometry": g_hash,
            "material": spec.material_id,
            "material_assignments": spec.material_assignments,
            "analysis": spec.analysis_type.value,
            "load_cases": [c.model_dump(mode="json") for c in spec.load_cases],
            "mesh": spec.mesh_settings.cache_key(),
            "solver": spec.solver_settings.cache_key(),
        }
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(blob.encode()).hexdigest()[:32]

    def get(self, key: str) -> Optional[EvaluationOutput]:
        return self._store.get(key)

    def put(self, key: str, value: EvaluationOutput) -> None:
        self._store[key] = value

    def __len__(self) -> int:  # pragma: no cover - diagnostics
        return len(self._store)


def resolve_materials(
    spec: EngineeringSpecification, geometry_subdomain_keys: Optional[list[str]] = None
) -> dict[str, MaterialRecord]:
    """Load the material records a run needs, from the controlled catalog only."""
    materials: dict[str, MaterialRecord] = {"primary": get_material(spec.material_id)}
    for key, material_id in spec.material_assignments.items():
        materials[key] = get_material(material_id)
    missing = set(geometry_subdomain_keys or []) - set(materials)
    if missing:
        raise ValueError(
            f"geometry declares material subdomains {sorted(missing)} but the "
            "specification assigns no material to them"
        )
    return materials


def requirement_revision(spec: EngineeringSpecification) -> str:
    """A stable identity for the requirement this specification encodes.

    Hashed over the parts that define *what is being asked for* - the stated
    objective, the objectives and constraints with their limits, the material
    and the analysis type - and deliberately not over the parameter vector,
    because exploring parameters does not change the requirement. When any of
    these move, the hash moves, and results carrying the old one are stale.
    """
    return stable_hash(
        {
            "component_type": spec.component_type.value,
            "design_mode": spec.design_mode.value,
            "analysis_type": spec.analysis_type.value,
            "objective_summary": spec.objective_summary,
            "material_id": spec.material_id,
            "material_assignments": spec.material_assignments,
            "objectives": [o.model_dump(mode="json") for o in spec.objectives],
            "constraints": [
                c.model_dump(mode="json") for c in spec.all_constraints()
            ],
        },
        length=16,
    )


def _provenance(
    spec: EngineeringSpecification,
    materials: dict[str, MaterialRecord],
    case,
) -> list[ProvenanceEntry]:
    """Every engineering input behind one run, with where it came from.

    The source type is read off the record, never guessed. A catalog material
    that is not supplier-certified is ``LITERATURE``, an unconfirmed assumption
    is ``DEMO_ASSUMPTION``, and a load the user set is ``USER_SUPPLIED``. None
    of them is upgraded by being used.
    """
    entries: list[ProvenanceEntry] = []

    for key, m in materials.items():
        entries.append(
            ProvenanceEntry(
                key=f"material.{key}",
                label=f"{m.name} ({key})",
                value=m.elastic_modulus if m.elastic_modulus is not None else m.density,
                unit="Pa" if m.elastic_modulus is not None else "kg/m3",
                source_type=(
                    SourceType.APPROVED_DATABASE
                    if m.source_status == "supplier_certified"
                    else SourceType.LITERATURE
                ),
                source_id=m.material_id,
                source_reference=m.source_document,
                revision=m.record_version,
                confirmed=m.source_status == "supplier_certified",
                note=(
                    f"Condition: {m.condition}"
                    + (
                        " Illustrative handbook-class value, not supplier-certified."
                        if m.is_illustrative
                        else ""
                    )
                ),
            )
        )

    for load in case.loads:
        q = getattr(load, "magnitude", None) or getattr(load, "pressure", None)
        entries.append(
            ProvenanceEntry(
                key=f"load.{load.region}.{load.type}",
                label=f"{load.type} on {load.region}",
                value=q.canonical() if q is not None else None,
                unit="N" if load.type == "force" else "Pa",
                source_type=SourceType.USER_SUPPLIED,
                source_reference=getattr(load, "note", None),
                confirmed=True,
            )
        )

    for bc in case.thermal_boundary_conditions:
        for attr, unit in (
            ("temperature", "K"),
            ("ambient_temperature", "K"),
            ("heat_flux", "W/m²"),
            ("power", "W"),
        ):
            q = getattr(bc, attr, None)
            if q is None:
                continue
            entries.append(
                ProvenanceEntry(
                    key=f"thermal.{bc.region}.{attr}",
                    label=f"{attr.replace('_', ' ')} at {bc.region}",
                    value=q.canonical(),
                    unit=unit,
                    source_type=SourceType.USER_SUPPLIED,
                    source_reference=getattr(bc, "note", None),
                    confirmed=True,
                )
            )

    for c in spec.all_constraints():
        limit = c.limit if c.operator.value != "between" else c.upper
        entries.append(
            ProvenanceEntry(
                key=f"constraint.{c.constraint_id}",
                label=c.label or c.constraint_id,
                value=limit.canonical() if limit is not None else None,
                unit=limit.unit if limit is not None else "-",
                source_type=(
                    SourceType.USER_SUPPLIED
                    if c.source_status.value == "user_supplied"
                    else SourceType.DEMO_ASSUMPTION
                    if c.source_status.value == "demo_fixture"
                    else SourceType.LITERATURE
                ),
                source_reference=c.source_reference,
                confirmed=c.source_status.value
                in ("user_supplied", "official_problem_statement", "supplier_certified"),
            )
        )

    for a in spec.assumptions:
        entries.append(
            ProvenanceEntry(
                key=f"assumption.{a.key}",
                label=a.statement,
                source_type=(
                    SourceType.DEMO_ASSUMPTION
                    if a.source_status.value in ("demo_fixture", "llm_draft_unconfirmed")
                    else SourceType.LITERATURE
                ),
                source_reference=a.source_reference,
                confirmed=a.confirmed,
            )
        )

    return entries


def build_geometry(
    profile: ComponentProfile,
    parameters: dict[str, float],
    output_dir: Path,
    write_preview: bool = True,
) -> GeneratedGeometry:
    """Build, validate and export one parameter set. Raises on an invalid solid."""
    generator = profile.generator

    validation = generator.validate_parameters(parameters)
    if not validation.ok:
        raise ValueError("; ".join(validation.errors))
    params = validation.normalized

    shape = generator.build(params)
    report = validate_geometry(generator, shape, params)
    if not report.passed:
        raise ValueError("; ".join(report.errors))

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    step_path = export_step(shape, output_dir / "design.step")
    glb_path = export_preview_glb(shape, output_dir / "preview.glb") if write_preview else None

    g_hash = geometry_hash(generator.component_type, generator.version, params)

    (output_dir / "parameters.json").write_text(
        __import__("json").dumps(
            {
                "parameters": params,
                "generator": generator.name,
                "generator_version": generator.version,
                "geometry_hash": g_hash,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (output_dir / "geometry_validation.json").write_text(
        report.model_dump_json(indent=2), encoding="utf-8"
    )

    return GeneratedGeometry(
        component_type=generator.component_type,
        generator_name=generator.name,
        generator_version=generator.version,
        parameters=params,
        step_path=step_path,
        preview_glb_path=glb_path,
        region_set=generator.named_regions(params),
        subdomains=generator.subdomains(params),
        validation=report,
        geometry_hash=g_hash,
    )


def evaluate_candidate(
    *,
    profile: ComponentProfile,
    spec: EngineeringSpecification,
    parameters: dict[str, float],
    output_dir: Path,
    index: int,
    generation: int = 0,
    is_baseline: bool = False,
    candidate_id: Optional[str] = None,
    cache: Optional[EvaluationCache] = None,
    progress: Optional[ProgressFn] = None,
) -> EvaluationOutput:
    """Run one candidate end to end and return its record."""
    cid = candidate_id or new_id("cand")
    generator = profile.generator

    def emit(stage: str, message: str) -> None:
        if progress:
            progress(stage, message)

    record = CandidateRecord(
        candidate_id=cid,
        index=index,
        generation=generation,
        parameters=dict(parameters),
        geometry_hash="",
        is_baseline=is_baseline,
    )

    # ------------------------------------------------------- parameter gate
    emit("validating", f"Validating parameters for candidate {index}")
    validation = generator.validate_parameters(parameters)
    if not validation.ok:
        record.status = CandidateStatus.GEOMETRY_INVALID
        record.failure_stage = "parameter_validation"
        record.failure_reason = "; ".join(validation.errors)
        log.info("candidate %s rejected at parameter validation: %s", cid, record.failure_reason)
        return EvaluationOutput(record=record)

    params = validation.normalized
    record.parameters = params
    g_hash = geometry_hash(generator.component_type, generator.version, params)
    record.geometry_hash = g_hash

    # ------------------------------------------------------------- cache hit
    # Compared against None, never for truthiness: EvaluationCache defines
    # __len__, so an empty cache is falsy and `if cache` would skip both the
    # lookup and the store, leaving the cache permanently empty.
    cache_key = (
        EvaluationCache.key(spec, params, g_hash) if cache is not None else None
    )
    if cache is not None and cache_key:
        hit = cache.get(cache_key)
        if hit is not None:
            log.info("candidate %s served from the evaluation cache", cid)
            cached = hit.record.model_copy(
                update={
                    "candidate_id": cid,
                    "index": index,
                    "generation": generation,
                    "is_baseline": is_baseline,
                    "from_cache": True,
                }
            )
            return EvaluationOutput(record=cached, geometry=hit.geometry, result=hit.result)

    # --------------------------------------------------------- geometry build
    emit("generating_geometry", f"Building geometry for candidate {index}")
    try:
        geometry = build_geometry(profile, params, output_dir)
    except Exception as exc:
        record.status = CandidateStatus.GEOMETRY_INVALID
        record.failure_stage = "geometry"
        record.failure_reason = str(exc)
        log.info("candidate %s failed geometry: %s", cid, exc)
        return EvaluationOutput(record=record)

    record.status = CandidateStatus.GEOMETRY_VALID
    record.step_path = str(geometry.step_path)
    record.preview_glb_path = str(geometry.preview_glb_path) if geometry.preview_glb_path else None
    record.warnings.extend(geometry.validation.warnings)

    # ------------------------------------------------------------- materials
    try:
        materials = resolve_materials(spec, [s.material_key for s in geometry.subdomains])
    except Exception as exc:
        record.status = CandidateStatus.GEOMETRY_INVALID
        record.failure_stage = "material_resolution"
        record.failure_reason = str(exc)
        return EvaluationOutput(record=record, geometry=geometry)

    # ---------------------------------------------------------------- solver
    solver = get_solver(spec.solver_settings.solver_id)
    case = spec.load_cases[0]

    problems = solver.validate_case(geometry, case, spec)
    if problems:
        record.status = CandidateStatus.GEOMETRY_INVALID
        record.failure_stage = "case_validation"
        record.failure_reason = "; ".join(problems)
        return EvaluationOutput(record=record, geometry=geometry)

    # ----------------------------------------------- pre-solver assurance gate
    # Runs before any mesh is built, so a candidate with a unit-scale error, an
    # incomplete material card or a boundary condition naming a region that does
    # not exist is rejected without spending a solve on it.
    emit("validating", f"Running pre-solver checks for candidate {index}")
    pre_report = pre_solver(
        spec=spec, geometry=geometry, materials=materials, case=case
    )
    if not pre_report.gate_passed:
        failures = pre_report.blocking_failures
        record.status = CandidateStatus.GEOMETRY_INVALID
        record.failure_stage = "assurance_pre_solver"
        record.failure_reason = "; ".join(
            f"{c.title}: {c.detail}" for c in failures
        )
        record.assurance = assess(
            spec=spec,
            component_type=geometry.component_type,
            pre=pre_report,
            geometry_valid=True,
        )
        log.info(
            "candidate %s rejected by the pre-solver gate: %s",
            cid,
            ", ".join(c.check_id for c in failures),
        )
        return EvaluationOutput(record=record, geometry=geometry)
    record.warnings.extend(f"{c.title}: {c.detail}" for c in pre_report.warnings)

    # ------------------------------------------------------------------ mesh
    emit("meshing", f"Meshing candidate {index}")
    try:
        mesh = mesh_step_file(geometry.step_path, spec.mesh_settings, geometry.subdomains)
    except MeshingError as exc:
        record.status = CandidateStatus.MESH_FAILED
        record.failure_stage = "meshing"
        record.failure_reason = str(exc)
        log.info("candidate %s failed meshing: %s", cid, exc)
        return EvaluationOutput(record=record, geometry=geometry)

    record.status = CandidateStatus.MESHED
    record.mesh_node_count = mesh.metadata.node_count
    record.warnings.extend(mesh.metadata.warnings)

    # The mesh checks join the pre-solver report: element quality and whether
    # the meshed volume still represents the solid it came from.
    pre_report = pre_solver(
        spec=spec, geometry=geometry, materials=materials, case=case, mesh=mesh
    )
    if not pre_report.gate_passed:
        failures = pre_report.blocking_failures
        record.status = CandidateStatus.MESH_FAILED
        record.failure_stage = "assurance_pre_solver"
        record.failure_reason = "; ".join(
            f"{c.title}: {c.detail}" for c in failures
        )
        record.assurance = assess(
            spec=spec,
            component_type=geometry.component_type,
            pre=pre_report,
            geometry_valid=True,
        )
        log.info(
            "candidate %s rejected by the pre-solver mesh gate: %s",
            cid,
            ", ".join(c.check_id for c in failures),
        )
        return EvaluationOutput(record=record, geometry=geometry)
    record.warnings.extend(
        f"{c.title}: {c.detail}"
        for c in pre_report.warnings
        if c.check_id in ("mesh_quality", "mesh_volume_fidelity")
    )

    # ----------------------------------------------------------------- solve
    emit("solving", f"Solving candidate {index} ({mesh.metadata.node_count} nodes)")
    started = time.perf_counter()
    try:
        result = solver.solve(
            geometry=geometry,
            mesh=mesh,
            case=case,
            spec=spec,
            materials=materials,
            output_dir=output_dir,
        )
    except SolverError as exc:
        record.status = CandidateStatus.SOLVER_FAILED
        record.failure_stage = "solver"
        record.failure_reason = str(exc)
        record.solve_time_seconds = time.perf_counter() - started
        log.warning("candidate %s solver failed: %s", cid, exc)
        return EvaluationOutput(record=record, geometry=geometry)
    except Exception as exc:  # unexpected, still never faked
        record.status = CandidateStatus.SOLVER_FAILED
        record.failure_stage = "solver"
        record.failure_reason = f"unexpected solver error: {exc}"
        record.solve_time_seconds = time.perf_counter() - started
        log.exception("candidate %s raised in the solver", cid)
        return EvaluationOutput(record=record, geometry=geometry)

    record.status = CandidateStatus.SOLVED
    record.solve_time_seconds = result.solve_time_seconds
    record.warnings.extend(result.warnings)
    record.field_artifact_path = (
        str(result.field_artifact.path) if result.field_artifact else None
    )

    # -------------------------------------------------- constraints/objectives
    metrics = result.summary.as_metric_dict()
    record.metrics = metrics
    record.constraint_results = evaluate_constraints(metrics, spec.all_constraints())
    record.objective_values = evaluate_objectives(metrics, spec.objectives)

    feasible, reasons = derive_feasibility(record.constraint_results)
    record.is_feasible = feasible
    record.infeasibility_reasons = reasons
    record.status = CandidateStatus.FEASIBLE if feasible else CandidateStatus.INFEASIBLE

    # --------------------------------------------- post-solver assurance gate
    # A completed solve is not a verified result. This stage reads the returned
    # fields, the per-load verification, the energy balance and the solver
    # residual, and only then decides what the result may be called.
    emit("validating", f"Running post-solver checks for candidate {index}")
    post_report = post_solver(result=result, spec=spec)
    record.warnings.extend(
        f"{c.title}: {c.detail}" for c in post_report.blocking_failures
    )

    evidence = build_evidence_record(
        requirement_revision=requirement_revision(spec),
        geometry_hash=g_hash,
        generator_version=generator.version,
        material_snapshot=result.material_snapshot or None,
        load_case=case.model_dump(mode="json"),
        mesh_settings=spec.mesh_settings.model_dump(mode="json"),
        mesh_metadata=result.mesh_metadata.model_dump(mode="json"),
        solver_name=result.solver_name,
        solver_version=result.solver_version,
        provenance=_provenance(spec, materials, case),
    )

    record.assurance = assess(
        spec=spec,
        component_type=geometry.component_type,
        pre=pre_report,
        post=post_report,
        result=result,
        evidence=evidence,
        geometry_valid=True,
        constraints_evaluated=bool(record.constraint_results),
    )

    if record.assurance.verification.status.value == "failed":
        log.warning(
            "candidate %s solved but failed the post-solver gate: %s",
            cid,
            ", ".join(c.check_id for c in post_report.blocking_failures),
        )

    (output_dir / "summary.json").write_text(
        result.model_dump_json(indent=2), encoding="utf-8"
    )
    (output_dir / "assurance.json").write_text(
        record.assurance.model_dump_json(indent=2), encoding="utf-8"
    )

    output = EvaluationOutput(record=record, geometry=geometry, result=result)
    if cache is not None and cache_key:
        cache.put(cache_key, output)
    return output
