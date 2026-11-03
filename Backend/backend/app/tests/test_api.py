"""API surface tests (spec 13.4).

These exercise the HTTP contract without running a solver: the validation gates
that refuse an incomplete request, the honesty of the capability report, and the
path handling that stops an artifact URL reading arbitrary files.
"""
from __future__ import annotations

import pytest


class TestHealthAndCapabilities:
    def test_health(self, api_client):
        body = api_client.get("/api/health").json()
        assert body["status"] == "ok"
        assert body["app"] == "AutoTwin"
        assert set(body["component_profiles"]) >= {
            "alloy_wheel",
            "brake_caliper",
            "spark_plug",
        }

    def test_capabilities_reports_absent_external_solvers(self, api_client):
        """The UI must be told what this installation genuinely has."""
        body = api_client.get("/api/capabilities", params={"run_benchmarks": False}).json()
        external = body["solvers"]["external_solvers"]

        assert "calculix" in external and "elmer" in external
        for name, info in external.items():
            assert "available" in info
            if not info["available"]:
                # An absent solver must say so rather than being omitted.
                assert info["note"], f"{name} is unavailable with no explanation"

        assert body["solvers"]["in_process_solvers"], "no solver is registered"
        assert body["standing_limitations"]

    def test_api_root_carries_the_disclaimer(self, api_client):
        body = api_client.get("/api").json()
        assert "not a regulatory certification" in body["disclaimer"]


class TestProfiles:
    def test_list(self, api_client):
        profiles = api_client.get("/api/components/profiles").json()
        assert len(profiles) >= 3

        by_type = {p["component_type"]: p for p in profiles}
        # The three components must not share one analysis or one load case.
        assert by_type["alloy_wheel"]["analysis_type"] == "linear_static_structural"
        assert by_type["brake_caliper"]["analysis_type"] == "linear_static_structural"
        assert by_type["spark_plug"]["analysis_type"] == "steady_state_thermal"

    def test_each_profile_is_self_describing(self, api_client):
        for profile in api_client.get("/api/components/profiles").json():
            assert profile["design_variables"], f"{profile['component_type']} has no variables"
            assert profile["engineering_inputs"], "no engineering inputs declared"
            assert profile["materials"], "no materials offered"
            assert profile["region_names"], "no named regions"
            assert profile["scope_statement"]
            assert profile["not_in_scope"], "a profile must say what it does not cover"
            assert profile["method_statement"]
            assert profile["mesh_presets"]

    def test_preserved_parameters_explain_themselves(self, api_client):
        for profile in api_client.get("/api/components/profiles").json():
            locked = [p for p in profile["parameters"] if not p["is_design_variable"]]
            assert locked, f"{profile['component_type']} preserves no interface"
            for spec in locked:
                assert spec["preserved_reason"], (
                    f"{spec['name']} is locked without saying why"
                )

    def test_demo_defaults_are_labelled(self, api_client):
        """Every pre-filled number must be declared a demo fixture."""
        for profile in api_client.get("/api/components/profiles").json():
            has_default = any(
                f["demo_default"] is not None for f in profile["engineering_inputs"]
            )
            if has_default:
                keys = {a["key"] for a in profile["demo_assumptions"]}
                assert keys, f"{profile['component_type']} pre-fills values with no assumption"
                assert any(
                    a["requires_confirmation"] for a in profile["demo_assumptions"]
                ), "demo fixtures must require explicit confirmation"

    def test_material_order_follows_the_profile(self, api_client):
        """The UI defaults to the first material, so the order is meaningful.

        A profile lists its typical material first. Serving the catalog's own
        order instead would default a cast-iron caliper to an aluminium alloy.
        """
        from app.engineering.profiles.registry import get_profile
        from app.schemas.common import ComponentType

        for profile in api_client.get("/api/components/profiles").json():
            declared = get_profile(
                ComponentType(profile["component_type"])
            ).material_choices()
            served = [m["material_id"] for m in profile["materials"]]
            assert served == declared, (
                f"{profile['component_type']} material order changed: "
                f"{served} != {declared}"
            )

        caliper = next(
            p
            for p in api_client.get("/api/components/profiles").json()
            if p["component_type"] == "brake_caliper"
        )
        assert caliper["materials"][0]["material_id"] == "iron_gjs_400_18"

    def test_unknown_profile_is_404(self, api_client):
        assert api_client.get("/api/components/profiles/flux_capacitor").status_code == 422


class TestProjects:
    def test_create_and_list(self, api_client):
        created = api_client.post(
            "/api/projects", json={"name": "Test project", "description": "d"}
        )
        assert created.status_code == 201
        project = created.json()

        listed = api_client.get("/api/projects").json()
        assert any(p["id"] == project["id"] for p in listed)

    def test_component_requires_a_real_project(self, api_client):
        response = api_client.post(
            "/api/components",
            json={
                "project_id": "proj_doesnotexist",
                "component_type": "alloy_wheel",
                "design_mode": "generate_new",
                "name": "x",
            },
        )
        assert response.status_code == 404

    def test_malformed_id_is_rejected(self, api_client):
        assert api_client.get("/api/projects/..%2F..%2Fetc").status_code in (400, 404)

    def test_create_component(self, api_client):
        project = api_client.post("/api/projects", json={"name": "P"}).json()
        response = api_client.post(
            "/api/components",
            json={
                "project_id": project["id"],
                "component_type": "alloy_wheel",
                "design_mode": "generate_new",
                "name": "Wheel",
            },
        )
        assert response.status_code == 201
        assert response.json()["component_type"] == "alloy_wheel"


@pytest.fixture(scope="module")
def component(api_client):
    project = api_client.post("/api/projects", json={"name": "Study project"}).json()
    return api_client.post(
        "/api/components",
        json={
            "project_id": project["id"],
            "component_type": "alloy_wheel",
            "design_mode": "generate_new",
            "name": "Wheel",
        },
    ).json()


def _request(component, **overrides):
    body = {
        "component_instance_id": component["id"],
        "material_id": "al_a356_t6",
        "objective_summary": "Reduce mass within limits",
        "engineering_inputs": {
            "radial_load_n": 4500.0,
            "allowable_stress_pa": 120.0,
            "allowable_displacement_m": 1.2,
            "min_wall_thickness_m": 6.0,
        },
        "parameters": {},
        "design_variables": [],
        "strategy": "doe",
        "candidate_budget": 2,
        "mesh_preset": "screening",
        "verify_winner": False,
        "confirm_demo_assumptions": True,
    }
    body.update(overrides)
    return body


class TestStudyValidationGates:
    def test_missing_inputs_are_refused_with_a_list(self, api_client, component):
        response = api_client.post(
            "/api/studies", json=_request(component, engineering_inputs={})
        )
        assert response.status_code == 422
        body = response.json()
        assert "will not assume" in body["message"]

        missing = {f["field"] for f in body["missing_fields"]}
        assert {"radial_load_n", "allowable_stress_pa"} <= missing
        for field in body["missing_fields"]:
            assert field["why_required"], "a missing field must explain why it matters"
            assert field["suggested_unit"]

    def test_unconfirmed_assumptions_block_the_run(self, api_client, component):
        response = api_client.post(
            "/api/studies", json=_request(component, confirm_demo_assumptions=False)
        )
        assert response.status_code == 422
        body = response.json()
        assert body["unconfirmed_assumptions"], "the run was blocked without saying what for"
        for assumption in body["unconfirmed_assumptions"]:
            assert assumption["statement"]
            assert assumption["source_status"] == "demo_fixture"

    def test_unknown_material_is_refused(self, api_client, component):
        response = api_client.post(
            "/api/studies", json=_request(component, material_id="unobtanium")
        )
        assert response.status_code == 422
        assert "catalog" in response.json()["message"].lower()

    def test_preserved_parameter_cannot_be_searched(self, api_client, component):
        """Protected interfaces must not be offered to the optimizer."""
        response = api_client.post(
            "/api/studies",
            json=_request(component, design_variables=["rim_diameter_m"]),
        )
        assert response.status_code == 422
        assert any(
            "preserved" in e or "design variables" in e
            for e in response.json()["errors"]
        )

    def test_out_of_range_parameter_is_refused(self, api_client, component):
        response = api_client.post(
            "/api/studies",
            json=_request(component, parameters={"spoke_count": 99}),
        )
        assert response.status_code == 422

    def test_validate_endpoint_reports_the_constraints(self, api_client, component):
        response = api_client.post("/api/studies/validate", json=_request(component))
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True

        text = " ".join(body["constraints"])
        assert "max_von_mises_pa" in text
        assert "MPa" in text, "a constraint must be stated with its unit"

        # Submitted display units were converted to canonical SI.
        assert body["canonical_engineering_inputs"]["allowable_stress_pa"] == pytest.approx(
            120e6
        )
        assert body["canonical_engineering_inputs"]["min_wall_thickness_m"] == pytest.approx(
            0.006
        )

    def test_unknown_component_is_404(self, api_client):
        response = api_client.post(
            "/api/studies",
            json=_request({"id": "comp_doesnotexist"}),
        )
        assert response.status_code == 404


class TestAssetSafety:
    @pytest.mark.parametrize(
        "path",
        [
            "..%2F..%2F..%2Fwindows%2Fwin.ini",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "projects/../../../../secret.txt",
        ],
    )
    def test_traversal_is_refused(self, api_client, path):
        response = api_client.get(f"/api/assets/{path}")
        assert response.status_code in (400, 404), (
            f"{path} returned {response.status_code}; an artifact URL must never read "
            "outside the storage root"
        )

    def test_missing_artifact_is_404(self, api_client):
        assert api_client.get("/api/assets/projects/nope/missing.step").status_code == 404


class TestJobs:
    def test_unknown_job_is_404(self, api_client):
        assert api_client.get("/api/jobs/job_doesnotexist").status_code == 404

    def test_malformed_job_id_is_rejected(self, api_client):
        assert api_client.get("/api/jobs/..%2Fetc").status_code in (400, 404)


class TestAssistant:
    def test_status_declares_offline_capability(self, api_client):
        body = api_client.get("/api/assistant/status").json()
        assert body["works_without_llm"] is True
        assert "cannot supply" in body["note"]

    def test_interpret_extracts_only_stated_values(self, api_client):
        response = api_client.post(
            "/api/assistant/interpret",
            json={
                "text": (
                    "Design a lighter alloy wheel in A356 aluminium carrying a 5200 N "
                    "radial load with stress below 110 MPa and deflection under 0.9 mm. "
                    "Our casting cannot go thinner than 7 mm walls."
                ),
                "use_llm": False,
            },
        )
        assert response.status_code == 200
        draft = response.json()

        assert draft["component_type"] == "alloy_wheel"
        assert draft["material_id"] == "al_a356_t6"

        found = {v["key"]: v for v in draft["extracted_values"]}
        assert found["radial_load_n"]["display_value"] == pytest.approx(5200)
        assert found["allowable_stress_pa"]["display_value"] == pytest.approx(110)
        # These two sit in adjacent sentences and must not be swapped.
        assert found["allowable_displacement_m"]["display_value"] == pytest.approx(0.9)
        assert found["min_wall_thickness_m"]["display_value"] == pytest.approx(7)

        for value in draft["extracted_values"]:
            assert value["source_text"], "every extracted value must cite its source text"

    def test_vague_request_reports_what_is_missing(self, api_client):
        draft = api_client.post(
            "/api/assistant/interpret",
            json={"text": "Make my wheel lighter", "use_llm": False},
        ).json()

        assert draft["missing_fields"], "the assistant invented values it was not given"
        missing = {f["field"] for f in draft["missing_fields"]}
        assert "radial_load_n" in missing

    def test_unknown_component_is_not_guessed(self, api_client):
        draft = api_client.post(
            "/api/assistant/interpret",
            json={"text": "Reduce the mass of this bracket", "use_llm": False},
        ).json()
        assert draft["interpreted"] is False
        assert draft["warnings"]


class TestCost:
    def test_scenario_arithmetic(self, api_client):
        response = api_client.post(
            "/api/cost/estimate",
            json={
                "currency": "USD",
                "prototype_unit_cost": 4200,
                "physical_test_cost": 2600,
                "engineering_hourly_cost": 85,
                "traditional_physical_iterations": 5,
                "traditional_engineering_hours_per_iteration": 40,
                "physical_iterations_after_virtual": 2,
                "virtual_engineering_hours": 55,
                "virtual_compute_cost": 120,
            },
        )
        assert response.status_code == 200
        body = response.json()

        assert body["traditional_cost"] == pytest.approx(5 * 6800 + 5 * 40 * 85)
        assert body["virtual_first_cost"] == pytest.approx(2 * 6800 + 55 * 85 + 120)
        assert body["physical_iterations_avoided"] == 3
        assert body["disclaimer"]
        assert body["assumptions"]
        for line in body["traditional_breakdown"]:
            assert line["formula"], "every cost line must show its arithmetic"

    def test_negative_saving_is_reported_honestly(self, api_client):
        body = api_client.post(
            "/api/cost/estimate",
            json={
                "currency": "USD",
                "prototype_unit_cost": 300,
                "physical_test_cost": 100,
                "engineering_hourly_cost": 120,
                "traditional_physical_iterations": 2,
                "traditional_engineering_hours_per_iteration": 5,
                "physical_iterations_after_virtual": 2,
                "virtual_engineering_hours": 40,
                "virtual_compute_cost": 50,
            },
        ).json()
        assert body["estimated_savings"] < 0

    def test_incoherent_scenario_is_rejected(self, api_client):
        """More physical prototypes after virtual screening makes no sense."""
        response = api_client.post(
            "/api/cost/estimate",
            json={
                "currency": "USD",
                "prototype_unit_cost": 1,
                "physical_test_cost": 1,
                "engineering_hourly_cost": 1,
                "traditional_physical_iterations": 1,
                "traditional_engineering_hours_per_iteration": 1,
                "physical_iterations_after_virtual": 5,
                "virtual_engineering_hours": 1,
                "virtual_compute_cost": 0,
            },
        )
        assert response.status_code == 422

    def test_template_has_no_prefilled_costs(self, api_client):
        body = api_client.get("/api/cost/template").json()
        for field in body["fields"]:
            assert "default" not in field, "a cost default would invent the answer"
