"""Prototype cost and time scenario calculator (spec 9).

This is a transparent scenario calculator, not evidence of savings. Every input
comes from the user; nothing is defaulted to a figure that would flatter the
result, and the output carries the arithmetic so anyone can check it.

The deliberate design rule here: the calculator will not claim a saving unless
the user supplied how many physical iterations they expect to avoid. It has no
built-in "AI saves X percent" assumption, because there is no measurement
behind such a number.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, model_validator


class CostInputs(BaseModel):
    """All scenario inputs. Currency is whatever the user works in."""

    currency: str = Field(default="USD", max_length=8)

    prototype_unit_cost: float = Field(
        ge=0, description="Material, machining and assembly for one physical prototype."
    )
    physical_test_cost: float = Field(
        ge=0, description="Test-rig and instrumentation cost per physical iteration."
    )
    engineering_hourly_cost: float = Field(ge=0)

    traditional_physical_iterations: int = Field(
        ge=0, description="Physical build-test-modify cycles without virtual screening."
    )
    traditional_engineering_hours_per_iteration: float = Field(ge=0)

    physical_iterations_after_virtual: int = Field(
        ge=0,
        description="Physical prototypes still expected after virtual screening. "
        "This is the user's own judgement, not a platform assumption.",
    )
    virtual_engineering_hours: float = Field(
        ge=0, description="Engineering time to set up and review the virtual study."
    )
    virtual_compute_cost: float = Field(
        default=0.0, ge=0, description="Compute cost for the virtual runs."
    )

    lead_time_days_per_physical_iteration: Optional[float] = Field(default=None, ge=0)
    lead_time_days_per_virtual_study: Optional[float] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _check(self) -> "CostInputs":
        if self.physical_iterations_after_virtual > self.traditional_physical_iterations:
            raise ValueError(
                "physical_iterations_after_virtual is greater than "
                "traditional_physical_iterations, which describes virtual screening "
                "making things worse. Check the inputs."
            )
        return self


class CostLine(BaseModel):
    label: str
    amount: float
    formula: str


class CostEstimate(BaseModel):
    currency: str
    inputs: CostInputs

    traditional_cost: float
    virtual_first_cost: float
    estimated_savings: float
    estimated_savings_percent: Optional[float]

    traditional_breakdown: list[CostLine] = Field(default_factory=list)
    virtual_breakdown: list[CostLine] = Field(default_factory=list)

    physical_iterations_avoided: int = 0
    traditional_lead_time_days: Optional[float] = None
    virtual_first_lead_time_days: Optional[float] = None
    lead_time_days_saved: Optional[float] = None

    #: Shown verbatim next to the number in the UI and the report.
    disclaimer: str = ""
    assumptions: list[str] = Field(default_factory=list)


_DISCLAIMER = (
    "This is a scenario calculation from the inputs you supplied, not a measured "
    "saving. The decisive input is how many physical iterations you believe virtual "
    "screening lets you skip - that is your engineering judgement, and the platform "
    "does not estimate it for you. Nothing here has been validated against your "
    "actual programme costs."
)


def estimate(inputs: CostInputs) -> CostEstimate:
    """Compute the scenario with its arithmetic exposed (spec 9.2)."""
    per_iteration = inputs.prototype_unit_cost + inputs.physical_test_cost

    traditional_hardware = inputs.traditional_physical_iterations * per_iteration
    traditional_labour = (
        inputs.traditional_physical_iterations
        * inputs.traditional_engineering_hours_per_iteration
        * inputs.engineering_hourly_cost
    )
    traditional_cost = traditional_hardware + traditional_labour

    virtual_hardware = inputs.physical_iterations_after_virtual * per_iteration
    virtual_labour = inputs.virtual_engineering_hours * inputs.engineering_hourly_cost
    virtual_cost = virtual_hardware + virtual_labour + inputs.virtual_compute_cost

    savings = traditional_cost - virtual_cost
    savings_percent = (
        (savings / traditional_cost * 100.0) if traditional_cost > 0 else None
    )

    estimate_out = CostEstimate(
        currency=inputs.currency,
        inputs=inputs,
        traditional_cost=traditional_cost,
        virtual_first_cost=virtual_cost,
        estimated_savings=savings,
        estimated_savings_percent=savings_percent,
        physical_iterations_avoided=(
            inputs.traditional_physical_iterations
            - inputs.physical_iterations_after_virtual
        ),
        disclaimer=_DISCLAIMER,
    )

    estimate_out.traditional_breakdown = [
        CostLine(
            label="Physical prototypes and testing",
            amount=traditional_hardware,
            formula=(
                f"{inputs.traditional_physical_iterations} iterations x "
                f"({inputs.prototype_unit_cost:,.2f} prototype + "
                f"{inputs.physical_test_cost:,.2f} test)"
            ),
        ),
        CostLine(
            label="Engineering labour",
            amount=traditional_labour,
            formula=(
                f"{inputs.traditional_physical_iterations} iterations x "
                f"{inputs.traditional_engineering_hours_per_iteration:g} h x "
                f"{inputs.engineering_hourly_cost:,.2f}/h"
            ),
        ),
    ]
    estimate_out.virtual_breakdown = [
        CostLine(
            label="Remaining physical prototypes and testing",
            amount=virtual_hardware,
            formula=(
                f"{inputs.physical_iterations_after_virtual} iterations x "
                f"({inputs.prototype_unit_cost:,.2f} prototype + "
                f"{inputs.physical_test_cost:,.2f} test)"
            ),
        ),
        CostLine(
            label="Virtual study engineering labour",
            amount=virtual_labour,
            formula=(
                f"{inputs.virtual_engineering_hours:g} h x "
                f"{inputs.engineering_hourly_cost:,.2f}/h"
            ),
        ),
        CostLine(
            label="Compute",
            amount=inputs.virtual_compute_cost,
            formula="as supplied",
        ),
    ]

    if (
        inputs.lead_time_days_per_physical_iteration is not None
        and inputs.lead_time_days_per_virtual_study is not None
    ):
        trad_days = (
            inputs.traditional_physical_iterations
            * inputs.lead_time_days_per_physical_iteration
        )
        virt_days = (
            inputs.physical_iterations_after_virtual
            * inputs.lead_time_days_per_physical_iteration
            + inputs.lead_time_days_per_virtual_study
        )
        estimate_out.traditional_lead_time_days = trad_days
        estimate_out.virtual_first_lead_time_days = virt_days
        estimate_out.lead_time_days_saved = trad_days - virt_days

    assumptions = [
        f"{inputs.traditional_physical_iterations} physical iterations are assumed in "
        "the traditional route (your input).",
        f"{inputs.physical_iterations_after_virtual} physical iterations are assumed to "
        "remain after virtual screening (your input, not a platform estimate).",
        "Virtual screening is assumed not to change the cost of a single physical "
        "prototype or test.",
        "Tooling, fixtures, overheads, rework and programme risk are not modelled.",
    ]
    if savings < 0:
        assumptions.append(
            "With these inputs the virtual-first route costs more, because the "
            "engineering and compute effort exceeds the saving from the avoided "
            "physical iterations."
        )
    if estimate_out.physical_iterations_avoided == 0:
        assumptions.append(
            "No physical iterations were assumed to be avoided, so any difference "
            "shown comes only from the labour and compute figures."
        )
    estimate_out.assumptions = assumptions

    return estimate_out
