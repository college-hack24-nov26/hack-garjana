"""Brake-caliper engineering profile (spec 2.4)."""
from __future__ import annotations

import math

from app.engineering.cad.generators.brake_caliper import BrakeCaliperGenerator
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
from app.schemas.engineering import (
    Constraint,
    ForceLoad,
    LoadCase,
    Objective,
    PressureLoad,
    Support,
)

_GENERATOR = BrakeCaliperGenerator()


class BrakeCaliperProfile(ComponentProfile):
    component_type = ComponentType.BRAKE_CALIPER
    display_name = "Brake Caliper"
    analysis_type = AnalysisType.LINEAR_STATIC_STRUCTURAL
    solver_id = "skfem_linear_static"
    summary = (
        "Explore caliper bridge, wall and rib proportions that cut unnecessary mass "
        "while keeping peak stress and caliper mouth opening inside configured limits "
        "and preserving the disc slot, piston bore and mounting interfaces."
    )
    scope_statement = (
        "Linear static structural analysis of a simplified fixed-caliper body under a "
        "clamping load case: hydraulic pressure on the piston bore pocket and the "
        "equal-and-opposite pad reaction on the outboard leg, with the mounting holes "
        "fixed. This is the load case that opens the caliper mouth."
    )
    not_in_scope = [
        "Hydraulic circuit, fluid compressibility and seal behaviour",
        "Piston, pad, disc and dust-boot contact mechanics",
        "Brake thermal analysis and thermal distortion",
        "Fatigue, wear and brake-system validation",
        "Brake torque reaction through the mounting bolts as a separate load case",
        "Any regulatory or road-use approval",
    ]

    @property
    def generator(self) -> BrakeCaliperGenerator:
        return _GENERATOR

    def material_choices(self) -> list[str]:
        return ["iron_gjs_400_18", "al_a380", "al_6061_t6", "steel_s355"]

    # ------------------------------------------------------- engineer inputs

    def required_inputs(self) -> list[EngineeringInputField]:
        return [
            EngineeringInputField(
                key="hydraulic_pressure_pa",
                label="Hydraulic line pressure",
                kind="pressure",
                unit="MPa",
                demo_default=10.0e6,
                why_required=(
                    "Drives the whole load case: it sets both the bore pressure and, "
                    "through the bore area, the pad clamping reaction."
                ),
                help_text=(
                    "Peak line pressure your brake system reaches. The clamping force "
                    "is computed from this and the preserved bore diameter, so it is "
                    "not entered separately."
                ),
            ),
            EngineeringInputField(
                key="allowable_stress_pa",
                label="Allowable von Mises stress",
                kind="stress",
                unit="MPa",
                demo_default=165.0e6,
                why_required="The pass/fail limit for the stress constraint.",
                help_text=(
                    "From your design standard: typically yield strength divided by "
                    "your required safety factor."
                ),
            ),
            EngineeringInputField(
                key="allowable_displacement_m",
                label="Allowable mouth opening",
                kind="length",
                unit="mm",
                demo_default=0.15e-3,
                why_required=(
                    "The stiffness limit. Excessive mouth opening wastes pedal travel "
                    "and causes uneven pad wear."
                ),
                help_text="Maximum acceptable displacement magnitude under the clamping load.",
            ),
            EngineeringInputField(
                key="min_wall_thickness_m",
                label="Minimum manufacturable wall thickness",
                kind="length",
                unit="mm",
                demo_default=7.0e-3,
                why_required=(
                    "Casting limit. Candidates thinner than this are rejected as "
                    "unmanufacturable."
                ),
                help_text="Thinnest section your casting process can reliably fill.",
            ),
            EngineeringInputField(
                key="piston_count",
                label="Pistons per side",
                kind="dimensionless",
                unit="-",
                required=False,
                demo_default=1.0,
                help_text=(
                    "Used only to scale the clamping reaction. The template models a "
                    "single bore, so values above 1 scale the load without changing "
                    "the geometry."
                ),
            ),
            EngineeringInputField(
                key="target_mass_kg",
                label="Target mass (optional)",
                kind="mass",
                unit="kg",
                required=False,
                demo_default=None,
                help_text="If supplied, adds a mass constraint alongside the mass objective.",
            ),
        ]

    def demo_fixture_assumptions(self) -> list[Assumption]:
        return [
            Assumption(
                key="hydraulic_pressure_demo_fixture",
                statement=(
                    "The 10 MPa default line pressure is a demonstration fixture "
                    "representing a firm brake application. It is not taken from a "
                    "vehicle brake-system specification."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="clamping_load_model",
                statement=(
                    "The clamping load is modelled as hydraulic pressure on the piston "
                    "bore pocket plus an equal and opposite resultant force spread over "
                    "the outboard pad abutment face. The piston, pads and disc are not "
                    "modelled, and pad pressure distribution is assumed uniform."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="mounting_constraint_simplification",
                statement=(
                    "The two mounting hole barrels are fully fixed. Bolt pretension, "
                    "friction and contact separation at the knuckle are not modelled, "
                    "so stress around the mounting holes is indicative only."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="brake_torque_not_modelled",
                statement=(
                    "Only the clamping (mouth-opening) load case is analysed. The brake "
                    "torque reaction that acts circumferentially through the mounting "
                    "bolts is a separate load case and is not included here."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="allowable_stress_demo_fixture",
                statement=(
                    "The 165 MPa default allowable stress is a demonstration value "
                    "derived as roughly the 250 MPa catalog yield of EN-GJS-400-18 "
                    "divided by a safety factor of 1.5. The 0.15 mm default mouth "
                    "opening limit is likewise illustrative. Both are stated so the "
                    "constraint is active across the design space; replace them with "
                    "limits from your own design standard and certified material data."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
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
        pressure = float(inputs["hydraulic_pressure_pa"])
        pistons = float(inputs.get("piston_count") or 1.0)

        bore_diameter = _GENERATOR.default_parameters()["piston_bore_diameter_m"]
        bore_area = math.pi * (bore_diameter / 2.0) ** 2
        clamping_force = pressure * bore_area * pistons

        return [
            LoadCase(
                case_id="clamping_load",
                name="Clamping load (mouth opening)",
                analysis_type=AnalysisType.LINEAR_STATIC_STRUCTURAL,
                description=(
                    f"{pressure / 1e6:.2f} MPa hydraulic pressure on the piston bore "
                    f"pocket, with the resulting {clamping_force:.0f} N pad reaction "
                    f"(bore area {bore_area * 1e4:.2f} cm2 x {pistons:g} piston(s)) "
                    "applied to the outboard pad abutment. Mounting holes fixed."
                ),
                loads=[
                    PressureLoad(
                        region="piston_bore_surfaces",
                        magnitude=Quantity(value=pressure / 1e6, unit="MPa"),
                        note="Hydraulic pressure acting on the bore pocket wall and base.",
                    ),
                    ForceLoad(
                        region="outboard_pad_abutment",
                        magnitude=Quantity(value=clamping_force, unit="N"),
                        direction=(0.0, 1.0, 0.0),
                        note=(
                            "Outboard pad reaction pushing the outboard leg away from "
                            "the disc, which is what opens the caliper mouth."
                        ),
                    ),
                ],
                supports=[
                    Support(
                        type="fixed",
                        region="mounting_hole_surfaces",
                        note="Simplified fixed knuckle mount.",
                    )
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
                label="Minimise caliper body mass",
            ),
            Objective(
                objective_id="minimize_mouth_opening",
                metric="max_displacement_m",
                sense=ObjectiveSense.MINIMIZE,
                label="Minimise caliper mouth opening",
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
                constraint_id="mouth_opening_limit",
                metric="max_displacement_m",
                operator=ConstraintOperator.LTE,
                limit=Quantity(
                    value=float(inputs["allowable_displacement_m"]) * 1e3, unit="mm"
                ),
                source_status=SourceStatus.USER_SUPPLIED,
                source_reference="Allowable mouth opening supplied in engineering setup",
                label="Mouth opening within allowable",
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
