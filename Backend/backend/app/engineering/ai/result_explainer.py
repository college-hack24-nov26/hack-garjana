"""Result explanation (spec 7.1, 7.2).

Explanations are generated from stored solver output only. Every number in the
text is read out of a persisted record, and the generator has no access to any
value it could invent. The default path is a deterministic template so the
product explains itself with no API key; when an LLM is configured it may
rephrase the same grounded facts, and the numbers it is allowed to mention are
handed to it explicitly.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field

from app.core import units as U
from app.core.logging import get_logger
from app.engineering.optimization.evaluation import CandidateRecord
from app.schemas.engineering import KNOWN_METRICS

log = get_logger(__name__)

_METRIC_LABELS: dict[str, str] = {
    "mass_kg": "mass",
    "volume_m3": "material volume",
    "max_von_mises_pa": "peak von Mises stress",
    "max_displacement_m": "peak displacement",
    "compliance_j": "strain energy (compliance)",
    "min_factor_of_safety": "factor of safety against yield",
    "max_temperature_k": "peak temperature",
    "min_temperature_k": "minimum temperature",
    "max_temperature_gradient_k_per_m": "peak temperature gradient",
    "heat_flow_w": "heat flow through the sink surfaces",
    "min_wall_thickness_m": "minimum wall thickness",
}


class GroundedFact(BaseModel):
    """One value quoted in an explanation, with where it came from."""

    label: str
    metric: str
    value: float
    unit: str
    canonical_value: float
    canonical_unit: str
    source: str


class Explanation(BaseModel):
    generator: str
    headline: str
    paragraphs: list[str] = Field(default_factory=list)
    grounded_facts: list[GroundedFact] = Field(default_factory=list)
    constraint_statements: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    method_statement: str = ""

    def prose(self) -> str:
        """Every piece of generated text in this explanation, as one string."""
        return "\n".join(
            [self.headline, *self.paragraphs, *self.constraint_statements, *self.caveats]
        )

    def guard_claims(self, maturity: Optional[str] = None) -> "Explanation":
        """Refuse to emit prose that claims more than the evidence supports.

        Run after the text is assembled, not while it is being written, so that
        it checks the output rather than the intent. The templates in this
        module are deterministic, so a violation here is a bug in a template
        and raising is the right response: it surfaces in the test suite rather
        than in front of an engineer.

        When an LLM is configured to rewrite this prose, its output passes
        through the same call, and the same rule applies to it - which is the
        point of checking the text instead of trusting the writer.
        """
        from app.engineering.assurance import MaturityLevel, assert_clean

        level = None
        if maturity:
            try:
                level = MaturityLevel(maturity)
            except ValueError:
                level = None
        assert_clean(self.prose(), maturity=level, where="generated explanation")
        return self


def _fact(metric: str, value: float, source: str) -> Optional[GroundedFact]:
    kind = KNOWN_METRICS.get(metric)
    if kind is None:
        return None
    canonical_unit = U.CANONICAL[kind]
    display_value, display_unit = U.display(float(value), canonical_unit)
    return GroundedFact(
        label=_METRIC_LABELS.get(metric, metric),
        metric=metric,
        value=display_value,
        unit=display_unit,
        canonical_value=float(value),
        canonical_unit=canonical_unit,
        source=source,
    )


def _fmt(fact: GroundedFact) -> str:
    return f"{fact.value:.4g} {fact.unit}"


def explain_candidate(
    candidate: CandidateRecord,
    *,
    baseline: Optional[CandidateRecord] = None,
    method_statement: str = "",
    solver_name: str = "",
    mesh_nodes: Optional[int] = None,
    mesh_preset: Optional[str] = None,
    mesh_convergence: Optional[dict] = None,
) -> Explanation:
    """Describe one evaluated candidate using only its stored metrics."""
    # The candidate carries its own derived maturity, so the claim guard reads
    # it from the record rather than being told what it is.
    maturity = (
        candidate.assurance.maturity.level.value
        if candidate.assurance is not None
        else None
    )
    explanation = Explanation(
        generator="deterministic_template", headline="", method_statement=method_statement
    )

    # ---- a candidate that never solved gets the truth, not an explanation ---
    if not candidate.evaluated:
        explanation.headline = (
            f"Candidate {candidate.index} produced no results: it failed at the "
            f"{candidate.failure_stage or 'unknown'} stage."
        )
        explanation.paragraphs.append(
            candidate.failure_reason
            or "No failure reason was recorded for this candidate."
        )
        explanation.paragraphs.append(
            "There are no stress, displacement, temperature or mass values for this "
            "design because nothing was computed for it. It is excluded from ranking."
        )
        return explanation.guard_claims(maturity)

    metrics = candidate.metrics
    source = f"stored result of candidate {candidate.index}"

    for metric in (
        "mass_kg",
        "max_von_mises_pa",
        "max_displacement_m",
        "min_factor_of_safety",
        "max_temperature_k",
        "min_temperature_k",
        "heat_flow_w",
        "min_wall_thickness_m",
    ):
        if metric in metrics and metrics[metric] is not None:
            fact = _fact(metric, metrics[metric], source)
            if fact is not None:
                explanation.grounded_facts.append(fact)

    by_metric = {f.metric: f for f in explanation.grounded_facts}

    # ---- headline ----------------------------------------------------------
    verdict = (
        "satisfies every configured constraint"
        if candidate.is_feasible
        else "violates at least one configured constraint"
    )
    label = "The baseline design" if candidate.is_baseline else f"Candidate {candidate.index}"
    mass = by_metric.get("mass_kg")
    explanation.headline = (
        f"{label} {verdict}"
        + (f" at {_fmt(mass)}." if mass else ".")
    )

    # ---- what was computed -------------------------------------------------
    parts: list[str] = []
    if "max_von_mises_pa" in by_metric:
        stress = by_metric["max_von_mises_pa"]
        sentence = f"Peak von Mises stress is {_fmt(stress)}"
        fos = by_metric.get("min_factor_of_safety")
        if fos:
            sentence += (
                f", giving a factor of safety of {fos.value:.2f} against the yield "
                "strength recorded in the material snapshot"
            )
        parts.append(sentence + ".")
    if "max_displacement_m" in by_metric:
        parts.append(
            f"Peak displacement is {_fmt(by_metric['max_displacement_m'])} under the "
            "configured load case."
        )
    if "max_temperature_k" in by_metric:
        hot = by_metric["max_temperature_k"]
        cold = by_metric.get("min_temperature_k")
        sentence = f"The steady-state temperature peaks at {_fmt(hot)}"
        if cold:
            sentence += f" and falls to {_fmt(cold)} at the coolest point"
        parts.append(sentence + ".")
    if "heat_flow_w" in by_metric:
        parts.append(
            f"{_fmt(by_metric['heat_flow_w'])} of heat leaves through the sink surfaces."
        )
    if parts:
        explanation.paragraphs.append(" ".join(parts))

    # ---- constraints, one statement each -----------------------------------
    for c in candidate.constraint_results:
        name = c.label or c.constraint_id
        if c.passed is None:
            explanation.constraint_statements.append(
                f"{name}: not evaluated. {c.note or ''}".strip()
            )
            continue
        actual = f"{c.value.value:.4g} {c.value.unit}" if c.value else "n/a"
        state = "PASS" if c.passed else "FAIL"
        margin = ""
        if c.margin_fraction is not None:
            margin = (
                f", {abs(c.margin_fraction) * 100:.1f}% "
                + ("inside" if c.passed else "beyond")
                + " the limit"
            )
        explanation.constraint_statements.append(
            f"{state} - {name}: {c.description}, actual {actual}{margin}."
        )

    # ---- comparison against the baseline -----------------------------------
    if baseline is not None and baseline.evaluated and not candidate.is_baseline:
        deltas: list[str] = []
        for metric in ("mass_kg", "max_von_mises_pa", "max_displacement_m", "max_temperature_k"):
            a = baseline.metrics.get(metric)
            b = metrics.get(metric)
            if a is None or b is None or a == 0:
                continue
            change = (b - a) / abs(a) * 100.0
            fact_a, fact_b = _fact(metric, a, "baseline"), _fact(metric, b, source)
            if fact_a is None or fact_b is None:
                continue
            direction = "lower" if change < 0 else "higher"
            deltas.append(
                f"{fact_b.label} is {abs(change):.1f}% {direction} than the baseline "
                f"({_fmt(fact_a)} to {_fmt(fact_b)})"
            )
        if deltas:
            explanation.paragraphs.append(
                "Against the baseline: " + "; ".join(deltas) + "."
            )

    # ---- what the engineer should distrust ---------------------------------
    if solver_name:
        detail = f"Computed with {solver_name}"
        if mesh_nodes:
            detail += f" on a {mesh_nodes}-node mesh"
        if mesh_preset:
            detail += f" at {mesh_preset} fidelity"
        explanation.caveats.append(detail + ".")

    if mesh_convergence and mesh_convergence.get("performed"):
        statement = mesh_convergence.get("statement") or ""
        explanation.caveats.append(
            statement
            if statement
            else {
                "passed": "A mesh-refinement check was performed and converged.",
                "failed": "A mesh-refinement check was performed and the decision "
                          "quantity did not converge.",
                "inconclusive": "A mesh-refinement check was performed. The decision "
                                "quantity converged; a region-specific metric did "
                                "not, so convergence is recorded as inconclusive.",
            }.get(
                str(mesh_convergence.get("status") or ""),
                "A mesh-refinement check was performed but produced no verdict.",
            )
        )
    elif mesh_preset in ("screening", "exploration"):
        explanation.caveats.append(
            f"This result was computed at {mesh_preset} mesh fidelity, which is "
            "intended for comparing candidates. Re-run the selected design at "
            "verification fidelity before treating the absolute values as predictions."
        )

    explanation.caveats.extend(candidate.warnings)

    if candidate.is_feasible:
        explanation.caveats.append(
            "Feasible under the configured model means every constraint you configured "
            "passed. It does not mean the design is certified, safe for road use, or "
            "approved for manufacturing."
        )

    return explanation.guard_claims(maturity)


def explain_study(
    *,
    candidates: list[CandidateRecord],
    recommendation: dict[str, Any] | None,
    comparison: dict[str, Any] | None,
    algorithm: str,
    summary: dict[str, Any],
    method_statement: str = "",
    mesh_convergence: Optional[dict] = None,
    maturity: Optional[str] = None,
) -> Explanation:
    """Summarise a whole study: what was searched, what was found, what failed.

    ``maturity`` is the level the recommended candidate's evidence earned. It is
    passed only to the claim guard, which uses it to decide whether a phrase
    like "experimentally validated" is available. It never changes a number.
    """
    explanation = Explanation(
        generator="deterministic_template",
        headline="",
        method_statement=method_statement,
    )

    generated = summary.get("candidates_generated", len(candidates))
    evaluated = summary.get("candidates_evaluated", 0)
    feasible = summary.get("candidates_feasible", 0)
    failed = summary.get("candidates_failed", 0)

    explanation.headline = (
        f"{generated} design(s) generated, {evaluated} evaluated by the solver, "
        f"{feasible} feasible under the configured constraints"
        + (f", {failed} failed to evaluate." if failed else ".")
    )

    explanation.paragraphs.append(
        f"The design space was searched with {algorithm}. Every candidate was built by "
        "the parametric CAD generator, meshed, and solved with the same solver "
        "configuration before being judged, so the comparison between them is "
        "like-for-like."
    )

    if recommendation and recommendation.get("statement"):
        explanation.paragraphs.append(recommendation["statement"])

    if comparison:
        deltas = []
        for metric, entry in comparison.items():
            if not entry.get("available"):
                continue
            pct = entry.get("percent_change")
            if pct is None:
                continue
            label = _METRIC_LABELS.get(metric, metric)
            base = entry["baseline"]
            cand = entry["candidate"]
            deltas.append(
                f"{label} {base['value']:.4g} to {cand['value']:.4g} {cand['unit']} "
                f"({pct:+.1f}%)"
            )
        if deltas:
            explanation.paragraphs.append(
                "Recommended design against the baseline: " + "; ".join(deltas) + "."
            )

    # Failures are named, not hidden.
    failures = [c for c in candidates if not c.evaluated]
    if failures:
        reasons: dict[str, int] = {}
        for c in failures:
            key = c.failure_stage or "unknown"
            reasons[key] = reasons.get(key, 0) + 1
        explanation.paragraphs.append(
            "Candidates that produced no result: "
            + ", ".join(f"{count} at the {stage} stage" for stage, count in reasons.items())
            + ". They carry no metrics and are excluded from ranking."
        )

    infeasible = [c for c in candidates if c.evaluated and c.is_feasible is False]
    if infeasible:
        violated: dict[str, int] = {}
        for c in infeasible:
            for cr in c.constraint_results:
                if cr.passed is False:
                    name = cr.label or cr.constraint_id
                    violated[name] = violated.get(name, 0) + 1
        if violated:
            explanation.paragraphs.append(
                "Constraints that ruled candidates out: "
                + ", ".join(f"{name} ({count})" for name, count in violated.items())
                + "."
            )

    mean_solve = summary.get("mean_solve_seconds")
    total = summary.get("total_seconds")
    if mean_solve and total:
        explanation.caveats.append(
            f"Mean solver time per candidate was {mean_solve:.1f} s; the whole study "
            f"took {total:.0f} s."
        )

    if mesh_convergence and mesh_convergence.get("statement"):
        explanation.caveats.append(mesh_convergence["statement"])

    explanation.caveats.append(
        "These are virtual-prototyping predictions under the model you configured. "
        "They narrow down which designs are worth building; they do not replace "
        "physical testing or any approval your process requires."
    )
    return explanation.guard_claims(maturity)
