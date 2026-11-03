"""Claims this platform may not make, and the scanner that enforces it.

The research dossiers list the phrases that must never appear on AutoTwin
output, because each one asserts evidence the platform does not hold:
certification it has not obtained, fatigue life it cannot compute, a twin with
no physical instance behind it, accuracy nobody measured, and percentage cost
savings nobody baselined.

A list in a document is a wish. This module makes it a test. Every piece of
generated prose that reaches a user - the result explainer's output, the
engineering report, a recommendation paragraph - is passed through
:func:`scan_text`, and ``app/tests/test_assurance.py`` asserts the report and
explainer stay clean. The point is that the language model writing the prose
cannot talk its way past this: the check runs on its output, deterministically,
after it has finished.

A claim is also permitted conditionally. "Experimentally validated" is a
legitimate phrase once a result genuinely reaches that maturity level, so
:func:`scan_text` takes the derived level and only flags claims that outrun it.
"""
from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel

from app.engineering.assurance.maturity import MaturityLevel


class ProhibitedClaim(BaseModel):
    claim_id: str
    #: Regex, matched case-insensitively against generated prose.
    pattern: str
    #: Why this phrasing is not available to the platform.
    reason: str
    #: The maturity level at or above which the phrase becomes legitimate.
    #: ``None`` means it is never available, whatever evidence exists.
    permitted_at_or_above: Optional[MaturityLevel] = None


PROHIBITED_CLAIMS: list[ProhibitedClaim] = [
    ProhibitedClaim(
        claim_id="production_ready",
        pattern=r"\bproduction[- ]ready\b|\bready for production\b|\bproduction[- ]release\b",
        reason=(
            "Production readiness is a release decision made by a design "
            "authority against a full test programme, not an output of a "
            "simulation."
        ),
    ),
    ProhibitedClaim(
        claim_id="certified",
        pattern=r"\bcertified\b|\bcertification\b|\bhomologat(?:ed|ion)\b|\bcompliant with (?:SAE|ISO|IEC)\b",
        reason=(
            "Referencing a standard is not complying with it. No part of this "
            "platform is an accredited certification path."
        ),
    ),
    ProhibitedClaim(
        claim_id="fatigue_validated",
        pattern=r"\bfatigue life\b|\bfatigue[- ]validated\b|\bendurance validated\b|\bcycles to failure\b",
        reason=(
            "The solver path is linear static or steady-state thermal. There is "
            "no load spectrum, no cycle counting and no fatigue criterion."
        ),
    ),
    ProhibitedClaim(
        claim_id="real_time_digital_twin",
        pattern=r"\breal[- ]time digital twin\b|\blive digital twin\b|\boperational twin\b",
        reason=(
            "A digital twin requires a uniquely identified physical asset with a "
            "live data link. This platform analyses virtual prototypes."
        ),
        permitted_at_or_above=MaturityLevel.OPERATIONAL_PREDICTIVE_TWIN,
    ),
    ProhibitedClaim(
        claim_id="calibrated_twin",
        pattern=r"\bcalibrated twin\b|\bcalibrated component twin\b|\bdigital twin of (?:this|the) (?:part|component|wheel|caliper|plug)\b",
        reason=(
            "Calibration requires measurements from an identified physical part."
        ),
        permitted_at_or_above=MaturityLevel.CALIBRATED_COMPONENT_TWIN,
    ),
    ProhibitedClaim(
        claim_id="ai_accuracy",
        pattern=r"\bAI accuracy\b|\b(?:AI|model) is \d+(?:\.\d+)?% accurate\b|\bAI[- ](?:verified|validated)\b",
        reason=(
            "No accuracy figure has been measured for any generative component, "
            "and the assistant never produces an engineering number."
        ),
    ),
    ProhibitedClaim(
        claim_id="quantified_savings",
        # Anchored on the *subject* of the percentage, not on the verb.
        #
        # This distinction is the whole point of the rule. "Reduced mass by 12%"
        # is the product's core output: a comparison between two solver results
        # in a physical quantity it actually computed. "Reduced development cost
        # by 12%" is a business claim about a workflow nobody baselined. Matching
        # on "reduced ... %" alone cannot tell them apart and flags the honest
        # one, so the pattern requires a cost, time or effort noun near the
        # figure. A percentage attached to mass, stress, temperature or
        # displacement is a result and passes.
        pattern=(
            r"\b\d+(?:\.\d+)?\s*%\s*(?:\w+\s+){0,3}"
            r"(?:cost|costs|time|times|hour|hours|spend|spending|budget|price|"
            r"lead[- ]?time|turnaround|headcount|effort|labour|labor|"
            r"development|engineering|prototype|prototypes|iteration|"
            r"iterations|test|tests)\b"
            r"|\b(?:cost|costs|time|development|lead[- ]?time|turnaround|"
            r"engineering|labour|labor|effort|budget|prototype|prototypes|"
            r"iteration|iterations)\b[^.?!]{0,40}?"
            r"\b(?:sav\w+|reduc\w+|cut\w*|lower\w*|down)\b[^.?!]{0,20}?"
            r"\d+(?:\.\d+)?\s*%"
            r"|\b(?:sav\w+|reduc\w+|cut\w*|lower\w*)\b[^.?!]{0,40}?"
            r"\b(?:cost|costs|time|development|lead[- ]?time|turnaround|"
            r"engineering|labour|labor|effort|budget|prototype|prototypes|"
            r"iteration|iterations)\b[^.?!]{0,30}?\d+(?:\.\d+)?\s*%"
            r"|\b\d+(?:\.\d+)?\s*%\s*(?:\w+\s+){0,2}"
            r"(?:saving|savings|cheaper|faster to develop)\b"
        ),
        reason=(
            "A cost, time or effort saving requires a measured baseline workflow "
            "and a matched comparison. The cost model is an explicitly "
            "illustrative scenario calculator, not a measurement. A percentage "
            "change in a computed physical quantity such as mass is a result, "
            "not a saving, and is permitted."
        ),
    ),
    ProhibitedClaim(
        claim_id="experimentally_validated",
        pattern=r"\bexperimentally validated\b|\bvalidated against (?:physical|measured|test) data\b|\bcorrelated with (?:test|measurement)\b",
        reason=(
            "No physical measurement has been compared against any prediction in "
            "this installation."
        ),
        permitted_at_or_above=MaturityLevel.EXPERIMENTALLY_VALIDATED,
    ),
    ProhibitedClaim(
        claim_id="safe_for_road_use",
        pattern=r"\bsafe for road use\b|\broad[- ]legal\b|\bfit for (?:road|service) use\b|\bsafe to (?:drive|install|fit)\b",
        reason=(
            "Fitness for road use is a vehicle-level homologation question that "
            "no component simulation answers."
        ),
    ),
    ProhibitedClaim(
        claim_id="guaranteed",
        pattern=r"\bguarantee[ds]?\b|\bwill not fail\b|\bcannot fail\b|\bzero risk\b",
        reason=(
            "A single analysis under one load case guarantees nothing. Feasible "
            "means the configured constraints passed, and nothing more."
        ),
    ),
]


class ClaimViolation(BaseModel):
    claim_id: str
    matched_text: str
    reason: str
    #: Where in the scanned text it appeared, for a precise report.
    context: str


def scan_text(
    text: str, *, maturity: Optional[MaturityLevel] = None
) -> list[ClaimViolation]:
    """Find prohibited claims in generated prose.

    ``maturity`` is the level the result's evidence actually earned. A claim
    whose ``permitted_at_or_above`` the result has reached is not a violation,
    which is how a genuinely validated model is still allowed to say so.
    """
    violations: list[ClaimViolation] = []
    for claim in PROHIBITED_CLAIMS:
        if (
            claim.permitted_at_or_above is not None
            and maturity is not None
            and maturity.ordinal >= claim.permitted_at_or_above.ordinal
        ):
            continue
        for match in re.finditer(claim.pattern, text, flags=re.IGNORECASE):
            start = max(0, match.start() - 60)
            end = min(len(text), match.end() + 60)
            violations.append(
                ClaimViolation(
                    claim_id=claim.claim_id,
                    matched_text=match.group(0),
                    reason=claim.reason,
                    context=text[start:end].replace("\n", " ").strip(),
                )
            )
    return violations


def assert_clean(text: str, *, maturity: Optional[MaturityLevel] = None, where: str = "output") -> None:
    """Raise if generated prose makes a claim the evidence does not support."""
    violations = scan_text(text, maturity=maturity)
    if violations:
        detail = "; ".join(
            f"{v.claim_id}: {v.matched_text!r} ({v.reason})" for v in violations
        )
        raise ValueError(f"prohibited claim in {where}: {detail}")


#: The plain-language list, for the UI and the report's limitations section.
PROHIBITED_CLAIM_STATEMENTS: list[str] = [
    "Production-ready automotive CAE",
    "Certified, compliant or homologated to any standard",
    "Fatigue life validated",
    "Real-time or operational digital twin",
    "Calibrated component twin",
    "A measured AI accuracy figure",
    "A percentage cost or time saving",
    "Experimentally validated",
    "Safe for road use",
    "Guaranteed not to fail",
]
