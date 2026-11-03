"""Shared fixtures.

Tests run against a temporary storage root and a temporary database so a test
run never touches the developer's real project data.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="autotwin-tests-"))
os.environ.setdefault("STORAGE_ROOT", str(_TMP / "storage"))
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(_TMP / 'test.db').as_posix()}")


@pytest.fixture(scope="session")
def storage_root() -> Path:
    path = _TMP / "storage"
    path.mkdir(parents=True, exist_ok=True)
    return path


@pytest.fixture(scope="session")
def work_dir() -> Path:
    path = _TMP / "work"
    path.mkdir(parents=True, exist_ok=True)
    return path


@pytest.fixture(scope="session")
def wheel_profile():
    from app.engineering.profiles.registry import get_profile
    from app.schemas.common import ComponentType

    return get_profile(ComponentType.ALLOY_WHEEL)


@pytest.fixture(scope="session")
def caliper_profile():
    from app.engineering.profiles.registry import get_profile
    from app.schemas.common import ComponentType

    return get_profile(ComponentType.BRAKE_CALIPER)


@pytest.fixture(scope="session")
def plug_profile():
    from app.engineering.profiles.registry import get_profile
    from app.schemas.common import ComponentType

    return get_profile(ComponentType.SPARK_PLUG)


@pytest.fixture(scope="session")
def api_client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        yield client
