"""Alloy-wheel engineering profile (spec 2.3)."""
from __future__ import annotations

from app.engineering.cad.generators.alloy_wheel import AlloyWheelGenerator
from app.engineering.materials.catalog import get_material
from app.engineering.profiles.base import ComponentProfile, EngineeringInputField
from app.schemas.common import (
    AnalysisType,
    Assumption,
    ComponentType,
    ConstraintOperator,
    ObjectiveSense,
    Quantity,
    SourceStatus,
)
from app.schemas.engineering import Constraint, ForceLoad, LoadCase, Objective, Support

_GENERATOR = AlloyWheelGenerator()


class AlloyWheelProfile(ComponentProfile):
    component_type = ComponentType.ALLOY_WHEEL
    display_name = "Alloy Wheel"
    analysis_type = AnalysisType.LINEAR_STATIC_STRUCTURAL
    solver_id = "skfem_linear_static"
    summary = (
        "Explore spoke, hub and rim-wall proportions that reduce wheel mass while "
        "keeping peak stress and radial deflection inside configured limits and "
        "preserving every vehicle interface."
    )
    scope_statement = (
        "Linear static structural analysis of a simplified one-piece cast-wheel "
        "template under a single configured radial road load, with the bolted joint "
        "represented as a clamped support."
    )
    not_in_scope = [
        "Wheel fatigue certification (rotary bending, radial fatigue)",
        "Impact and kerb-strike testing",
        "Tyre/wheel contact physics and inflation pressure",
        "Bolt pretension, thread and contact mechanics",
        "Casting porosity, residual stress and material defects",
        "Any regulatory or road-use approval",
    ]

    @property
    def generator(self) -> AlloyWheelGenerator:
        return _GENERATOR

    def material_choices(self) -> list[str]:
        return ["al_a356_t6", "al_6061_t6", "al_a380"]

    # ------------------------------------------------------- engineer inputs

    def required_inputs(self) -> list[EngineeringInputField]:
        return [
            EngineeringInputField(
                key="radial_load_n",
                label="Radial road load (per wheel)",
                kind="force",
                unit="N",
                demo_default=4500.0,
                why_required=(
                    "Sets the magnitude of the load case. Without it there is nothing "
                    "to solve, and the platform will not assume a vehicle mass."
                ),
                help_text=(
                    "Resultant vertical load carried by one wheel, including whatever "
                    "dynamic factor your load specification applies."
                ),
            ),
            EngineeringInputField(
                key="allowable_stress_pa",
                label="Allowable von Mises stress",
                kind="stress",
                unit="MPa",
                demo_default=120.0e6,
                why_required=(
                    "The pass/fail limit for the stress constraint. It must come from "
                    "your design standard, not from the material yield value alone."
                ),
                help_text=(
                    "Typically the material yield strength divided by your required "
                    "safety factor."
                ),
            ),
            EngineeringInputField(
                key="allowable_displacement_m",
                label="Allowable radial deflection",
                kind="length",
                unit="mm",
                demo_default=1.20e-3,
                why_required="The pass/fail limit for the stiffness constraint.",
                help_text="Maximum acceptable deflection magnitude under the load case.",
            ),
            EngineeringInputField(
                key="min_wall_thickness_m",
                label="Minimum manufacturable wall thickness",
                kind="length",
                unit="mm",
                demo_default=6.0e-3,
                why_required=(
                    "Manufacturing limit for the casting process. Candidates thinner "
                    "than this are rejected as unmanufacturable."
                ),
                help_text="Thinnest section your casting process can reliably fill.",
            ),
            EngineeringInputField(
                key="target_mass_kg",
                label="Target mass (optional)",
                kind="mass",
                unit="kg",
                required=False,
                demo_default=None,
                help_text="If supplied, adds a mass constraint in addition to the mass objective.",
            ),
        ]

    def demo_fixture_assumptions(self) -> list[Assumption]:
        return [
            Assumption(
                key="radial_load_demo_fixture",
                statement=(
                    "The 4500 N default radial load is a demonstration fixture chosen to "
                    "represent a loaded passenger-car corner with a dynamic factor. It is "
                    "not taken from a vehicle specification or a test standard."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="load_introduction_simplification",
                statement=(
                    "The road load is applied as a uniform traction over a 50-degree sector "
                    "of the rim outer surface. A real wheel is loaded through the tyre bead "
                    "seats with inflation pressure and contact; that is not modelled."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="bolted_joint_simplification",
                statement=(
                    "The bolted joint is represented by fully fixing the bolt-hole barrels "
                    "and the hub mounting face. Bolt pretension, friction and contact "
                    "separation are not modelled, so stress near the bolt holes is "
                    "indicative only."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="allowable_stress_demo_fixture",
                statement=(
                    "The 120 MPa default allowable stress is a demonstration value. Replace "
                    "it with the allowable from your own design standard, derived from "
                    "certified material data and your required safety factor."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="allowable_deflection_demo_fixture",
                statement=(
                    "The 1.2 mm default allowable deflection is a demonstration "
                    "serviceability limit, not a value from any standard. It was chosen "
                    "to sit inside the range this simplified template produces so that "
                    "the constraint is genuinely active across the design space - "
                    "candidates with thin rim walls or small dish offsets do exceed it. "
                    "Replace it with your own stiffness requirement."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="barrel_stiffness_conservatism",
                statement=(
                    "The rim is modelled as a constant-wall barrel with no bead flanges "
                    "and no drop centre. Those features stiffen a production wheel "
                    "substantially, so the deflection computed here is expected to be "
                    "larger than a real wheel of the same mass. Treat the deflection "
                    "numbers as conservative and comparative between candidates rather "
                    "than as absolute predictions."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=False,
            ),
            Assumption(
                key="geometry_simplification",
                statement=_GENERATOR.capability_note,
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=False,
            ),
        ]

    # ----------------------------------------------------------- load cases

    def build_load_cases(self, inputs: dict[str, float]) -> list[LoadCase]:
        load = float(inputs["radial_load_n"])
        return [
            LoadCase(
                case_id="radial_road_load",
                name="Radial road load",
                analysis_type=AnalysisType.LINEAR_STATIC_STRUCTURAL,
                description=(
                    f"{load:.0f} N radial load applied over a 50-degree sector of the rim "
                    "outer surface, with the bolt holes and hub mounting face fixed. "
                    "Simplified representative load case."
                ),
                loads=[
                    ForceLoad(
                        region="rim_contact_patch",
                        magnitude=Quantity(value=load, unit="N"),
                        direction=(0.0, -1.0, 0.0),
                        note="Resultant road load acting towards the contact patch.",
                    )
                ],
                supports=[
                    Support(
                        type="fixed",
                        region="bolt_hole_bearing_surfaces",
                        note="Simplified clamped bolted joint.",
                    ),
                    Support(
                        type="fixed",
                        region="hub_mounting_face",
                        note="Mounting pad seated against the hub flange.",
                    ),
                ],
            )
        ]

    # ------------------------------------------------- objectives/constraints

    def default_objectives(self) -> list[Objective]:
        return [
            Objective(
                objective_id="minimize_mass",
                metric="mass_kg",
                sense=ObjectiveSense.MINIMIZE,
                label="Minimise wheel mass",
            ),
            Objective(
                objective_id="minimize_peak_stress",
                metric="max_von_mises_pa",
                sense=ObjectiveSense.MINIMIZE,
                label="Minimise peak von Mises stress",
            ),
        ]

    def build_constraints(self, inputs: dict[str, float], material_id: str) -> list[Constraint]:
        out = [
            Constraint(
                constraint_id="stress_limit",
                metric="max_von_mises_pa",
                operator=ConstraintOperator.LTE,
                limit=Quantity(value=float(inputs["allowable_stress_pa"]) / 1e6, unit="MPa"),
                source_status=SourceStatus.USER_SUPPLIED,
                source_reference="Allowable von Mises stress supplied in engineering setup",
                label="Peak stress within allowable",
            ),
            Constraint(
                constraint_id="displacement_limit",
                metric="max_displacement_m",
                operator=ConstraintOperator.LTE,
                limit=Quantity(
                    value=float(inputs["allowable_displacement_m"]) * 1e3, unit="mm"
                ),
                source_status=SourceStatus.USER_SUPPLIED,
                source_reference="Allowable deflection supplied in engineering setup",
                label="Deflection within allowable",
            ),
            Constraint(
                constraint_id="manufacturing_min_wall",
                metric="min_wall_thickness_m",
                operator=ConstraintOperator.GTE,
                limit=Quantity(
                    value=float(inputs["min_wall_thickness_m"]) * 1e3, unit="mm"
                ),
                source_status=SourceStatus.USER_SUPPLIED,
                source_reference="Casting minimum wall thickness supplied in engineering setup",
                label="Manufacturable wall thickness",
            ),
        ]

        target = inputs.get("target_mass_kg")
        if target:
            out.append(
                Constraint(
                    constraint_id="mass_target",
                    metric="mass_kg",
                    operator=ConstraintOperator.LTE,
                    limit=Quantity(value=float(target), unit="kg"),
                    source_status=SourceStatus.USER_SUPPLIED,
                    source_reference="Target mass supplied in engineering setup",
                    label="Mass target",
                )
            )
        return out
