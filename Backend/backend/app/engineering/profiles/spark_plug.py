"""Spark-plug engineering profile (spec 2.5).

The engineering question this profile answers is the plug's *heat range*: does
the firing end run hot enough to burn off deposits, but cool enough to avoid
pre-ignition? That makes the headline constraint a two-sided window on the peak
temperature, which is why it is expressed with a BETWEEN operator rather than a
single limit.

This profile runs genuine 3D steady-state conduction FEA on a three-material
assembly. It is not a reduced-order thermal network, and the UI labels it
accordingly.
"""
from __future__ import annotations

from app.engineering.cad.generators.spark_plug import SparkPlugGenerator
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
    ConvectionBC,
    Constraint,
    FixedTemperatureBC,
    LoadCase,
    Objective,
)

_GENERATOR = SparkPlugGenerator()


class SparkPlugProfile(ComponentProfile):
    component_type = ComponentType.SPARK_PLUG
    display_name = "Spark Plug"
    analysis_type = AnalysisType.STEADY_STATE_THERMAL
    solver_id = "skfem_steady_state_thermal"
    summary = (
        "Explore insulator nose, electrode and insulator proportions that keep the "
        "firing-end temperature inside its operating window, while preserving the "
        "thread, seat and electrode-gap interfaces."
    )
    scope_statement = (
        "Genuine 3D steady-state heat-conduction finite-element analysis of the "
        "electrode / insulator / shell assembly, with convective heat input from the "
        "combustion side, conduction into the cylinder-head seat, and convection to "
        "air at the terminal end. Each part carries its own thermal conductivity and "
        "the interfaces between them are treated as perfectly conducting."
    )
    not_in_scope = [
        "Combustion, flame propagation and cylinder pressure",
        "Spark and ignition discharge, and all electrical behaviour",
        "In-cylinder gas flow and charge motion",
        "Transient engine-cycle thermal response (this is a steady-state solution)",
        "Contact thermal resistance between the shell, insulator and electrode",
        "Deposit build-up, electrode erosion and service life",
        "Mechanical stress, thread strength and sealing performance",
    ]

    @property
    def generator(self) -> SparkPlugGenerator:
        return _GENERATOR

    def material_choices(self) -> list[str]:
        return [
            "alumina_96",
            "alumina_99",
            "nickel_alloy_electrode",
            "copper_core",
            "steel_low_carbon_shell",
        ]

    def default_material_assignments(self) -> dict[str, str]:
        """Each subdomain the generator declares needs its own material."""
        return {
            "electrode": "nickel_alloy_electrode",
            "insulator": "alumina_96",
            "shell": "steel_low_carbon_shell",
        }

    # ------------------------------------------------------- engineer inputs

    def required_inputs(self) -> list[EngineeringInputField]:
        return [
            EngineeringInputField(
                key="gas_temperature_k",
                label="Combustion-side gas temperature",
                kind="temperature",
                unit="C",
                demo_default=1173.15,  # 900 C
                why_required=(
                    "Drives the heat input. Without it there is no thermal load, and "
                    "the platform will not assume a combustion condition."
                ),
                help_text=(
                    "Representative time-averaged gas temperature seen by the firing "
                    "end at the operating point you want to assess."
                ),
            ),
            EngineeringInputField(
                key="gas_film_coefficient",
                label="Combustion-side heat transfer coefficient",
                kind="heat_transfer_coefficient",
                unit="W/(m²·K)",
                demo_default=500.0,
                why_required=(
                    "Sets how strongly combustion heat enters the firing end. Together "
                    "with the gas temperature it is the entire thermal load."
                ),
                help_text=(
                    "Effective time-averaged convective coefficient on the firing end. "
                    "This is the most uncertain input in the model."
                ),
            ),
            EngineeringInputField(
                key="head_temperature_k",
                label="Cylinder-head seat temperature",
                kind="temperature",
                unit="C",
                demo_default=423.15,  # 150 C
                why_required=(
                    "The heat sink. It sets the temperature level of the whole "
                    "solution, so the result is meaningless without it."
                ),
                help_text=(
                    "Local cylinder-head temperature where the plug seat seals, at the "
                    "operating point being assessed."
                ),
            ),
            EngineeringInputField(
                key="ambient_temperature_k",
                label="Plug-well air temperature",
                kind="temperature",
                unit="C",
                demo_default=353.15,  # 80 C
                why_required="Boundary condition for the terminal end of the plug.",
                help_text="Air temperature in the plug well above the cylinder head.",
            ),
            EngineeringInputField(
                key="ambient_film_coefficient",
                label="Plug-well heat transfer coefficient",
                kind="heat_transfer_coefficient",
                unit="W/(m²·K)",
                demo_default=25.0,
                why_required="Boundary condition for the terminal end of the plug.",
                help_text=(
                    "Convective coefficient on the exposed upper body. This is a minor "
                    "heat path compared with the seat."
                ),
            ),
            EngineeringInputField(
                key="min_operating_temperature_k",
                label="Self-cleaning temperature (lower limit)",
                kind="temperature",
                unit="C",
                demo_default=723.15,  # 450 C
                why_required=(
                    "Lower bound of the heat-range window. Below it, combustion "
                    "deposits are not burned off and the plug fouls."
                ),
                help_text=(
                    "Minimum firing-end temperature your plug must reach to stay clean."
                ),
            ),
            EngineeringInputField(
                key="max_operating_temperature_k",
                label="Pre-ignition temperature (upper limit)",
                kind="temperature",
                unit="C",
                demo_default=1123.15,  # 850 C
                why_required=(
                    "Upper bound of the heat-range window. Above it the firing end can "
                    "ignite the charge before the spark."
                ),
                help_text=(
                    "Maximum firing-end temperature you will accept before "
                    "pre-ignition risk."
                ),
            ),
        ]

    def demo_fixture_assumptions(self) -> list[Assumption]:
        return [
            Assumption(
                key="combustion_boundary_demo_fixture",
                statement=(
                    "The default thermal load - 900 C gas at a 500 W/(m²·K) film "
                    "coefficient on the firing end - is a demonstration fixture. Real "
                    "values depend on the engine, the operating point and the duty "
                    "cycle. The film coefficient in particular is the most uncertain "
                    "input in this model and the computed temperatures scale strongly "
                    "with it."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="steady_state_only",
                statement=(
                    "This is a steady-state solution: it represents a sustained "
                    "operating condition, not a warm-up, a transient load change or "
                    "any part of the engine cycle. Cyclic peak surface temperatures "
                    "are higher than a steady-state average."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="head_temperature_demo_fixture",
                statement=(
                    "The 150 C default cylinder-head seat temperature is a "
                    "demonstration fixture and is applied as a fixed temperature, "
                    "which assumes the head is an ideal sink with no contact "
                    "resistance at the seat."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="heat_range_window_demo_fixture",
                statement=(
                    "The 450 C to 850 C operating window is the commonly cited "
                    "self-cleaning to pre-ignition range for a spark plug firing end. "
                    "It is entered here as a demonstration fixture, not as a "
                    "specification from a plug or engine manufacturer. Confirm the "
                    "window that applies to your application."
                ),
                source_status=SourceStatus.DEMO_FIXTURE,
                requires_confirmation=True,
            ),
            Assumption(
                key="perfect_interfaces",
                statement=(
                    "The shell, insulator and electrode are modelled as perfectly "
                    "bonded, so no contact thermal resistance is included at their "
                    "interfaces. Real assemblies have some resistance, which would "
                    "raise the computed firing-end temperature."
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
        gas_t = float(inputs["gas_temperature_k"])
        gas_h = float(inputs["gas_film_coefficient"])
        head_t = float(inputs["head_temperature_k"])
        amb_t = float(inputs["ambient_temperature_k"])
        amb_h = float(inputs["ambient_film_coefficient"])

        return [
            LoadCase(
                case_id="steady_state_operating",
                name="Steady-state operating condition",
                analysis_type=AnalysisType.STEADY_STATE_THERMAL,
                description=(
                    f"Convective heat input on the firing end from gas at "
                    f"{gas_t - 273.15:.0f} C with h = {gas_h:.0f} W/(m²·K); seat held "
                    f"at the cylinder-head temperature of {head_t - 273.15:.0f} C; "
                    f"terminal end losing heat to {amb_t - 273.15:.0f} C air at "
                    f"h = {amb_h:.0f} W/(m²·K)."
                ),
                thermal_boundary_conditions=[
                    ConvectionBC(
                        region="combustion_exposed_surfaces",
                        film_coefficient=Quantity(value=gas_h, unit="W/(m²·K)"),
                        ambient_temperature=Quantity(value=gas_t, unit="K"),
                        note=(
                            "Combustion-side heat input. Combustion itself is not "
                            "simulated; this is a convective boundary condition."
                        ),
                    ),
                    FixedTemperatureBC(
                        region="cylinder_head_seat",
                        temperature=Quantity(value=head_t, unit="K"),
                        note=(
                            "Thread and seat held at the cylinder-head temperature, "
                            "assuming ideal thermal contact."
                        ),
                    ),
                    ConvectionBC(
                        region="terminal_end_surfaces",
                        film_coefficient=Quantity(value=amb_h, unit="W/(m²·K)"),
                        ambient_temperature=Quantity(value=amb_t, unit="K"),
                        note="Convection to air in the plug well.",
                    ),
                ],
            )
        ]

    # ------------------------------------------------- objectives/constraints

    def default_objectives(self) -> list[Objective]:
        """Objectives, most important first.

        The heat-range window is a hard constraint, not an objective, so the
        primary objective is the peak temperature gradient: among plugs that sit
        inside the window, the better design is the one with the least thermal
        stress in the ceramic. Making peak temperature primary instead would
        simply drive the search onto the lower bound of the window, which is the
        most fouling-prone design that still passes.
        """
        return [
            Objective(
                objective_id="minimize_thermal_gradient",
                metric="max_temperature_gradient_k_per_m",
                sense=ObjectiveSense.MINIMIZE,
                label="Minimise peak temperature gradient (ceramic thermal stress proxy)",
            ),
            Objective(
                objective_id="minimize_peak_temperature",
                metric="max_temperature_k",
                sense=ObjectiveSense.MINIMIZE,
                label="Maximise margin to the pre-ignition limit",
            ),
        ]

    def build_constraints(self, inputs: dict[str, float], material_id: str) -> list[Constraint]:
        lower = float(inputs["min_operating_temperature_k"])
        upper = float(inputs["max_operating_temperature_k"])
        return [
            Constraint(
                constraint_id="heat_range_window",
                metric="max_temperature_k",
                operator=ConstraintOperator.BETWEEN,
                lower=Quantity(value=lower, unit="K"),
                upper=Quantity(value=upper, unit="K"),
                source_status=SourceStatus.USER_SUPPLIED,
                source_reference=(
                    "Self-cleaning and pre-ignition limits supplied in engineering setup"
                ),
                label="Firing-end temperature inside the heat-range window",
            ),
            Constraint(
                constraint_id="manufacturing_min_wall",
                metric="min_wall_thickness_m",
                operator=ConstraintOperator.GTE,
                limit=Quantity(value=1.0, unit="mm"),
                source_status=SourceStatus.DEMO_FIXTURE,
                source_reference=(
                    "Illustrative minimum section for the ceramic insulator wall and "
                    "shell wall"
                ),
                label="Minimum manufacturable section",
            ),
        ]
