"""Engineering report generation (spec 8.1, 15).

The report is a traceability document, not a sales sheet. It carries the
specification that was run, the solver and its benchmark evidence, every
candidate including the failures, the constraint verdicts, the assumptions with
their provenance, and the standing limitations. Nothing in it is computed here:
every number is read from a stored record.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core import units as U
from app.core.logging import get_logger
from app.db.models import (
    Candidate,
    ComponentInstance,
    EngineeringSpecificationRecord,
    OptimizationRun,
    Project,
    SimulationResultRecord,
    SimulationRun,
)
from app.engineering.ai.result_explainer import explain_study
from app.engineering.optimization.evaluation import CandidateRecord
from app.engineering.profiles.registry import get_profile
from app.engineering.solvers.registry import get_solver
from app.schemas.common import ComponentType
from app.schemas.engineering import KNOWN_METRICS
from app.services.artifact_store import get_store

log = get_logger(__name__)

STANDING_LIMITATIONS = [
    "This report contains virtual-prototyping predictions produced under the "
    "engineering model recorded below. It is not a regulatory certification, not an "
    "approval for road use, and not a substitute for physical validation.",
    "A candidate marked 'feasible under configured model' satisfied the constraints "
    "listed in this report and nothing more.",
    "Material properties are taken from the catalog snapshot recorded with each run. "
    "Where a record is tagged 'illustrative_handbook_value' it is not supplier-certified "
    "data and must be replaced before any engineering sign-off.",
    "Candidates that failed geometry generation, meshing or the solver carry no "
    "metrics. They are listed with their failure stage and reason rather than omitted.",
]


def _display(metric: str, value: float) -> dict[str, Any]:
    kind = KNOWN_METRICS.get(metric)
    if kind is None:
        return {"canonical_value": value, "canonical_unit": None}
    canonical_unit = U.CANONICAL[kind]
    display_value, display_unit = U.display(float(value), canonical_unit)
    return {
        "value": display_value,
        "unit": display_unit,
        "canonical_value": float(value),
        "canonical_unit": canonical_unit,
    }


def _record_from_db(row: Candidate) -> CandidateRecord:
    return CandidateRecord.model_validate(
        {
            "candidate_id": row.id,
            "index": row.candidate_index,
            "generation": row.generation,
            "parameters": row.parameters or {},
            "geometry_hash": row.geometry_hash or "",
            "status": row.status,
            "is_baseline": row.is_baseline,
            "from_cache": row.from_cache,
            "metrics": row.metrics or {},
            "constraint_results": row.constraint_results or [],
            "objective_values": row.objective_values or [],
            "is_feasible": row.is_feasible,
            "infeasibility_reasons": row.infeasibility_reasons or [],
            "failure_reason": row.failure_reason,
            "failure_stage": row.failure_stage,
            "rank": row.rank,
            "pareto_front": row.pareto_front,
            "solve_time_seconds": row.solve_time_seconds,
            "mesh_node_count": row.mesh_node_count,
            "warnings": row.warnings or [],
            "assurance": row.assurance,
        }
    )


def _assurance_section(
    records: list[CandidateRecord],
    recommended_id: Optional[str],
    component_type: ComponentType,
) -> dict[str, Any]:
    """The evidence package manifest: what was checked, and what is still open.

    This is the part of the report an engineer reviewing the recommendation
    actually needs. It states the maturity level of the recommended design, the
    evidence that produced it, every check with its measured value, the gaps
    that remain, where the component sits on its validation ladder, and the
    claims that may not be made from any of it.
    """
    from app.engineering.assurance import (
        PROHIBITED_CLAIM_STATEMENTS,
        FIDELITY_LADDER,
        ladder_for,
    )

    ladder = ladder_for(component_type)
    section: dict[str, Any] = {
        "note": (
            "Every verdict below was produced by the deterministic assurance "
            "service from a measurement. A check recorded as 'not_run' produced "
            "no evidence and is not a pass."
        ),
        "validation_ladder": {
            "title": ladder.title,
            "attained_level": ladder.attained_level,
            "rungs": [r.model_dump(mode="json") for r in ladder.rungs],
        },
        "fidelity_ladder": [r.model_dump(mode="json") for r in FIDELITY_LADDER],
        "claims_this_report_does_not_make": PROHIBITED_CLAIM_STATEMENTS,
        "per_candidate": [],
    }

    for record in records:
        if record.assurance is None:
            section["per_candidate"].append(
                {
                    "candidate_id": record.candidate_id,
                    "index": record.index,
                    "assurance": None,
                    "note": (
                        "The assurance gate did not run for this candidate, so "
                        "there is no verification evidence for it."
                    ),
                }
            )
            continue
        section["per_candidate"].append(
            {
                "candidate_id": record.candidate_id,
                "index": record.index,
                "is_recommended": record.candidate_id == recommended_id,
                "maturity": record.assurance.maturity.model_dump(mode="json"),
                "verification": record.assurance.verification.model_dump(mode="json"),
                "validation": record.assurance.validation.model_dump(mode="json"),
                "uncertainty": record.assurance.uncertainty.model_dump(mode="json"),
                "evidence": (
                    record.assurance.evidence.model_dump(mode="json")
                    if record.assurance.evidence
                    else None
                ),
            }
        )

    recommended = next(
        (r for r in records if r.candidate_id == recommended_id and r.assurance), None
    )
    if recommended is not None:
        outcome = recommended.assurance
        section["recommended_design"] = {
            "candidate_id": recommended.candidate_id,
            "maturity_level": outcome.maturity.level.value,
            "maturity_statement": outcome.maturity.statement,
            "intended_use_domain": outcome.maturity.intended_use_domain,
            "last_evidence_date": outcome.maturity.last_evidence_date,
            "verification_status": outcome.verification.status.value,
            "validation_status": outcome.validation.status.value,
            "blocked_from": (
                outcome.maturity.blocked_from.value
                if outcome.maturity.blocked_from
                else None
            ),
            "blocking_reasons": outcome.maturity.blocking_reasons,
            "unresolved_limitations": outcome.maturity.unresolved_limitations,
            "prohibited_at_this_level": outcome.maturity.prohibited_claims,
            "evidence_gaps": outcome.verification.evidence_gaps,
            "ladder_level": outcome.ladder_level,
            "ladder_next_gap": outcome.ladder_next_gap,
            "fidelity_level": outcome.fidelity_level,
        }

    return section


def _recommended_maturity(
    records: list[CandidateRecord], recommendation: dict | None
) -> str | None:
    """The maturity level of the candidate the study recommends.

    Passed to the claim guard so that the narrative is checked against the
    evidence of the design it is actually recommending.
    """
    candidate_id = (recommendation or {}).get("candidate_id")
    for record in records:
        if record.candidate_id == candidate_id and record.assurance is not None:
            return record.assurance.maturity.level.value
    return None


def build_report(session: Session, run_id: str) -> dict[str, Any]:
    """Assemble the full report payload for a completed study."""
    run = session.get(OptimizationRun, run_id)
    if run is None:
        raise ValueError(f"unknown study {run_id!r}")

    component = session.get(ComponentInstance, run.component_instance_id)
    if component is None:
        raise ValueError("the component this study belongs to no longer exists")
    project = session.get(Project, component.project_id)

    component_type = ComponentType(component.component_type)
    profile = get_profile(component_type)
    solver = get_solver(profile.solver_id)

    rows = (
        session.query(Candidate)
        .filter(Candidate.optimization_run_id == run_id)
        .order_by(Candidate.candidate_index.asc())
        .all()
    )

    spec_payload: dict[str, Any] = {}
    assumptions: list[dict] = []
    engineering_inputs: dict[str, Any] = {}
    if run.specification_id:
        record = session.get(EngineeringSpecificationRecord, run.specification_id)
        if record is not None:
            spec_payload = record.payload or {}
            assumptions = record.assumptions or []
            engineering_inputs = record.engineering_inputs or {}

    from app.api.routes.studies import _study_summary_file
    from app.api.serializers import optimization_run_summary

    summary_file = _study_summary_file(rows)
    run_summary = optimization_run_summary(session, run)

    baseline_row = next((r for r in rows if r.is_baseline), None)
    recommended_id = (summary_file.get("recommendation") or {}).get("candidate_id")
    recommended_row = next((r for r in rows if r.id == recommended_id), None)

    # ---- per-candidate table ---------------------------------------------
    candidate_entries: list[dict[str, Any]] = []
    for row in rows:
        entry: dict[str, Any] = {
            "candidate_id": row.id,
            "index": row.candidate_index,
            "generation": row.generation,
            "label": "Baseline" if row.is_baseline else f"Candidate {row.candidate_index}",
            "status": row.status,
            "is_baseline": row.is_baseline,
            "is_feasible": row.is_feasible,
            "rank": row.rank,
            "pareto_front": row.pareto_front,
            "parameters": row.parameters or {},
            "geometry_hash": row.geometry_hash,
            "metrics": {
                k: _display(k, v)
                for k, v in (row.metrics or {}).items()
                if v is not None
            },
            "constraint_results": row.constraint_results or [],
            "infeasibility_reasons": row.infeasibility_reasons or [],
            "failure_stage": row.failure_stage,
            "failure_reason": row.failure_reason,
            "warnings": row.warnings or [],
            "solve_time_seconds": row.solve_time_seconds,
            "mesh_node_count": row.mesh_node_count,
            "step_artifact": row.step_path,
            "preview_artifact": row.preview_glb_path,
        }

        if row.simulation_run_id:
            sim = session.get(SimulationRun, row.simulation_run_id)
            result = (
                session.query(SimulationResultRecord)
                .filter(SimulationResultRecord.simulation_run_id == row.simulation_run_id)
                .first()
            )
            if sim is not None:
                entry["provenance"] = {
                    "solver_name": sim.solver_name,
                    "solver_version": sim.solver_version,
                    "result_kind": sim.result_kind,
                    "analysis_type": sim.analysis_type,
                    "load_case_id": sim.load_case_id,
                    "degrees_of_freedom": sim.degrees_of_freedom,
                    "mesh_preset": sim.mesh_preset,
                    "mesh_metadata": sim.mesh_metadata,
                    "mesh_settings": sim.mesh_settings,
                    "linear_solver": sim.linear_solver_report,
                    "material_snapshot": sim.material_snapshot,
                }
            if result is not None:
                entry["provenance"] = {
                    **entry.get("provenance", {}),
                    "region_applications": result.region_applications,
                    "load_verifications": result.load_verifications,
                    "method_statement": result.method_statement,
                }
        candidate_entries.append(entry)

    # ---- narrative, generated from the stored records ---------------------
    records = [_record_from_db(r) for r in rows]
    explanation = explain_study(
        candidates=records,
        recommendation=summary_file.get("recommendation"),
        comparison=summary_file.get("comparison"),
        algorithm=summary_file.get("algorithm") or run.algorithm,
        summary=run_summary,
        method_statement=solver.method_statement,
        mesh_convergence=summary_file.get("mesh_convergence"),
        maturity=_recommended_maturity(records, summary_file.get("recommendation")),
    )

    # ---- benchmark evidence for the solver that produced these numbers ----
    from app.api.routes.health import _benchmark_cache

    benchmarks = _benchmark_cache()

    report = {
        "report_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "title": (
            f"{profile.display_name} generative design study"
            + (f" - {project.name}" if project else "")
        ),
        "project": {
            "id": project.id if project else None,
            "name": project.name if project else None,
            "description": project.description if project else None,
        },
        "component": {
            "id": component.id,
            "name": component.name,
            "type": component_type.value,
            "display_name": profile.display_name,
            "design_mode": component.design_mode,
            "imported_source": component.source_asset_path,
            "source_is_parametric": component.source_is_parametric,
        },
        "study": {
            "optimization_run_id": run.id,
            "algorithm": summary_file.get("algorithm") or run.algorithm,
            "random_seed": run.random_seed,
            "candidate_budget": run.candidate_budget,
            "generations": run.generations,
            "design_variables": run.design_variables,
            "status": run.status,
            "termination_reason": run.termination_reason,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "summary": run_summary,
        },
        "engineering_specification": spec_payload,
        "engineering_inputs_canonical": engineering_inputs,
        "objectives": run.objective_definitions or [],
        "constraints": run.constraint_definitions or [],
        "scope": {
            "analysis_type": profile.analysis_type.value,
            "scope_statement": profile.scope_statement,
            "not_in_scope": list(profile.not_in_scope),
            "geometry_capability_note": profile.generator.capability_note,
            "solver": {
                "solver_id": solver.solver_id,
                "name": solver.solver_name,
                "version": solver.solver_version,
                "result_kind": solver.result_kind.value,
                "method_statement": solver.method_statement,
            },
        },
        "solver_verification": {
            "benchmarks": benchmarks,
            "all_passed": all(b["passed"] for b in benchmarks) if benchmarks else None,
            "note": (
                "These benchmarks compare the same solver code path used for the "
                "results in this report against closed-form solutions."
            ),
        },
        "baseline_candidate_id": baseline_row.id if baseline_row else None,
        "recommended_candidate_id": recommended_id,
        "recommendation": summary_file.get("recommendation"),
        "baseline_vs_recommended": summary_file.get("comparison") or {},
        "mesh_convergence": summary_file.get("mesh_convergence") or {},
        "candidates": candidate_entries,
        "narrative": explanation.model_dump(mode="json"),
        "assumptions": assumptions,
        "standing_limitations": STANDING_LIMITATIONS,
        "assurance": _assurance_section(records, recommended_id, component_type),
    }

    if recommended_row is not None:
        report["recommended_design"] = {
            "candidate_id": recommended_row.id,
            "parameters": recommended_row.parameters,
            "metrics": {
                k: _display(k, v)
                for k, v in (recommended_row.metrics or {}).items()
                if v is not None
            },
            "step_artifact": recommended_row.step_path,
            "next_steps": [
                "Review every assumption listed in this report and replace the "
                "demonstration fixtures with your own engineering values.",
                "Replace illustrative material data with supplier-certified properties "
                "and re-run.",
                "Re-run the selected design at verification mesh fidelity if that has "
                "not already been done.",
                "Add the load cases this study did not cover before committing to a "
                "physical prototype.",
                "Build and physically test the selected design. This study narrows the "
                "candidates; it does not replace that test.",
            ],
        }

    return report


def build_evidence_manifest(report: dict[str, Any]) -> dict[str, Any]:
    """The machine-readable evidence manifest that travels with an export.

    A STEP file leaves this tool and is opened somewhere else, by someone who
    did not run the study. The manifest is what makes that file accountable: it
    states which requirement revision the design answers, what it was computed
    from, which checks passed and which produced nothing, how mature the result
    is, and what may not be claimed from it.

    Deliberately flat and small. It is meant to be read by another system, or
    by a person with no access to this one.
    """
    assurance = report.get("assurance") or {}
    rec = assurance.get("recommended_design") or {}
    detail = next(
        (
            c
            for c in assurance.get("per_candidate", [])
            if c.get("is_recommended") and c.get("evidence")
        ),
        None,
    )
    evidence = (detail or {}).get("evidence") or {}
    verification = (detail or {}).get("verification") or {}

    checks: list[dict[str, Any]] = []
    for stage_key in ("pre_solver", "post_solver"):
        stage = verification.get(stage_key) or {}
        for check in stage.get("checks", []):
            checks.append(
                {
                    "check_id": check["check_id"],
                    "stage": check["stage"],
                    "status": check["status"],
                    "measured": check.get("measured"),
                    "threshold": check.get("threshold"),
                    "unit": check.get("unit"),
                }
            )

    return {
        "manifest_version": "1.0",
        "generated_at": report["generated_at"],
        "study": {
            "optimization_run_id": report["study"]["optimization_run_id"],
            "algorithm": report["study"]["algorithm"],
            "random_seed": report["study"]["random_seed"],
        },
        "component": {
            "type": report["component"]["type"],
            "display_name": report["component"]["display_name"],
            "design_mode": report["component"]["design_mode"],
        },
        "subject": {
            "candidate_id": rec.get("candidate_id"),
            "step_artifact": (report.get("recommended_design") or {}).get(
                "step_artifact"
            ),
        },
        "identity": {
            "requirement_revision": evidence.get("requirement_revision"),
            "geometry_hash": evidence.get("geometry_hash"),
            "material_snapshot_hash": evidence.get("material_snapshot_hash"),
            "load_case_hash": evidence.get("load_case_hash"),
            "mesh_hash": evidence.get("mesh_hash"),
            "solver_input_hash": evidence.get("solver_input_hash"),
            "solver_name": evidence.get("solver_name"),
            "solver_version": evidence.get("solver_version"),
            "generator_version": evidence.get("generator_version"),
            "code_commit": evidence.get("code_commit"),
            "staleness_rule": (
                "If any identity value above differs from the current state, every "
                "result in this manifest is stale and must be re-derived."
            ),
        },
        "maturity": {
            "level": rec.get("maturity_level"),
            "statement": rec.get("maturity_statement"),
            "intended_use_domain": rec.get("intended_use_domain"),
            "last_evidence_date": rec.get("last_evidence_date"),
            "blocked_from": rec.get("blocked_from"),
            "blocking_reasons": rec.get("blocking_reasons", []),
            "derivation": (
                "Derived deterministically from the recorded checks below. No "
                "language model assigns or raises this level."
            ),
        },
        "verification": {
            "status": rec.get("verification_status"),
            "benchmark_id": verification.get("benchmark_id"),
            "reaction_balance_error": verification.get("reaction_balance_error"),
            "energy_balance_error": verification.get("energy_balance_error"),
            "checks": checks,
            "evidence_gaps": rec.get("evidence_gaps", []),
        },
        "validation": (detail or {}).get("validation"),
        "uncertainty": (detail or {}).get("uncertainty"),
        "provenance": evidence.get("provenance", []),
        "validation_ladder": assurance.get("validation_ladder"),
        "fidelity_level": rec.get("fidelity_level"),
        "unresolved_limitations": rec.get("unresolved_limitations", []),
        "prohibited_claims": assurance.get("claims_this_report_does_not_make", []),
        "standing_limitations": report.get("standing_limitations", []),
    }


def write_report(session: Session, run_id: str) -> tuple[Path, dict[str, Any]]:
    """Build the report and persist it as JSON, Markdown and an evidence manifest."""
    report = build_report(session, run_id)

    run = session.get(OptimizationRun, run_id)
    component = session.get(ComponentInstance, run.component_instance_id)
    store = get_store()
    paths = store.component_paths(component.project_id, component.id)

    json_path = paths.reports / f"{run_id}_report.json"
    json_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    md_path = paths.reports / f"{run_id}_report.md"
    md_path.write_text(render_markdown(report), encoding="utf-8")

    manifest_path = paths.reports / f"{run_id}_evidence_manifest.json"
    manifest_path.write_text(
        json.dumps(build_evidence_manifest(report), indent=2, default=str),
        encoding="utf-8",
    )

    log.info(
        "report written for study %s: %s, %s", run_id, md_path.name, manifest_path.name
    )
    return md_path, report


def render_markdown(report: dict[str, Any]) -> str:
    """Render the report as Markdown for reading, printing and attaching."""
    out: list[str] = []
    a = out.append

    a(f"# {report['title']}")
    a("")
    a(f"**Generated:** {report['generated_at']}  ")
    a(f"**Study:** `{report['study']['optimization_run_id']}`  ")
    a(f"**Component:** {report['component']['display_name']} ({report['component']['name']})  ")
    a(f"**Algorithm:** {report['study']['algorithm']}  ")
    a(f"**Random seed:** {report['study']['random_seed']}")
    a("")

    a("> " + report["standing_limitations"][0])
    a("")

    # ---- headline ---------------------------------------------------------
    narrative = report.get("narrative") or {}
    a("## Outcome")
    a("")
    if narrative.get("headline"):
        a(f"**{narrative['headline']}**")
        a("")
    for paragraph in narrative.get("paragraphs", []):
        a(paragraph)
        a("")

    # ---- recommendation ---------------------------------------------------
    comparison = report.get("baseline_vs_recommended") or {}
    if comparison:
        a("## Baseline versus recommended design")
        a("")
        a("| Metric | Baseline | Recommended | Change |")
        a("|---|---|---|---|")
        for metric, entry in comparison.items():
            if not entry.get("available"):
                a(f"| {metric} | not available | not available | - |")
                continue
            base, cand = entry["baseline"], entry["candidate"]
            pct = entry.get("percent_change")
            a(
                f"| {metric} | {base['value']:.4g} {base['unit']} | "
                f"{cand['value']:.4g} {cand['unit']} | "
                f"{pct:+.1f}% |" if pct is not None else
                f"| {metric} | {base['value']:.4g} {base['unit']} | "
                f"{cand['value']:.4g} {cand['unit']} | - |"
            )
        a("")

    # ---- candidate table --------------------------------------------------
    a("## All candidates")
    a("")
    a("Every generated design is listed, including those that produced no result.")
    a("")
    a("| # | Status | Feasible | Mass | Peak stress | Peak displacement | Rank | Note |")
    a("|---|---|---|---|---|---|---|---|")
    for c in report["candidates"]:
        metrics = c["metrics"]

        def show(key: str) -> str:
            entry = metrics.get(key)
            if not entry or entry.get("value") is None:
                return "-"
            return f"{entry['value']:.4g} {entry['unit']}"

        feasible = (
            "yes" if c["is_feasible"] else ("no" if c["is_feasible"] is False else "-")
        )
        note = c["failure_reason"] or "; ".join(c["infeasibility_reasons"]) or ""
        a(
            f"| {c['label']} | {c['status']} | {feasible} | {show('mass_kg')} | "
            f"{show('max_von_mises_pa')} | {show('max_displacement_m')} | "
            f"{c['rank'] or '-'} | {note[:90]} |"
        )
    a("")

    # ---- constraints ------------------------------------------------------
    a("## Configured constraints")
    a("")
    for con in report["constraints"]:
        source = con.get("source_status", "unknown")
        a(f"- `{con.get('constraint_id')}` - {con.get('label') or con.get('metric')} "
          f"(provenance: {source})")
    a("")

    # ---- method and verification -----------------------------------------
    scope = report["scope"]
    a("## Method and scope")
    a("")
    a(f"**Analysis:** {scope['analysis_type']}")
    a("")
    a(scope["scope_statement"])
    a("")
    a(f"**Solver:** {scope['solver']['name']} ({scope['solver']['version']})")
    a("")
    a(scope["solver"]["method_statement"])
    a("")
    a("**Geometry template:** " + scope["geometry_capability_note"])
    a("")
    a("### Not covered by this analysis")
    a("")
    for item in scope["not_in_scope"]:
        a(f"- {item}")
    a("")

    verification = report.get("solver_verification") or {}
    if verification.get("benchmarks"):
        a("### Solver verification")
        a("")
        a(verification["note"])
        a("")
        a("| Benchmark | Quantity | Computed | Reference | Relative error | Result |")
        a("|---|---|---|---|---|---|")
        for bench in verification["benchmarks"]:
            for key, q in bench["quantities"].items():
                a(
                    f"| {bench['name']} | {key} | {q['computed']:.6g} | "
                    f"{q['reference']:.6g} | {q['relative_error']:.3g} | "
                    f"{'pass' if q['passed'] else 'FAIL'} |"
                )
        a("")

    mesh = report.get("mesh_convergence") or {}
    if mesh.get("statement"):
        a("### Mesh convergence")
        a("")
        status = str(mesh.get("status") or "not_run")
        a(f"Status: `{status}`" + {
            "passed": " - the decision quantity and every compared metric held"
                      " within tolerance under refinement.",
            "failed": " - the quantity the feasibility decision rests on is not"
                      " mesh-independent.",
            "inconclusive": " - the decision quantity converged, but a"
                            " region-specific metric did not. Recorded as its own"
                            " state rather than as a pass or a failure.",
            "not_run": " - no refinement study is on record for this result.",
        }.get(status, ""))
        a("")
        a(mesh["statement"])
        a("")
        rows = [
            (name, entry) for name, entry in (mesh.get("metrics") or {}).items()
            if isinstance(entry, dict) and entry.get("available")
        ]
        if rows:
            decision = mesh.get("decision_metric")
            a("| Metric | Coarse | Refined | Change | Converged | Role |")
            a("|---|---|---|---|---|---|")
            for name, entry in rows:
                role = "decision quantity" if name == decision else "reported"
                a(
                    f"| {name} | {entry['coarse']:.6g} | {entry['fine']:.6g} | "
                    f"{entry['percent_change']:+.2f}% | "
                    f"{'yes' if entry['converged'] else 'no'} | {role} |"
                )
            a("")

    # ---- assumptions ------------------------------------------------------
    a("## Assumptions and provenance")
    a("")
    if report["assumptions"]:
        for assumption in report["assumptions"]:
            confirmed = " (confirmed by the engineer)" if assumption.get("confirmed") else ""
            a(f"- **{assumption.get('key')}** [{assumption.get('source_status')}]"
              f"{confirmed}: {assumption.get('statement')}")
    else:
        a("No assumptions were recorded for this study.")
    a("")

    # ---- next steps -------------------------------------------------------
    recommended = report.get("recommended_design")
    if recommended:
        a("## Recommended next steps")
        a("")
        for step in recommended["next_steps"]:
            a(f"1. {step}")
        a("")

    # ---- assurance, evidence and maturity ---------------------------------
    assurance = report.get("assurance") or {}
    rec = assurance.get("recommended_design")
    if rec:
        a("## Evidence and model maturity")
        a("")
        a(f"**{rec['maturity_statement']}**")
        a("")
        a(f"- **Intended use domain:** {rec['intended_use_domain']}")
        a(f"- **Numerical verification:** {rec['verification_status']}")
        a(f"- **Physical validation:** {rec['validation_status']}")
        a(f"- **Validation ladder:** {rec.get('ladder_level') or 'not assigned'}")
        a(f"- **Model fidelity:** {rec.get('fidelity_level') or 'not assigned'}")
        if rec.get("last_evidence_date"):
            a(f"- **Newest evidence:** {rec['last_evidence_date']}")
        a("")
        a(
            "This level was derived from recorded evidence by the deterministic "
            "assurance service. No language model assigns or raises it."
        )
        a("")

        if rec.get("blocked_from"):
            a(f"### Why this is not yet `{rec['blocked_from']}`")
            a("")
            for reason in rec.get("blocking_reasons", []):
                a(f"- {reason}")
            a("")

        if rec.get("evidence_gaps"):
            a("### Checks that produced no evidence")
            a("")
            for gap in rec["evidence_gaps"]:
                a(f"- {gap}")
            a("")

        if rec.get("prohibited_at_this_level"):
            a("### What this level does not establish")
            a("")
            for item in rec["prohibited_at_this_level"]:
                a(f"- {item}")
            a("")

        if rec.get("ladder_next_gap"):
            a(f"**Next rung:** {rec['ladder_next_gap']}")
            a("")

        # The full check table for the recommended design.
        detail = next(
            (
                c
                for c in assurance.get("per_candidate", [])
                if c.get("is_recommended") and c.get("verification")
            ),
            None,
        )
        if detail:
            a("### Assurance checks")
            a("")
            a("| Check | Status | Measured | Threshold | Detail |")
            a("| --- | --- | --- | --- | --- |")
            verification = detail["verification"]
            for stage_key in ("pre_solver", "post_solver"):
                stage = verification.get(stage_key) or {}
                for check in stage.get("checks", []):
                    unit = check.get("unit") or ""

                    def shown(value: Optional[float], u: str = unit) -> str:
                        return f"{value:.4g} {u}".strip() if value is not None else "-"

                    detail_text = check.get("detail", "").replace("|", "/")
                    a(
                        f"| {check['title']} | `{check['status']}` "
                        f"| {shown(check.get('measured'))} "
                        f"| {shown(check.get('threshold'))} "
                        f"| {detail_text} |"
                    )
            a("")

            evidence = detail.get("evidence")
            if evidence:
                a("### Evidence record")
                a("")
                for key in (
                    "requirement_revision",
                    "geometry_hash",
                    "material_snapshot_hash",
                    "load_case_hash",
                    "mesh_hash",
                    "solver_input_hash",
                    "solver_version",
                    "generator_version",
                    "code_commit",
                ):
                    value = evidence.get(key)
                    a(
                        f"- **{key.replace('_', ' ')}:** "
                        + (f"`{value}`" if value else "not available")
                    )
                a("")
                a(
                    "If any of these change, every result above becomes stale and "
                    "must be re-derived."
                )
                a("")

                provenance = evidence.get("provenance") or []
                if provenance:
                    a("### Input provenance")
                    a("")
                    a("| Input | Value | Source | Confirmed |")
                    a("| --- | --- | --- | --- |")
                    for entry in provenance:
                        value = entry.get("value")
                        unit = entry.get("unit") or ""
                        shown = (
                            f"{value:.6g} {unit}".strip() if value is not None else "-"
                        )
                        confirmed = "yes" if entry.get("confirmed") else "no"
                        a(
                            f"| {entry['label']} | {shown} "
                            f"| `{entry['source_type']}` | {confirmed} |"
                        )
                    a("")

    ladder = assurance.get("validation_ladder")
    if ladder:
        a(f"## {ladder['title']}")
        a("")
        a(f"This build has reached **{ladder['attained_level']}**.")
        a("")
        a("| Level | Capability | Attained | Gap |")
        a("| --- | --- | --- | --- |")
        for rung in ladder["rungs"]:
            a(
                f"| **{rung['level']}** | {rung['capability']} "
                f"| {'yes' if rung['attained'] else 'no'} "
                f"| {rung.get('gap') or '-'} |"
            )
        a("")

    if assurance.get("claims_this_report_does_not_make"):
        a("## Claims this report does not make")
        a("")
        for claim in assurance["claims_this_report_does_not_make"]:
            a(f"- {claim}")
        a("")

    a("## Standing limitations")
    a("")
    for item in report["standing_limitations"]:
        a(f"- {item}")
    a("")

    for caveat in narrative.get("caveats", []):
        a(f"> {caveat}")
        a("")

    return "\n".join(out)
