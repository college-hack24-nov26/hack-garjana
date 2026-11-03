"""The assurance service: run the gates, record the verdicts, derive the level.

This is the only component permitted to decide that a result is verified, and
the only component permitted to say what maturity level it has reached. It does
both by reading measurements, never by being told.

The flow the pipeline follows is:

    pre_solver(...)   -> may stop the candidate before a solve is spent
    post_solver(...)  -> decides whether the result is numerically verified
    assess(...)       -> derives the maturity level from both reports

:class:`VerificationRecord` and :class:`ValidationRecord` are the two halves
the dossiers insist on keeping separate. Verification asks "did we solve the
equations right"; validation asks "are these the right equations for the real
part". The platform can answer the first. It cannot answer the second, so
validation defaults to ``NOT_AVAILABLE`` and there is no code path that moves
it to ``PASSED`` without a physical dataset being supplied.
"""
from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from app.engineering.assurance.benchmark_evidence import benchmark_id
from app.engineering.assurance.checks import (
    AssuranceCheck,
    AssuranceReport,
    CheckStage,
    CheckStatus,
)
from app.engineering.assurance.evidence import EvidenceRecord
from app.engineering.assurance.gates import (
    post_solver_checks,
    pre_solver_input_checks,
    pre_solver_mesh_checks,
)
from app.engineering.assurance.ladders import (
    FIDELITY_OF_ANALYSIS,
    ladder_for,
)
from app.engineering.assurance.maturity import (
    MaturityAssessment,
    MaturityLevel,
    derive_maturity,
)
from app.engineering.cad.base import GeneratedGeometry
from app.engineering.materials.catalog import MaterialRecord
from app.engineering.meshing.gmsh_runner import MeshResult
from app.engineering.solvers.base import SimulationResult
from app.schemas.common import ComponentType
from app.schemas.engineering import EngineeringSpecification, LoadCase


class VerificationStatus(str, Enum):
    VERIFIED = "verified"
    UNVERIFIED = "unverified"
    FAILED = "failed"


class ValidationStatus(str, Enum):
    """Physical validation. ``NOT_AVAILABLE`` is the honest default."""

    PASSED = "passed"
    FAILED = "failed"
    #: The only physical data on hand was consumed by calibration, so it cannot
    #: also serve as independent validation. Seeded failure case F09.
    CALIBRATION_ONLY = "calibration_only"
    NOT_RUN = "not_run"
    NOT_AVAILABLE = "not_available"


class VerificationRecord(BaseModel):
    """Did the numerics hold? Every check, and the verdict they produce."""

    status: VerificationStatus
    benchmark_id: Optional[str] = None
    pre_solver: AssuranceReport
    post_solver: Optional[AssuranceReport] = None

    #: Named verdicts, kept flat for the UI and the report.
    unit_check_passed: Optional[bool] = None
    geometry_integrity_passed: Optional[bool] = None
    interface_invariance_passed: Optional[bool] = None
    region_mapping_passed: Optional[bool] = None
    mesh_quality_passed: Optional[bool] = None
    load_balance_passed: Optional[bool] = None
    energy_balance_passed: Optional[bool] = None
    benchmark_passed: Optional[bool] = None
    mesh_convergence_passed: Optional[bool] = None
    #: The four-state status from the research evidence schema:
    #: not_run | passed | failed | inconclusive. ``inconclusive`` means the
    #: decision quantity converged but a region-specific metric did not, and
    #: it is deliberately distinct from both a pass and a failure.
    mesh_convergence_status: str = "not_run"

    reaction_balance_error: Optional[float] = None
    energy_balance_error: Optional[float] = None

    warnings: list[str] = Field(default_factory=list)
    #: Checks that ran and found a problem.
    blocking_failures: list[str] = Field(default_factory=list)
    #: Checks that produced no evidence. These block verification without
    #: being failures, and are listed separately so the difference is visible.
    evidence_gaps: list[str] = Field(default_factory=list)

    @property
    def all_checks(self) -> list[AssuranceCheck]:
        return list(self.pre_solver.checks) + list(
            self.post_solver.checks if self.post_solver else []
        )


class ValidationRecord(BaseModel):
    """Has this been compared against a real measurement? Normally: no."""

    status: ValidationStatus = ValidationStatus.NOT_AVAILABLE
    dataset_id: Optional[str] = None
    #: What the comparison was against, when there was one.
    measurement_basis: Optional[str] = None
    predicted: Optional[float] = None
    measured: Optional[float] = None
    measurement_uncertainty: Optional[float] = None
    relative_error: Optional[float] = None
    unit: Optional[str] = None
    #: True when the dataset used here was also used to calibrate the model,
    #: which disqualifies it as independent validation.
    dataset_used_for_calibration: bool = False
    statement: str = (
        "No physical measurement has been compared against this prediction. "
        "Physical validation status is not available, which is distinct from "
        "having been validated and distinct from having failed."
    )


class UncertaintyRecord(BaseModel):
    """What is known about how wrong the numbers might be.

    Numerical error, model discrepancy and measurement uncertainty are three
    different things and are not summed into one confidence score. A field left
    ``None`` means nobody quantified that source, and the UI says so.
    """

    numerical_error_sources: list[str] = Field(default_factory=list)
    #: Relative solver residual achieved, where recorded.
    solver_residual: Optional[float] = None
    #: Movement in the decision metric between screening and refined meshes.
    discretization_sensitivity: Optional[float] = None
    #: Difference between model and reality. Unquantifiable without test data.
    model_discrepancy: Optional[float] = None
    measurement_uncertainty: Optional[float] = None
    stated_prediction_interval: Optional[str] = None
    note: str = (
        "Numerical error is bounded by the recorded residual and the mesh "
        "sensitivity. Model discrepancy against a physical part is not "
        "quantified, because no physical measurement exists for this model."
    )


class AssuranceOutcome(BaseModel):
    """Everything the assurance plane produced for one result."""

    verification: VerificationRecord
    validation: ValidationRecord
    uncertainty: UncertaintyRecord
    maturity: MaturityAssessment
    evidence: Optional[EvidenceRecord] = None
    #: Which rung of the component ladder this analysis sits on.
    ladder_level: Optional[str] = None
    ladder_release_label: Optional[str] = None
    ladder_next_gap: Optional[str] = None
    fidelity_level: Optional[str] = None


# ----------------------------------------------------------------- the stages


def pre_solver(
    *,
    spec: EngineeringSpecification,
    geometry: GeneratedGeometry,
    materials: dict[str, MaterialRecord],
    case: LoadCase,
    mesh: Optional[MeshResult] = None,
) -> AssuranceReport:
    """Run the pre-solver gate. With ``mesh``, the mesh checks run too."""
    report = pre_solver_input_checks(
        spec=spec, geometry=geometry, materials=materials, case=case
    )
    if mesh is not None:
        report = AssuranceReport(
            stage=CheckStage.PRE_SOLVER,
            checks=report.checks
            + pre_solver_mesh_checks(geometry=geometry, mesh=mesh).checks,
        )
    return report


def post_solver(
    *,
    result: SimulationResult,
    spec: EngineeringSpecification,
    mesh_convergence: Optional[dict] = None,
) -> AssuranceReport:
    """Run the post-solver gate on a returned result."""
    return post_solver_checks(
        result=result, spec=spec, mesh_convergence=mesh_convergence
    )


def _verdict(report: Optional[AssuranceReport], check_id: str) -> Optional[bool]:
    """``True``/``False``/``None`` for one named check.

    ``None`` is returned both when the check is absent and when it did not run,
    because those are the same fact: no evidence. ``NOT_APPLICABLE`` returns
    ``True`` - a structural run has no thermal boundary to get wrong, and
    treating that as missing evidence would permanently block verification for
    every structural result.
    """
    if report is None:
        return None
    check = report.by_id(check_id)
    if check is None or check.status is CheckStatus.NOT_RUN:
        return None
    if check.status is CheckStatus.NOT_APPLICABLE:
        return True
    if check.status is CheckStatus.WARNING:
        return None
    return check.status is CheckStatus.PASSED


def _mesh_convergence_status(post: Optional[AssuranceReport]) -> str:
    """Collapse the two convergence checks into the schema's four states.

    ``inconclusive`` is a state in its own right, not a softened failure: the
    decision quantity held still, a region-specific metric did not, and the
    study therefore cannot be called converged outright while the quantity
    that decided feasibility is sound.
    """
    if post is None:
        return "not_run"
    decision = post.by_id("mesh_convergence")
    if decision is None or decision.status is CheckStatus.NOT_RUN:
        return "not_run"
    if decision.status is CheckStatus.FAILED:
        return "failed"
    region = post.by_id("mesh_convergence_region_metrics")
    if region is not None and region.status is CheckStatus.WARNING:
        return "inconclusive"
    return "passed"


def build_verification_record(
    *,
    spec: EngineeringSpecification,
    pre: AssuranceReport,
    post: Optional[AssuranceReport],
) -> VerificationRecord:
    """Collapse the two reports into one verification verdict.

    The verdict is ``VERIFIED`` only when both gates passed every blocking
    check. If the post-solver gate has not run at all, the status is
    ``UNVERIFIED`` - never ``VERIFIED`` by omission.
    """
    reports = [pre] + ([post] if post is not None else [])
    blocking = [
        c.title + ": " + c.detail for r in reports for c in r.blocking_failures
    ]
    gaps = [c.title + ": " + c.detail for r in reports for c in r.blocking_gaps]
    warnings = [c.title + ": " + c.detail for r in reports for c in r.warnings]

    # Three outcomes, and the middle one is the one that matters. A check that
    # found a problem makes this FAILED. A check that produced no evidence
    # leaves it UNVERIFIED - not verified, but not a failure either. Only a
    # complete set of passes in both stages is VERIFIED.
    if blocking:
        status = VerificationStatus.FAILED
    elif post is not None and pre.gate_passed and post.gate_passed:
        status = VerificationStatus.VERIFIED
    else:
        status = VerificationStatus.UNVERIFIED

    balance = post.by_id("load_balance") if post else None
    convergence_status = _mesh_convergence_status(post)
    energy = post.by_id("energy_balance") if post else None

    return VerificationRecord(
        status=status,
        benchmark_id=benchmark_id(spec.analysis_type),
        pre_solver=pre,
        post_solver=post,
        unit_check_passed=_verdict(pre, "unit_consistency"),
        geometry_integrity_passed=_verdict(pre, "geometry_integrity"),
        interface_invariance_passed=_verdict(pre, "interface_invariance"),
        region_mapping_passed=_verdict(pre, "semantic_region_mapping"),
        mesh_quality_passed=_verdict(pre, "mesh_quality"),
        load_balance_passed=_verdict(post, "load_balance"),
        energy_balance_passed=_verdict(post, "energy_balance"),
        benchmark_passed=_verdict(post, "benchmark_verification"),
        mesh_convergence_passed=_verdict(post, "mesh_convergence"),
        mesh_convergence_status=convergence_status,
        reaction_balance_error=balance.measured if balance else None,
        energy_balance_error=energy.measured if energy else None,
        warnings=warnings,
        blocking_failures=blocking,
        evidence_gaps=gaps,
    )


def assess(
    *,
    spec: EngineeringSpecification,
    component_type: ComponentType,
    pre: AssuranceReport,
    post: Optional[AssuranceReport] = None,
    result: Optional[SimulationResult] = None,
    evidence: Optional[EvidenceRecord] = None,
    validation: Optional[ValidationRecord] = None,
    geometry_valid: bool = True,
    constraints_evaluated: bool = False,
    extra_limitations: Optional[list[str]] = None,
) -> AssuranceOutcome:
    """Derive the full assurance outcome, including the maturity level."""
    verification = build_verification_record(spec=spec, pre=pre, post=post)
    validation = validation or ValidationRecord()

    ladder = ladder_for(component_type)
    rung = ladder.attained_rung
    next_rung = ladder.next_rung

    # Everything the maturity derivation needs, and nothing it may infer.
    field_ok = _verdict(post, "result_field_integrity")
    metric_ok = _verdict(post, "decision_metric_present")
    results_parsed = bool(field_ok) and bool(metric_ok)

    limitations: list[str] = list(extra_limitations or [])
    limitations.extend(verification.warnings)
    if next_rung is not None and next_rung.gap:
        limitations.append(f"{next_rung.level} not attained: {next_rung.gap}")
    if validation.status is not ValidationStatus.PASSED:
        limitations.append(validation.statement)

    residual = (result.linear_solver_report or {}).get("relative_residual") if result else None
    convergence = post.by_id("mesh_convergence") if post else None

    # An inconclusive refinement study is not a blocking failure, but it is a
    # standing limitation and must travel with the result rather than being
    # dropped because the decision quantity happened to converge.
    region = post.by_id("mesh_convergence_region_metrics") if post else None
    if region is not None and region.status is CheckStatus.WARNING:
        limitations.append(
            "Mesh convergence is inconclusive: the decision quantity converged "
            "but a region-specific metric did not. " + region.detail
        )

    maturity = derive_maturity(
        geometry_valid=geometry_valid,
        solver_completed=result is not None,
        results_parsed=results_parsed,
        constraints_evaluated=constraints_evaluated,
        verification_passed=(
            True
            if verification.status is VerificationStatus.VERIFIED
            else False
            if verification.status is VerificationStatus.FAILED
            else None
        ),
        benchmark_passed=verification.benchmark_passed,
        balance_closed=_combine(
            verification.load_balance_passed, verification.energy_balance_passed
        ),
        mesh_converged=verification.mesh_convergence_passed,
        validation_status=validation.status.value,
        intended_use_domain=_intended_use_domain(component_type, rung.level if rung else None),
        limitations=limitations,
        last_evidence_date=(
            evidence.recorded_at[:10] if evidence else date.today().isoformat()
        ),
    )

    uncertainty = UncertaintyRecord(
        numerical_error_sources=[
            s
            for s in (
                "finite-element discretisation",
                "iterative linear solve residual" if residual is not None else None,
                "nodal projection of element-wise stress"
                if spec.analysis_type.value == "linear_static_structural"
                else None,
            )
            if s
        ],
        solver_residual=float(residual) if residual is not None else None,
        discretization_sensitivity=(
            convergence.threshold if convergence and convergence.measured else None
        ),
    )

    return AssuranceOutcome(
        verification=verification,
        validation=validation,
        uncertainty=uncertainty,
        maturity=maturity,
        evidence=evidence,
        ladder_level=rung.level if rung else None,
        ladder_release_label=rung.release_label if rung else None,
        ladder_next_gap=(
            f"{next_rung.level} ({next_rung.capability}) is not attained: {next_rung.gap}"
            if next_rung and next_rung.gap
            else None
        ),
        fidelity_level=FIDELITY_OF_ANALYSIS.get(spec.analysis_type),
    )


def _combine(*verdicts: Optional[bool]) -> Optional[bool]:
    """Combine several verdicts conservatively.

    Any ``False`` makes the whole thing ``False``. Otherwise any ``None``
    makes it ``None``, because a group of checks where one produced no evidence
    has not collectively passed. Only an all-``True`` group is ``True``.
    """
    if any(v is False for v in verdicts):
        return False
    if any(v is None for v in verdicts):
        return None
    return True


def _intended_use_domain(component_type: ComponentType, rung: Optional[str]) -> str:
    """The domain this component's analysis may be used in, stated per rung."""
    base = {
        ComponentType.ALLOY_WHEEL: (
            "Comparative structural screening of wheel geometries under one "
            "declared quasi-static load case, with the hub interface fixed. Not a "
            "radial or cornering fatigue test configuration."
        ),
        ComponentType.BRAKE_CALIPER: (
            "Comparative structural screening of caliper body geometries under a "
            "declared equivalent clamping load at the mounting condition stated. "
            "Isothermal, with no contact mechanics and no disc interaction."
        ),
        ComponentType.SPARK_PLUG: (
            "Comparative thermal screening of firing-end geometries under a "
            "declared convective boundary condition. Not an engine operating "
            "point, and not a combustion-coupled heat flux."
        ),
    }[component_type]
    return f"{base} Ladder rung {rung}." if rung else base
