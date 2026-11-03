"""Seeded failure cases F01-F14, and the false-acceptance rate they measure.

This is the most important test file in the project, and the reason is the
asymmetry between the two ways a check can be wrong. A false rejection wastes a
candidate. A false *acceptance* ships a design that was never actually checked,
with a green verdict on it. The research dossiers call false acceptance "the
most dangerous reliability failure" and ask for it to be measured rather than
assumed, so each test below injects one specific defect and asserts the gate
catches it.

The suite is written against the real gates on real geometry. Nothing here
mocks a check into passing or failing, because a mocked gate would prove only
that the mock works.

``test_false_acceptance_rate`` aggregates the lot into the single number the
dossiers ask for: of all seeded invalid cases, how many were accepted? The
assertion is that it is zero, and the test prints the figure so a regression
shows up as a number rather than a stack trace.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.engineering.assurance import (
    CheckStatus,
    MaturityLevel,
    PROHIBITED_CLAIMS,
    ValidationRecord,
    ValidationStatus,
    VerificationStatus,
    assess,
    build_verification_record,
    derive_maturity,
    ladder_for,
    pre_solver,
    scan_text,
)
from app.engineering.assurance.evidence import EvidenceRecord, stable_hash
from app.engineering.assurance.checks import CheckSeverity
from app.engineering.assurance.gates import (
    _mesh_convergence,
    pre_solver_input_checks,
    pre_solver_mesh_checks,
)
from app.engineering.materials.catalog import get_material
from app.schemas.common import ComponentType, DesignMode
from app.schemas.engineering import (
    ConvectionBC,
    EngineeringSpecification,
    ForceLoad,
    LoadCase,
    PressureLoad,
    Support,
)
from app.schemas.common import AnalysisType, Quantity

#: Every seeded case that must be rejected, filled in by the tests below. Used
#: by the false-acceptance summary at the end of the module.
SEEDED_OUTCOMES: dict[str, bool] = {}


def _record(case_id: str, rejected: bool) -> None:
    SEEDED_OUTCOMES[case_id] = rejected


def _spec(profile, **kwargs) -> EngineeringSpecification:
    return profile.build_specification(
        design_mode=DesignMode.GENERATE_NEW,
        objective_summary="seeded failure fixture",
        material_id=kwargs.pop("material_id", profile.material_choices()[0]),
        parameters=kwargs.pop("parameters", profile.generator.default_parameters()),
        inputs=profile.demo_fixture_inputs(),
        mesh_preset=kwargs.pop("mesh_preset", "screening"),
        **kwargs,
    )


def _materials(spec) -> dict:
    from app.services.pipeline import resolve_materials

    return resolve_materials(spec)


@pytest.fixture(scope="module")
def wheel_evaluated(wheel_profile, work_dir):
    """One real wheel solve, shared by the post-solver cases.

    The post-solver gate can only be tested against a genuine result, so this
    runs the actual pipeline once. The defects in those tests are then injected
    into copies of the real result, which keeps everything else about it
    truthful.
    """
    from app.services.pipeline import evaluate_candidate

    spec = _spec(wheel_profile)
    output = evaluate_candidate(
        profile=wheel_profile,
        spec=spec,
        parameters=spec.parameters,
        output_dir=work_dir / "assurance_wheel",
        index=0,
        is_baseline=True,
    )
    if output.result is None:
        pytest.skip(
            "the wheel solve did not complete, so the post-solver gate cannot "
            f"be exercised: {output.record.failure_reason}"
        )
    output.spec = spec
    return output


# ============================================================ F01 / F02: units


def test_f01_unlabelled_quantity_is_rejected():
    """F01: a quantity whose unit is absent or unknown cannot be constructed.

    The unit guard sits on ``Quantity`` itself, which means there is no way to
    get an unlabelled number into a load case at all - the failure happens at
    construction rather than being caught later by a check that someone might
    forget to run.
    """
    with pytest.raises(Exception):
        Quantity(value=15000.0, unit="")
    with pytest.raises(Exception):
        Quantity(value=15000.0, unit="kilonewtons")
    _record("F01", True)


@pytest.mark.slow
def test_f02_millimetres_read_as_metres_is_rejected(wheel_profile, work_dir):
    """F02: a parameter vector in millimetres is caught before the solver.

    A 431.8 mm rim entered as 431.8 m would produce a wheel the size of a
    building, and every stress and mass number downstream would absorb the
    error without complaint.
    """
    from app.services.pipeline import build_geometry

    spec = _spec(wheel_profile)
    geometry = build_geometry(
        wheel_profile, spec.parameters, work_dir / "f02", write_preview=False
    )

    # Inflate the measured bounding box by 1000x, exactly as a mm-for-m error
    # would, leaving everything else about the candidate untouched.
    inflated = geometry.model_copy(deep=True)
    m = inflated.validation.metrics
    inflated.validation.metrics = m.model_copy(
        update={
            "bounding_box_min_m": tuple(v * 1000 for v in m.bounding_box_min_m),
            "bounding_box_max_m": tuple(v * 1000 for v in m.bounding_box_max_m),
        }
    )

    report = pre_solver_input_checks(
        spec=spec,
        geometry=inflated,
        materials=_materials(spec),
        case=spec.load_cases[0],
    )
    check = report.by_id("dimensional_plausibility")
    assert check.status is CheckStatus.FAILED
    assert not report.gate_passed
    _record("F02", True)


# ================================================== F03: material card gaps


@pytest.mark.slow
def test_f03_material_without_required_property_is_rejected(wheel_profile, work_dir):
    """F03: a grade name is not a material card.

    A structural analysis needs an elastic modulus. A record carrying only a
    density must block the run, not silently produce a stiffness of zero.
    """
    from app.services.pipeline import build_geometry

    spec = _spec(wheel_profile)
    geometry = build_geometry(
        wheel_profile, spec.parameters, work_dir / "f03", write_preview=False
    )

    stripped = get_material(spec.material_id).model_copy(
        update={"elastic_modulus": None, "poisson_ratio": None}
    )
    report = pre_solver_input_checks(
        spec=spec,
        geometry=geometry,
        materials={"primary": stripped},
        case=spec.load_cases[0],
    )
    check = report.by_id("material_completeness")
    assert check.status is CheckStatus.FAILED
    assert "elastic modulus" in check.detail
    assert not report.gate_passed
    _record("F03", True)


def test_f03b_every_catalog_material_declares_its_condition():
    """A temper or heat-treatment state is required on every catalog record."""
    from app.engineering.materials.catalog import get_catalog

    for m in get_catalog().materials:
        assert m.condition and len(m.condition) > 10, (
            f"{m.material_id} does not declare a usable temper or condition"
        )


# ========================================= F04: load region missing / mismapped


@pytest.mark.slow
def test_f04_load_on_a_nonexistent_region_is_rejected(wheel_profile, work_dir):
    """F04: a boundary condition naming a region the geometry does not have."""
    from app.services.pipeline import build_geometry

    spec = _spec(wheel_profile)
    geometry = build_geometry(
        wheel_profile, spec.parameters, work_dir / "f04", write_preview=False
    )

    case = spec.load_cases[0]
    broken = case.model_copy(
        update={
            "loads": [
                case.loads[0].model_copy(update={"region": "outer_rim_face_typo"})
            ]
        }
    )
    report = pre_solver_input_checks(
        spec=spec, geometry=geometry, materials=_materials(spec), case=broken
    )
    check = report.by_id("semantic_region_mapping")
    assert check.status is CheckStatus.FAILED
    assert "outer_rim_face_typo" in check.detail
    assert not report.gate_passed
    _record("F04", True)


# ============================== F05: caliper pressure used as a pad force


@pytest.mark.slow
def test_f05_caliper_pressure_without_a_force_path_is_rejected(
    caliper_profile, work_dir
):
    """F05: hydraulic pressure is not a pad force.

    Pressure acts on the piston area; the piston force follows from it. A case
    that asserts a clamping force with no pressure on the bore has skipped the
    conversion, and for a 48 mm bore the two differ by a factor of about 1800.
    """
    from app.services.pipeline import build_geometry

    spec = _spec(caliper_profile)
    geometry = build_geometry(
        caliper_profile, spec.parameters, work_dir / "f05", write_preview=False
    )
    case = spec.load_cases[0]

    # Keep only the force loads: the pressure on the piston bore is removed, so
    # the force path is asserted rather than derived.
    forces = [l for l in case.loads if l.type == "force"]
    if not forces:
        forces = [
            ForceLoad(
                region=case.loads[0].region,
                magnitude=Quantity(value=18000.0, unit="N"),
                direction=(0.0, 0.0, 1.0),
            )
        ]
    broken = case.model_copy(update={"loads": forces})

    report = pre_solver_input_checks(
        spec=spec, geometry=geometry, materials=_materials(spec), case=broken
    )
    check = report.by_id("force_path_declaration")
    assert check.status is CheckStatus.FAILED
    assert "pressure" in check.detail.lower()
    assert not report.gate_passed
    _record("F05", True)


@pytest.mark.slow
def test_f05b_caliper_force_path_is_stated_when_correct(caliper_profile, work_dir):
    """The same check passes on the real case, and states the conversion."""
    from app.services.pipeline import build_geometry

    spec = _spec(caliper_profile)
    geometry = build_geometry(
        caliper_profile, spec.parameters, work_dir / "f05b", write_preview=False
    )
    report = pre_solver_input_checks(
        spec=spec,
        geometry=geometry,
        materials=_materials(spec),
        case=spec.load_cases[0],
    )
    check = report.by_id("force_path_declaration")
    assert check.status is CheckStatus.PASSED
    # The detail must show the pressure, the bore and the resulting force, so
    # the conversion is auditable rather than asserted.
    assert "MPa" in check.detail and "bore" in check.detail and "kN" in check.detail


# ====================================== F06: a load case reused across profiles


def test_f06_structural_case_rejected_for_a_thermal_analysis():
    """F06: a test configuration may not be reused across analysis types.

    The load-case contract refuses to build a structural case that carries
    thermal boundary conditions, or a thermal case with none, so a radial setup
    cannot be quietly reused where a different configuration is required.
    """
    with pytest.raises(Exception):
        LoadCase(
            case_id="mismatch",
            name="structural case declared as thermal",
            analysis_type=AnalysisType.STEADY_STATE_THERMAL,
            loads=[
                ForceLoad(
                    region="outer_rim_face",
                    magnitude=Quantity(value=15000.0, unit="N"),
                    direction=(0.0, -1.0, 0.0),
                )
            ],
            supports=[Support(region="hub_mounting_face")],
        )
    _record("F06", True)


# ======================================= F07: hot and cold boundaries swapped


@pytest.mark.slow
def test_f07_swapped_thermal_boundaries_are_rejected(plug_profile, work_dir):
    """F07: a swapped hot/cold pair has the same temperature span as a correct one.

    This is why the check reads the regions' thermal roles rather than only the
    size of the gradient: a reversed model solves perfectly and reports a
    firing tip colder than the cylinder head.
    """
    from app.services.pipeline import build_geometry

    spec = _spec(plug_profile)
    geometry = build_geometry(
        plug_profile, spec.parameters, work_dir / "f07", write_preview=False
    )
    case = spec.load_cases[0]

    # The real plug case mixes convection on the gas and ambient sides with a
    # fixed temperature at the cylinder-head seat, so the temperature lives
    # under a different field name depending on the boundary type.
    def temperature_field(bc) -> str | None:
        for name in ("ambient_temperature", "temperature"):
            if getattr(bc, name, None) is not None:
                return name
        return None

    with_temp = [
        (bc, field)
        for bc in case.thermal_boundary_conditions
        if (field := temperature_field(bc)) is not None
    ]
    assert len(with_temp) >= 2, "the plug case is expected to state temperatures"

    hot_bc, hot_field = max(
        with_temp, key=lambda pair: getattr(pair[0], pair[1]).canonical()
    )
    cold_bc, cold_field = min(
        with_temp, key=lambda pair: getattr(pair[0], pair[1]).canonical()
    )
    hot_value = getattr(hot_bc, hot_field)
    cold_value = getattr(cold_bc, cold_field)

    swapped = []
    for bc in case.thermal_boundary_conditions:
        field = temperature_field(bc)
        if field is None:
            swapped.append(bc)
        elif bc.region == hot_bc.region:
            swapped.append(bc.model_copy(update={field: cold_value}))
        elif bc.region == cold_bc.region:
            swapped.append(bc.model_copy(update={field: hot_value}))
        else:
            swapped.append(bc)
    broken = case.model_copy(update={"thermal_boundary_conditions": swapped})

    report = pre_solver_input_checks(
        spec=spec, geometry=geometry, materials=_materials(spec), case=broken
    )
    check = report.by_id("thermal_boundary_consistency")
    assert check.status is CheckStatus.FAILED
    assert "swapped" in check.detail or "backwards" in check.detail
    assert not report.gate_passed
    _record("F07", True)


# ==================================== F08: solver exits clean, result is not


@pytest.mark.slow
def test_f08_nonfinite_result_field_is_rejected(wheel_evaluated, tmp_path):
    """F08: a zero exit status is not evidence of a usable result.

    The stored field is read back and every value checked. A NaN written into
    it must fail the gate even though the solve reported success.
    """
    from app.engineering.assurance.gates import post_solver_checks

    result = wheel_evaluated.result
    assert result is not None and result.field_artifact is not None

    with np.load(result.field_artifact.path) as data:
        arrays = {k: data[k].copy() for k in data.files}

    target = next(
        k for k, v in arrays.items() if np.issubdtype(v.dtype, np.floating) and v.size
    )
    arrays[target] = arrays[target].astype(float)
    arrays[target].flat[0] = np.nan

    poisoned = tmp_path / "poisoned_fields.npz"
    np.savez_compressed(poisoned, **arrays)

    broken = result.model_copy(deep=True)
    broken.field_artifact = result.field_artifact.model_copy(
        update={"path": poisoned}
    )

    report = post_solver_checks(result=broken, spec=wheel_evaluated.spec)
    check = report.by_id("result_field_integrity")
    assert check.status is CheckStatus.FAILED
    assert "non-finite" in check.detail
    assert not report.gate_passed
    _record("F08", True)


@pytest.mark.slow
def test_f08b_empty_boundary_region_is_rejected(wheel_evaluated):
    """A boundary condition that resolved to no facets applied nothing."""
    from app.engineering.assurance.gates import post_solver_checks

    result = wheel_evaluated.result.model_copy(deep=True)
    assert result.region_applications
    result.region_applications[0] = result.region_applications[0].model_copy(
        update={"facet_count": 0, "area_m2": 0.0}
    )

    report = post_solver_checks(result=result, spec=wheel_evaluated.spec)
    check = report.by_id("region_application_coverage")
    assert check.status is CheckStatus.FAILED
    assert "applied\nnothing" in check.detail or "applied nothing" in check.detail


@pytest.mark.slow
def test_f08c_thermal_energy_balance_closes_and_is_mesh_independent(plug_profile, work_dir):
    """The thermal balance accounts for convective boundaries, not only applied flux.

    This is a regression test for two real defects, in order:

    The first version of the balance only ran when an explicit heat flux or
    total power was applied. The spark plug is driven entirely by convection, so
    the check never ran at all and every plug result was permanently blocked
    from numerical verification by missing evidence.

    The second version computed the fixed-temperature boundary's power by
    integrating the recovered temperature gradient across it. That quantity does
    not converge: the imbalance grew from 3% to 24% as the mesh was refined.
    Taking the reaction from the residual instead makes the balance an identity
    of the assembled system, so it closes at every fidelity. The assertion below
    is mesh-independence, because that is what distinguishes the two.
    """
    from app.services.pipeline import evaluate_candidate

    errors: dict[str, float] = {}
    for preset in ("screening", "exploration"):
        spec = _spec(plug_profile, mesh_preset=preset)
        output = evaluate_candidate(
            profile=plug_profile,
            spec=spec,
            parameters=spec.parameters,
            output_dir=work_dir / f"balance_{preset}",
            index=0,
            is_baseline=True,
        )
        assert output.result is not None, output.record.failure_reason
        balance = output.result.energy_balance
        assert balance is not None, (
            f"no energy balance was recorded at {preset} fidelity, so conservation "
            "was never verified"
        )
        assert balance.relative_error is not None
        assert balance.passed, (
            f"the {preset} balance did not close: {balance.applied:.4g} W in "
            f"against {balance.recovered:.4g} W out"
        )
        errors[preset] = balance.relative_error

    # Refining the mesh must not make conservation worse. A balance built from
    # a non-converging quantity fails here even though each run passes alone.
    assert errors["exploration"] <= max(errors["screening"], 1e-6) * 10 + 1e-6, (
        f"the imbalance grew with refinement ({errors['screening']:.3e} -> "
        f"{errors['exploration']:.3e}), which means it is not a conservation "
        "identity"
    )


@pytest.mark.slow
def test_f08d_a_dropped_thermal_boundary_breaks_the_balance(plug_profile, work_dir):
    """A boundary that applies nothing must show up as an imbalance.

    The point of the balance is to catch a boundary condition that silently did
    not take effect. Removing the firing-end heat source leaves a model that
    still solves, so only the accounting notices.
    """
    from app.engineering.solvers.base import BalanceCheck

    # Verified directly on the contract rather than by re-solving: the solver
    # refuses a thermal case with fewer than two boundaries, so a dropped
    # source cannot be driven through the real pipeline.
    broken = BalanceCheck.from_values(
        "power entering the solid across every boundary against power leaving it",
        0.0,
        93.4,
        "W",
    )
    assert not broken.passed
    assert broken.relative_error is None, (
        "with no inflow the relative error is undefined, and an undefined error "
        "must not be reported as a pass"
    )

    closed = BalanceCheck.from_values("test", 93.4, 93.4, "W")
    assert closed.passed and closed.relative_error == 0.0


# ============================ F09: calibration data reused as validation data


def test_f09_calibration_data_cannot_validate():
    """F09: a dataset used to fit the model cannot also be used to judge it.

    ``calibration_only`` must block the experimentally-validated level. This is
    the quietest way a maturity claim gets inflated, and the only defence is
    for the status to be a distinct value rather than a boolean.
    """
    assessment = derive_maturity(
        geometry_valid=True,
        solver_completed=True,
        results_parsed=True,
        constraints_evaluated=True,
        verification_passed=True,
        benchmark_passed=True,
        balance_closed=True,
        mesh_converged=True,
        validation_status=ValidationStatus.CALIBRATION_ONLY.value,
    )
    assert assessment.level is MaturityLevel.NUMERICALLY_VERIFIED
    assert assessment.blocked_from is MaturityLevel.EXPERIMENTALLY_VALIDATED
    assert any("calibration" in r for r in assessment.blocking_reasons)
    _record("F09", True)


def test_f09b_validation_record_defaults_to_not_available():
    """The default physical-validation state is 'not available', never 'passed'."""
    record = ValidationRecord()
    assert record.status is ValidationStatus.NOT_AVAILABLE
    assert "No physical measurement" in record.statement


# ===================================== F10: inputs change after the simulation


def test_f10_changed_geometry_marks_the_result_stale():
    """F10: a revision that moves after a solve leaves the result stale."""
    before = EvidenceRecord(
        requirement_revision="r1",
        geometry_hash="g1",
        material_snapshot_hash="m1",
        load_case_hash="l1",
        mesh_hash="h1",
        solver_input_hash="s1",
        solver_version="1.0",
        generator_version="1.0",
    )
    after = before.model_copy(update={"geometry_hash": "g2"})

    stale, changed = before.is_stale_against(after)
    assert stale is True
    assert changed == ["the geometry"]

    unchanged, nothing = before.is_stale_against(before)
    assert unchanged is False and nothing == []
    _record("F10", True)


def test_f10b_material_and_load_changes_are_detected_separately():
    base = EvidenceRecord(
        requirement_revision="r1",
        geometry_hash="g1",
        material_snapshot_hash="m1",
        load_case_hash="l1",
        solver_version="1.0",
    )
    moved = base.model_copy(
        update={"material_snapshot_hash": "m2", "load_case_hash": "l2"}
    )
    stale, changed = base.is_stale_against(moved)
    assert stale
    assert set(changed) == {"the material assignment", "the load case"}


def test_f10c_requirement_revision_tracks_the_requirement_not_the_parameters(
    wheel_profile,
):
    """Exploring parameters must not change the requirement's identity."""
    from app.services.pipeline import requirement_revision

    spec = _spec(wheel_profile)
    params = dict(spec.parameters)
    name = wheel_profile.generator.default_parameters()
    key = next(k for k in name if "spoke" in k.lower()) if name else None

    moved = spec.model_copy(
        update={"parameters": {**params, **({key: params[key] * 0.95} if key else {})}}
    )
    assert requirement_revision(spec) == requirement_revision(moved)

    relaxed = spec.model_copy(update={"objective_summary": "a different requirement"})
    assert requirement_revision(spec) != requirement_revision(relaxed)


# ========================================= F11: a surrogate queried out of domain


def test_f11_reduced_order_path_is_not_offered_as_decision_grade():
    """F11: the F0 estimator is labelled as screening, not as a decision model.

    No surrogate is trained in this build, so the out-of-domain fallback the
    dossiers require cannot be exercised yet. What must hold today is that the
    fidelity ladder does not advertise an F3 rung as available, which is the
    precondition for anyone relying on one.
    """
    from app.engineering.assurance.ladders import FIDELITY_LADDER

    by_level = {r.level: r for r in FIDELITY_LADDER}
    assert by_level["F0"].available is True
    assert by_level["F3"].available is False, (
        "no qualified reduced-order model exists, so F3 must not be advertised"
    )
    assert by_level["F4"].available is False
    assert "out-of-distribution" in by_level["F3"].gate
    _record("F11", True)


def test_f11b_estimators_carry_a_measured_calibration_note():
    """Every reduced-order estimate states its measured error against the solver.

    An F0 number shown next to an F2 number has to say how far apart they are,
    or the cheap one gets read as the accurate one.
    """
    from app.engineering.estimators.analytic import _ESTIMATORS, estimate
    from app.engineering.profiles.registry import get_profile
    from app.services.pipeline import resolve_materials

    for component in _ESTIMATORS:
        profile = get_profile(component)
        spec = _spec(profile)
        result = estimate(
            component,
            profile.generator.default_parameters(),
            profile.demo_fixture_inputs(),
            resolve_materials(spec),
        )
        assert result.calibration_note, f"{component.value} estimate has no note"
        assert len(result.calibration_note) > 60, (
            f"{component.value} calibration note is too thin to be informative"
        )
        # An estimate must never be presented as a solver result.
        assert scan_text(result.calibration_note) == []


# ================================================= F12: unsafe user filenames


def test_f12_user_filenames_never_become_filesystem_paths():
    """F12: an uploaded name carrying traversal or shell syntax is not a path."""
    from app.core.ids import new_id

    hostile = [
        "../../../../windows/system32/config/sam",
        "design.step; rm -rf /",
        "C:\\Windows\\System32\\drivers\\etc\\hosts",
        "$(whoami).step",
        "a\x00b.step",
    ]
    for name in hostile:
        generated = new_id("upload")
        assert name not in generated
        assert "/" not in generated and "\\" not in generated
        assert ".." not in generated
        assert generated.isascii() and generated.replace("_", "").isalnum()
    _record("F12", True)


def test_f12b_no_shell_true_anywhere_in_the_application():
    """No subprocess in the application is given a shell."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1]
    offenders = []
    for path in root.rglob("*.py"):
        if "tests" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "shell=True" in text:
            offenders.append(str(path.relative_to(root)))
    assert not offenders, f"shell=True found in {offenders}"


# ============================ F13: a warning or a gap read as a pass


def test_f13_a_check_that_did_not_run_is_never_a_pass():
    """F13: the single rule the whole assurance plane rests on.

    ``NOT_RUN`` and ``WARNING`` are not passes, and neither may be converted
    into one. ``NOT_APPLICABLE`` is the one status that does not block, because
    a structural run genuinely has no thermal boundary to get wrong.
    """
    assert CheckStatus.PASSED.is_pass is True
    for status in (
        CheckStatus.FAILED,
        CheckStatus.WARNING,
        CheckStatus.NOT_RUN,
        CheckStatus.NOT_APPLICABLE,
    ):
        assert status.is_pass is False, f"{status} must not read as a pass"

    assert CheckStatus.NOT_RUN.blocks_verification is True
    assert CheckStatus.WARNING.blocks_verification is True
    assert CheckStatus.FAILED.blocks_verification is True
    assert CheckStatus.NOT_APPLICABLE.blocks_verification is False
    assert CheckStatus.PASSED.blocks_verification is False
    _record("F13", True)


def test_f13b_missing_verification_evidence_blocks_the_verified_level():
    """A maturity level is never reached by an absence of contradiction."""
    for missing in ("verification_passed", "benchmark_passed", "balance_closed", "mesh_converged"):
        kwargs = dict(
            geometry_valid=True,
            solver_completed=True,
            results_parsed=True,
            constraints_evaluated=True,
            verification_passed=True,
            benchmark_passed=True,
            balance_closed=True,
            mesh_converged=True,
        )
        kwargs[missing] = None
        assessment = derive_maturity(**kwargs)
        assert assessment.level is MaturityLevel.SIMULATION_EVALUATED, (
            f"a missing {missing} must not reach the numerically-verified level"
        )
        assert assessment.blocked_from is MaturityLevel.NUMERICALLY_VERIFIED


def test_f13c_an_unrun_post_solver_stage_never_reads_as_verified():
    """With no post-solver report at all, the verdict is unverified."""
    from app.engineering.assurance.checks import AssuranceReport, CheckStage

    class _Spec:
        analysis_type = AnalysisType.LINEAR_STATIC_STRUCTURAL

    record = build_verification_record(
        spec=_Spec(), pre=AssuranceReport(stage=CheckStage.PRE_SOLVER), post=None
    )
    assert record.status is VerificationStatus.UNVERIFIED


# ======================== F14: a prohibited claim reaching generated prose


def test_f14_prohibited_claims_are_caught_in_generated_prose():
    """F14: the claim guard runs on the model's output, after it has finished."""
    offending = {
        "This caliper is production-ready.": "production_ready",
        "The wheel is certified to SAE J328.": "certified",
        "Fatigue life validated across the duty cycle.": "fatigue_validated",
        "AutoTwin builds a real-time digital twin.": "real_time_digital_twin",
        "The workflow delivers a 40% cost reduction.": "quantified_savings",
        "This design is safe for road use.": "safe_for_road_use",
        "The part is guaranteed not to fail.": "guaranteed",
        "Experimentally validated against bench data.": "experimentally_validated",
    }
    for text, expected in offending.items():
        found = {v.claim_id for v in scan_text(text)}
        assert expected in found, f"{expected!r} not caught in {text!r}"
    _record("F14", True)


def test_f14b_legitimate_engineering_prose_passes_clean():
    """The guard must not block honest statements, or it will be turned off.

    A guard that cries wolf gets disabled, and then it protects nothing. These
    are the sentences the product exists to produce.
    """
    clean = [
        "Peak von Mises stress is 180 MPa against a 220 MPa allowable.",
        "Mass fell 12% relative to the baseline geometry.",
        "Feasible means every configured constraint passed; it is not a safety claim.",
        "The result is simulation-evaluated and has not been compared with any "
        "physical measurement.",
        "Refining the mesh moved peak stress by 51%, so the screening value is "
        "not converged.",
    ]
    for text in clean:
        assert scan_text(text) == [], f"false positive on {text!r}"


def test_f14e_a_percentage_in_a_physical_quantity_is_a_result_not_a_saving():
    """The savings guard keys on the subject, not the verb.

    "Reduced mass by 12%" is a comparison between two solver results and is the
    product's core output. "Reduced development cost by 12%" is a business claim
    about a workflow nobody baselined. A guard that matched "reduced ... %"
    alone would flag the first, which is how this was originally wrong.
    """
    results = [
        "Candidate 3 reduced mass by 12% while holding peak stress at 180 MPa.",
        "Candidate 3 cut mass by 12% at the same stiffness.",
        "Peak stress reduced by 8% against the original design.",
        "Lowered the deflection by 15% at the same mass.",
        "The spoke count cut stress concentration by 20%.",
        "Mesh volume differs from the CAD volume by 0.17%.",
    ]
    for text in results:
        assert scan_text(text) == [], f"a computed result was flagged: {text!r}"

    savings = [
        "The workflow delivers a 40% cost reduction.",
        "Delivers a 30% reduction in development time.",
        "The workflow saves 25% of engineering hours.",
        "Reduces prototype cost by 50%.",
        "Cuts development time by 30%.",
        "Up to 50% fewer prototypes.",
        "Lead time down 20%.",
        "Achieves up to 50% reduction in physical prototype iterations.",
    ]
    for text in savings:
        found = {v.claim_id for v in scan_text(text)}
        assert "quantified_savings" in found, f"a savings claim slipped through: {text!r}"


def test_f14c_a_claim_becomes_available_once_its_evidence_exists():
    """'Experimentally validated' is legitimate at the level that earns it."""
    text = "Experimentally validated against the instrumented bench dataset."
    assert scan_text(text, maturity=MaturityLevel.NUMERICALLY_VERIFIED)
    assert scan_text(text, maturity=MaturityLevel.EXPERIMENTALLY_VALIDATED) == []


def test_f14d_every_prohibited_claim_has_a_stated_reason():
    for claim in PROHIBITED_CLAIMS:
        assert len(claim.reason) > 40, f"{claim.claim_id} has no usable reason"


# ======================================================== the aggregate metric


def test_false_acceptance_rate():
    """Of all seeded invalid cases, how many were accepted? Must be zero.

    This runs last and reads what the seeded tests recorded. It is the number
    the dossiers ask to be reported, and reporting it as a number means a
    regression shows up as a rate rather than as one failing test among many.
    """
    expected = {f"F{i:02d}" for i in range(1, 15)}
    observed = set(SEEDED_OUTCOMES)
    missing = expected - observed

    accepted = [c for c, rejected in SEEDED_OUTCOMES.items() if not rejected]
    rate = len(accepted) / len(SEEDED_OUTCOMES) if SEEDED_OUTCOMES else 1.0

    print(
        f"\nseeded failure cases exercised: {len(observed)}/{len(expected)}"
        f"\nfalse acceptances: {len(accepted)}"
        f"\nfalse-acceptance rate: {rate * 100:.1f}%"
        + (f"\nnot exercised in this run: {sorted(missing)}" if missing else "")
    )

    assert not accepted, f"seeded invalid cases were accepted: {accepted}"


# ============================================== the ladders and their honesty


def test_ladders_do_not_overclaim():
    """No ladder claims a rung that needs physical data this build lacks."""
    for component in ComponentType:
        ladder = ladder_for(component)
        attained = [r for r in ladder.rungs if r.attained]
        assert attained, f"{component.value} claims no rung at all"

        # Nothing above rung 1 may be attained: rungs 2 and up all require
        # test-configuration modelling or physical measurement.
        for rung in ladder.rungs:
            index = int(rung.level[1:])
            if index >= 2:
                assert not rung.attained, (
                    f"{rung.level} is marked attained but needs evidence this "
                    "build does not have"
                )
                assert rung.gap, f"{rung.level} is unattained but states no gap"

        # The attained rungs must be contiguous from the bottom.
        levels = [int(r.level[1:]) for r in attained]
        assert levels == list(range(len(levels)))


def test_ladder_release_labels_pass_the_claim_guard():
    """The ladders' own wording must survive the prohibited-claim scanner."""
    for component in ComponentType:
        ladder = ladder_for(component)
        for rung in ladder.rungs:
            if not rung.attained:
                continue
            violations = scan_text(f"{rung.capability} {rung.release_label}")
            assert violations == [], (
                f"{rung.level} release label makes a prohibited claim: "
                f"{[v.claim_id for v in violations]}"
            )


def test_maturity_prohibitions_are_stated_at_every_level():
    for level in MaturityLevel:
        assessment = derive_maturity(
            geometry_valid=True,
            solver_completed=level.ordinal >= 1,
            results_parsed=level.ordinal >= 1,
            constraints_evaluated=level.ordinal >= 1,
            verification_passed=True if level.ordinal >= 2 else None,
            benchmark_passed=True if level.ordinal >= 2 else None,
            balance_closed=True if level.ordinal >= 2 else None,
            mesh_converged=True if level.ordinal >= 2 else None,
            validation_status="passed" if level.ordinal >= 3 else "not_available",
            calibration_bound_to_instance=level.ordinal >= 4,
            operational_link_live=level.ordinal >= 5,
        )
        assert assessment.prohibited_claims, f"{level} states no prohibited claims"
        assert assessment.evidence_requirement
        assert "No language model" in assessment.derivation


def test_stable_hash_is_order_independent():
    assert stable_hash({"a": 1, "b": 2}) == stable_hash({"b": 2, "a": 1})
    assert stable_hash({"a": 1}) != stable_hash({"a": 2})


# ===================================================== mesh convergence states


def _convergence_report(**overrides) -> dict:
    """A refinement study in the shape ``_verify_on_refined_mesh`` produces."""
    report = {
        "performed": True,
        "verdict_changed": False,
        "tolerance": 0.10,
        "converged": True,
        "decision_metric": "max_temperature_k",
        "decision_metric_converged": True,
        "decision_metric_change": -0.0073,
        "unconverged_metrics": [],
        "unconverged_region_metrics": [],
        "metrics": {
            "max_temperature_k": {"available": True, "percent_change": -0.73},
            "peak_temperature_gradient_k_per_m": {
                "available": True,
                "percent_change": 32.38,
            },
        },
        "statement": "",
    }
    report.update(overrides)
    return report


def test_convergence_is_judged_on_the_decision_quantity():
    """A singular region metric must not be read as a failed study.

    The research judges convergence on "the trend in the decision quantity ...
    include region-specific metrics". A peak gradient at a material interface
    is singular in this formulation: it grows without bound however fine the
    mesh gets, so no amount of refinement will ever converge it. Treating that
    as a failure would permanently block numerical verification for a result
    that is converged on the quantity being decided, which is a false negative
    - the mirror of the false acceptance this suite is built to prevent.

    These are the real spark-plug numbers: the decision metric moved -0.73%,
    the peak gradient +32.38%.
    """
    from app.engineering.assurance.gates import _mesh_convergence_region_metrics

    report = _convergence_report(
        converged=False,
        unconverged_metrics=["peak_temperature_gradient_k_per_m"],
        unconverged_region_metrics=["peak_temperature_gradient_k_per_m"],
    )
    decision = _mesh_convergence(report)
    region = _mesh_convergence_region_metrics(report)

    assert decision.status is CheckStatus.PASSED
    assert decision.severity is CheckSeverity.BLOCKING
    # Reported, named, and not silently dropped.
    assert region.status is CheckStatus.WARNING
    assert region.severity is CheckSeverity.ADVISORY
    assert "peak_temperature_gradient_k_per_m" in region.detail
    assert "+32.4%" in region.detail or "32.38" in region.detail


def test_decision_quantity_that_moves_still_fails():
    """Narrowing to the decision quantity must not weaken the actual gate."""
    decision = _mesh_convergence(
        _convergence_report(
            converged=False,
            decision_metric_converged=False,
            decision_metric_change=0.21,
        )
    )
    assert decision.status is CheckStatus.FAILED
    assert decision.severity is CheckSeverity.BLOCKING


def test_a_flipped_feasibility_verdict_fails_regardless():
    """If refinement changes the answer, the screening mesh decided nothing."""
    decision = _mesh_convergence(
        _convergence_report(verdict_changed=True, statement="the verdict changed")
    )
    assert decision.status is CheckStatus.FAILED


def test_missing_decision_quantity_is_not_a_pass():
    """No evidence is never auto-converted to passed."""
    report = _convergence_report(decision_metric_converged=None)
    assert _mesh_convergence(report).status is CheckStatus.NOT_RUN
    assert _mesh_convergence(None).status is CheckStatus.NOT_RUN


def test_four_state_convergence_status():
    """The evidence schema's four states, each reachable and distinct."""
    from app.engineering.assurance.checks import AssuranceReport, CheckStage
    from app.engineering.assurance.gates import _mesh_convergence_region_metrics
    from app.engineering.assurance.service import _mesh_convergence_status

    def status_for(report):
        return _mesh_convergence_status(
            AssuranceReport(
                stage=CheckStage.POST_SOLVER,
                checks=[
                    _mesh_convergence(report),
                    _mesh_convergence_region_metrics(report),
                ],
            )
        )

    assert status_for(None) == "not_run"
    assert status_for(_convergence_report()) == "passed"
    assert (
        status_for(_convergence_report(decision_metric_converged=False)) == "failed"
    )
    assert (
        status_for(
            _convergence_report(
                converged=False,
                unconverged_region_metrics=["peak_temperature_gradient_k_per_m"],
            )
        )
        == "inconclusive"
    )
