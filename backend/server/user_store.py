import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from .db_connect import connect as _db_connect


class UserStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        return _db_connect(self.db_path, "TURSO_JOBS_DB_URL")

    def init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    user_id       TEXT PRIMARY KEY,
                    email         TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role          TEXT NOT NULL DEFAULT 'user',
                    created_at    INTEGER NOT NULL,
                    updated_at    INTEGER NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)"
            )

    def create_user(self, email: str, password_hash: str, role: str = "user") -> dict[str, Any]:
        now = int(time.time() * 1000)
        user_id = str(uuid.uuid4())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO users (user_id, email, password_hash, role, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, email.lower().strip(), password_hash, role, now, now),
            )
        return {"user_id": user_id, "email": email.lower().strip(), "role": role}

    def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE email = ?",
                (email.lower().strip(),),
            ).fetchone()
        return dict(row) if row else None

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        return dict(row) if row else None

    def count_users(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) FROM users").fetchone()
        return row[0] if row else 0
