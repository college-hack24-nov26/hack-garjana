"""The report's evidence sections, and the manifest that travels with an export.

These exercise the rendering and manifest code against a report payload shaped
exactly like a real one, without paying for a solve. What they are checking is
not that the text is pretty but that the honesty survives serialisation: a
check that did not run must still read as a gap in the Markdown, a maturity
level must not appear without its prohibitions, and the manifest must carry the
staleness rule along with the hashes it applies to.
"""
from __future__ import annotations

import json

from app.engineering.assurance import (
    AssuranceOutcome,
    MaturityLevel,
    UncertaintyRecord,
    ValidationRecord,
    VerificationRecord,
    VerificationStatus,
    derive_maturity,
    ladder_for,
    scan_text,
)
from app.engineering.assurance.checks import (
    AssuranceCheck,
    AssuranceReport,
    CheckSeverity,
    CheckStage,
    CheckStatus,
)
from app.engineering.assurance.evidence import (
    EvidenceRecord,
    ProvenanceEntry,
    SourceType,
)
from app.schemas.common import ComponentType
from app.services.report_service import (
    STANDING_LIMITATIONS,
    build_evidence_manifest,
    render_markdown,
)


def _outcome() -> AssuranceOutcome:
    """An outcome shaped like a real one: mostly passing, one genuine gap."""
    pre = AssuranceReport(
        stage=CheckStage.PRE_SOLVER,
        checks=[
            AssuranceCheck(
                check_id="unit_consistency",
                stage=CheckStage.PRE_SOLVER,
                title="Unit consistency",
                description="Every quantity converts to canonical SI.",
                status=CheckStatus.PASSED,
                measured=4.0,
                detail="4 quantities converted.",
            ),
            AssuranceCheck(
                check_id="interface_invariance",
                stage=CheckStage.PRE_SOLVER,
                title="Preserved interface invariance",
                description="Protected interfaces hold.",
                status=CheckStatus.PASSED,
                measured=0.0,
                threshold=1.0e-3,
                unit="m",
                detail="3 interfaces held.",
            ),
        ],
    )
    post = AssuranceReport(
        stage=CheckStage.POST_SOLVER,
        checks=[
            AssuranceCheck(
                check_id="load_balance",
                stage=CheckStage.POST_SOLVER,
                title="Load and reaction balance",
                description="Each load integrates back.",
                status=CheckStatus.PASSED,
                measured=0.0004,
                threshold=0.02,
                detail="1 load verified.",
            ),
            AssuranceCheck(
                check_id="mesh_convergence",
                stage=CheckStage.POST_SOLVER,
                title="Mesh convergence",
                description="The decision metric is mesh-independent.",
                status=CheckStatus.NOT_RUN,
                severity=CheckSeverity.BLOCKING,
                detail="This candidate was not re-solved on a refined mesh.",
            ),
        ],
    )

    verification = VerificationRecord(
        status=VerificationStatus.UNVERIFIED,
        benchmark_id="cantilever_beam_linear_static",
        pre_solver=pre,
        post_solver=post,
        unit_check_passed=True,
        interface_invariance_passed=True,
        load_balance_passed=True,
        mesh_convergence_passed=None,
        reaction_balance_error=0.0004,
        evidence_gaps=["Mesh convergence: not re-solved on a refined mesh."],
    )

    evidence = EvidenceRecord(
        requirement_revision="a46c2571e4f21119",
        geometry_hash="g" * 32,
        material_snapshot_hash="m" * 32,
        load_case_hash="l" * 32,
        mesh_hash="h" * 32,
        solver_input_hash="s" * 32,
        solver_name="scikit-fem linear elasticity",
        solver_version="12.0.2",
        generator_version="1.0.0",
        provenance=[
            ProvenanceEntry(
                key="material.primary",
                label="A356-T6 cast aluminium alloy (primary)",
                value=7.1e10,
                unit="Pa",
                source_type=SourceType.LITERATURE,
                revision="1.0",
                confirmed=False,
                note="Illustrative handbook-class value, not supplier-certified.",
            ),
            ProvenanceEntry(
                key="assumption.radial_load_demo_fixture",
                label="The 15 kN radial load is a demonstration fixture.",
                source_type=SourceType.DEMO_ASSUMPTION,
                confirmed=False,
            ),
        ],
    )

    maturity = derive_maturity(
        geometry_valid=True,
        solver_completed=True,
        results_parsed=True,
        constraints_evaluated=True,
        verification_passed=None,
        benchmark_passed=True,
        balance_closed=True,
        mesh_converged=None,
        intended_use_domain="Comparative structural screening only. Ladder rung W1.",
        last_evidence_date="2026-11-03",
    )

    ladder = ladder_for(ComponentType.ALLOY_WHEEL)
    return AssuranceOutcome(
        verification=verification,
        validation=ValidationRecord(),
        uncertainty=UncertaintyRecord(solver_residual=4.2e-9),
        maturity=maturity,
        evidence=evidence,
        ladder_level="W1",
        ladder_release_label=ladder.rungs[1].release_label,
        ladder_next_gap=f"W2 is not attained: {ladder.rungs[2].gap}",
        fidelity_level="F2",
    )


def _report() -> dict:
    outcome = _outcome()
    ladder = ladder_for(ComponentType.ALLOY_WHEEL)
    from app.engineering.assurance import FIDELITY_LADDER, PROHIBITED_CLAIM_STATEMENTS

    per_candidate = [
        {
            "candidate_id": "cand_abc",
            "index": 3,
            "is_recommended": True,
            "maturity": outcome.maturity.model_dump(mode="json"),
            "verification": outcome.verification.model_dump(mode="json"),
            "validation": outcome.validation.model_dump(mode="json"),
            "uncertainty": outcome.uncertainty.model_dump(mode="json"),
            "evidence": outcome.evidence.model_dump(mode="json"),
        }
    ]

    return {
        "report_version": "1.0",
        "generated_at": "2026-11-03T12:00:00+00:00",
        "title": "Alloy wheel generative design study",
        "study": {
            "optimization_run_id": "opt_test",
            "algorithm": "nsga2",
            "random_seed": 20261102,
        },
        "component": {
            "type": "alloy_wheel",
            "display_name": "Alloy wheel",
            "name": "front wheel",
            "design_mode": "generate_new",
        },
        "standing_limitations": STANDING_LIMITATIONS,
        "assumptions": [],
        # The renderer reads these for its other sections. Present so the
        # document renders exactly as it would for a real study.
        "candidates": [
            {
                "candidate_id": "cand_abc",
                "index": 3,
                "generation": 1,
                "label": "Candidate 3",
                "status": "feasible",
                "is_baseline": False,
                "is_feasible": True,
                "rank": 1,
                "pareto_front": 0,
                "parameters": {"spoke_count": 7.0},
                "geometry_hash": "g" * 32,
                "metrics": {
                    "mass_kg": {"value": 8.42, "unit": "kg"},
                    "max_von_mises_pa": {"value": 180.0, "unit": "MPa"},
                },
                "constraint_results": [],
                "infeasibility_reasons": [],
                "failure_stage": None,
                "failure_reason": None,
                "warnings": [],
                "solve_time_seconds": 78.2,
                "mesh_node_count": 4754,
                "step_artifact": "designs/d1/design.step",
                "preview_artifact": "designs/d1/preview.glb",
            }
        ],
        "constraints": [],
        "objectives": [],
        "scope": {
            "analysis_type": "linear_static_structural",
            "scope_statement": "Comparative structural screening.",
            "not_in_scope": ["Fatigue life."],
            "geometry_capability_note": "Parametric wheel template.",
            "solver": {
                "solver_id": "skfem_structural",
                "name": "scikit-fem linear elasticity",
                "version": "12.0.2",
                "result_kind": "linear_static",
                "method_statement": "Linear static small-strain elasticity.",
            },
        },
        "solver_verification": {"benchmarks": [], "all_passed": None, "note": ""},
        "mesh_convergence": {},
        "baseline_vs_recommended": {},
        "narrative": {
            "headline": "Candidate 3 reduced mass by 12% while holding peak stress at 180 MPa.",
            "paragraphs": ["Peak von Mises stress reached 180 MPa."],
            "caveats": ["Physical testing is still required."],
        },
        "recommended_design": {
            "step_artifact": "designs/d1/design.step",
            "next_steps": ["Build and physically test the selected design."],
        },
        "assurance": {
            "note": "Every verdict was produced from a measurement.",
            "validation_ladder": {
                "title": ladder.title,
                "attained_level": ladder.attained_level,
                "rungs": [r.model_dump(mode="json") for r in ladder.rungs],
            },
            "fidelity_ladder": [r.model_dump(mode="json") for r in FIDELITY_LADDER],
            "claims_this_report_does_not_make": PROHIBITED_CLAIM_STATEMENTS,
            "per_candidate": per_candidate,
            "recommended_design": {
                "candidate_id": "cand_abc",
                "maturity_level": outcome.maturity.level.value,
                "maturity_statement": outcome.maturity.statement,
                "intended_use_domain": outcome.maturity.intended_use_domain,
                "last_evidence_date": outcome.maturity.last_evidence_date,
                "verification_status": outcome.verification.status.value,
                "validation_status": outcome.validation.status.value,
                "blocked_from": outcome.maturity.blocked_from.value,
                "blocking_reasons": outcome.maturity.blocking_reasons,
                "unresolved_limitations": outcome.maturity.unresolved_limitations,
                "prohibited_at_this_level": outcome.maturity.prohibited_claims,
                "evidence_gaps": outcome.verification.evidence_gaps,
                "ladder_level": outcome.ladder_level,
                "ladder_next_gap": outcome.ladder_next_gap,
                "fidelity_level": outcome.fidelity_level,
            },
        },
    }


class TestMarkdownRendering:
    def test_maturity_section_is_rendered(self):
        md = render_markdown(_report())
        assert "## Evidence and model maturity" in md
        assert "Simulation-evaluated candidate (Level 1)" in md
        assert "**Physical validation:** not_available" in md
        assert "Validation ladder:** W1" in md

    def test_the_gap_to_the_next_level_is_stated(self):
        md = render_markdown(_report())
        assert "Why this is not yet `numerically_verified`" in md
        assert "mesh-refinement study" in md

    def test_a_check_that_did_not_run_is_not_shown_as_a_pass(self):
        md = render_markdown(_report())
        assert "### Checks that produced no evidence" in md
        # The check table must carry its real status.
        assert "| Mesh convergence | `not_run` |" in md
        assert "| Load and reaction balance | `passed` |" in md

    def test_evidence_hashes_and_the_staleness_rule_appear(self):
        md = render_markdown(_report())
        assert "### Evidence record" in md
        assert "requirement revision:** `a46c2571e4f21119`" in md
        assert "becomes stale" in md

    def test_provenance_marks_an_unconfirmed_demo_assumption(self):
        md = render_markdown(_report())
        assert "### Input provenance" in md
        assert "`demo_assumption`" in md
        assert "`literature`" in md

    def test_the_ladder_shows_unattained_rungs_with_their_gaps(self):
        md = render_markdown(_report())
        assert "| **W4** |" in md
        assert "no load spectrum" in md

    def test_prohibited_claims_are_listed(self):
        md = render_markdown(_report())
        assert "## Claims this report does not make" in md
        assert "Fatigue life validated" in md

    def test_the_narrative_itself_makes_no_prohibited_claim(self):
        """The guard applies to generated prose, not to the deliberate list.

        The "claims this report does not make" section quotes the forbidden
        phrases on purpose, so the scan is applied to the narrative - which is
        the part a model wrote - rather than to the whole document.
        """
        report = _report()
        narrative = report["narrative"]
        prose = "\n".join(
            [narrative["headline"], *narrative["paragraphs"], *narrative["caveats"]]
        )
        assert scan_text(prose, maturity=MaturityLevel.SIMULATION_EVALUATED) == []


class TestEvidenceManifest:
    def test_manifest_carries_the_full_input_identity(self):
        manifest = build_evidence_manifest(_report())
        identity = manifest["identity"]
        for key in (
            "requirement_revision",
            "geometry_hash",
            "material_snapshot_hash",
            "load_case_hash",
            "mesh_hash",
            "solver_input_hash",
            "solver_version",
            "generator_version",
        ):
            assert identity[key], f"{key} is missing from the manifest"
        assert "stale" in identity["staleness_rule"]

    def test_manifest_states_the_maturity_and_what_blocks_the_next_level(self):
        manifest = build_evidence_manifest(_report())
        assert manifest["maturity"]["level"] == "simulation_evaluated"
        assert manifest["maturity"]["blocked_from"] == "numerically_verified"
        assert manifest["maturity"]["blocking_reasons"]
        assert "No language model" in manifest["maturity"]["derivation"]

    def test_manifest_keeps_the_unrun_check_as_unrun(self):
        manifest = build_evidence_manifest(_report())
        statuses = {c["check_id"]: c["status"] for c in manifest["verification"]["checks"]}
        assert statuses["mesh_convergence"] == "not_run"
        assert statuses["load_balance"] == "passed"
        assert manifest["verification"]["evidence_gaps"]

    def test_manifest_validation_is_not_available_not_passed(self):
        manifest = build_evidence_manifest(_report())
        assert manifest["validation"]["status"] == "not_available"

    def test_manifest_lists_prohibited_claims_and_the_ladder(self):
        manifest = build_evidence_manifest(_report())
        assert "Fatigue life validated" in manifest["prohibited_claims"]
        assert manifest["validation_ladder"]["attained_level"] == "W1"
        assert manifest["fidelity_level"] == "F2"

    def test_manifest_is_json_serialisable(self):
        """It is written to disk and read by other systems, so it must round-trip."""
        manifest = build_evidence_manifest(_report())
        restored = json.loads(json.dumps(manifest, default=str))
        assert restored["study"]["optimization_run_id"] == "opt_test"
        assert restored["provenance"]

    def test_manifest_survives_a_report_with_no_assurance_section(self):
        """An older study has no assurance data, and that must not crash."""
        report = _report()
        report.pop("assurance")
        manifest = build_evidence_manifest(report)
        assert manifest["maturity"]["level"] is None
        assert manifest["verification"]["checks"] == []
