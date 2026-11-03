"""Natural-language requirement parsing (spec 7).

The assistant drafts a *structured requirement proposal*. It never fills in an
engineering value it was not given: anything it cannot extract from the text is
returned in ``missing_fields`` for the engineer to supply, and anything it
inferred is returned as an assumption marked ``llm_draft_unconfirmed``.

Two paths, same output contract:

* **Offline (default)** - deterministic keyword and unit extraction. No network,
  no API key, fully reproducible. This is the path the product runs on.
* **LLM (optional)** - when an API key is configured, the model proposes the
  same structure, and the result is validated against the same Pydantic schema
  and the same missing-field logic before anything is accepted.

Neither path may invent a load, a limit, a material property or a boundary
condition, and neither can mark a run as ready. Simulation stays blocked until
the required fields are supplied or a labelled demo fixture is chosen.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.core import units as U
from app.core.logging import get_logger
from app.engineering.materials.catalog import get_catalog
from app.engineering.profiles.base import ComponentProfile
from app.engineering.profiles.registry import available_profiles, get_profile
from app.schemas.common import (
    AnalysisType,
    Assumption,
    ComponentType,
    DesignMode,
    MissingField,
    SourceStatus,
)

log = get_logger(__name__)


class ExtractedValue(BaseModel):
    """One engineering value the parser found, with the text it came from."""

    key: str
    value_canonical: float
    canonical_unit: str
    display_value: float
    display_unit: str
    source_text: str
    confidence: str = Field(default="explicit", pattern="^(explicit|inferred)$")


class RequirementDraft(BaseModel):
    """The structured proposal returned to the UI (spec 7.3)."""

    interpreted: bool
    parser: str

    component_type: Optional[ComponentType] = None
    design_mode: DesignMode = DesignMode.GENERATE_NEW
    analysis_type: Optional[AnalysisType] = None
    objective_summary: str = ""

    material_id: Optional[str] = None
    material_candidates: list[str] = Field(default_factory=list)

    engineering_inputs: dict[str, float] = Field(
        default_factory=dict, description="Canonical SI values that were extracted."
    )
    extracted_values: list[ExtractedValue] = Field(default_factory=list)

    objectives: list[str] = Field(default_factory=list)
    design_variables: list[str] = Field(default_factory=list)

    missing_fields: list[MissingField] = Field(default_factory=list)
    assumptions_requiring_confirmation: list[Assumption] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)

    @property
    def ready_to_run(self) -> bool:
        """A draft is never runnable while a required field is missing."""
        return self.component_type is not None and not self.missing_fields


# --------------------------------------------------------------------------- #
# Component and intent detection
# --------------------------------------------------------------------------- #

_COMPONENT_KEYWORDS: dict[ComponentType, tuple[str, ...]] = {
    ComponentType.ALLOY_WHEEL: (
        "wheel", "rim", "alloy wheel", "spoke", "road wheel",
    ),
    ComponentType.BRAKE_CALIPER: (
        "caliper", "calliper", "brake body", "brake caliper", "piston bore",
    ),
    ComponentType.SPARK_PLUG: (
        "spark plug", "sparkplug", "plug", "insulator", "electrode", "firing end",
    ),
}

_IMPROVE_KEYWORDS = (
    "improve", "existing", "current design", "my design", "uploaded", "redesign",
    "modify", "optimise my", "optimize my",
)

_OBJECTIVE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "minimize_mass": ("lighter", "lightweight", "reduce mass", "reduce weight",
                      "minimise mass", "minimize mass", "lose weight", "mass down"),
    "minimize_peak_stress": ("reduce stress", "lower stress", "stronger",
                             "minimise stress", "minimize stress", "stress down"),
    "minimize_deflection": ("stiffer", "reduce deflection", "less deflection",
                            "more rigid", "stiffness"),
    "thermal_window": ("cooler", "reduce temperature", "heat range",
                       "lower temperature", "thermal", "overheat"),
}


def detect_component(text: str) -> tuple[Optional[ComponentType], list[str]]:
    lowered = text.lower()
    hits: list[tuple[ComponentType, int, str]] = []
    for component, keywords in _COMPONENT_KEYWORDS.items():
        for kw in keywords:
            if kw in lowered:
                # Longer keyword matches are more specific.
                hits.append((component, len(kw), kw))
    if not hits:
        return None, []
    hits.sort(key=lambda t: -t[1])
    best = hits[0][0]
    registered = {p.component_type for p in available_profiles()}
    notes = [f"matched the phrase {hits[0][2]!r}"]
    if best not in registered:
        return None, [
            f"the text looks like a {best.value.replace('_', ' ')}, but no profile for "
            "it is registered in this installation"
        ]
    return best, notes


def detect_design_mode(text: str) -> DesignMode:
    lowered = text.lower()
    if any(kw in lowered for kw in _IMPROVE_KEYWORDS):
        return DesignMode.IMPROVE_EXISTING
    return DesignMode.GENERATE_NEW


def detect_objectives(text: str) -> list[str]:
    lowered = text.lower()
    found = [
        name
        for name, keywords in _OBJECTIVE_KEYWORDS.items()
        if any(kw in lowered for kw in keywords)
    ]
    return found


# --------------------------------------------------------------------------- #
# Quantity extraction
# --------------------------------------------------------------------------- #

#: Units the parser recognises in free text, mapped to the canonical unit kind.
_UNIT_ALIASES: dict[str, str] = {
    "n": "N", "newton": "N", "newtons": "N", "kn": "kN",
    "mpa": "MPa", "n/mm2": "MPa", "n/mm^2": "MPa", "gpa": "GPa",
    "kpa": "kPa", "pa": "Pa", "bar": "bar",
    "mm": "mm", "millimetre": "mm", "millimeter": "mm", "millimetres": "mm",
    "millimeters": "mm", "cm": "cm", "m": "m", "metre": "m", "meter": "m",
    "in": "in", "inch": "in", "inches": "in",
    "kg": "kg", "kilogram": "kg", "kilograms": "kg", "g": "g", "gram": "g",
    "c": "C", "degc": "C", "°c": "C", "celsius": "C", "k": "K", "kelvin": "K",
    "w": "W", "watt": "W", "watts": "W", "kw": "W",
}

_NUMBER = r"(-?\d+(?:[.,]\d+)?(?:e-?\d+)?)"
_QUANTITY_RE = re.compile(
    _NUMBER + r"\s*(" + "|".join(
        sorted((re.escape(u) for u in _UNIT_ALIASES), key=len, reverse=True)
    ) + r")\b",
    re.IGNORECASE,
)


class Quantity(BaseModel):
    value: float
    unit: str
    kind: str
    text: str
    position: int


def extract_quantities(text: str) -> list[Quantity]:
    """Find every number that carries a recognised unit."""
    out: list[Quantity] = []
    for match in _QUANTITY_RE.finditer(text):
        raw_number, raw_unit = match.group(1), match.group(2).lower()
        unit = _UNIT_ALIASES.get(raw_unit)
        if unit is None:
            continue
        try:
            value = float(raw_number.replace(",", "."))
        except ValueError:
            continue
        # "kw" aliases to W but means kilowatts.
        if raw_unit == "kw":
            value *= 1000.0
        try:
            kind = U.quantity_kind(unit)
        except U.UnitError:
            continue
        out.append(
            Quantity(
                value=value, unit=unit, kind=kind,
                text=match.group(0).strip(), position=match.start(),
            )
        )
    return out


#: Words near a quantity that identify which engineering input it is.
_CONTEXT_HINTS: dict[str, tuple[str, ...]] = {
    "radial_load_n": ("load", "force", "radial", "corner", "wheel load", "vertical"),
    "allowable_stress_pa": ("allowable", "stress", "limit", "yield", "maximum stress",
                            "below", "under", "not exceed"),
    "allowable_displacement_m": ("deflection", "displacement", "deform", "stiffness",
                                 "movement", "travel"),
    "min_wall_thickness_m": ("wall", "thickness", "casting", "minimum section",
                             "manufactur", "thinnest"),
    "target_mass_kg": ("target mass", "target weight", "mass target", "under",
                       "below", "weigh"),
    "hydraulic_pressure_pa": ("hydraulic", "pressure", "brake pressure", "line pressure"),
    "clamping_load_n": ("clamp", "piston", "pad"),
    "hot_end_temperature_k": ("combustion", "gas", "hot", "firing", "chamber"),
    "seat_temperature_k": ("seat", "cylinder head", "sink", "head temperature"),
    "max_allowable_temperature_k": ("allowable", "limit", "maximum temperature",
                                    "not exceed", "below"),
    "min_allowable_temperature_k": ("minimum temperature", "self-clean", "fouling",
                                    "at least", "above"),
    "heat_input_w": ("heat", "power", "thermal load", "heat input"),
}


_SENTENCE_SPLIT = re.compile(r"[.;!?\n]")


def _sentence_bounds(text: str, position: int) -> tuple[int, int]:
    """The span of the sentence containing ``position``.

    A quantity's descriptor is almost always in the same sentence as the number.
    Scoring across sentence boundaries makes neighbouring limits swap places -
    "deflection under 0.9 mm. Our casting cannot go thinner than 7 mm" would
    otherwise let the wall-thickness hints claim the deflection value.
    """
    start = 0
    end = len(text)
    for match in _SENTENCE_SPLIT.finditer(text):
        if match.start() < position:
            start = match.end()
        else:
            end = match.start()
            break
    return start, end


def assign_quantities(
    text: str, quantities: list[Quantity], profile: ComponentProfile
) -> tuple[dict[str, float], list[ExtractedValue], list[str]]:
    """Match extracted quantities to this profile's declared inputs.

    Matching is by unit compatibility plus context words in the *same sentence*,
    weighted by how close each word sits to the number. A quantity that cannot be
    assigned confidently is reported rather than forced into a field.
    """
    fields = {f.key: f for f in profile.required_inputs()}
    lowered = text.lower()
    assigned: dict[str, float] = {}
    records: list[ExtractedValue] = []
    warnings: list[str] = []

    # Score every (field, quantity) pair, then take the best unique matches.
    scored: list[tuple[float, str, Quantity]] = []
    for key, field in fields.items():
        try:
            field_kind = U.quantity_kind(field.unit)
        except U.UnitError:
            continue
        hints = _CONTEXT_HINTS.get(key, ())
        for q in quantities:
            if q.kind != field_kind:
                continue
            lo, hi = _sentence_bounds(lowered, q.position)
            sentence = lowered[lo:hi]
            offset = q.position - lo
            score = 0.0
            for hint in hints:
                # Closest occurrence of this hint wins, weighted by distance.
                best = None
                for match in re.finditer(re.escape(hint), sentence):
                    distance = abs(match.start() - offset)
                    best = distance if best is None else min(best, distance)
                if best is not None:
                    score += 1.0 / (1.0 + best / 25.0)
            if score == 0.0:
                # Unit matches but nothing identifies it; keep as a weak option.
                score = 0.1
            scored.append((score, key, q))

    scored.sort(key=lambda t: -t[0])
    used_positions: set[int] = set()
    for score, key, q in scored:
        if key in assigned or q.position in used_positions:
            continue
        if score < 0.5:
            continue
        assigned[key] = U.to_canonical(q.value, q.unit)
        used_positions.add(q.position)
        records.append(
            ExtractedValue(
                key=key,
                value_canonical=assigned[key],
                canonical_unit=U.CANONICAL[q.kind],
                display_value=q.value,
                display_unit=q.unit,
                source_text=q.text,
                confidence="explicit",
            )
        )

    leftovers = [q for q in quantities if q.position not in used_positions]
    for q in leftovers:
        warnings.append(
            f"the value {q.text!r} was recognised but could not be matched to a "
            "required engineering input, so it was not used"
        )
    return assigned, records, warnings


def detect_material(text: str, profile: ComponentProfile) -> tuple[Optional[str], list[str]]:
    """Match a material by catalog name or family, never by guessing properties."""
    lowered = text.lower()
    catalog = get_catalog()
    allowed = profile.material_choices()
    pool = [
        m
        for m in catalog.materials
        if not allowed or m.material_id in allowed
    ]

    for m in pool:
        tokens = [m.material_id.replace("_", " "), m.name.lower()]
        grade = re.sub(r"[^a-z0-9]", "", m.name.lower())
        for token in tokens:
            if token and token in lowered:
                return m.material_id, [f"matched material name {m.name!r}"]
        # Grade codes such as "a356" or "6061"
        codes = re.findall(r"[a-z]{0,2}\d{3,4}(?:-t\d)?", grade)
        for code in codes:
            if len(code) >= 4 and code in lowered.replace("-", "").replace(" ", ""):
                return m.material_id, [f"matched material grade {code!r}"]

    families = {
        "aluminium": "aluminium", "aluminum": "aluminium", "alloy": "aluminium",
        "cast iron": "ductile_cast_iron", "iron": "ductile_cast_iron",
        "steel": "carbon_steel", "alumina": "technical_ceramic",
        "ceramic": "technical_ceramic", "nickel": "nickel_alloy",
        "copper": "copper",
    }
    for word, family in families.items():
        if word in lowered:
            matches = [m for m in pool if family in m.family]
            if len(matches) == 1:
                return matches[0].material_id, [f"only one {word} option is available"]
            if matches:
                return None, [
                    f"the text mentions {word}, which matches "
                    f"{len(matches)} catalog materials: "
                    f"{', '.join(m.material_id for m in matches)}. Choose one."
                ]
    return None, []


# --------------------------------------------------------------------------- #
# Offline parser
# --------------------------------------------------------------------------- #


def parse_offline(text: str, component_type: Optional[ComponentType] = None) -> RequirementDraft:
    """Deterministic requirement extraction. No network, fully reproducible."""
    draft = RequirementDraft(interpreted=True, parser="deterministic_offline")

    if not text or not text.strip():
        draft.interpreted = False
        draft.warnings.append("no requirement text was supplied")
        return draft

    detected, notes = detect_component(text)
    draft.component_type = component_type or detected
    draft.notes.extend(notes)

    if draft.component_type is None:
        draft.interpreted = False
        draft.warnings.append(
            "the component could not be identified from the text. Choose one of: "
            + ", ".join(p.component_type.value for p in available_profiles())
        )
        return draft

    profile = get_profile(draft.component_type)
    draft.analysis_type = profile.analysis_type
    draft.design_mode = detect_design_mode(text)
    draft.design_variables = profile.generator.design_variable_names()

    quantities = extract_quantities(text)
    assigned, records, warnings = assign_quantities(text, quantities, profile)
    draft.engineering_inputs = assigned
    draft.extracted_values = records
    draft.warnings.extend(warnings)

    material_id, material_notes = detect_material(text, profile)
    draft.material_id = material_id
    draft.material_candidates = profile.material_choices()
    draft.notes.extend(material_notes)
    if material_id is None:
        draft.warnings.append(
            "no material was identified. Select one from the catalog; material "
            "properties are never inferred from the request text."
        )

    objectives = detect_objectives(text)
    draft.objectives = objectives or ["minimize_mass"]
    if not objectives:
        draft.notes.append(
            "no explicit objective was found, so mass minimisation is proposed as the "
            "default. Change it if that is not your intent."
        )

    first = text.strip().splitlines()[0][:280]
    draft.objective_summary = first

    draft.missing_fields = profile.missing_inputs(assigned)

    if draft.missing_fields:
        draft.warnings.append(
            f"{len(draft.missing_fields)} required engineering input(s) are still "
            "missing. Simulation stays blocked until they are supplied, or until you "
            "explicitly choose the labelled demonstration fixture."
        )

    for a in profile.demo_fixture_assumptions():
        if a.requires_confirmation:
            draft.assumptions_requiring_confirmation.append(a)

    return draft


# --------------------------------------------------------------------------- #
# Optional LLM parser
# --------------------------------------------------------------------------- #

_LLM_SYSTEM_PROMPT = """You convert an automotive engineer's request into a strict JSON draft.

Rules you must follow:
- Extract ONLY values the engineer actually stated. Never invent a load, a stress
  limit, a deflection limit, a temperature, a thickness or a material property.
- If a value is not stated, omit the key. Do not estimate it.
- Every numeric value you return must include the unit the engineer used.
- You are drafting inputs for review. You are not approving a simulation.

Return ONLY a JSON object with these keys:
{
  "component_type": "alloy_wheel" | "brake_caliper" | "spark_plug" | null,
  "design_mode": "improve_existing" | "generate_new",
  "objective_summary": string,
  "objectives": [string],
  "material_hint": string | null,
  "values": [{"key": string, "value": number, "unit": string, "source_text": string}],
  "notes": [string]
}

Valid value keys: %s
"""


def parse_with_llm(
    text: str, component_type: Optional[ComponentType] = None, timeout: float = 30.0
) -> RequirementDraft:
    """Ask a configured LLM to draft the structure, then validate it strictly.

    The model's output is never trusted directly: units are re-converted here,
    unknown keys are dropped, and the missing-field check is recomputed from the
    profile. If anything about the response is unusable, the offline parser's
    result is returned instead.
    """
    from app.core.config import get_settings

    settings = get_settings()
    if not settings.llm_available:
        draft = parse_offline(text, component_type)
        draft.notes.append(
            "no LLM is configured, so the deterministic offline parser was used"
        )
        return draft

    baseline = parse_offline(text, component_type)

    try:
        import httpx

        keys = sorted(
            {f.key for p in available_profiles() for f in p.required_inputs()}
        )
        response = httpx.post(
            settings.llm_base_url,
            headers={
                "x-api-key": settings.llm_api_key or "",
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": settings.llm_model,
                "max_tokens": 1200,
                "system": _LLM_SYSTEM_PROMPT % ", ".join(keys),
                "messages": [{"role": "user", "content": text}],
            },
            timeout=timeout,
        )
        response.raise_for_status()
        body = response.json()
        content = "".join(
            block.get("text", "")
            for block in body.get("content", [])
            if block.get("type") == "text"
        )
        payload = _extract_json(content)
        if payload is None:
            raise ValueError("the model did not return a JSON object")
    except Exception as exc:
        log.warning("LLM parsing failed (%s); using the offline parser", exc)
        baseline.notes.append(
            f"the language model could not be used ({exc}); the deterministic offline "
            "parser produced this draft instead"
        )
        return baseline

    return _draft_from_llm(payload, text, component_type, baseline)


def _extract_json(content: str) -> Optional[dict[str, Any]]:
    content = content.strip()
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(content[start : end + 1])
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _draft_from_llm(
    payload: dict[str, Any],
    text: str,
    requested_component: Optional[ComponentType],
    baseline: RequirementDraft,
) -> RequirementDraft:
    """Validate an LLM proposal against the real schema and profile."""
    draft = RequirementDraft(interpreted=True, parser="llm_validated")

    raw_component = payload.get("component_type")
    component: Optional[ComponentType] = requested_component
    if component is None and isinstance(raw_component, str):
        try:
            component = ComponentType(raw_component)
        except ValueError:
            draft.warnings.append(
                f"the model proposed an unknown component type {raw_component!r}, "
                "which was discarded"
            )
    if component is None:
        component = baseline.component_type
    if component is None:
        return baseline

    try:
        profile = get_profile(component)
    except KeyError:
        return baseline

    draft.component_type = component
    draft.analysis_type = profile.analysis_type
    draft.design_variables = profile.generator.design_variable_names()
    draft.material_candidates = profile.material_choices()

    mode = payload.get("design_mode")
    draft.design_mode = (
        DesignMode(mode)
        if isinstance(mode, str) and mode in {m.value for m in DesignMode}
        else detect_design_mode(text)
    )

    summary = payload.get("objective_summary")
    draft.objective_summary = (
        summary.strip()[:280] if isinstance(summary, str) and summary.strip() else baseline.objective_summary
    )

    objectives = payload.get("objectives")
    draft.objectives = (
        [str(o) for o in objectives][:6]
        if isinstance(objectives, list) and objectives
        else baseline.objectives
    )

    valid_keys = {f.key: f for f in profile.required_inputs()}
    for item in payload.get("values") or []:
        if not isinstance(item, dict):
            continue
        key, value, unit = item.get("key"), item.get("value"), item.get("unit")
        if key not in valid_keys:
            if key:
                draft.warnings.append(
                    f"the model proposed {key!r}, which is not an input of this "
                    "component profile, so it was discarded"
                )
            continue
        if not isinstance(value, (int, float)):
            continue
        field = valid_keys[key]
        normalized = _UNIT_ALIASES.get(str(unit).lower(), unit)
        try:
            canonical = U.to_canonical(float(value), str(normalized))
            if U.quantity_kind(str(normalized)) != U.quantity_kind(field.unit):
                raise U.UnitError(
                    f"{normalized} is not a {U.quantity_kind(field.unit)} unit"
                )
        except Exception as exc:
            draft.warnings.append(
                f"the model gave {key!r} as {value} {unit!r}, which is not a valid "
                f"unit for this field ({exc}), so it was discarded"
            )
            continue
        draft.engineering_inputs[key] = canonical
        draft.extracted_values.append(
            ExtractedValue(
                key=key,
                value_canonical=canonical,
                canonical_unit=U.CANONICAL[U.quantity_kind(field.unit)],
                display_value=float(value),
                display_unit=str(normalized),
                source_text=str(item.get("source_text") or "")[:160],
                confidence="explicit",
            )
        )

    hint = payload.get("material_hint")
    material_id, notes = detect_material(
        f"{hint} {text}" if isinstance(hint, str) else text, profile
    )
    draft.material_id = material_id
    draft.notes.extend(notes)
    if material_id is None:
        draft.warnings.append(
            "no material was identified. Select one from the catalog; the assistant "
            "is not permitted to supply material properties."
        )

    for note in payload.get("notes") or []:
        if isinstance(note, str):
            draft.notes.append(f"model note: {note[:200]}")

    # The missing-field verdict is always recomputed here, never taken from the model.
    draft.missing_fields = profile.missing_inputs(draft.engineering_inputs)
    if draft.missing_fields:
        draft.warnings.append(
            f"{len(draft.missing_fields)} required engineering input(s) are still "
            "missing. Simulation stays blocked until they are supplied."
        )
    for a in profile.demo_fixture_assumptions():
        if a.requires_confirmation:
            draft.assumptions_requiring_confirmation.append(a)

    draft.notes.append(
        "This draft was proposed by a language model and re-validated against the "
        "component schema. Confirm every value before running."
    )
    return draft


def parse_requirements(
    text: str,
    component_type: Optional[ComponentType] = None,
    use_llm: bool = True,
) -> RequirementDraft:
    """Entry point: LLM when configured and requested, otherwise offline."""
    from app.core.config import get_settings

    if use_llm and get_settings().llm_available:
        return parse_with_llm(text, component_type)
    return parse_offline(text, component_type)
