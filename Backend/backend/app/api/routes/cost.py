"""Prototype cost and time scenario endpoints (spec 9)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.services.cost_estimator import CostEstimate, CostInputs, estimate

router = APIRouter(tags=["cost"])


@router.post("/cost/estimate", response_model=CostEstimate)
def estimate_cost(payload: CostInputs) -> CostEstimate:
    return estimate(payload)


@router.get("/cost/template")
def cost_template() -> dict[str, Any]:
    """Field descriptions for the UI form. No pre-filled cost figures."""
    return {
        "fields": [
            {
                "key": "prototype_unit_cost",
                "label": "Cost per physical prototype",
                "help": "Material, machining and assembly for one prototype part.",
                "required": True,
            },
            {
                "key": "physical_test_cost",
                "label": "Test cost per iteration",
                "help": "Rig time, instrumentation and labour for one physical test.",
                "required": True,
            },
            {
                "key": "engineering_hourly_cost",
                "label": "Engineering cost per hour",
                "required": True,
            },
            {
                "key": "traditional_physical_iterations",
                "label": "Physical iterations without virtual screening",
                "help": "How many build-test-modify cycles your current process needs.",
                "required": True,
            },
            {
                "key": "traditional_engineering_hours_per_iteration",
                "label": "Engineering hours per physical iteration",
                "required": True,
            },
            {
                "key": "physical_iterations_after_virtual",
                "label": "Physical iterations you expect to still need",
                "help": (
                    "Your judgement of how many physical prototypes remain after "
                    "virtual screening. The platform deliberately does not estimate "
                    "this for you: it is the input that decides the whole result."
                ),
                "required": True,
            },
            {
                "key": "virtual_engineering_hours",
                "label": "Engineering hours to set up and review the virtual study",
                "required": True,
            },
            {
                "key": "virtual_compute_cost",
                "label": "Compute cost for the virtual study",
                "required": False,
            },
            {
                "key": "lead_time_days_per_physical_iteration",
                "label": "Calendar days per physical iteration",
                "required": False,
            },
            {
                "key": "lead_time_days_per_virtual_study",
                "label": "Calendar days for the virtual study",
                "required": False,
            },
        ],
        "note": (
            "This calculator has no built-in savings assumption. It reports the "
            "arithmetic of the scenario you describe, and it will show a negative "
            "saving if your inputs imply one."
        ),
    }
