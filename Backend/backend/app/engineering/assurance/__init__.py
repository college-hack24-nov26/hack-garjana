"""The assurance plane: deterministic checks, evidence and maturity.

Nothing in this package calls a language model, and no language model can reach
into it. That separation is the point. The research the platform is built on
found that a language agent asked to set up a real finite-element problem
produced runnable solver input 88% of the time and a correct physics setup none
of the time, so the component that decides whether a setup is sound has to be
independent of the component that proposed it.

What this package exports:

``pre_solver`` / ``post_solver``
    The two check stages, each returning an :class:`AssuranceReport` whose
    ``gate_passed`` is true only when every blocking check actually passed.

``assess``
    Collapses both reports into a :class:`VerificationRecord`, a
    :class:`ValidationRecord`, an :class:`UncertaintyRecord` and a derived
    :class:`MaturityAssessment`.

``derive_maturity``
    The only function permitted to decide what a result may be called.

``scan_text`` / ``assert_clean``
    The prohibited-claim guard, run over generated prose after the model that
    wrote it has finished.
"""
from app.engineering.assurance.benchmark_evidence import (
    benchmark_evidence,
    benchmark_id,
    benchmark_status,
)
from app.engineering.assurance.checks import (
    AssuranceCheck,
    AssuranceReport,
    CheckSeverity,
    CheckStage,
    CheckStatus,
)
from app.engineering.assurance.claims import (
    PROHIBITED_CLAIM_STATEMENTS,
    PROHIBITED_CLAIMS,
    ClaimViolation,
    assert_clean,
    scan_text,
)
from app.engineering.assurance.evidence import (
    EvidenceRecord,
    ProvenanceEntry,
    SourceType,
    build_evidence_record,
    stable_hash,
)
from app.engineering.assurance.ladders import (
    FIDELITY_LADDER,
    FIDELITY_OF_ANALYSIS,
    LADDERS,
    ComponentLadder,
    LadderRung,
    ladder_for,
)
from app.engineering.assurance.maturity import (
    EVIDENCE_REQUIREMENTS,
    PROHIBITED_AT_LEVEL,
    MaturityAssessment,
    MaturityLevel,
    derive_maturity,
)
from app.engineering.assurance.service import (
    AssuranceOutcome,
    UncertaintyRecord,
    ValidationRecord,
    ValidationStatus,
    VerificationRecord,
    VerificationStatus,
    assess,
    build_verification_record,
    post_solver,
    pre_solver,
)

__all__ = [
    "AssuranceCheck",
    "AssuranceOutcome",
    "AssuranceReport",
    "CheckSeverity",
    "CheckStage",
    "CheckStatus",
    "ClaimViolation",
    "ComponentLadder",
    "EVIDENCE_REQUIREMENTS",
    "EvidenceRecord",
    "FIDELITY_LADDER",
    "FIDELITY_OF_ANALYSIS",
    "LADDERS",
    "LadderRung",
    "MaturityAssessment",
    "MaturityLevel",
    "PROHIBITED_AT_LEVEL",
    "PROHIBITED_CLAIMS",
    "PROHIBITED_CLAIM_STATEMENTS",
    "ProvenanceEntry",
    "SourceType",
    "UncertaintyRecord",
    "ValidationRecord",
    "ValidationStatus",
    "VerificationRecord",
    "VerificationStatus",
    "assert_clean",
    "assess",
    "benchmark_evidence",
    "benchmark_id",
    "benchmark_status",
    "build_evidence_record",
    "build_verification_record",
    "derive_maturity",
    "ladder_for",
    "post_solver",
    "pre_solver",
    "scan_text",
    "stable_hash",
]
