"""Application settings.

Every engineering-relevant path is explicit and validated at startup so that a
missing solver is reported as a capability gap rather than discovered halfway
through a simulation run.
"""
from __future__ import annotations

import shutil
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    app_name: str = "AutoTwin"

    database_url: str = f"sqlite:///{(BACKEND_ROOT / 'autotwin.db').as_posix()}"
    storage_root: Path = PROJECT_ROOT / "storage"

    # Optional external solver binaries. When unset, the verified in-process
    # scikit-fem solvers are used (see engineering/solvers/registry.py).
    calculix_bin: Optional[str] = None
    elmer_bin: Optional[str] = None
    gmsh_bin: Optional[str] = None

    # Optional LLM. The product must work fully without it.
    llm_api_key: Optional[str] = None
    llm_model: str = "claude-sonnet-5-5"
    llm_base_url: str = "https://api.anthropic.com/v1/messages"

    # Optional Groq model for the AI Insights chat (OpenAI-compatible API).
    # The key stays here on the server; the browser never sees it.
    groq_api_key: Optional[str] = None
    groq_model: str = "openai/gpt-oss-120b"
    groq_base_url: str = "https://api.groq.com/openai/v1/chat/completions"
    groq_timeout_seconds: float = 20.0

    # Engineering run limits (guard rails for a laptop-sized demo).
    solver_timeout_seconds: int = 600
    max_mesh_nodes: int = 400_000
    max_candidates_per_run: int = 40
    max_upload_bytes: int = 64 * 1024 * 1024
    job_worker_threads: int = 2

    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )

    @property
    def calculix_available(self) -> bool:
        return bool(self.calculix_bin) and Path(self.calculix_bin).exists()

    @property
    def elmer_available(self) -> bool:
        return bool(self.elmer_bin) and Path(self.elmer_bin).exists()

    @property
    def llm_available(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def groq_available(self) -> bool:
        return bool(self.groq_api_key and self.groq_api_key.strip())

    def resolve_binary(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        p = Path(value)
        if p.exists():
            return str(p)
        return shutil.which(value)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.storage_root.mkdir(parents=True, exist_ok=True)
    return s
