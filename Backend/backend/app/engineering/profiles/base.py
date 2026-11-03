"""Component engineering profiles (spec 2.2).

A *generator* knows how to build geometry. A *profile* knows the engineering:
which analysis applies, what load cases exist, which constraints and objectives
are meaningful, and which inputs the engineer must supply before anything runs.

Every default numeric engineering value offered by a profile is a labelled demo
fixture, surfaced as an :class:`Assumption` that the UI shows and that the
report prints. Nothing here is presented as a certified requirement.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from pydantic import BaseModel, Field

from app.engineering.cad.base import ComponentGenerator
from app.schemas.common import (
    AnalysisType,
    Assumption,
    ComponentType,
    DesignMode,
    MissingField,
)
from app.schemas.engineering import (
    Constraint,
    EngineeringSpecification,
    LoadCase,
    MeshSettings,
    Objective,
    SolverSettings,
)


class EngineeringInputField(BaseModel):
    """One engineering value the engineer must supply or confirm."""

    key: str
    label: str
    kind: str = Field(description="Quantity kind, e.g. force / stress / temperature")
    unit: str = Field(description="Unit the UI should present and submit")
    required: bool = True
    demo_default: Optional[float] = Field(
        default=None,
        description="A labelled demonstration value, never a recommended value.",
    )
    help_text: str = ""
    why_required: str = ""


class MeshPreset(BaseModel):
    """Named mesh fidelity. Exploration is coarse; verification is refined."""

    key: str
    label: str
    description: str
    element_size_scale: float = 1.0


MESH_PRESETS: dict[str, MeshPreset] = {
    "screening": MeshPreset(
        key="screening",
        label="Screening",
        description=(
            "Coarsest mesh, used for multi-generation optimizer runs where many "
            "evaluations matter more than absolute accuracy. Use it to rank designs "
            "against each other, then re-run the winner at verification fidelity. "
            "A mesh-refinement study is reported alongside any screening result."
        ),
        element_size_scale=1.45,
    ),
    "exploration": MeshPreset(
        key="exploration",
        label="Exploration",
        description=(
            "Coarser mesh used while searching the design space, so many candidates "
            "can be evaluated. Comparative trends are meaningful; absolute peak "
            "stress is not yet mesh-converged."
        ),
        element_size_scale=1.0,
    ),
    "verification": MeshPreset(
        key="verification",
        label="Verification",
        description=(
            "Refined mesh used to re-evaluate a selected candidate. Run alongside "
            "the exploration mesh to report a mesh-convergence comparison."
        ),
        element_size_scale=0.62,
    ),
}


class ComponentProfile(ABC):
    """The engineering definition of one component type."""

    component_type: ComponentType
    display_name: str
    summary: str
    analysis_type: AnalysisType
    solver_id: str
    #: Honest statement of which engineering domains this profile covers.
    scope_statement: str = ""
    not_in_scope: list[str] = []

    @property
    @abstractmethod
    def generator(self) -> ComponentGenerator:
        ...

    @abstractmethod
    def required_inputs(self) -> list[EngineeringInputField]:
        """Engineering values the engineer supplies (never invented)."""

    @abstractmethod
    def build_load_cases(self, inputs: dict[str, float]) -> list[LoadCase]:
        """Turn confirmed engineering inputs into solvable load cases."""

    @abstractmethod
    def default_objectives(self) -> list[Objective]:
        ...

    @abstractmethod
    def build_constraints(self, inputs: dict[str, float], material_id: str) -> list[Constraint]:
        ...

    def material_choices(self) -> list[str]:
        """Catalog material ids appropriate for this component."""
        return []

    def default_material_assignments(self) -> dict[str, str]:
        return {}

    def missing_inputs(self, inputs: dict[str, float]) -> list[MissingField]:
        out: list[MissingField] = []
        for field in self.required_inputs():
            if not field.required:
                continue
            if field.key not in inputs or inputs[field.key] is None:
                out.append(
                    MissingField(
                        field=field.key,
                        label=field.label,
                        expected_kind=field.kind,
                        why_required=field.why_required or field.help_text,
                        suggested_unit=field.unit,
                    )
                )
        return out

    def demo_fixture_inputs(self) -> dict[str, float]:
        """The labelled demonstration values used by the built-in scenario."""
        return {
            f.key: f.demo_default
            for f in self.required_inputs()
            if f.demo_default is not None
        }

    def demo_fixture_assumptions(self) -> list[Assumption]:
        """One assumption record per demo value, so the UI can label every number."""
        return []

    def mesh_settings(
        self, parameters: dict[str, float], preset: str = "exploration"
    ) -> MeshSettings:
        p = MESH_PRESETS[preset]
        hint = self.generator.mesh_size_hint(parameters)
        size = hint * p.element_size_scale
        return MeshSettings(
            target_element_size_m=size,
            min_element_size_m=size * 0.45,
            element_order=2,
        )

    def solver_settings(self, timeout_seconds: int = 600) -> SolverSettings:
        return SolverSettings(solver_id=self.solver_id, timeout_seconds=timeout_seconds)

    # -------------------------------------------------------------- assembly

    def build_specification(
        self,
        *,
        design_mode: DesignMode,
        objective_summary: str,
        material_id: str,
        parameters: dict[str, float],
        inputs: dict[str, float],
        design_variables: Optional[list[str]] = None,
        candidate_budget: int = 8,
        mesh_preset: str = "exploration",
        extra_assumptions: Optional[list[Assumption]] = None,
    ) -> EngineeringSpecification:
        """Assemble a complete, validated specification for this component."""
        return EngineeringSpecification(
            component_type=self.component_type,
            design_mode=design_mode,
            analysis_type=self.analysis_type,
            objective_summary=objective_summary,
            material_id=material_id,
            material_assignments=self.default_material_assignments(),
            parameters=parameters,
            design_variables=design_variables
            if design_variables is not None
            else self.generator.design_variable_names(),
            load_cases=self.build_load_cases(inputs),
            objectives=self.default_objectives(),
            constraints=self.build_constraints(inputs, material_id),
            mesh_settings=self.mesh_settings(parameters, mesh_preset),
            solver_settings=self.solver_settings(),
            assumptions=(self.demo_fixture_assumptions() + list(extra_assumptions or [])),
            requested_candidate_budget=candidate_budget,
        )
