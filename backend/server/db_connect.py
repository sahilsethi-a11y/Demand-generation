import os
import sqlite3
from pathlib import Path


def connect(db_path: Path, turso_url_env: str, wal: bool = False) -> sqlite3.Connection:
    """
    Returns a sqlite3-compatible connection.
    Uses Turso (libsql-experimental embedded replica) when TURSO_AUTH_TOKEN
    and the given turso_url_env variable are both set; otherwise falls back
    to local SQLite.

    Args:
        db_path:       Local file path (used as local replica cache with Turso,
                       or as the actual DB when running locally).
        turso_url_env: Name of the env var holding the libsql:// URL for this DB.
        wal:           Enable WAL journal mode (local SQLite only; Turso ignores it).
    """
    turso_url = os.getenv(turso_url_env)
    turso_token = os.getenv("TURSO_AUTH_TOKEN")

    db_path.parent.mkdir(parents=True, exist_ok=True)

    if turso_url and turso_token and turso_url.startswith("libsql://"):
        import libsql_experimental as libsql  # type: ignore[import]
        conn = libsql.connect(str(db_path), sync_url=turso_url, auth_token=turso_token)
        conn.sync()
        conn.row_factory = libsql.Row
        return conn

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    if wal:
        conn.execute("PRAGMA journal_mode=WAL")
    return conn
