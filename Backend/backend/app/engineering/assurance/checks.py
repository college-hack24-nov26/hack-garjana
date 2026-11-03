"""The check vocabulary shared by both assurance stages.

Two things in this module do the real work.

The first is :class:`CheckStatus`. It has five states, and the reason it is not
a boolean is the central reliability finding in the research: FEABench reported
language agents producing syntactically valid solver input 88% of the time and
a correct physics setup 0% of the time, which means "it ran" and "it is right"
are different facts and must be stored as different facts. A check that did not
run is ``NOT_RUN``; a check that does not apply to this analysis is
``NOT_APPLICABLE``; a concern short of a failure is ``WARNING``. None of the
three is a pass, and :meth:`CheckStatus.is_pass` is the only way to ask.

The second is :meth:`AssuranceReport.gate_passed`, which closes the loop: a
stage passes only when every check in it is an actual pass. There is no code
path that treats a missing check as a satisfied one.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class CheckStatus(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    WARNING = "warning"
    NOT_RUN = "not_run"
    NOT_APPLICABLE = "not_applicable"

    @property
    def is_pass(self) -> bool:
        """Only an actual pass is a pass. A warning is not; a gap is not."""
        return self is CheckStatus.PASSED

    @property
    def blocks_verification(self) -> bool:
        """Whether this status prevents a claim of numerical verification.

        ``NOT_APPLICABLE`` does not block - a thermal run has no reaction-force
        balance to close, and pretending otherwise would be as dishonest as
        skipping the check. Everything else that is not a pass blocks.
        """
        return self not in (CheckStatus.PASSED, CheckStatus.NOT_APPLICABLE)


class CheckStage(str, Enum):
    """When a check runs. Pre-solver checks can still stop the run."""

    PRE_SOLVER = "pre_solver"
    POST_SOLVER = "post_solver"


class CheckSeverity(str, Enum):
    #: A failure here must stop the candidate before the solver is invoked, or
    #: invalidate the result afterwards.
    BLOCKING = "blocking"
    #: A failure here is recorded and reported but does not stop the run.
    ADVISORY = "advisory"


class AssuranceCheck(BaseModel):
    """One deterministic check, its measured value and its verdict."""

    check_id: str
    stage: CheckStage
    title: str
    #: What the check actually measures, in one sentence.
    description: str
    status: CheckStatus
    severity: CheckSeverity = CheckSeverity.BLOCKING

    #: The measurement the verdict came from, and the threshold it was compared
    #: against. Both stay on the record so a reader can re-derive the verdict.
    measured: Optional[float] = None
    threshold: Optional[float] = None
    unit: Optional[str] = None
    detail: str = ""

    @property
    def is_pass(self) -> bool:
        return self.status.is_pass


class AssuranceReport(BaseModel):
    """Every check from one stage, and whether the stage as a whole passed."""

    stage: CheckStage
    checks: list[AssuranceCheck] = Field(default_factory=list)

    @property
    def gate_passed(self) -> bool:
        """True only when every blocking check in this stage actually passed.

        Strict: a blocking check that did not run leaves the gate not passed,
        because the evidence it would have produced does not exist.
        """
        return not self.blocking_failures and not self.blocking_gaps

    @property
    def blocking_failures(self) -> list[AssuranceCheck]:
        """Blocking checks that ran and found something wrong.

        These are the ones that justify rejecting a candidate: something was
        measured and it was out of tolerance.
        """
        return [
            c
            for c in self.checks
            if c.severity is CheckSeverity.BLOCKING and c.status is CheckStatus.FAILED
        ]

    @property
    def blocking_gaps(self) -> list[AssuranceCheck]:
        """Blocking checks that produced no evidence either way.

        Kept separate from :attr:`blocking_failures` because the two mean
        different things and deserve different handling. A gap must stop a
        claim of verification - it may not be rounded up to a pass - but it is
        not grounds for throwing away a candidate whose solve succeeded, which
        would be rounding it down to a failure instead. A per-candidate run has
        no mesh-refinement study, so a gap there is expected, not a defect.
        """
        return [
            c
            for c in self.checks
            if c.severity is CheckSeverity.BLOCKING
            and c.status in (CheckStatus.NOT_RUN, CheckStatus.WARNING)
        ]

    @property
    def warnings(self) -> list[AssuranceCheck]:
        return [c for c in self.checks if c.status is CheckStatus.WARNING]

    def by_id(self, check_id: str) -> Optional[AssuranceCheck]:
        for c in self.checks:
            if c.check_id == check_id:
                return c
        return None

    def summary(self) -> dict[str, int]:
        counts = {s.value: 0 for s in CheckStatus}
        for c in self.checks:
            counts[c.status.value] += 1
        return counts
