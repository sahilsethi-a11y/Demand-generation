"""
ScheduleStore — persistence layer for automation schedules, run history, and outreach dedup log.

All tables live in the same jobs.sqlite3 database (passed as db_path).
Table creation is handled by JobStore.init_db() via _migrate_automation_tables().
This class only performs CRUD operations against that database.
"""

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from .db_connect import connect as _db_connect


class ScheduleStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path

    # ── Connection ──────────────────────────────────────────────────────────

    def _connect(self) -> sqlite3.Connection:
        return _db_connect(self.db_path, "TURSO_JOBS_DB_URL", wal=True)

    # ── Schedule CRUD ────────────────────────────────────────────────────────

    def create_schedule(self, data: dict[str, Any]) -> dict[str, Any]:
        now = int(time.time() * 1000)
        schedule_id = str(uuid.uuid4())
        interval_minutes = int(data.get("interval_minutes") or 360)
        next_run_at = now + interval_minutes * 60 * 1000

        row = {
            "schedule_id": schedule_id,
            "name": str(data.get("name") or ""),
            "is_active": 1,
            "role": str(data.get("role") or ""),
            "location": str(data.get("location") or ""),
            "date_filter": str(data.get("date_filter") or "7d"),
            "market": str(data.get("market") or "us"),
            "job_type": str(data.get("job_type") or "all"),
            "sources_json": json.dumps(data.get("sources") or []),
            "max_companies": int(data.get("max_companies") or 20),
            "max_icps_per_company": int(data.get("max_icps_per_company") or 5),
            "campaign_id": data.get("campaign_id") or None,
            "titles_json": json.dumps(data.get("titles") or []),
            "auto_icp": 1 if data.get("auto_icp", True) else 0,
            "auto_email": 1 if data.get("auto_email", True) else 0,
            "auto_send": 1 if data.get("auto_send", True) else 0,
            "interval_minutes": interval_minutes,
            "cron_expr": data.get("cron_expr") or None,
            "next_run_at": next_run_at,
            "consecutive_failures": 0,
            "last_run_status": None,
            "last_run_id": None,
            "last_run_at": None,
            "skip_contacted_companies": 1 if data.get("skip_contacted_companies", True) else 0,
            "dedup_lookback_days": int(data.get("dedup_lookback_days") or 90),
            "created_at": now,
            "updated_at": now,
        }

        with self._connect() as conn:
            cols = ", ".join(row.keys())
            placeholders = ", ".join("?" for _ in row)
            conn.execute(
                f"INSERT INTO automation_schedules ({cols}) VALUES ({placeholders})",
                tuple(row.values()),
            )
            conn.commit()

        return self.get_schedule(schedule_id)  # type: ignore[return-value]

    def list_schedules(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM automation_schedules ORDER BY created_at DESC"
            ).fetchall()
        return [self._deserialize_schedule(dict(r)) for r in rows]

    def get_schedule(self, schedule_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM automation_schedules WHERE schedule_id = ?",
                (schedule_id,),
            ).fetchone()
        return self._deserialize_schedule(dict(row)) if row else None

    def update_schedule(self, schedule_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
        existing = self.get_schedule(schedule_id)
        if not existing:
            return None

        now = int(time.time() * 1000)
        allowed = {
            "name", "role", "location", "date_filter", "market", "job_type",
            "max_companies", "max_icps_per_company", "campaign_id",
            "auto_icp", "auto_email", "auto_send", "interval_minutes", "cron_expr",
            "skip_contacted_companies", "dedup_lookback_days", "is_active",
        }
        updates: dict[str, Any] = {"updated_at": now}

        for key, value in data.items():
            if key not in allowed:
                continue
            if key in ("auto_icp", "auto_email", "auto_send", "is_active", "skip_contacted_companies"):
                updates[key] = 1 if value else 0
            elif key in ("max_companies", "max_icps_per_company", "interval_minutes", "dedup_lookback_days"):
                updates[key] = int(value)
            else:
                updates[key] = value

        if "sources" in data:
            updates["sources_json"] = json.dumps(data["sources"] or [])
        if "titles" in data:
            updates["titles_json"] = json.dumps(data["titles"] or [])

        # Recalculate next_run_at if interval changed
        if "interval_minutes" in updates:
            updates["next_run_at"] = now + updates["interval_minutes"] * 60 * 1000

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE automation_schedules SET {set_clause} WHERE schedule_id = ?",
                (*updates.values(), schedule_id),
            )
            conn.commit()

        return self.get_schedule(schedule_id)

    def delete_schedule(self, schedule_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM automation_schedules WHERE schedule_id = ?",
                (schedule_id,),
            )
            conn.execute(
                "DELETE FROM automation_run_history WHERE schedule_id = ?",
                (schedule_id,),
            )
            conn.commit()
        return cursor.rowcount > 0

    def pause_schedule(self, schedule_id: str) -> dict[str, Any] | None:
        return self.update_schedule(schedule_id, {"is_active": False})

    def resume_schedule(self, schedule_id: str) -> dict[str, Any] | None:
        now = int(time.time() * 1000)
        existing = self.get_schedule(schedule_id)
        if not existing:
            return None
        interval_ms = existing["interval_minutes"] * 60 * 1000
        next_run_at = now + interval_ms
        with self._connect() as conn:
            conn.execute(
                "UPDATE automation_schedules SET is_active=1, next_run_at=?, consecutive_failures=0, updated_at=? WHERE schedule_id=?",
                (next_run_at, now, schedule_id),
            )
            conn.commit()
        return self.get_schedule(schedule_id)

    # ── Polling ──────────────────────────────────────────────────────────────

    def get_due_schedules(self) -> list[dict[str, Any]]:
        """Return active schedules whose next_run_at is in the past and are not currently running."""
        now = int(time.time() * 1000)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM automation_schedules
                WHERE is_active = 1
                  AND next_run_at <= ?
                  AND (last_run_status IS NULL OR last_run_status != 'running')
                ORDER BY next_run_at ASC
                """,
                (now,),
            ).fetchall()
        return [self._deserialize_schedule(dict(r)) for r in rows]

    def mark_schedule_running(self, schedule_id: str, run_history_id: str) -> None:
        now = int(time.time() * 1000)
        with self._connect() as conn:
            conn.execute(
                "UPDATE automation_schedules SET last_run_status='running', last_run_id=?, updated_at=? WHERE schedule_id=?",
                (run_history_id, now, schedule_id),
            )
            conn.commit()

    def update_after_run(
        self,
        schedule_id: str,
        status: str,
        run_history_id: str,
    ) -> None:
        """Called after a schedule run completes. Updates next_run_at and failure counter."""
        now = int(time.time() * 1000)
        schedule = self.get_schedule(schedule_id)
        if not schedule:
            return

        interval_ms = schedule["interval_minutes"] * 60 * 1000
        next_run_at = now + interval_ms

        if status == "completed":
            consecutive_failures = 0
            is_active = 1
        else:
            consecutive_failures = schedule["consecutive_failures"] + 1
            # Exponential backoff: 2x interval after 3 failures, 4x after 4+
            if consecutive_failures == 3:
                next_run_at = now + interval_ms * 2
            elif consecutive_failures >= 4:
                # Auto-pause after 4 consecutive failures
                is_active = 0
                next_run_at = None
            else:
                pass  # normal interval
            is_active = 1 if consecutive_failures < 4 else 0

        with self._connect() as conn:
            conn.execute(
                """
                UPDATE automation_schedules
                SET last_run_status=?, last_run_id=?, last_run_at=?,
                    next_run_at=?, consecutive_failures=?, is_active=?, updated_at=?
                WHERE schedule_id=?
                """,
                (
                    status,
                    run_history_id,
                    now,
                    next_run_at,
                    consecutive_failures,
                    is_active,
                    now,
                    schedule_id,
                ),
            )
            conn.commit()

    def trigger_now(self, schedule_id: str) -> None:
        """Force a schedule to fire on the next poller tick by setting next_run_at = now - 1."""
        now = int(time.time() * 1000)
        with self._connect() as conn:
            conn.execute(
                "UPDATE automation_schedules SET next_run_at=?, updated_at=? WHERE schedule_id=?",
                (now - 1, now, schedule_id),
            )
            conn.commit()

    # ── Run History ──────────────────────────────────────────────────────────

    def create_run_history(
        self,
        schedule_id: str,
        pipeline_run_id: str,
        triggered_by_email: str | None = None,
    ) -> str:
        run_history_id = str(uuid.uuid4())
        now = int(time.time() * 1000)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO automation_run_history
                  (run_history_id, schedule_id, pipeline_run_id, status,
                   triggered_at, created_at, triggered_by_email)
                VALUES (?, ?, ?, 'queued', ?, ?, ?)
                """,
                (run_history_id, schedule_id, pipeline_run_id, now, now, triggered_by_email),
            )
            conn.commit()
        return run_history_id

    def start_run_history(self, run_history_id: str) -> None:
        now = int(time.time() * 1000)
        with self._connect() as conn:
            conn.execute(
                "UPDATE automation_run_history SET status='running', started_at=? WHERE run_history_id=?",
                (now, run_history_id),
            )
            conn.commit()

    def complete_run_history(
        self,
        run_history_id: str,
        status: str,
        summary: dict[str, Any] | None = None,
        error_message: str | None = None,
        companies_skipped_dedup: int = 0,
        contacts_skipped_dedup: int = 0,
    ) -> None:
        now = int(time.time() * 1000)
        s = summary or {}
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE automation_run_history SET
                    status=?, completed_at=?, error_message=?,
                    jobs_found=?, companies=?, icps_found=?,
                    emails_generated=?, leads_sent=?,
                    companies_skipped_dedup=?, contacts_skipped_dedup=?
                WHERE run_history_id=?
                """,
                (
                    status, now, error_message,
                    s.get("jobs_found"), s.get("companies"), s.get("icps"),
                    s.get("emails_generated"), s.get("leads_sent"),
                    companies_skipped_dedup, contacts_skipped_dedup,
                    run_history_id,
                ),
            )
            conn.commit()

    def list_run_history(self, schedule_id: str, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM automation_run_history
                WHERE schedule_id = ?
                ORDER BY triggered_at DESC
                LIMIT ?
                """,
                (schedule_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def list_all_run_history(self, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM automation_run_history
                ORDER BY triggered_at DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_run_history_entry(self, run_history_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM automation_run_history WHERE run_history_id = ?",
                (run_history_id,),
            ).fetchone()
        return dict(row) if row else None

    # ── Outreach Log (Deduplication) ─────────────────────────────────────────

    def log_outreach(
        self,
        contacts: list[dict[str, Any]],
        schedule_id: str | None = None,
        run_history_id: str | None = None,
        pipeline_run_id: str | None = None,
        campaign_id: str | None = None,
    ) -> int:
        """Insert sent contacts into outreach_log. Uses INSERT OR IGNORE for dedup safety."""
        now = int(time.time() * 1000)
        inserted = 0
        with self._connect() as conn:
            for contact in contacts:
                company_key = str(contact.get("_company_key") or contact.get("organization_domain") or "").lower()
                # Build contact_key same way as JobStore._contact_key
                person_id = str(contact.get("apollo_person_id") or "").strip()
                email = str(contact.get("email") or "").strip().lower()
                name = str(contact.get("name") or "").strip().lower()
                title = str(contact.get("title") or "").strip().lower()

                if person_id:
                    contact_key = f"apollo:{person_id}"
                elif email:
                    contact_key = f"email:{email}"
                else:
                    contact_key = f"{company_key}|{name}|{title}"

                if not contact_key or contact_key == "||":
                    continue

                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO outreach_log
                      (log_id, contact_key, company_key,
                       contact_email, contact_name, contact_title,
                       company_name, company_domain,
                       schedule_id, run_history_id, pipeline_run_id, campaign_id,
                       sent_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        contact_key,
                        company_key,
                        email or None,
                        contact.get("name"),
                        contact.get("title"),
                        contact.get("_company_name"),
                        contact.get("_company_domain") or contact.get("organization_domain"),
                        schedule_id,
                        run_history_id,
                        pipeline_run_id,
                        campaign_id,
                        now,
                        now,
                    ),
                )
                inserted += cursor.rowcount
            conn.commit()
        return inserted

    def get_contacted_company_keys(self, lookback_days: int = 90) -> set[str]:
        """Return company_keys that have been outreached within the lookback window."""
        now = int(time.time() * 1000)
        if lookback_days <= 0:
            cutoff = 0
        else:
            cutoff = now - lookback_days * 24 * 3600 * 1000
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT DISTINCT company_key FROM outreach_log WHERE sent_at >= ?",
                (cutoff,),
            ).fetchall()
        return {r["company_key"] for r in rows if r["company_key"]}

    def get_contacted_contact_keys(self) -> set[str]:
        """Return all contact_keys ever logged (no lookback — contacts are never re-contacted)."""
        with self._connect() as conn:
            rows = conn.execute("SELECT contact_key FROM outreach_log").fetchall()
        return {r["contact_key"] for r in rows}

    def list_outreach_log(
        self,
        company_key: str | None = None,
        schedule_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        conditions: list[str] = []
        params: list[Any] = []
        if company_key:
            conditions.append("company_key = ?")
            params.append(company_key)
        if schedule_id:
            conditions.append("schedule_id = ?")
            params.append(schedule_id)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.extend([limit, offset])
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM outreach_log {where} ORDER BY sent_at DESC LIMIT ? OFFSET ?",
                tuple(params),
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_outreach_log_entry(self, log_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM outreach_log WHERE log_id = ?", (log_id,))
            conn.commit()
        return cursor.rowcount > 0

    # ── Internal helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _deserialize_schedule(row: dict[str, Any]) -> dict[str, Any]:
        row["sources"] = json.loads(row.get("sources_json") or "[]")
        row["titles"] = json.loads(row.get("titles_json") or "[]")
        row["is_active"] = bool(row.get("is_active"))
        row["auto_icp"] = bool(row.get("auto_icp"))
        row["auto_email"] = bool(row.get("auto_email"))
        row["auto_send"] = bool(row.get("auto_send"))
        row["skip_contacted_companies"] = bool(row.get("skip_contacted_companies"))
        return row
