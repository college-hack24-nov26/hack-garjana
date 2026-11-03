"""Fast analytic estimators for live slider feedback (reduced-order).

A finite-element run takes tens of seconds, which is far too slow to update
while an engineer drags a slider. These closed-form models answer in
microseconds so the UI can respond immediately.

**They are not the finite-element result.** Every value returned here is tagged
``ESTIMATED`` and the UI must render it as such. They exist to show a trend
while a parameter moves, and to tell the engineer roughly where they are before
committing to a real solve. The authoritative number is always the FEA run.

Each estimator states its own model and its known error against the solver, so
the gap is visible rather than implied. Where an estimator has been compared
against FEA on the default parameter set, that comparison is recorded in
``calibration_note``.
"""
from __future__ import annotations

import math
from typing import Optional

from pydantic import BaseModel, Field

from app.engineering.materials.catalog import MaterialRecord, get_material
from app.schemas.common import ComponentType


class EstimatedMetric(BaseModel):
    """One reduced-order estimate, with the model that produced it."""

    key: str
    label: str
    value: float = Field(description="Canonical SI value")
    display_value: float
    display_unit: str
    model: str = Field(description="The closed-form relation used")
    #: Order-of-magnitude confidence in this estimate against a solver run.
    confidence: str = Field(default="trend_only", pattern="^(indicative|trend_only)$")


class EstimateResult(BaseModel):
    component_type: ComponentType
    fidelity: str = "reduced-order-v1"
    metrics: list[EstimatedMetric] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    calibration_note: str = ""
    #: Always true. Present so no caller can forget what this is.
    is_estimate: bool = True
    disclaimer: str = (
        "Reduced-order estimate for live feedback only. It is not a finite-element "
        "result and must not be used for a design decision. Run the solver for the "
        "authoritative value."
    )


# --------------------------------------------------------------------------- #
# Spark plug: lumped thermal resistance network
# --------------------------------------------------------------------------- #


def estimate_spark_plug(
    parameters: dict[str, float],
    inputs: dict[str, float],
    materials: dict[str, MaterialRecord],
) -> EstimateResult:
    """One-dimensional conduction network from firing tip to cylinder head.

    The heat path is modelled as three resistances in series: convection into
    the exposed firing end, axial conduction along the insulator nose, and
    conduction radially out through the shell wall into the seat. Electrode
    conduction is treated as a parallel path along the centre wire.

    This captures the dominant sensitivity - nose length - which is what the
    heat-range design decision turns on.
    """
    insulator = materials.get("insulator") or get_material("alumina_96")
    electrode = materials.get("electrode") or get_material("nickel_alloy_electrode")
    shell = materials.get("shell") or get_material("steel_low_carbon_shell")

    r_e = parameters["center_electrode_diameter_m"] / 2.0
    r_i = parameters["insulator_diameter_m"] / 2.0
    r_shell = parameters["thread_major_diameter_m"] / 2.0
    nose = parameters["insulator_nose_length_m"]
    protrusion = parameters["electrode_protrusion_m"]
    electrode_length = parameters["electrode_length_m"]

    gas_t = inputs.get("gas_temperature_k", 1173.15)
    gas_h = inputs.get("gas_film_coefficient", 500.0)
    head_t = inputs.get("head_temperature_k", 423.15)

    # Exposed firing-end area: insulator nose barrel plus the electrode stub.
    nose_area = 2.0 * math.pi * r_i * nose + math.pi * r_i**2
    electrode_area = 2.0 * math.pi * r_e * protrusion + math.pi * r_e**2
    exposed_area = nose_area + electrode_area

    # R1: convective film into the firing end.
    r_convection = 1.0 / max(gas_h * exposed_area, 1e-12)

    # R2: axial conduction along the insulator nose to where the shell begins.
    insulator_section = math.pi * (r_i**2 - r_e**2)
    k_insulator = insulator.thermal_conductivity or 25.0
    r_nose = nose / max(k_insulator * insulator_section, 1e-12)

    # R2b: parallel axial conduction along the centre electrode.
    electrode_section = math.pi * r_e**2
    k_electrode = electrode.thermal_conductivity or 90.0
    r_electrode = max(electrode_length - nose, 1e-4) / max(
        k_electrode * electrode_section, 1e-12
    )

    # The nose and the electrode are two parallel routes out of the firing end.
    r_parallel = 1.0 / (1.0 / r_nose + 1.0 / r_electrode)

    # R3: radial conduction through the shell wall into the seat.
    k_shell = shell.thermal_conductivity or 50.0
    wall = max(r_shell - r_i, 1e-4)
    seat_area = 2.0 * math.pi * r_shell * max(nose, 1e-3)
    r_shell_wall = wall / max(k_shell * seat_area, 1e-12)

    r_total = r_parallel + r_shell_wall
    # Steady state: heat in through the film equals heat out through the body.
    # T_tip = T_head + Q R_body, with Q = (T_gas - T_tip) / R_convection.
    tip_t = (gas_t * r_total + head_t * r_convection) / (r_total + r_convection)
    heat_flow = (gas_t - tip_t) / r_convection

    gradient = (tip_t - head_t) / max(nose, 1e-4)

    return EstimateResult(
        component_type=ComponentType.SPARK_PLUG,
        metrics=[
            EstimatedMetric(
                key="max_temperature_k",
                label="Firing-end temperature",
                value=tip_t,
                display_value=tip_t - 273.15,
                display_unit="C",
                model="series convection + parallel nose/electrode conduction + shell wall",
                confidence="indicative",
            ),
            EstimatedMetric(
                key="heat_flow_w",
                label="Heat flow to head",
                value=heat_flow,
                display_value=heat_flow,
                display_unit="W",
                model="(T_gas - T_tip) / R_convection",
                confidence="indicative",
            ),
            EstimatedMetric(
                key="max_temperature_gradient_k_per_m",
                label="Axial gradient",
                value=gradient,
                display_value=gradient / 1000.0,
                display_unit="K/mm",
                model="(T_tip - T_seat) / nose length",
                confidence="trend_only",
            ),
        ],
        assumptions=[
            "One-dimensional heat path; no circumferential or multi-dimensional spreading.",
            "Interfaces between electrode, insulator and shell are perfectly conducting.",
            "Constant material properties, evaluated at the catalog values.",
            "The cylinder-head seat is an ideal sink held at the supplied temperature.",
        ],
        calibration_note=(
            "On the default parameter set this network predicts a firing-end "
            "temperature within roughly 15 percent of the 3D conduction solve. It "
            "tracks the nose-length sensitivity correctly, which is the design "
            "variable that sets the heat range. Treat the absolute level as "
            "indicative and take the final number from the solver. "
            "Its heat flow is a different quantity from the solver's and is not "
            "comparable: this network reports the power crossing the firing-end "
            "film alone (about 37 W on the reference plug), while the solver "
            "reports the total power the whole component sheds across every "
            "boundary (about 94 W). Use the solver's figure for anything that "
            "depends on the magnitude."
        ),
    )


# --------------------------------------------------------------------------- #
# Alloy wheel: spoke bending
# --------------------------------------------------------------------------- #


def estimate_alloy_wheel(
    parameters: dict[str, float],
    inputs: dict[str, float],
    materials: dict[str, MaterialRecord],
) -> EstimateResult:
    """Radial load carried by the spokes in bending, as built-in beams.

    The loaded sector of the rim is assumed to transfer its share of the road
    load into the spokes beneath it, each treated as a cantilever of the spoke
    length with a rectangular section. This is a crude but monotonic model: it
    responds to spoke count, width, thickness and dish the way the solver does,
    which is what makes it useful while dragging a slider.
    """
    material = materials.get("primary") or get_material("al_a356_t6")
    E = material.elastic_modulus or 72e9

    r_out = parameters["rim_diameter_m"] / 2.0
    rim_wall = parameters["rim_wall_thickness_m"]
    r_rim_inner = r_out - rim_wall
    r_hub = parameters["hub_pad_diameter_m"] / 2.0
    width = parameters["rim_width_m"]

    n = max(int(round(parameters["spoke_count"])), 1)
    w_root = parameters["spoke_root_width_m"]
    w_tip = parameters["spoke_tip_width_m"]
    thickness = parameters["spoke_thickness_m"]
    dish = parameters["spoke_dish_offset_m"]

    load = inputs.get("radial_load_n", 4500.0)

    # Spoke length includes the axial dish, so a dished spoke is longer.
    radial_span = max(r_rim_inner - r_hub, 1e-3)
    length = math.hypot(radial_span, dish)

    # The whole spoke ring reacts the radial load together - some spokes in
    # bending, others carrying it in-plane - so the load is shared across all of
    # them. Crediting only the spokes directly under the contact patch was tried
    # first and overestimated peak stress by about seven times against the
    # solver; sharing across the ring brings it to within a few percent.
    load_per_spoke = load / max(n, 1)

    # Mean rectangular section.
    w_mean = 0.5 * (w_root + w_tip)
    I = w_mean * thickness**3 / 12.0
    section_modulus = w_mean * thickness**2 / 6.0

    bending_moment = load_per_spoke * length
    stress = bending_moment / max(section_modulus, 1e-12)
    deflection = load_per_spoke * length**3 / max(3.0 * E * I, 1e-12)

    # Mass from the analytic volume of rim, hub and spokes.
    rim_volume = math.pi * (r_out**2 - r_rim_inner**2) * width
    hub_volume = math.pi * r_hub**2 * parameters["hub_thickness_m"]
    bore_r = parameters["center_bore_diameter_m"] / 2.0
    hub_volume -= math.pi * bore_r**2 * parameters["hub_thickness_m"]
    spoke_volume = n * w_mean * thickness * length
    volume = rim_volume + hub_volume + spoke_volume
    mass = volume * material.density

    fos: Optional[float] = None
    if material.yield_strength and stress > 0:
        fos = material.yield_strength / stress

    metrics = [
        EstimatedMetric(
            key="mass_kg",
            label="Mass",
            value=mass,
            display_value=mass,
            display_unit="kg",
            model="analytic volume of rim barrel, hub pad and spokes x density",
            confidence="indicative",
        ),
        EstimatedMetric(
            key="max_von_mises_pa",
            label="Peak spoke stress",
            value=stress,
            display_value=stress / 1e6,
            display_unit="MPa",
            model="cantilever bending M/Z on the loaded spokes",
            confidence="trend_only",
        ),
        EstimatedMetric(
            key="max_displacement_m",
            label="Radial deflection",
            value=deflection,
            display_value=deflection * 1000.0,
            display_unit="mm",
            model="cantilever tip deflection PL^3/(3EI)",
            confidence="trend_only",
        ),
    ]
    if fos is not None:
        metrics.append(
            EstimatedMetric(
                key="min_factor_of_safety",
                label="Factor of safety",
                value=fos,
                display_value=fos,
                display_unit="-",
                model="yield strength / estimated peak stress",
                confidence="trend_only",
            )
        )

    return EstimateResult(
        component_type=ComponentType.ALLOY_WHEEL,
        metrics=metrics,
        assumptions=[
            "Spokes treated as built-in rectangular cantilevers; the rim is assumed "
            "rigid and the hub fully fixed.",
            "The radial load is shared equally across all spokes.",
            "Rim barrel ovalling and local denting are not represented at all.",
            "Stress concentrations at the spoke root are not represented.",
        ],
        calibration_note=(
            "Measured against the 3D solve on the default wheel: mass within 4 percent "
            "(both integrate the same geometry), peak stress within about 5 percent "
            "and radial deflection about 7 percent low. The deflection reads low "
            "because rim ovalling is not modelled. Good enough to follow a slider; "
            "take the committed number from the solver."
        ),
    )


# --------------------------------------------------------------------------- #
# Brake caliper: bridge bending
# --------------------------------------------------------------------------- #


def estimate_brake_caliper(
    parameters: dict[str, float],
    inputs: dict[str, float],
    materials: dict[str, MaterialRecord],
) -> EstimateResult:
    """Caliper mouth opening from bridge bending under the clamping load.

    The bridge is treated as a beam spanning the disc slot, loaded by the
    clamping force that tries to prise the two legs apart.
    """
    material = materials.get("primary") or get_material("iron_gjs_400_18")
    E = material.elastic_modulus or 169e9

    length = parameters["body_length_m"]
    gap = parameters["disc_slot_width_m"]
    wall = parameters["wall_thickness_m"]
    bridge = parameters["bridge_thickness_m"]
    height = parameters["body_height_m"]
    slot_fraction = parameters["slot_depth_fraction"]
    ribs = int(round(parameters["rib_count"]))
    rib_thickness = parameters["rib_thickness_m"]

    pressure = inputs.get("hydraulic_pressure_pa", 10e6)
    pistons = inputs.get("piston_count", 1.0) or 1.0
    bore_r = parameters["piston_bore_diameter_m"] / 2.0
    clamping = pressure * math.pi * bore_r**2 * pistons

    # Bridge section. The clamping load enters over the bore, not along the whole
    # body, so only the material near it resists the bending: the bore diameter
    # plus a spread of roughly the bridge depth either side. Crediting the full
    # body length was tried first and understated stress several times over.
    effective_width = min(length, 2.0 * bore_r + 2.0 * bridge) + ribs * rib_thickness
    I = effective_width * bridge**3 / 12.0
    section_modulus = effective_width * bridge**2 / 6.0

    span = gap + wall  # the bridge works over the slot plus a leg
    moment = clamping * span / 4.0
    stress = moment / max(section_modulus, 1e-12)
    # Simply supported centre deflection, doubled for the two legs spreading.
    opening = 2.0 * clamping * span**3 / max(48.0 * E * I, 1e-12)

    slot_depth = height * slot_fraction
    total_width = gap + 2.0 * wall
    solid = length * total_width * height
    slot_volume = length * gap * slot_depth
    bore_volume = math.pi * bore_r**2 * (0.65 * wall)
    volume = solid - slot_volume - bore_volume + ribs * rib_thickness * gap * 0.012
    mass = volume * material.density

    fos: Optional[float] = None
    if material.yield_strength and stress > 0:
        fos = material.yield_strength / stress

    metrics = [
        EstimatedMetric(
            key="mass_kg",
            label="Mass",
            value=mass,
            display_value=mass,
            display_unit="kg",
            model="analytic body volume less slot and bore x density",
            confidence="indicative",
        ),
        EstimatedMetric(
            key="max_von_mises_pa",
            label="Peak bridge stress",
            value=stress,
            display_value=stress / 1e6,
            display_unit="MPa",
            model="bridge beam bending M/Z under the clamping load",
            confidence="trend_only",
        ),
        EstimatedMetric(
            key="max_displacement_m",
            label="Mouth opening",
            value=opening,
            display_value=opening * 1000.0,
            display_unit="mm",
            model="simply supported bridge deflection PL^3/(48EI), both legs",
            confidence="trend_only",
        ),
    ]
    if fos is not None:
        metrics.append(
            EstimatedMetric(
                key="min_factor_of_safety",
                label="Factor of safety",
                value=fos,
                display_value=fos,
                display_unit="-",
                model="yield strength / estimated peak stress",
                confidence="trend_only",
            )
        )

    return EstimateResult(
        component_type=ComponentType.BRAKE_CALIPER,
        metrics=metrics,
        assumptions=[
            "The bridge is treated as a beam spanning the disc slot; the legs are "
            "assumed rigid apart from the bridge rotation.",
            "Ribs are credited as extra bridge width, which overstates their benefit.",
            "Mounting compliance and bolt behaviour are not represented.",
            f"Clamping load {clamping:.0f} N computed from the supplied pressure and "
            "the preserved bore diameter.",
        ],
        calibration_note=(
            "Mass tracks the solver within about 1 percent. Stress and mouth opening "
            "are trend indicators only and read substantially low: the solver's peak "
            "stress is a local concentration at the bore and mounting-hole edges, "
            "which a beam model of the bridge cannot represent at all, and treating "
            "the legs as rigid removes real compliance. Use the direction of change, "
            "not the magnitude, and read the committed value from the solver."
        ),
    )


_ESTIMATORS = {
    ComponentType.ALLOY_WHEEL: estimate_alloy_wheel,
    ComponentType.BRAKE_CALIPER: estimate_brake_caliper,
    ComponentType.SPARK_PLUG: estimate_spark_plug,
}


def estimate(
    component_type: ComponentType,
    parameters: dict[str, float],
    inputs: dict[str, float],
    materials: dict[str, MaterialRecord],
) -> EstimateResult:
    """Dispatch to the component's reduced-order estimator."""
    try:
        estimator = _ESTIMATORS[component_type]
    except KeyError as exc:
        raise KeyError(f"no estimator for {component_type}") from exc
    return estimator(parameters, inputs, materials)
