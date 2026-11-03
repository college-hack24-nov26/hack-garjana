"""Safe identifier generation.

User-supplied names are never used as filesystem path segments; every artifact
path segment is one of these generated IDs (spec 8.3).
"""
from __future__ import annotations

import re
import uuid

_SAFE = re.compile(r"^[A-Za-z0-9_-]+$")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def is_safe_id(value: str) -> bool:
    return bool(value) and len(value) <= 64 and bool(_SAFE.match(value))


def require_safe_id(value: str) -> str:
    if not is_safe_id(value):
        raise ValueError(f"unsafe identifier: {value!r}")
    return value


def slugify(value: str, fallback: str = "item") -> str:
    out = re.sub(r"[^A-Za-z0-9_-]+", "-", value or "").strip("-").lower()
    return out[:48] or fallback
