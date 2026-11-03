"""Local background job manager (spec 5.5).

CAD generation, meshing and solving take tens of seconds, so they never run
inside a request handler. They run on a small worker pool; status, stage and
progress are persisted to SQLite and read back by polling ``GET /api/jobs/{id}``.

No Redis, Celery or broker: a thread pool plus the database is enough for a
single-machine engineering tool, and it keeps the app runnable with one command.
"""
from __future__ import annotations

import hashlib
import json
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.core.config import get_settings
from app.core.ids import new_id
from app.core.logging import get_logger
from app.db.models import Job
from app.db.session import session_scope
from app.schemas.common import JobStage, JobStatus, JobType
from app.services.artifact_store import get_store

log = get_logger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class JobCancelled(RuntimeError):
    """Raised inside a worker when the job has been asked to stop."""


class JobContext:
    """Handle a worker uses to report progress and check for cancellation."""

    def __init__(self, job_id: str, cancel_event: threading.Event) -> None:
        self.job_id = job_id
        self._cancel = cancel_event
        self._log_path = get_store().logs_dir() / f"{job_id}.log"

    # ------------------------------------------------------------- progress

    def update(
        self,
        stage: Optional[str] = None,
        progress: Optional[float] = None,
        message: Optional[str] = None,
    ) -> None:
        self.check_cancelled()
        with session_scope() as session:
            job = session.get(Job, self.job_id)
            if job is None:
                return
            if stage is not None and stage != job.stage:
                history = list(job.stage_history or [])
                history.append({"stage": stage, "at": _now().isoformat()})
                job.stage_history = history
                job.stage = stage
            if progress is not None:
                job.progress = float(min(max(progress, 0.0), 1.0))
            if message is not None:
                job.message = message
        if message:
            self.log(f"[{stage or '-'}] {message}")

    def log(self, line: str) -> None:
        try:
            with open(self._log_path, "a", encoding="utf-8") as fh:
                fh.write(f"{_now().isoformat()} {line}\n")
        except OSError:  # pragma: no cover - logging must never break a run
            pass

    # ---------------------------------------------------------- cancellation

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def check_cancelled(self) -> None:
        if self._cancel.is_set():
            raise JobCancelled(f"job {self.job_id} was cancelled")

    @property
    def log_path(self) -> str:
        return str(self._log_path)


JobFn = Callable[[JobContext], dict[str, Any]]


def request_hash(payload: dict) -> str:
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


class JobManager:
    def __init__(self, max_workers: Optional[int] = None) -> None:
        settings = get_settings()
        self._pool = ThreadPoolExecutor(
            max_workers=max_workers or settings.job_worker_threads,
            thread_name_prefix="autotwin-job",
        )
        self._futures: dict[str, Future] = {}
        self._cancels: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    # ----------------------------------------------------------------- submit

    def submit(
        self,
        *,
        job_type: JobType,
        fn: JobFn,
        payload: dict,
        project_id: Optional[str] = None,
        component_instance_id: Optional[str] = None,
        optimization_run_id: Optional[str] = None,
        deduplicate: bool = True,
    ) -> tuple[str, bool]:
        """Queue a job. Returns ``(job_id, was_deduplicated)``.

        An identical request that is still queued or running is reused rather
        than started twice (spec 5.5).
        """
        rhash = request_hash(payload)

        if deduplicate:
            with session_scope() as session:
                existing = (
                    session.query(Job)
                    .filter(
                        Job.request_hash == rhash,
                        Job.status.in_([JobStatus.QUEUED.value, JobStatus.RUNNING.value]),
                    )
                    .order_by(Job.created_at.desc())
                    .first()
                )
                if existing is not None:
                    log.info("reusing in-flight job %s for an identical request", existing.id)
                    return existing.id, True

        job_id = new_id("job")
        with session_scope() as session:
            session.add(
                Job(
                    id=job_id,
                    job_type=job_type.value,
                    project_id=project_id,
                    component_instance_id=component_instance_id,
                    optimization_run_id=optimization_run_id,
                    status=JobStatus.QUEUED.value,
                    stage=JobStage.QUEUED.value,
                    progress=0.0,
                    message="Queued",
                    request_hash=rhash,
                    request_payload=payload,
                    stage_history=[{"stage": JobStage.QUEUED.value, "at": _now().isoformat()}],
                    log_path=str(get_store().logs_dir() / f"{job_id}.log"),
                )
            )

        cancel = threading.Event()
        with self._lock:
            self._cancels[job_id] = cancel
            self._futures[job_id] = self._pool.submit(self._run, job_id, fn, cancel)

        log.info("queued %s job %s", job_type.value, job_id)
        return job_id, False

    # -------------------------------------------------------------- execution

    def _run(self, job_id: str, fn: JobFn, cancel: threading.Event) -> None:
        ctx = JobContext(job_id, cancel)
        with session_scope() as session:
            job = session.get(Job, job_id)
            if job is not None:
                job.status = JobStatus.RUNNING.value
                job.stage = JobStage.VALIDATING.value
                job.started_at = _now()
                job.message = "Starting"

        try:
            ctx.log(f"job {job_id} started")
            result = fn(ctx)
            with session_scope() as session:
                job = session.get(Job, job_id)
                if job is not None:
                    job.status = JobStatus.COMPLETED.value
                    job.stage = JobStage.COMPLETED.value
                    job.progress = 1.0
                    job.message = "Completed"
                    job.result_payload = result
                    job.completed_at = _now()
            ctx.log(f"job {job_id} completed")
            log.info("job %s completed", job_id)

        except JobCancelled as exc:
            with session_scope() as session:
                job = session.get(Job, job_id)
                if job is not None:
                    job.status = JobStatus.CANCELLED.value
                    job.message = str(exc)
                    job.completed_at = _now()
            ctx.log(f"job {job_id} cancelled")

        except Exception as exc:
            detail = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
            ctx.log(f"job {job_id} FAILED: {exc}\n{detail}")
            with session_scope() as session:
                job = session.get(Job, job_id)
                if job is not None:
                    job.status = JobStatus.FAILED.value
                    job.message = "Failed"
                    # The message the engineer sees; the traceback stays in the log.
                    job.error = str(exc)
                    job.completed_at = _now()
            log.exception("job %s failed", job_id)

        finally:
            with self._lock:
                self._futures.pop(job_id, None)
                self._cancels.pop(job_id, None)

    # ------------------------------------------------------------------ query

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            event = self._cancels.get(job_id)
        if event is None:
            return False
        event.set()
        return True

    def is_running(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._futures

    def active_count(self) -> int:
        with self._lock:
            return len(self._futures)

    def shutdown(self, wait: bool = False) -> None:  # pragma: no cover
        self._pool.shutdown(wait=wait, cancel_futures=True)

    def reset_orphaned_jobs(self) -> int:
        """Mark jobs left running by a previous process as failed, on startup."""
        with session_scope() as session:
            orphans = (
                session.query(Job)
                .filter(Job.status.in_([JobStatus.QUEUED.value, JobStatus.RUNNING.value]))
                .all()
            )
            for job in orphans:
                job.status = JobStatus.FAILED.value
                job.error = (
                    "The application restarted while this job was in progress, so it "
                    "was not completed. Artifacts produced before the restart are kept."
                )
                job.completed_at = _now()
            count = len(orphans)
        if count:
            log.info("marked %d orphaned job(s) as failed on startup", count)
        return count


_manager: Optional[JobManager] = None


def get_job_manager() -> JobManager:
    global _manager
    if _manager is None:
        _manager = JobManager()
    return _manager
