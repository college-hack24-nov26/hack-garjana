"""Database engine and session management."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.models import Base

log = get_logger(__name__)

_settings = get_settings()

_engine: Engine = create_engine(
    _settings.database_url,
    # The job manager touches the database from worker threads.
    connect_args={"check_same_thread": False, "timeout": 30},
    future=True,
)


@event.listens_for(_engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record):
    cur = dbapi_connection.cursor()
    # WAL lets a worker thread write while the API reads.
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False, future=True)


#: Columns added after the first release, as ``(table, column, SQL type)``.
#:
#: ``create_all`` creates missing tables but never alters an existing one, so a
#: database written by an earlier build keeps its old shape and every read of a
#: new column fails. There is no migration tool in this project, so additive
#: columns are applied here explicitly. Each entry must be nullable and have no
#: default beyond NULL, because existing rows genuinely have no value for it -
#: a candidate evaluated before the assurance gate existed was not assured, and
#: backfilling it with anything other than "unknown" would invent evidence.
_ADDITIVE_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("candidates", "assurance", "JSON"),
    # Old results have no applied-load check on record, so NULL is the honest value.
    ("simulation_results", "load_verifications", "JSON"),
)


def _apply_additive_columns() -> None:
    from sqlalchemy import text

    with _engine.begin() as conn:
        existing_tables = {
            row[0]
            for row in conn.execute(
                text("SELECT name FROM sqlite_master WHERE type = 'table'")
            )
        }
        for table, column, sql_type in _ADDITIVE_COLUMNS:
            if table not in existing_tables:
                continue  # create_all just built it with the column present
            columns = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))
            }
            if column in columns:
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))
            log.info("added column %s.%s to the existing database", table, column)


def init_db() -> None:
    Base.metadata.create_all(_engine)
    _apply_additive_columns()
    log.info("database ready at %s", _settings.database_url)


def get_engine() -> Engine:
    return _engine


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for worker threads and services."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
