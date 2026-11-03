"""The immutable evidence record attached to every result.

Nine hashes and three version strings. Together they answer the question the
dossiers put at the centre of the product: for this recommended design, what
requirement did it satisfy, what geometry was built, which material and load
case applied, what mesh was solved, by which solver build.

The reason these are hashes rather than descriptions is staleness. If geometry,
material, loads, mesh settings, the solver or the generator changes, the hash
changes, and :func:`is_stale` can say so without anyone remembering to mark it.
That is seeded failure case F10: a revision that moves after a simulation has
run must leave the downstream result visibly stale, not quietly wrong.

A hash that could not be computed stays ``None``. A record with missing hashes
is incomplete evidence, and :attr:`EvidenceRecord.complete` says so.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


def stable_hash(payload: Any, length: int = 32) -> str:
    """A deterministic hash of any JSON-serialisable engineering payload.

    Keys are sorted so that two dictionaries describing the same case hash
    identically regardless of construction order.
    """
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:length]


def _code_commit() -> Optional[str]:
    """The git commit this build came from, when the tree is a repository."""
    import subprocess
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    commit = out.stdout.strip()
    return commit or None


class SourceType(str, Enum):
    """Where one engineering number came from.

    The order is deliberate: it runs from the most authoritative to the least,
    and ``DEMO_ASSUMPTION`` exists so that a demonstration fixture can never be
    mistaken for a supplier's certified figure.
    """

    USER_SUPPLIED = "user_supplied"
    MEASURED = "measured"
    APPROVED_DATABASE = "approved_database"
    LITERATURE = "literature"
    DEMO_ASSUMPTION = "demo_assumption"
    DERIVED = "derived"


class ProvenanceEntry(BaseModel):
    """One number, its unit, and everything known about where it came from.

    This is the record the dossiers' traceability chain is built from. The
    fields that matter most are the ones that are allowed to be empty:
    ``uncertainty`` is ``None`` when nobody quantified it, and ``confirmed`` is
    ``False`` until an engineer actually confirmed it. Neither defaults the
    other way.
    """

    key: str
    label: str
    value: Optional[float] = None
    unit: str = "-"
    source_type: SourceType
    source_id: Optional[str] = None
    source_reference: Optional[str] = None
    revision: Optional[str] = None
    confirmed: bool = False
    #: Absolute uncertainty in the same unit as ``value``, where it is known.
    uncertainty: Optional[float] = None
    note: Optional[str] = None

    @property
    def is_quantified(self) -> bool:
        return self.uncertainty is not None


class EvidenceRecord(BaseModel):
    """The identity of one analysis: what went in, and what ran on it."""

    #: Which revision of the requirement this result answers.
    requirement_revision: Optional[str] = None
    geometry_hash: Optional[str] = None
    material_snapshot_hash: Optional[str] = None
    load_case_hash: Optional[str] = None
    mesh_hash: Optional[str] = None
    solver_input_hash: Optional[str] = None

    solver_name: Optional[str] = None
    solver_version: Optional[str] = None
    generator_version: Optional[str] = None
    code_commit: Optional[str] = None

    recorded_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")
    )

    #: Every engineering input that fed this run, with its provenance.
    provenance: list[ProvenanceEntry] = Field(default_factory=list)

    @property
    def complete(self) -> bool:
        """Whether every hash needed to reproduce this run is on record."""
        return all(
            getattr(self, f) is not None
            for f in (
                "geometry_hash",
                "material_snapshot_hash",
                "load_case_hash",
                "mesh_hash",
                "solver_input_hash",
                "solver_version",
                "generator_version",
            )
        )

    @property
    def missing_hashes(self) -> list[str]:
        return [
            f
            for f in (
                "requirement_revision",
                "geometry_hash",
                "material_snapshot_hash",
                "load_case_hash",
                "mesh_hash",
                "solver_input_hash",
                "solver_version",
                "generator_version",
            )
            if getattr(self, f) is None
        ]

    @property
    def unconfirmed_inputs(self) -> list[ProvenanceEntry]:
        """Inputs still carrying an unconfirmed assumption or a demo fixture."""
        return [
            p
            for p in self.provenance
            if not p.confirmed
            and p.source_type in (SourceType.DEMO_ASSUMPTION, SourceType.DERIVED)
        ]

    def fingerprint(self) -> str:
        """One hash over the whole input identity, for staleness comparison."""
        return stable_hash(
            {
                "requirement": self.requirement_revision,
                "geometry": self.geometry_hash,
                "material": self.material_snapshot_hash,
                "load_case": self.load_case_hash,
                "mesh": self.mesh_hash,
                "solver_input": self.solver_input_hash,
                "solver_version": self.solver_version,
                "generator_version": self.generator_version,
            }
        )

    def is_stale_against(self, current: "EvidenceRecord") -> tuple[bool, list[str]]:
        """Whether this result's inputs have since changed.

        Returns the verdict and the specific fields that moved, so a stale
        result can say *what* changed rather than only that something did.
        """
        changed: list[str] = []
        for field_name, label in (
            ("requirement_revision", "the requirement revision"),
            ("geometry_hash", "the geometry"),
            ("material_snapshot_hash", "the material assignment"),
            ("load_case_hash", "the load case"),
            ("mesh_hash", "the mesh settings"),
            ("solver_input_hash", "the solver input"),
            ("solver_version", "the solver version"),
            ("generator_version", "the geometry generator version"),
        ):
            mine = getattr(self, field_name)
            theirs = getattr(current, field_name)
            if mine is not None and theirs is not None and mine != theirs:
                changed.append(label)
        return bool(changed), changed


def build_evidence_record(
    *,
    requirement_revision: Optional[str],
    geometry_hash: Optional[str],
    generator_version: Optional[str],
    material_snapshot: Optional[dict],
    load_case: Optional[dict],
    mesh_settings: Optional[dict],
    mesh_metadata: Optional[dict],
    solver_name: Optional[str],
    solver_version: Optional[str],
    provenance: Optional[list[ProvenanceEntry]] = None,
) -> EvidenceRecord:
    """Assemble the evidence record from what a run actually produced.

    Each hash is computed only from data that exists. A missing input yields a
    missing hash rather than a hash of an empty dictionary, because the latter
    would be a stable-looking fingerprint for "we do not know".
    """
    return EvidenceRecord(
        requirement_revision=requirement_revision,
        geometry_hash=geometry_hash,
        material_snapshot_hash=stable_hash(material_snapshot) if material_snapshot else None,
        load_case_hash=stable_hash(load_case) if load_case else None,
        mesh_hash=stable_hash(mesh_metadata) if mesh_metadata else None,
        solver_input_hash=(
            stable_hash(
                {
                    "load_case": load_case,
                    "mesh_settings": mesh_settings,
                    "material": material_snapshot,
                    "geometry": geometry_hash,
                }
            )
            if load_case and mesh_settings
            else None
        ),
        solver_name=solver_name,
        solver_version=solver_version,
        generator_version=generator_version,
        code_commit=_code_commit(),
        provenance=list(provenance or []),
    )
