"""Full-pipeline integration tests (spec 13.5).

One candidate is driven through the real path - parameters, CAD, validation,
mesh, solve, constraints - for a structural and a thermal profile. These are
the tests that would catch a result being fabricated, a load landing on the
wrong region, or a failure being quietly swallowed.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.schemas.common import CandidateStatus, DesignMode
from app.services.pipeline import EvaluationCache, evaluate_candidate


def _spec(profile, mesh_preset="screening", **kwargs):
    return profile.build_specification(
        design_mode=DesignMode.GENERATE_NEW,
        objective_summary="integration test",
        material_id=kwargs.pop("material_id", profile.material_choices()[0]),
        parameters=profile.generator.default_parameters(),
        inputs=profile.demo_fixture_inputs(),
        mesh_preset=mesh_preset,
        **kwargs,
    )


@pytest.mark.slow
class TestStructuralPipeline:
    @pytest.fixture(scope="class")
    def evaluated(self, wheel_profile, work_dir):
        spec = _spec(wheel_profile)
        return evaluate_candidate(
            profile=wheel_profile,
            spec=spec,
            parameters=wheel_profile.generator.default_parameters(),
            output_dir=work_dir / "pipeline_wheel",
            index=0,
            is_baseline=True,
        )

    def test_candidate_reaches_a_verdict(self, evaluated):
        record = evaluated.record
        assert record.status in (CandidateStatus.FEASIBLE, CandidateStatus.INFEASIBLE), (
            f"pipeline stopped at {record.failure_stage}: {record.failure_reason}"
        )
        assert record.is_feasible is not None
        assert evaluated.result is not None

    def test_metrics_are_physically_plausible(self, evaluated):
        metrics = evaluated.record.metrics
        # A 17-inch cast aluminium wheel is a few kilograms, not grams or tonnes.
        assert 3.0 < metrics["mass_kg"] < 20.0
        assert metrics["max_von_mises_pa"] > 0
        assert metrics["max_displacement_m"] > 0
        assert metrics["volume_m3"] > 0

    def test_mass_equals_volume_times_density(self, evaluated):
        """Mass must be derived, not asserted."""
        from app.engineering.materials.catalog import get_material

        material = get_material("al_a356_t6")
        metrics = evaluated.record.metrics
        assert metrics["mass_kg"] == pytest.approx(
            metrics["volume_m3"] * material.density, rel=1e-9
        )

    def test_factor_of_safety_is_derived_from_the_material_snapshot(self, evaluated):
        from app.engineering.materials.catalog import get_material

        metrics = evaluated.record.metrics
        yield_strength = get_material("al_a356_t6").yield_strength
        assert metrics["min_factor_of_safety"] == pytest.approx(
            yield_strength / metrics["max_von_mises_pa"], rel=1e-6
        )

    def test_every_load_is_verified_independently(self, evaluated):
        """A load that landed on the wrong region must be caught, not reported."""
        verifications = evaluated.result.load_verifications
        assert verifications, "no load verification was recorded"
        for check in verifications:
            assert check.passed
            assert check.relative_error is not None
            assert check.relative_error < 0.02
            assert check.reference_basis, "a check must say what it compared against"
        assert evaluated.result.all_loads_verified

    def test_boundary_conditions_landed_on_real_facets(self, evaluated):
        applications = evaluated.result.region_applications
        assert applications
        roles = {a.role.split(":")[0] for a in applications}
        assert {"support", "load"} <= roles
        for application in applications:
            assert application.facet_count > 0
            assert application.area_m2 > 0

    def test_mesh_matches_the_cad_volume(self, evaluated):
        """A mesh that does not represent the solid invalidates everything after it."""
        cad_volume = evaluated.geometry.volume_m3
        meta = evaluated.result.mesh_metadata
        assert meta.node_count > 0 and meta.tet_count > 0
        # The pipeline records a warning if this drifts; assert it did not.
        assert not any("meshed volume differs" in w for w in evaluated.record.warnings)
        assert cad_volume > 0

    def test_result_is_traceable(self, evaluated):
        result = evaluated.result
        assert result.solver_name and result.solver_version
        assert result.material_snapshot["primary"]["material_id"] == "al_a356_t6"
        assert result.method_statement
        assert result.linear_solver_report["relative_residual"] < 1e-5
        assert evaluated.record.geometry_hash

    def test_field_artifact_is_written_and_consistent(self, evaluated):
        artifact = evaluated.result.field_artifact
        assert artifact is not None and artifact.path.exists()
        assert artifact.has_displacement and artifact.has_stress
        assert artifact.stress_location.value == "nodal_l2_projected"

        data = np.load(artifact.path)
        assert data["nodes"].shape[0] == artifact.node_count
        assert data["faces"].shape[0] == artifact.triangle_count
        assert data["displacement"].shape[0] == artifact.node_count
        assert data["von_mises"].shape[0] == artifact.node_count
        # The stored peak must equal the reported summary metric.
        assert float(data["von_mises"].max()) == pytest.approx(
            evaluated.record.metrics["max_von_mises_pa"], rel=1e-5
        )

    def test_constraints_were_evaluated_against_computed_metrics(self, evaluated):
        record = evaluated.record
        assert record.constraint_results
        for result in record.constraint_results:
            assert result.passed is not None, (
                f"{result.constraint_id} has no verdict, so feasibility is unsound"
            )
            assert result.value is not None

    def test_artifacts_are_written(self, evaluated, work_dir):
        directory = work_dir / "pipeline_wheel"
        for name in ("design.step", "preview.glb", "parameters.json",
                     "geometry_validation.json", "summary.json"):
            assert (directory / name).exists(), f"{name} was not written"


@pytest.mark.slow
class TestThermalPipeline:
    @pytest.fixture(scope="class")
    def evaluated(self, plug_profile, work_dir):
        spec = _spec(plug_profile, mesh_preset="exploration", material_id="alumina_96")
        return evaluate_candidate(
            profile=plug_profile,
            spec=spec,
            parameters=plug_profile.generator.default_parameters(),
            output_dir=work_dir / "pipeline_plug",
            index=0,
            is_baseline=True,
        )

    def test_multi_material_assembly_solves(self, evaluated):
        record = evaluated.record
        assert record.status in (CandidateStatus.FEASIBLE, CandidateStatus.INFEASIBLE), (
            f"pipeline stopped at {record.failure_stage}: {record.failure_reason}"
        )

    def test_each_material_subdomain_got_elements(self, evaluated):
        """A subdomain with no elements means a part was not meshed at all."""
        counts = evaluated.result.mesh_metadata.subdomain_element_counts
        assert set(counts) == {"electrode", "insulator", "shell"}
        for name, count in counts.items():
            assert count > 0, f"subdomain {name} has no elements"

    def test_every_part_has_its_own_conductivity(self, evaluated):
        snapshot = evaluated.result.material_snapshot
        assert set(snapshot) == {"electrode", "insulator", "shell"}
        conductivities = {k: v["thermal_conductivity"] for k, v in snapshot.items()}
        # The three materials genuinely differ, so this is a real multi-material solve.
        assert len(set(conductivities.values())) == 3

    def test_temperature_field_obeys_its_boundary_conditions(self, evaluated):
        metrics = evaluated.record.metrics
        inputs = evaluated.record  # readability
        gas_temperature = 1173.15
        head_temperature = 423.15
        ambient = 353.15

        # Steady-state conduction cannot exceed its hottest driving temperature
        # nor fall below the coldest sink.
        assert metrics["max_temperature_k"] < gas_temperature
        assert metrics["min_temperature_k"] >= ambient - 1.0
        assert metrics["min_temperature_k"] < metrics["max_temperature_k"]
        assert metrics["heat_flow_w"] > 0

    def test_thermal_field_artifact(self, evaluated):
        artifact = evaluated.result.field_artifact
        assert artifact.has_temperature and not artifact.has_displacement
        data = np.load(artifact.path)
        assert float(data["temperature"].max()) == pytest.approx(
            evaluated.record.metrics["max_temperature_k"], rel=1e-5
        )


@pytest.mark.slow
class TestFailuresAreRecordedNotHidden:
    def test_infeasible_parameters_are_rejected_before_cad(self, wheel_profile, work_dir):
        parameters = dict(wheel_profile.generator.default_parameters())
        parameters["spoke_count"] = 12
        parameters["spoke_root_width_m"] = 0.070  # spokes would merge into a disc

        output = evaluate_candidate(
            profile=wheel_profile,
            spec=_spec(wheel_profile),
            parameters=parameters,
            output_dir=work_dir / "pipeline_reject",
            index=99,
        )
        record = output.record

        assert record.status == CandidateStatus.GEOMETRY_INVALID
        assert record.failure_stage == "parameter_validation"
        assert record.failure_reason
        # A rejected candidate carries no metrics at all.
        assert record.metrics == {}
        assert record.is_feasible is None
        assert record.evaluated is False
        assert record.rank is None

    def test_cache_returns_an_identical_evaluation(self, wheel_profile, work_dir):
        """A cache hit must reproduce the result, not approximate it."""
        spec = _spec(wheel_profile)
        parameters = wheel_profile.generator.default_parameters()
        cache = EvaluationCache()

        first = evaluate_candidate(
            profile=wheel_profile, spec=spec, parameters=parameters,
            output_dir=work_dir / "cache_a", index=0, cache=cache,
        )
        second = evaluate_candidate(
            profile=wheel_profile, spec=spec, parameters=parameters,
            output_dir=work_dir / "cache_b", index=1, cache=cache,
        )

        assert second.record.from_cache is True
        assert first.record.from_cache is False
        for metric, value in first.record.metrics.items():
            assert second.record.metrics[metric] == pytest.approx(value, rel=1e-12)

    def test_cache_key_changes_with_the_load(self, wheel_profile):
        """A different load case must never reuse a cached result."""
        from app.engineering.cad.base import geometry_hash

        parameters = wheel_profile.generator.default_parameters()
        g_hash = geometry_hash(
            wheel_profile.component_type, wheel_profile.generator.version, parameters
        )

        light = _spec(wheel_profile)
        heavy_inputs = dict(wheel_profile.demo_fixture_inputs())
        heavy_inputs["radial_load_n"] = 9000.0
        heavy = wheel_profile.build_specification(
            design_mode=DesignMode.GENERATE_NEW,
            objective_summary="integration test",
            material_id="al_a356_t6",
            parameters=parameters,
            inputs=heavy_inputs,
            mesh_preset="screening",
        )

        assert EvaluationCache.key(light, parameters, g_hash) != EvaluationCache.key(
            heavy, parameters, g_hash
        )
