import os
import sqlite3
from pathlib import Path


class _Row:
    """sqlite3.Row replacement for libsql — supports both row['col'] and row[0]."""
    __slots__ = ("_keys", "_data")

    def __init__(self, keys: tuple, data: tuple):
        self._keys = keys
        self._data = data

    def __getitem__(self, key):
        if isinstance(key, str):
            try:
                return self._data[self._keys.index(key)]
            except ValueError:
                raise IndexError(f"No column named {key!r}")
        return self._data[key]

    def keys(self):
        return list(self._keys)


class _Cursor:
    """Wraps a libsql cursor to yield _Row objects."""

    def __init__(self, cur):
        self._cur = cur

    @property
    def description(self):
        return self._cur.description

    @property
    def rowcount(self):
        return self._cur.rowcount

    @property
    def lastrowid(self):
        return self._cur.lastrowid

    def _keys(self):
        return tuple(d[0] for d in self._cur.description) if self._cur.description else ()

    def fetchone(self):
        row = self._cur.fetchone()
        return _Row(self._keys(), row) if row is not None else None

    def fetchall(self):
        keys = self._keys()
        return [_Row(keys, r) for r in self._cur.fetchall()]

    def __iter__(self):
        keys = self._keys()
        for row in self._cur:
            yield _Row(keys, row)


class _Connection:
    """Wraps a libsql connection; provides context manager + _Row-based row access."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        return _Cursor(self._conn.execute(sql, params))

    def executemany(self, sql, seq):
        return _Cursor(self._conn.executemany(sql, seq))

    def cursor(self):
        return _Cursor(self._conn.cursor())

    def commit(self):
        self._conn.commit()

    def rollback(self):
        if hasattr(self._conn, "rollback"):
            self._conn.rollback()

    def close(self):
        self._conn.close()

    def sync(self):
        if hasattr(self._conn, "sync"):
            self._conn.sync()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self._conn.commit()
        else:
            self.rollback()
        return False


def connect(db_path: Path, turso_url_env: str, wal: bool = False) -> sqlite3.Connection:
    """
    Returns a sqlite3-compatible connection.
    Uses Turso (libsql-experimental embedded replica) when TURSO_AUTH_TOKEN
    and the given turso_url_env variable are both set with a valid libsql:// URL;
    otherwise falls back to local SQLite.
    """
    turso_url = os.getenv(turso_url_env)
    turso_token = os.getenv("TURSO_AUTH_TOKEN")

    db_path.parent.mkdir(parents=True, exist_ok=True)

    if turso_url and turso_token and turso_url.startswith("libsql://"):
        import libsql_experimental as libsql  # type: ignore[import]
        raw = libsql.connect(str(db_path), sync_url=turso_url, auth_token=turso_token)
        raw.sync()
        return _Connection(raw)  # type: ignore[return-value]

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    if wal:
        conn.execute("PRAGMA journal_mode=WAL")
    return conn
