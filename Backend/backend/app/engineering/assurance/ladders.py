"""Component validation ladders and the fidelity ladder.

Three ladders, one per component profile: W0-W4 for the alloy wheel, C0-C4 for
the brake caliper, S0-S4 for the spark plug. Each rung states the capability it
represents and the evidence it requires. ``attained`` marks the rung this
installation has actually built and verified; every rung above it is documented
so that the distance between what the platform does and what the component
would need for a durability claim is visible rather than implied.

This is the structure the research dossiers ask for by name, and the reason
they ask for it is that "we simulated a wheel" and "we can predict a wheel's
fatigue life" sound similar and are separated by three rungs of physical
testing. Writing the rungs down is what stops the first from being read as the
second.

The fidelity ladder F0-F4 is a different axis: not how much evidence a model
has, but how expensive the model is. F0 is the reduced-order estimator used for
live preview, F2 is the finite-element path, and the gate on each rung states
what must be true before a result from it may be used for a decision.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import AnalysisType, ComponentType


class LadderRung(BaseModel):
    """One rung of a component validation ladder."""

    level: str
    capability: str
    #: What must exist before this rung may be claimed.
    evidence_required: str
    #: The release label this rung earns, in the dossiers' own words.
    release_label: str
    #: True only for rungs this installation has built and verified.
    attained: bool = False
    #: Why the rung is not attained, when it is not.
    gap: Optional[str] = None


class ComponentLadder(BaseModel):
    component_type: ComponentType
    prefix: str
    title: str
    rungs: list[LadderRung] = Field(default_factory=list)

    @property
    def attained_level(self) -> str:
        attained = [r for r in self.rungs if r.attained]
        return attained[-1].level if attained else f"{self.prefix}-none"

    @property
    def attained_rung(self) -> Optional[LadderRung]:
        attained = [r for r in self.rungs if r.attained]
        return attained[-1] if attained else None

    @property
    def next_rung(self) -> Optional[LadderRung]:
        for rung in self.rungs:
            if not rung.attained:
                return rung
        return None


WHEEL_LADDER = ComponentLadder(
    component_type=ComponentType.ALLOY_WHEEL,
    prefix="W",
    title="Alloy wheel structural validation ladder",
    rungs=[
        LadderRung(
            level="W0",
            capability=(
                "Analytical code verification: cantilever beam and annular plate "
                "benchmarks against closed-form elasticity solutions."
            ),
            evidence_required=(
                "A known reference solution, element and mesh sensitivity, and a "
                "closed reaction balance."
            ),
            release_label="Numerically verified solver path.",
            attained=True,
        ),
        LadderRung(
            level="W1",
            capability=(
                "Linear static wheel model with an explicit hub support and one "
                "stated radial or bending-equivalent load."
            ),
            evidence_required=(
                "Mass, peak von Mises stress, displacement, preserved interfaces "
                "and a mesh-convergence study."
            ),
            release_label="Simulation evaluated. No fatigue claim.",
            attained=True,
        ),
        LadderRung(
            level="W2",
            capability=(
                "Separate radial-drum and cornering fatigue test-configuration "
                "models, each with its own boundary conditions."
            ),
            evidence_required=(
                "Mounting, tyre, inflation pressure, bead-seat, fixture and "
                "contact assumptions stated per configuration."
            ),
            release_label="Test-configuration model.",
            gap=(
                "The platform applies one declared equivalent load case. It has no "
                "tyre model, no bead-seat interference fit and no inflation "
                "pressure, so the radial and cornering configurations are not "
                "separately represented."
            ),
        ),
        LadderRung(
            level="W3",
            capability="Tyre-rim and biaxial bench interaction.",
            evidence_required=(
                "Fixture kinematics, camber and overturning moment, tyre-rim "
                "contact forces and correlation against bench measurement."
            ),
            release_label="Validated only for the tested domain.",
            gap="No tyre-rim contact model and no bench measurement data.",
        ),
        LadderRung(
            level="W4",
            capability="Measured duty-cycle fatigue and damage accumulation.",
            evidence_required=(
                "Material fatigue data, rainflow cycle counting, a critical-plane "
                "multiaxial criterion, and failure location and life compared "
                "against an independent bench test."
            ),
            release_label="Fatigue prediction validated only within the tested domain.",
            gap=(
                "The analysis is linear static. There is no load spectrum, no cycle "
                "counting and no fatigue criterion, so no life may be stated."
            ),
        ),
    ],
)

CALIPER_LADDER = ComponentLadder(
    component_type=ComponentType.BRAKE_CALIPER,
    prefix="C",
    title="Brake caliper structural validation ladder",
    rungs=[
        LadderRung(
            level="C0",
            capability=(
                "Analytical code verification: a clamped block under uniform "
                "pressure against its closed-form deformation."
            ),
            evidence_required=(
                "Known displacement and stress, mesh convergence and a closed "
                "force balance."
            ),
            release_label="Numerically verified solver path.",
            attained=True,
        ),
        LadderRung(
            level="C1",
            capability=(
                "Simplified caliper body with a declared mounting condition and a "
                "declared pad reaction."
            ),
            evidence_required=(
                "Mass, stress and displacement, the pressure-to-force conversion "
                "stated explicitly, and semantic interfaces preserved."
            ),
            release_label="Simulation evaluated under a declared equivalent load.",
            attained=True,
        ),
        LadderRung(
            level="C2",
            capability=(
                "Piston-pad-disc-caliper-carrier assembly with resolved contacts."
            ),
            evidence_required=(
                "Contact behaviour, pressure transfer across the interfaces, "
                "convergence, and strain and displacement measurements."
            ),
            release_label="Assembly contact model.",
            gap=(
                "The solver path is linear with no contact mechanics. Piston, pad, "
                "disc and carrier are not modelled; their effect is collapsed into "
                "a declared equivalent clamping load."
            ),
        ),
        LadderRung(
            level="C3",
            capability="Static and rotating inertial dynamometer correlation.",
            evidence_required=(
                "Pressure ramps, disc speed, strain gauges, dial gauges, "
                "thermocouples and measured fixture compliance."
            ),
            release_label="Validated only for the tested domain.",
            gap=(
                "No dynamometer data. The published Scalmalloy caliper study found "
                "static correlation did not carry over to the rotating condition, "
                "so this rung cannot be inferred from C1."
            ),
        ),
        LadderRung(
            level="C4",
            capability="Thermomechanical fatigue and wear.",
            evidence_required=(
                "Temperature-dependent properties, stress histories, material "
                "fatigue and wear data, and independent test correlation."
            ),
            release_label="Durability prediction validated only within the tested domain.",
            gap=(
                "The caliper analysis is isothermal and structural only. There is "
                "no friction heating, no thermal gradient and no wear model."
            ),
        ),
    ],
)

SPARK_PLUG_LADDER = ComponentLadder(
    component_type=ComponentType.SPARK_PLUG,
    prefix="S",
    title="Spark plug thermal validation ladder",
    rungs=[
        LadderRung(
            level="S0",
            capability="One-dimensional thermal resistance network.",
            evidence_required=(
                "Hand-checkable temperature drops, heat flow and a closed energy "
                "balance."
            ),
            release_label="Numerically verified solver path.",
            attained=True,
        ),
        LadderRung(
            level="S1",
            capability=(
                "Three-dimensional steady conduction through shell, insulator and "
                "electrodes, with per-material conductivity."
            ),
            evidence_required=(
                "Material and interface provenance, boundary-condition provenance, "
                "a mesh study and a closed energy balance."
            ),
            release_label="Simulation evaluated under a declared reduced thermal model.",
            attained=True,
        ),
        LadderRung(
            level="S2",
            capability="Engine-coupled or cycle-averaged heat input.",
            evidence_required=(
                "A stated operating point, a crank-angle or heat-flux model, and "
                "justification for the cycle averaging."
            ),
            release_label="Operating-point thermal model.",
            gap=(
                "The firing-end boundary is a declared convective film condition, "
                "not a combustion-derived heat flux. No engine operating point is "
                "represented, so the absolute temperature level is model-specific."
            ),
        ),
        LadderRung(
            level="S3",
            capability="Instrumented plug or engine test.",
            evidence_required=(
                "Sensor location, type and calibration, stated engine conditions "
                "and an independent validation dataset."
            ),
            release_label="Validated only for the tested operating points.",
            gap=(
                "No thermocouple data. The published combustion-coupled work needed "
                "heat-transfer-coefficient tuning against measurement to reach "
                "±10%, which this model has not had."
            ),
        ),
        LadderRung(
            level="S4",
            capability="Electrode erosion, oxidation and interface degradation.",
            evidence_required=(
                "Specialist multiphysics coupling plus microscopy, wear or erosion "
                "comparison."
            ),
            release_label="Degradation prediction validated only within the tested domain.",
            gap=(
                "Steady conduction cannot represent arc discharge, plasma energy "
                "transfer or material ablation. This is a different physics path, "
                "not a refinement of S1."
            ),
        ),
    ],
)

LADDERS: dict[ComponentType, ComponentLadder] = {
    ComponentType.ALLOY_WHEEL: WHEEL_LADDER,
    ComponentType.BRAKE_CALIPER: CALIPER_LADDER,
    ComponentType.SPARK_PLUG: SPARK_PLUG_LADDER,
}


def ladder_for(component_type: ComponentType) -> ComponentLadder:
    return LADDERS[component_type]


# --------------------------------------------------------------- fidelity ladder


class FidelityRung(BaseModel):
    level: str
    method: str
    use: str
    #: What must be true before a result at this fidelity may inform a decision.
    gate: str
    available: bool = False


FIDELITY_LADDER: list[FidelityRung] = [
    FidelityRung(
        level="F0",
        method=(
            "Closed-form analytical estimators: beam and plate bending, a thermal "
            "resistance network."
        ),
        use="Live preview while a parameter is being edited; initial screening.",
        gate=(
            "A known solution with its model scope documented, and a measured "
            "calibration note against the finite-element path."
        ),
        available=True,
    ),
    FidelityRung(
        level="F1",
        method="Coarse finite-element analysis on the screening mesh.",
        use="Rank broad design variants and remove clearly poor candidates.",
        gate="Numerical checks passed and correlation to the refined mesh recorded.",
        available=True,
    ),
    FidelityRung(
        level="F2",
        method="Refined finite-element analysis on the verification mesh.",
        use="Decision-grade candidate screening.",
        gate="Mesh convergence shown and the analytical benchmark passed.",
        available=True,
    ),
    FidelityRung(
        level="F3",
        method="Reduced-order model or surrogate trained on verified F2 results.",
        use="Many-query sensitivity and optimisation; fast what-if.",
        gate=(
            "Holdout field error, stability, uncertainty, out-of-distribution "
            "detection and a deterministic fallback to F2."
        ),
        available=False,
    ),
    FidelityRung(
        level="F4",
        method="Physical prototype and instrumented test.",
        use="Validate the model and the decision for an intended-use domain.",
        gate=(
            "A test protocol, measurement uncertainty, repeatability and an "
            "independent holdout."
        ),
        available=False,
    ),
]


#: Which fidelity rung each analysis path occupies.
FIDELITY_OF_ANALYSIS: dict[AnalysisType, str] = {
    AnalysisType.LINEAR_STATIC_STRUCTURAL: "F2",
    AnalysisType.STEADY_STATE_THERMAL: "F2",
    AnalysisType.REDUCED_ORDER_THERMAL: "F0",
}
