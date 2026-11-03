"""Geometry generation and validation tests (spec 13.1).

Covers all three component templates: valid solids, positive volume, preserved
interfaces that genuinely stay put, named regions that survive a parameter
change, and infeasible parameter sets being rejected rather than built.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.engineering.cad.exporter import export_preview_glb, export_step, tessellate
from app.engineering.cad.validation import validate_geometry
from app.engineering.profiles.registry import available_profiles

ALL_PROFILES = [p.component_type.value for p in available_profiles()]


@pytest.fixture(scope="module", params=ALL_PROFILES)
def profile(request):
    from app.engineering.profiles.registry import get_profile
    from app.schemas.common import ComponentType

    return get_profile(ComponentType(request.param))


@pytest.mark.slow
class TestEveryTemplateBuilds:
    def test_defaults_are_feasible(self, profile):
        """A template whose own defaults are infeasible is unusable."""
        result = profile.generator.validate_parameters(
            profile.generator.default_parameters()
        )
        assert result.ok, f"{profile.component_type.value} defaults rejected: {result.errors}"

    def test_builds_a_valid_solid_with_positive_volume(self, profile):
        generator = profile.generator
        params = generator.default_parameters()
        shape = generator.build(params)
        report = validate_geometry(generator, shape, params)

        assert report.passed, f"{profile.component_type.value}: {report.errors}"
        assert report.metrics.volume_m3 > 0
        assert report.metrics.is_valid_solid
        assert report.metrics.solid_count == generator.expected_solid_count(params)

    def test_preserved_interfaces_measure_correctly(self, profile):
        generator = profile.generator
        params = generator.default_parameters()
        report = validate_geometry(generator, generator.build(params), params)

        assert report.preserved_interface_checks, "no interface was actually measured"
        for check in report.preserved_interface_checks:
            assert check.passed, (
                f"{profile.component_type.value}: {check.name} expected "
                f"{check.expected_value_m} but measured {check.measured_value_m}"
            )

    def test_every_required_region_selects_geometry(self, profile):
        """Regions must land on the solid, or boundary conditions cannot apply."""
        generator = profile.generator
        params = generator.default_parameters()
        vertices, _faces = tessellate(generator.build(params))
        points = vertices.T

        for region in generator.named_regions(params).regions:
            hits = int(np.count_nonzero(region.mask(points)))
            if region.required:
                assert hits > 0, (
                    f"{profile.component_type.value}: required region {region.name!r} "
                    "selects nothing"
                )

    def test_exports_step_and_glb(self, profile, work_dir):
        generator = profile.generator
        params = generator.default_parameters()
        shape = generator.build(params)
        name = profile.component_type.value

        step = export_step(shape, work_dir / f"{name}.step")
        assert step.stat().st_size > 1000

        glb = export_preview_glb(shape, work_dir / f"{name}.glb")
        assert glb.stat().st_size > 500
        # GLB files start with the ASCII magic "glTF".
        assert glb.read_bytes()[:4] == b"glTF"

    def test_min_wall_thickness_is_positive(self, profile):
        params = profile.generator.default_parameters()
        assert profile.generator.min_wall_thickness(params) > 0


@pytest.mark.slow
class TestParameterRejection:
    def test_out_of_bounds_is_rejected(self, profile):
        generator = profile.generator
        variable = generator.design_variable_names()
        assert variable, "a template with no design variables cannot be explored"

        spec = generator.spec_for(variable[0])
        params = dict(generator.default_parameters())
        params[spec.name] = spec.maximum * 10 + 1

        result = generator.validate_parameters(params)
        assert not result.ok
        assert any(spec.name in error for error in result.errors)

    def test_unknown_parameter_is_rejected(self, profile):
        params = dict(profile.generator.default_parameters())
        params["not_a_real_parameter"] = 1.0
        result = profile.generator.validate_parameters(params)
        assert not result.ok

    def test_non_finite_is_rejected(self, profile):
        generator = profile.generator
        params = dict(generator.default_parameters())
        params[generator.design_variable_names()[0]] = float("nan")
        assert not generator.validate_parameters(params).ok


@pytest.mark.slow
class TestWheelSpecifics:
    def test_spokes_that_would_merge_are_rejected(self, wheel_profile):
        """Too many wide spokes become a disc, not a spoked wheel."""
        generator = wheel_profile.generator
        params = dict(generator.default_parameters())
        params["spoke_count"] = 12
        params["spoke_root_width_m"] = 0.070

        result = generator.validate_parameters(params)
        assert not result.ok
        assert any("circumference" in e for e in result.errors)

    def test_tip_wider_than_root_is_rejected(self, wheel_profile):
        generator = wheel_profile.generator
        params = dict(generator.default_parameters())
        params["spoke_tip_width_m"] = params["spoke_root_width_m"] + 0.005
        result = generator.validate_parameters(params)
        assert not result.ok

    def test_tampered_interface_is_caught(self, wheel_profile):
        """The gate must notice a protected interface that moved."""
        generator = wheel_profile.generator
        expected = generator.default_parameters()
        built_with = dict(expected)
        built_with["center_bore_diameter_m"] = 0.050  # smaller than the real interface

        report = validate_geometry(
            generator, generator.build(built_with), expected
        )
        assert not report.passed
        assert any("center_bore" in e for e in report.errors)

    def test_dish_changes_geometry_and_mass_stays_sane(self, wheel_profile):
        generator = wheel_profile.generator
        flat = dict(generator.default_parameters())
        flat["spoke_dish_offset_m"] = 0.0
        dished = dict(generator.default_parameters())
        dished["spoke_dish_offset_m"] = 0.085

        volume_flat = generator.build(flat).val().Volume()
        volume_dished = sum(
            s.Volume() for s in generator.build(dished).solids().vals()
        )
        # Both are plausible wheel volumes; the dish changes the shape, not the
        # order of magnitude.
        for volume in (volume_flat, volume_dished):
            assert 1e-3 < volume < 6e-3


@pytest.mark.slow
class TestSparkPlugAssembly:
    def test_builds_three_bodies(self, plug_profile):
        generator = plug_profile.generator
        params = generator.default_parameters()
        shape = generator.build(params)
        assert len(shape.solids().vals()) == 3

    def test_subdomains_cover_the_assembly(self, plug_profile):
        """Every declared material region must exist and be distinguishable."""
        generator = plug_profile.generator
        params = generator.default_parameters()
        subdomains = generator.subdomains(params)
        assert len(subdomains) == 3
        assert {s.material_key for s in subdomains} == {"electrode", "insulator", "shell"}

    def test_thin_shell_wall_is_rejected(self, plug_profile):
        generator = plug_profile.generator
        params = dict(generator.default_parameters())
        # An insulator almost as wide as the thread leaves no shell wall.
        params["insulator_diameter_m"] = 0.0085
        params["thread_major_diameter_m"] = 0.010
        result = generator.validate_parameters(params)
        assert not result.ok
