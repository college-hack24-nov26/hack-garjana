"""Schema, region, constraint and ranking tests.

These cover the honesty guarantees that do not need a solver run: a case that
cannot be solved is rejected at validation, a metric that was never computed
cannot pass a constraint, and a candidate that was never evaluated cannot be
ranked or recommended.
"""
from __future__ import annotations

import json

import numpy as np
import pytest

from app.engineering.cad.regions import (
    AndSelector,
    AngularSectorSelector,
    BoltHolesSelector,
    CylinderSelector,
    NamedRegion,
    OffsetCylinderSelector,
    PlaneSelector,
    RadialBandSelector,
    RegionKind,
    RegionSet,
)
from app.engineering.optimization.evaluation import (
    CandidateRecord,
    derive_feasibility,
    evaluate_constraints,
)
from app.engineering.optimization.ranking import (
    describe_recommendation,
    non_dominated_fronts,
    rank_candidates,
    recommended_candidate,
)
from app.schemas.common import (
    AnalysisType,
    CandidateStatus,
    ConstraintOperator,
    ObjectiveSense,
    Quantity,
    SourceStatus,
)
from app.schemas.engineering import (
    Constraint,
    ConvectionBC,
    FixedTemperatureBC,
    ForceLoad,
    HeatFluxBC,
    LoadCase,
    MeshSettings,
    Objective,
    PressureLoad,
    Support,
)


def _constraint(metric, operator, limit_value, limit_unit, **kwargs):
    return Constraint(
        constraint_id=f"{metric}_{operator.value}",
        metric=metric,
        operator=operator,
        limit=Quantity(value=limit_value, unit=limit_unit),
        source_status=SourceStatus.USER_SUPPLIED,
        **kwargs,
    )


def _candidate(index, metrics, *, feasible=None, status=CandidateStatus.SOLVED, baseline=False):
    return CandidateRecord(
        candidate_id=f"cand_{index}",
        index=index,
        parameters={},
        geometry_hash="h",
        status=status,
        is_baseline=baseline,
        is_feasible=feasible,
        metrics=metrics,
    )


class TestLoadCaseValidation:
    def test_structural_case_needs_supports(self):
        with pytest.raises(ValueError, match="support"):
            LoadCase(
                case_id="c",
                name="c",
                analysis_type=AnalysisType.LINEAR_STATIC_STRUCTURAL,
                loads=[PressureLoad(region="r", magnitude=Quantity(value=1, unit="MPa"))],
            )

    def test_structural_case_needs_loads(self):
        with pytest.raises(ValueError, match="load"):
            LoadCase(
                case_id="c",
                name="c",
                analysis_type=AnalysisType.LINEAR_STATIC_STRUCTURAL,
                supports=[Support(region="r")],
            )

    def test_thermal_case_needs_a_temperature_reference(self):
        """Pure flux with no sink leaves the temperature level undetermined."""
        with pytest.raises(ValueError, match="fixed-temperature or convection"):
            LoadCase(
                case_id="t",
                name="t",
                analysis_type=AnalysisType.STEADY_STATE_THERMAL,
                thermal_boundary_conditions=[
                    HeatFluxBC(region="hot", heat_flux=Quantity(value=1000, unit="W/m2"))
                ],
            )

    def test_thermal_case_with_convection_is_accepted(self):
        case = LoadCase(
            case_id="t",
            name="t",
            analysis_type=AnalysisType.STEADY_STATE_THERMAL,
            thermal_boundary_conditions=[
                ConvectionBC(
                    region="hot",
                    film_coefficient=Quantity(value=500, unit="W/(m2.K)"),
                    ambient_temperature=Quantity(value=900, unit="C"),
                )
            ],
        )
        assert case.regions_used() == {"hot"}

    def test_mixing_domains_is_rejected(self):
        with pytest.raises(ValueError, match="not used by a"):
            LoadCase(
                case_id="x",
                name="x",
                analysis_type=AnalysisType.STEADY_STATE_THERMAL,
                supports=[Support(region="r")],
                thermal_boundary_conditions=[
                    FixedTemperatureBC(region="s", temperature=Quantity(value=400, unit="K"))
                ],
            )

    def test_zero_direction_force_is_rejected(self):
        with pytest.raises(ValueError, match="zero direction"):
            ForceLoad(
                region="r", magnitude=Quantity(value=100, unit="N"), direction=(0, 0, 0)
            )


class TestConstraintSchema:
    def test_unknown_metric_is_rejected(self):
        with pytest.raises(ValueError, match="unknown metric"):
            _constraint("invented_metric", ConstraintOperator.LTE, 1, "MPa")

    def test_wrong_unit_kind_is_rejected(self):
        with pytest.raises(ValueError, match="expected a stress"):
            _constraint("max_von_mises_pa", ConstraintOperator.LTE, 1, "mm")

    def test_between_requires_both_bounds(self):
        with pytest.raises(ValueError, match="needs both"):
            Constraint(
                constraint_id="w",
                metric="max_temperature_k",
                operator=ConstraintOperator.BETWEEN,
                lower=Quantity(value=400, unit="K"),
                source_status=SourceStatus.USER_SUPPLIED,
            )

    def test_between_rejects_inverted_bounds(self):
        with pytest.raises(ValueError, match="lower > upper"):
            Constraint(
                constraint_id="w",
                metric="max_temperature_k",
                operator=ConstraintOperator.BETWEEN,
                lower=Quantity(value=900, unit="K"),
                upper=Quantity(value=400, unit="K"),
                source_status=SourceStatus.USER_SUPPLIED,
            )

    def test_mesh_settings_reject_inverted_sizes(self):
        with pytest.raises(ValueError, match="cannot exceed"):
            MeshSettings(target_element_size_m=0.001, min_element_size_m=0.01)


class TestConstraintEvaluation:
    def test_pass_and_fail(self):
        constraint = _constraint("max_von_mises_pa", ConstraintOperator.LTE, 120, "MPa")
        assert evaluate_constraints({"max_von_mises_pa": 60e6}, [constraint])[0].passed
        assert not evaluate_constraints({"max_von_mises_pa": 220e6}, [constraint])[0].passed

    def test_missing_metric_is_not_a_pass(self):
        """A constraint whose metric was never computed has no verdict."""
        constraint = _constraint("max_von_mises_pa", ConstraintOperator.LTE, 120, "MPa")
        result = evaluate_constraints({}, [constraint])[0]
        assert result.passed is None
        assert "not produced" in (result.note or "")

        feasible, reasons = derive_feasibility([result])
        assert feasible is False, "an unevaluated constraint must block feasibility"
        assert reasons

    def test_exact_limit_passes(self):
        """Floating-point representation must not fail a design that is on-limit."""
        constraint = _constraint("min_wall_thickness_m", ConstraintOperator.GTE, 7.0, "mm")
        on_limit = 0.020 - 0.65 * 0.020  # 0.006999999999999999
        assert evaluate_constraints({"min_wall_thickness_m": on_limit}, [constraint])[0].passed
        assert not evaluate_constraints({"min_wall_thickness_m": 0.0069}, [constraint])[0].passed

    def test_between_window(self):
        constraint = Constraint(
            constraint_id="window",
            metric="max_temperature_k",
            operator=ConstraintOperator.BETWEEN,
            lower=Quantity(value=723.15, unit="K"),
            upper=Quantity(value=1123.15, unit="K"),
            source_status=SourceStatus.USER_SUPPLIED,
        )
        assert evaluate_constraints({"max_temperature_k": 900.0}, [constraint])[0].passed
        assert not evaluate_constraints({"max_temperature_k": 650.0}, [constraint])[0].passed
        assert not evaluate_constraints({"max_temperature_k": 1200.0}, [constraint])[0].passed

    def test_result_carries_display_units_and_provenance(self):
        constraint = _constraint("max_von_mises_pa", ConstraintOperator.LTE, 120, "MPa")
        result = evaluate_constraints({"max_von_mises_pa": 60.6e6}, [constraint])[0]
        assert result.value.unit == "MPa"
        assert result.value.value == pytest.approx(60.6, rel=1e-6)
        assert result.value.canonical_unit == "Pa"
        assert result.source_status == SourceStatus.USER_SUPPLIED


class TestRanking:
    def test_unevaluated_candidates_are_never_ranked(self):
        records = [
            _candidate(0, {}, status=CandidateStatus.GEOMETRY_INVALID),
            _candidate(1, {}, status=CandidateStatus.MESH_FAILED),
            _candidate(2, {}, status=CandidateStatus.SOLVER_FAILED),
            _candidate(3, {"mass_kg": 7.0}, feasible=True),
        ]
        objectives = [Objective(objective_id="m", metric="mass_kg", sense=ObjectiveSense.MINIMIZE)]
        rank_candidates(records, objectives)

        assert [r.rank for r in records[:3]] == [None, None, None]
        assert records[3].rank == 1

    def test_failed_candidate_cannot_be_recommended(self):
        records = [
            _candidate(0, {"mass_kg": 8.0}, feasible=True, baseline=True),
            _candidate(1, {}, status=CandidateStatus.SOLVER_FAILED),
        ]
        objectives = [Objective(objective_id="m", metric="mass_kg", sense=ObjectiveSense.MINIMIZE)]
        rank_candidates(records, objectives)
        assert recommended_candidate(records, objectives) is None

    def test_feasible_outranks_infeasible(self):
        records = [
            _candidate(0, {"mass_kg": 5.0}, feasible=False, status=CandidateStatus.INFEASIBLE),
            _candidate(1, {"mass_kg": 9.0}, feasible=True, status=CandidateStatus.FEASIBLE),
        ]
        objectives = [Objective(objective_id="m", metric="mass_kg", sense=ObjectiveSense.MINIMIZE)]
        rank_candidates(records, objectives)
        # The lighter design violates a constraint, so the heavier feasible one wins.
        assert records[1].rank < records[0].rank

    def test_recommendation_reports_no_improvement_honestly(self):
        baseline = _candidate(0, {"mass_kg": 7.0}, feasible=True, baseline=True,
                              status=CandidateStatus.FEASIBLE)
        heavier = _candidate(1, {"mass_kg": 9.0}, feasible=True, status=CandidateStatus.FEASIBLE)
        objectives = [Objective(objective_id="m", metric="mass_kg", sense=ObjectiveSense.MINIMIZE)]
        rank_candidates([baseline, heavier], objectives)

        outcome = describe_recommendation([baseline, heavier], objectives, baseline)
        assert outcome.improves_on_baseline is False
        assert "does not beat the baseline" in outcome.statement

    def test_recommendation_quotes_units(self):
        """Prose must never contain a bare unlabelled engineering number."""
        baseline = _candidate(0, {"max_temperature_k": 728.75}, feasible=True, baseline=True,
                              status=CandidateStatus.FEASIBLE)
        other = _candidate(1, {"max_temperature_k": 809.65}, feasible=True,
                           status=CandidateStatus.FEASIBLE)
        objectives = [
            Objective(objective_id="t", metric="max_temperature_k", sense=ObjectiveSense.MINIMIZE)
        ]
        outcome = describe_recommendation([baseline, other], objectives, baseline)
        assert "455.6 C" in outcome.statement
        assert "536.5 C" in outcome.statement

    def test_no_feasible_candidate_is_stated_plainly(self):
        records = [
            _candidate(0, {"mass_kg": 7.0}, feasible=False, status=CandidateStatus.INFEASIBLE),
        ]
        objectives = [Objective(objective_id="m", metric="mass_kg", sense=ObjectiveSense.MINIMIZE)]
        outcome = describe_recommendation(records, objectives, None)
        assert outcome.candidate_id is None
        assert "No generated candidate satisfied" in outcome.statement

    def test_pareto_fronts(self):
        # Two mutually non-dominating points, plus one dominated by both.
        costs = np.array([[1.0, 5.0], [5.0, 1.0], [6.0, 6.0]])
        fronts = non_dominated_fronts(costs)
        assert fronts[0] == [0, 1]
        assert fronts[1] == [2]


class TestRegionSelectors:
    def test_cylinder_and_sector(self):
        points = np.array([[0.2, 0, 0], [0, 0.2, 0], [0.1, 0.1, 0.05]]).T
        cylinder = CylinderSelector(axis="z", radius=0.2, tol=1e-3)
        assert cylinder.evaluate(points).tolist() == [True, True, False]

        sector = AngularSectorSelector(axis="z", center_deg=0, half_angle_deg=20)
        assert sector.evaluate(points).tolist() == [True, False, False]

    def test_offset_cylinder_finds_off_axis_features(self):
        """Mounting holes are not concentric with the part axis."""
        selector = OffsetCylinderSelector(
            axis="y", center_a=0.048, center_b=0.083, radius=0.006, tol=1e-4
        )
        on_hole = np.array([[0.048 + 0.006, 0.0, 0.083]]).T
        off_hole = np.array([[0.0, 0.0, 0.0]]).T
        assert selector.evaluate(on_hole)[0]
        assert not selector.evaluate(off_hole)[0]

    def test_bolt_hole_pattern(self):
        selector = BoltHolesSelector(
            axis="z", pcd_radius=0.056, hole_radius=0.007, count=5
        )
        on_bolt = np.array([[0.056, 0.0, 0.0]]).T
        centre = np.array([[0.0, 0.0, 0.0]]).T
        assert selector.evaluate(on_bolt)[0]
        assert not selector.evaluate(centre)[0]

    def test_selectors_round_trip_through_json(self):
        """Selectors are stored with the run, so they must serialise exactly."""
        region = NamedRegion(
            name="combo",
            kind=RegionKind.LOAD,
            description="d",
            selector=AndSelector(
                of=[
                    CylinderSelector(axis="z", radius=0.2, tol=1e-3),
                    AngularSectorSelector(axis="z", center_deg=270, half_angle_deg=25),
                ]
            ),
        )
        points = np.array([[0.0, -0.2, 0.0], [0.2, 0.0, 0.0]]).T
        reparsed = NamedRegion.model_validate_json(region.model_dump_json())
        assert reparsed.mask(points).tolist() == region.mask(points).tolist()

    def test_region_set_reports_unknown_names(self):
        region_set = RegionSet(
            regions=[
                NamedRegion(
                    name="known",
                    kind=RegionKind.FIXED,
                    description="d",
                    selector=PlaneSelector(axis="z", value=0.0),
                )
            ]
        )
        with pytest.raises(KeyError, match="does not expose"):
            region_set.require({"known", "missing"})

    def test_mask_rejects_wrong_shape(self):
        region = NamedRegion(
            name="r",
            kind=RegionKind.FIXED,
            description="d",
            selector=PlaneSelector(axis="z", value=0.0),
        )
        with pytest.raises(ValueError, match=r"\(3, N\)"):
            region.mask(np.zeros((5, 2)))


class TestGeometryHash:
    def test_same_parameters_hash_the_same(self):
        from app.engineering.cad.base import geometry_hash
        from app.schemas.common import ComponentType

        a = geometry_hash(ComponentType.ALLOY_WHEEL, "1.0.0", {"x": 1.0, "y": 2.0})
        b = geometry_hash(ComponentType.ALLOY_WHEEL, "1.0.0", {"y": 2.0, "x": 1.0})
        assert a == b, "key order must not change the hash"

    def test_different_parameters_hash_differently(self):
        from app.engineering.cad.base import geometry_hash
        from app.schemas.common import ComponentType

        a = geometry_hash(ComponentType.ALLOY_WHEEL, "1.0.0", {"x": 1.0})
        b = geometry_hash(ComponentType.ALLOY_WHEEL, "1.0.0", {"x": 1.001})
        assert a != b

    def test_generator_version_changes_the_hash(self):
        from app.engineering.cad.base import geometry_hash
        from app.schemas.common import ComponentType

        a = geometry_hash(ComponentType.ALLOY_WHEEL, "1.0.0", {"x": 1.0})
        b = geometry_hash(ComponentType.ALLOY_WHEEL, "2.0.0", {"x": 1.0})
        assert a != b, "a new generator must not reuse cached results"
