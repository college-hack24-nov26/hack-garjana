"""Evidence-derived model maturity.

Six states, in order. A model's state is *derived* from the evidence that
exists, by the deterministic function in this module. Nothing else may set it:
not the requirement parser, not the result explainer, not a UI field, not an
operator. The three research dossiers agree on this point and state it as a
hard rule - a language model that could assign its own maturity label could
assign "Experimentally Validated" to a model that has never been near a test
rig.

The rule that makes the ladder meaningful is that evidence which is *absent*
counts as absent. A check that did not run, a balance error that was never
computed, a validation dataset that does not exist - none of these may be read
as a pass. :func:`derive_maturity` therefore only ever climbs on positive
evidence, and the level it returns is the highest one whose entire evidence
requirement is satisfied, never the highest one not yet contradicted.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class MaturityLevel(str, Enum):
    """What a result has actually earned the right to be called.

    The ordering is the ladder; :attr:`ordinal` gives the numeric level used in
    the research dossiers (Level 0 through Level 5).
    """

    VIRTUAL_PROTOTYPE = "virtual_prototype"
    SIMULATION_EVALUATED = "simulation_evaluated"
    NUMERICALLY_VERIFIED = "numerically_verified"
    EXPERIMENTALLY_VALIDATED = "experimentally_validated"
    CALIBRATED_COMPONENT_TWIN = "calibrated_component_twin"
    OPERATIONAL_PREDICTIVE_TWIN = "operational_predictive_twin"

    @property
    def ordinal(self) -> int:
        return _ORDER.index(self)

    @property
    def label(self) -> str:
        return _LABELS[self]

    def __lt__(self, other: object) -> bool:  # type: ignore[override]
        if not isinstance(other, MaturityLevel):
            return NotImplemented
        return self.ordinal < other.ordinal


_ORDER: list[MaturityLevel] = [
    MaturityLevel.VIRTUAL_PROTOTYPE,
    MaturityLevel.SIMULATION_EVALUATED,
    MaturityLevel.NUMERICALLY_VERIFIED,
    MaturityLevel.EXPERIMENTALLY_VALIDATED,
    MaturityLevel.CALIBRATED_COMPONENT_TWIN,
    MaturityLevel.OPERATIONAL_PREDICTIVE_TWIN,
]

_LABELS: dict[MaturityLevel, str] = {
    MaturityLevel.VIRTUAL_PROTOTYPE: "Virtual prototype",
    MaturityLevel.SIMULATION_EVALUATED: "Simulation-evaluated candidate",
    MaturityLevel.NUMERICALLY_VERIFIED: "Numerically verified model",
    MaturityLevel.EXPERIMENTALLY_VALIDATED: "Experimentally validated model",
    MaturityLevel.CALIBRATED_COMPONENT_TWIN: "Calibrated component twin",
    MaturityLevel.OPERATIONAL_PREDICTIVE_TWIN: "Operational predictive twin",
}

#: What evidence each level requires before it may be claimed.
EVIDENCE_REQUIREMENTS: dict[MaturityLevel, str] = {
    MaturityLevel.VIRTUAL_PROTOTYPE: (
        "Parametric geometry built inside its declared design envelope and "
        "passing the geometry gate. No solver has run."
    ),
    MaturityLevel.SIMULATION_EVALUATED: (
        "A mesh was generated, a solver ran to completion, its result fields "
        "parsed, and the configured constraints were evaluated against metrics "
        "the solver computed."
    ),
    MaturityLevel.NUMERICALLY_VERIFIED: (
        "Every pre-solver and post-solver assurance check passed, the solver "
        "path passed its analytical benchmark, load/reaction balance closed "
        "within tolerance, and a mesh-refinement study showed the decision "
        "metric converged."
    ),
    MaturityLevel.EXPERIMENTALLY_VALIDATED: (
        "Predictions were compared against independent physical measurements "
        "with stated measurement uncertainty, inside a declared intended-use "
        "domain, on a dataset not used for calibration."
    ),
    MaturityLevel.CALIBRATED_COMPONENT_TWIN: (
        "The model is bound to a uniquely identified physical part and its "
        "parameters were updated from that part's measurements, with an "
        "independent holdout retained."
    ),
    MaturityLevel.OPERATIONAL_PREDICTIVE_TWIN: (
        "A continuous operational data link, model-drift monitoring and a "
        "remaining-life estimate are live for the identified physical asset."
    ),
}

#: What a level does *not* entitle anyone to claim.
PROHIBITED_AT_LEVEL: dict[MaturityLevel, tuple[str, ...]] = {
    MaturityLevel.VIRTUAL_PROTOTYPE: (
        "No structural, thermal or performance claim of any kind.",
        "No statement that the part is feasible, safe or manufacturable.",
    ),
    MaturityLevel.SIMULATION_EVALUATED: (
        "Feasible only under this specific solver model, mesh and load case.",
        "No road-safety, durability, fatigue-life or production-release claim.",
        "No claim of numerical accuracy - the verification gates have not all passed.",
    ),
    MaturityLevel.NUMERICALLY_VERIFIED: (
        "Numerically sound, not physically accurate: no physical-accuracy "
        "claim without experimental correlation.",
        "No fatigue-life, certification or homologation claim.",
    ),
    MaturityLevel.EXPERIMENTALLY_VALIDATED: (
        "Valid only for the boundary conditions and operating regime tested.",
        "No extrapolation outside the declared intended-use domain.",
    ),
    MaturityLevel.CALIBRATED_COMPONENT_TWIN: (
        "Specific to the identified physical instance; no generalisation "
        "across uncalibrated parts, lots or processes.",
    ),
    MaturityLevel.OPERATIONAL_PREDICTIVE_TWIN: (
        "No autonomous physical actuation or release without explicit human "
        "sign-off.",
    ),
}


class MaturityAssessment(BaseModel):
    """The derived maturity of one result, with the reasoning kept attached.

    ``blocked_from`` and ``blocking_reasons`` are the useful half of this
    record: they say which level the evidence came closest to and exactly what
    was missing, so the gap is visible instead of being rounded away.
    """

    level: MaturityLevel
    level_ordinal: int
    label: str
    #: Why this level and not a lower one.
    basis: list[str] = Field(default_factory=list)
    #: The next level up, if there is one.
    blocked_from: Optional[MaturityLevel] = None
    #: Exactly what evidence the next level lacks.
    blocking_reasons: list[str] = Field(default_factory=list)
    evidence_requirement: str = ""
    prohibited_claims: list[str] = Field(default_factory=list)
    #: The domain this result may be used in. Never widened automatically.
    intended_use_domain: str = ""
    #: ISO-8601 date of the newest piece of evidence behind this level.
    last_evidence_date: Optional[str] = None
    unresolved_limitations: list[str] = Field(default_factory=list)
    #: Fixed text, present on every assessment, naming who may set this.
    derivation: str = (
        "Derived deterministically from recorded evidence. No language model "
        "assigns or raises this level."
    )

    @property
    def statement(self) -> str:
        return f"{self.label} (Level {self.level_ordinal})"


def derive_maturity(
    *,
    geometry_valid: bool,
    solver_completed: bool,
    results_parsed: bool,
    constraints_evaluated: bool,
    verification_passed: Optional[bool],
    benchmark_passed: Optional[bool],
    balance_closed: Optional[bool],
    mesh_converged: Optional[bool],
    validation_status: str = "not_available",
    calibration_bound_to_instance: bool = False,
    operational_link_live: bool = False,
    intended_use_domain: str = "",
    limitations: Optional[list[str]] = None,
    last_evidence_date: Optional[str] = None,
) -> MaturityAssessment:
    """Compute the maturity level the recorded evidence actually supports.

    Every ``Optional[bool]`` argument distinguishes three real states: ``True``
    (the check ran and passed), ``False`` (it ran and failed) and ``None`` (it
    did not run, or its result was never recorded). ``None`` and ``False`` both
    block the level that depends on them. This is the rule the dossiers call
    out specifically: missing evidence must stay "not available" and must never
    be converted into a pass.
    """
    basis: list[str] = []
    blocking: list[str] = []
    level = MaturityLevel.VIRTUAL_PROTOTYPE

    # ------------------------------------------------- Level 0: the geometry
    if not geometry_valid:
        return MaturityAssessment(
            level=MaturityLevel.VIRTUAL_PROTOTYPE,
            level_ordinal=0,
            label=_LABELS[MaturityLevel.VIRTUAL_PROTOTYPE],
            basis=["The geometry gate did not pass, so nothing downstream exists."],
            blocked_from=MaturityLevel.SIMULATION_EVALUATED,
            blocking_reasons=["The candidate has no valid solid."],
            evidence_requirement=EVIDENCE_REQUIREMENTS[MaturityLevel.VIRTUAL_PROTOTYPE],
            prohibited_claims=list(PROHIBITED_AT_LEVEL[MaturityLevel.VIRTUAL_PROTOTYPE]),
            intended_use_domain=intended_use_domain or "Geometry exploration only.",
            last_evidence_date=last_evidence_date,
            unresolved_limitations=list(limitations or []),
        )
    basis.append("A valid parametric solid was built and passed the geometry gate.")

    # ------------------------------------------- Level 1: a solver actually ran
    sim_evidence = [
        (solver_completed, "the solver did not run to completion"),
        (results_parsed, "the solver's result fields were not read back and verified"),
        (constraints_evaluated, "no constraint was evaluated against a computed metric"),
    ]
    sim_missing = [why for ok, why in sim_evidence if not ok]
    if sim_missing:
        blocking = sim_missing
        return _assemble(
            level,
            basis,
            MaturityLevel.SIMULATION_EVALUATED,
            blocking,
            intended_use_domain or "Geometry exploration only.",
            limitations,
            last_evidence_date,
        )
    level = MaturityLevel.SIMULATION_EVALUATED
    basis.append(
        "A solver ran to completion, its fields were parsed and the configured "
        "constraints were evaluated against computed metrics."
    )

    # ------------------------------------- Level 2: the numerical checks closed
    # Each item carries two phrasings, because "it failed" and "nobody
    # measured it" are different facts and a reader needs to know which one
    # they are looking at. Both block the level; only one is a defect.
    ver_evidence = [
        (
            verification_passed,
            "one or more assurance checks failed",
            "not every assurance check produced a pass",
        ),
        (
            benchmark_passed,
            "the solver path did not match its analytical benchmark",
            "no analytical benchmark evidence is on record for this solver path",
        ),
        (
            balance_closed,
            "the load or energy balance did not close within tolerance",
            "the load and energy balances were not both recorded",
        ),
        (
            mesh_converged,
            # This flag now carries the decision quantity alone, which is what
            # the research prescribes judging convergence on. Region-specific
            # metrics are compared too, but a singular one - a peak gradient at
            # a material interface, which grows without bound under refinement
            # - makes the study inconclusive rather than failed and does not
            # reach this flag. The advisory check names it, and an inconclusive
            # study is recorded as a standing limitation on the result.
            "the decision quantity did not converge when the mesh was refined",
            "no mesh-refinement study was run, so the result has not been shown "
            "to be mesh-independent",
        ),
    ]
    ver_missing = [
        missing if ok is None else failed
        for ok, failed, missing in ver_evidence
        if ok is not True
    ]
    if ver_missing:
        return _assemble(
            level,
            basis,
            MaturityLevel.NUMERICALLY_VERIFIED,
            ver_missing,
            intended_use_domain
            or "This specific solver model, mesh and load case only.",
            limitations,
            last_evidence_date,
        )
    level = MaturityLevel.NUMERICALLY_VERIFIED
    basis.append(
        "Every assurance check passed, the solver path matched its analytical "
        "benchmark, the load/reaction balance closed and the decision metric "
        "was mesh-converged."
    )

    # -------------------------------- Level 3: independent physical measurement
    if validation_status != "passed":
        reason = {
            "not_available": "no independent physical measurement exists",
            "calibration_only": (
                "the only physical data available was used for calibration, so it "
                "cannot also serve as independent validation"
            ),
            "failed": "the comparison against physical measurement did not pass",
            "not_run": "the comparison against physical measurement was not run",
        }.get(validation_status, f"validation status is {validation_status!r}")
        return _assemble(
            level,
            basis,
            MaturityLevel.EXPERIMENTALLY_VALIDATED,
            [reason],
            intended_use_domain or "Numerical prediction within the verified model scope.",
            limitations,
            last_evidence_date,
        )
    level = MaturityLevel.EXPERIMENTALLY_VALIDATED
    basis.append(
        "Predictions were compared against independent physical measurements "
        "inside a declared intended-use domain."
    )

    # ------------------------------------ Level 4: bound to a physical instance
    if not calibration_bound_to_instance:
        return _assemble(
            level,
            basis,
            MaturityLevel.CALIBRATED_COMPONENT_TWIN,
            ["the model is not bound to a uniquely identified physical part"],
            intended_use_domain,
            limitations,
            last_evidence_date,
        )
    level = MaturityLevel.CALIBRATED_COMPONENT_TWIN
    basis.append("The model is calibrated against a uniquely identified physical part.")

    # ----------------------------------------- Level 5: a live operational link
    if not operational_link_live:
        return _assemble(
            level,
            basis,
            MaturityLevel.OPERATIONAL_PREDICTIVE_TWIN,
            ["there is no live operational data link or drift monitoring"],
            intended_use_domain,
            limitations,
            last_evidence_date,
        )
    basis.append("A live operational data link with drift monitoring is in place.")
    return _assemble(
        MaturityLevel.OPERATIONAL_PREDICTIVE_TWIN,
        basis,
        None,
        [],
        intended_use_domain,
        limitations,
        last_evidence_date,
    )


def _assemble(
    level: MaturityLevel,
    basis: list[str],
    blocked_from: Optional[MaturityLevel],
    blocking: list[str],
    domain: str,
    limitations: Optional[list[str]],
    last_evidence_date: Optional[str],
) -> MaturityAssessment:
    return MaturityAssessment(
        level=level,
        level_ordinal=level.ordinal,
        label=level.label,
        basis=basis,
        blocked_from=blocked_from,
        blocking_reasons=blocking,
        evidence_requirement=EVIDENCE_REQUIREMENTS[level],
        prohibited_claims=list(PROHIBITED_AT_LEVEL[level]),
        intended_use_domain=domain,
        last_evidence_date=last_evidence_date,
        unresolved_limitations=list(limitations or []),
    )
