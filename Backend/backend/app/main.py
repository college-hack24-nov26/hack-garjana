"""AutoTwin FastAPI application.

Generative automotive virtual-prototyping platform. Start with:

    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.session import init_db
from app.services.job_manager import get_job_manager

configure_logging()
log = get_logger(__name__)

STANDING_DISCLAIMER = (
    "AutoTwin produces virtual-prototyping predictions under an explicitly configured "
    "engineering model. Results are not a regulatory certification, not an approval for "
    "road use, and not a substitute for the physical validation your process requires."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_db()
    manager = get_job_manager()
    orphans = manager.reset_orphaned_jobs()
    log.info(
        "%s starting | storage=%s | calculix=%s | elmer=%s | llm=%s | orphaned jobs reset=%d",
        settings.app_name,
        settings.storage_root,
        settings.calculix_available,
        settings.elmer_available,
        settings.llm_available,
        orphans,
    )
    try:
        yield
    finally:
        manager.shutdown(wait=False)
        log.info("%s shutting down", settings.app_name)


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="AutoTwin",
        version="1.0.0",
        description=(
            "Generative engineering and virtual prototyping for automotive components: "
            "parametric CAD generation, finite-element analysis, constrained design "
            "exploration and traceable results.\n\n" + STANDING_DISCLAIMER
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    from app.api.routes import (
        assets,
        assistant,
        chat,
        cost,
        estimate,
        health,
        jobs,
        projects,
        reports,
        studies,
    )

    for module in (
        health, projects, studies, jobs, assets, assistant, chat, cost, reports, estimate,
    ):
        app.include_router(module.router, prefix="/api")

    @app.exception_handler(ValueError)
    async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
        # Engineering validation failures surface as actionable messages rather
        # than an opaque 500.
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.get("/api")
    def api_root() -> dict:
        return {
            "name": "AutoTwin API",
            "version": "1.0.0",
            "disclaimer": STANDING_DISCLAIMER,
            "docs": "/docs",
            "endpoints": [
                "/api/health",
                "/api/capabilities",
                "/api/components/profiles",
                "/api/projects",
                "/api/components",
                "/api/studies",
                "/api/jobs/{job_id}",
                "/api/candidates/{candidate_id}/visualization",
                "/api/assistant/interpret",
                "/api/assistant/chat",
                "/api/estimate/preview",
                "/api/cost/estimate",
                "/api/reports/generate",
            ],
        }

    return app


app = create_app()
