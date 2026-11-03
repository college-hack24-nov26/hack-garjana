"""Live reduced-order estimate endpoint.

Answers in microseconds so the Design Lab can update while a slider moves. The
response is explicitly an estimate and says so in every field; the finite-element
run on the Experiment page remains the authoritative result.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core import units as U
from app.engineering.estimators.analytic import EstimateResult, estimate
from app.engineering.materials.catalog import get_material
from app.engineering.profiles.registry import get_profile
from app.schemas.common import ComponentType

router = APIRouter(tags=["estimate"])


class EstimateRequest(BaseModel):
    component_type: ComponentType
    #: Canonical SI parameter vector. Missing entries use the template default.
    parameters: dict[str, float] = Field(default_factory=dict)
    #: Engineering inputs in the units the profile declares.
    engineering_inputs: dict[str, float] = Field(default_factory=dict)
    material_id: str | None = None
    material_assignments: dict[str, str] = Field(default_factory=dict)


@router.post("/estimate/preview", response_model=EstimateResult)
def preview(payload: EstimateRequest) -> EstimateResult:
    try:
        profile = get_profile(payload.component_type)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    parameters = dict(profile.generator.default_parameters())
    parameters.update({k: float(v) for k, v in payload.parameters.items() if v is not None})

    # Convert the submitted display units into canonical SI, the same way a real
    # run does, so the estimate and the solve see identical inputs.
    by_key = {f.key: f for f in profile.required_inputs()}
    inputs: dict[str, float] = {}
    for key, raw in payload.engineering_inputs.items():
        field = by_key.get(key)
        if field is None or raw is None:
            continue
        try:
            inputs[key] = U.to_canonical(float(raw), field.unit)
        except Exception:
            continue
    for key, value in profile.demo_fixture_inputs().items():
        inputs.setdefault(key, value)

    assignments = dict(profile.default_material_assignments())
    assignments.update(payload.material_assignments)

    materials = {}
    primary_id = payload.material_id or (profile.material_choices() or ["steel_s355"])[0]
    try:
        materials["primary"] = get_material(primary_id)
        for key, material_id in assignments.items():
            materials[key] = get_material(material_id)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return estimate(payload.component_type, parameters, inputs, materials)
