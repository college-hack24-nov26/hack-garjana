"""On-disk artifact storage (spec 8.3).

Every path segment is a generated, validated identifier. A user-supplied file
name is never used as a path segment, and every resolved path is checked to stay
inside the storage root before it is read or written.
"""
from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.core.config import get_settings
from app.core.ids import require_safe_id, slugify
from app.core.logging import get_logger

log = get_logger(__name__)


class ArtifactPathError(ValueError):
    """Raised for an unsafe or out-of-tree artifact path."""


@dataclass(frozen=True)
class ComponentPaths:
    root: Path
    source: Path
    designs: Path
    simulations: Path
    reports: Path

    def design_dir(self, design_id: str) -> Path:
        return self.designs / require_safe_id(design_id)

    def simulation_dir(self, run_id: str) -> Path:
        return self.simulations / require_safe_id(run_id)


class ArtifactStore:
    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root or get_settings().storage_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    # ----------------------------------------------------------------- paths

    def component_paths(self, project_id: str, component_instance_id: str) -> ComponentPaths:
        base = (
            self.root
            / "projects"
            / require_safe_id(project_id)
            / require_safe_id(component_instance_id)
        )
        paths = ComponentPaths(
            root=base,
            source=base / "source",
            designs=base / "designs",
            simulations=base / "simulations",
            reports=base / "reports",
        )
        for p in (paths.source, paths.designs, paths.simulations, paths.reports):
            p.mkdir(parents=True, exist_ok=True)
        return paths

    def benchmarks_dir(self) -> Path:
        d = self.root / "benchmarks"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def logs_dir(self) -> Path:
        d = self.root / "logs"
        d.mkdir(parents=True, exist_ok=True)
        return d

    # ------------------------------------------------------------ safe access

    def resolve(self, path: str | Path) -> Path:
        """Resolve a stored path, refusing anything outside the storage root."""
        p = Path(path)
        candidate = (p if p.is_absolute() else self.root / p).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise ArtifactPathError(
                f"refusing to access {candidate}, which is outside the storage root"
            ) from exc
        return candidate

    def relative(self, path: str | Path) -> str:
        return self.resolve(path).relative_to(self.root).as_posix()

    # --------------------------------------------------------------- uploads

    def store_upload(
        self,
        project_id: str,
        component_instance_id: str,
        original_filename: str,
        data: bytes,
        allowed_suffixes: tuple[str, ...] = (".step", ".stp"),
    ) -> tuple[Path, dict]:
        """Store an uploaded CAD file under a generated name.

        The original name is recorded as metadata only; the file on disk is
        named from the validated suffix so a crafted filename cannot escape the
        storage tree or overwrite anything.
        """
        settings = get_settings()
        if len(data) == 0:
            raise ValueError("uploaded file is empty")
        if len(data) > settings.max_upload_bytes:
            raise ValueError(
                f"uploaded file is {len(data) / 1e6:.1f} MB, above the "
                f"{settings.max_upload_bytes / 1e6:.0f} MB limit"
            )

        suffix = Path(original_filename).suffix.lower()
        if suffix not in allowed_suffixes:
            raise ValueError(
                f"unsupported file type {suffix!r}; accepted: {', '.join(allowed_suffixes)}"
            )

        paths = self.component_paths(project_id, component_instance_id)
        target = paths.source / f"original{suffix}"
        target.write_bytes(data)

        meta = {
            "original_filename_as_submitted": original_filename,
            "stored_as": target.name,
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "suffix": suffix,
        }
        (paths.source / "source_metadata.json").write_text(
            __import__("json").dumps(meta, indent=2), encoding="utf-8"
        )
        log.info("stored upload %s (%d bytes)", target, len(data))
        return target, meta

    # -------------------------------------------------------------- checksums

    @staticmethod
    def checksum(path: Path) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    def describe(self, path: Path, file_type: str, units: Optional[str] = None) -> dict:
        p = self.resolve(path)
        return {
            "file_type": file_type,
            "relative_path": self.relative(p),
            "checksum_sha256": self.checksum(p),
            "size_bytes": p.stat().st_size,
            "units": units,
        }

    def delete_component_tree(self, project_id: str, component_instance_id: str) -> None:
        base = (
            self.root
            / "projects"
            / require_safe_id(project_id)
            / require_safe_id(component_instance_id)
        )
        if base.exists():
            shutil.rmtree(base)


_store: Optional[ArtifactStore] = None


def get_store() -> ArtifactStore:
    global _store
    if _store is None:
        _store = ArtifactStore()
    return _store
