from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from threading import Lock

_lock = Lock()


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                day TEXT NOT NULL,
                status TEXT NOT NULL,
                error TEXT,
                result_blob BLOB,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
            CREATE TABLE IF NOT EXISTS daily_usage (
                user_id TEXT NOT NULL,
                day TEXT NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, day)
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def _connections(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


async def blocking(fn: Callable[..., object]) -> object:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn)


@contextmanager
def connection(path: Path):
    conn = _connections(path)
    try:
        yield conn
    finally:
        conn.close()


def reserve_quota_and_insert_job(conn: sqlite3.Connection, *, job_id: str, user_id: str, day: str, limit: int) -> None:
    with _lock:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT used FROM daily_usage WHERE user_id = ? AND day = ?",
                (user_id, day),
            ).fetchone()
            cur_used = int(row[0]) if row else 0
            if cur_used >= limit:
                conn.rollback()
                raise QuotaExceededError(user_id=user_id, day=day, limit=limit)

            if row is None:
                conn.execute(
                    "INSERT INTO daily_usage (user_id, day, used) VALUES (?, ?, 1)",
                    (user_id, day),
                )
            else:
                conn.execute(
                    "UPDATE daily_usage SET used = used + 1 WHERE user_id = ? AND day = ?",
                    (user_id, day),
                )

            from datetime import datetime, timezone

            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """
                INSERT INTO jobs (id, user_id, day, status, error, result_blob, created_at, updated_at)
                VALUES (?, ?, ?, 'queued', NULL, NULL, ?, ?)
                """,
                (job_id, user_id, day, now, now),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


class QuotaExceededError(Exception):
    def __init__(self, *, user_id: str, day: str, limit: int) -> None:
        super().__init__("quota_exceeded")
        self.user_id = user_id
        self.day = day
        self.limit = limit


def refund_quota(conn: sqlite3.Connection, *, user_id: str, day: str) -> None:
    with _lock:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            UPDATE daily_usage
            SET used = MAX(used - 1, 0)
            WHERE user_id = ? AND day = ?
            """,
            (user_id, day),
        )
        conn.commit()


def update_job_processing(conn: sqlite3.Connection, *, job_id: str) -> None:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?",
        ("processing", now, job_id),
    )
    conn.commit()


def update_job_done(conn: sqlite3.Connection, *, job_id: str, result: bytes) -> None:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE jobs SET status = ?, error = NULL, result_blob = ?, updated_at = ? WHERE id = ?",
        ("done", result, now, job_id),
    )
    conn.commit()


def update_job_failed(conn: sqlite3.Connection, *, job_id: str, error: str) -> None:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
        ("failed", error, now, job_id),
    )
    conn.commit()


def get_job(conn: sqlite3.Connection, *, job_id: str, user_id: str):
    row = conn.execute(
        "SELECT id, user_id, status, error, result_blob FROM jobs WHERE id = ? AND user_id = ?",
        (job_id, user_id),
    ).fetchone()
    if row is None:
        return None
    return {"id": row[0], "user_id": row[1], "status": row[2], "error": row[3], "result_blob": row[4]}


def get_day_for_quota(timezone_name: str) -> str:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(timezone_name)
    return datetime.now(tz).date().isoformat()
