import json
import sqlite3
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .db_connect import connect as _db_connect

_THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000


class JobStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        return _db_connect(self.db_path, "TURSO_JOBS_DB_URL")

    def init_db(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        conn = self._connect()

        # Skip DDL if the main table already exists — avoids 20+ Turso round-trips per startup.
        try:
            conn.execute("SELECT 1 FROM saved_jobs LIMIT 1")
            _needs_schema = False
        except Exception:
            _needs_schema = True

        # Always ensure automation tables exist — they may have been added after the
        # initial schema was created, so the _needs_schema shortcut would have skipped them.
        try:
            conn.execute("SELECT 1 FROM outreach_log LIMIT 1")
        except Exception:
            with conn as connection:
                self._migrate_automation_tables(connection)

        if _needs_schema:
            with conn as connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS saved_jobs (
                        job_key TEXT PRIMARY KEY,
                        company_key TEXT,
                        company_domain TEXT,
                        source TEXT,
                        title TEXT,
                        organization TEXT,
                        location TEXT,
                        date_posted TEXT,
                        payload_json TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS company_contacts (
                        contact_key TEXT PRIMARY KEY,
                        company_key TEXT NOT NULL,
                        name TEXT,
                        title TEXT,
                        email TEXT,
                        linkedin_url TEXT,
                        apollo_person_id TEXT,
                        organization_id TEXT,
                        organization_domain TEXT,
                        confidence TEXT,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS company_enrichment (
                        company_key TEXT PRIMARY KEY,
                        company_name TEXT,
                        company_domain TEXT,
                        status TEXT NOT NULL DEFAULT 'pending',
                        confidence TEXT,
                        error_message TEXT,
                        contacts_count INTEGER NOT NULL DEFAULT 0,
                        last_run_id TEXT,
                        last_attempted_at INTEGER,
                        last_completed_at INTEGER,
                        updated_at INTEGER NOT NULL
                    )
                    """
                )
                self._migrate_saved_jobs_table(connection)
                self._migrate_company_contacts_table(connection)
                self._migrate_company_enrichment_table(connection)
                self._backfill_saved_jobs_company_metadata(connection)
                self._migrate_automation_tables(connection)
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_saved_jobs_updated_at ON saved_jobs(updated_at DESC)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_saved_jobs_company_key ON saved_jobs(company_key)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_company_contacts_company_key ON company_contacts(company_key)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_company_contacts_apollo_id ON company_contacts(apollo_person_id)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_company_contacts_linkedin ON company_contacts(linkedin_url)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_company_enrichment_status ON company_enrichment(status)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_arh_schedule_id ON automation_run_history(schedule_id)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_arh_triggered_at ON automation_run_history(triggered_at DESC)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_ol_contact_key ON outreach_log(contact_key)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_ol_company_key ON outreach_log(company_key)"
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_ol_sent_at ON outreach_log(sent_at DESC)"
                )
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS outreach_emails (
                        email_key TEXT PRIMARY KEY,
                        company_key TEXT NOT NULL,
                        contact_email TEXT,
                        apollo_person_id TEXT,
                        contact_name TEXT,
                        contact_title TEXT,
                        subject_1 TEXT,
                        subject_2 TEXT,
                        body TEXT,
                        qa_status TEXT,
                        approved INTEGER NOT NULL DEFAULT 0,
                        pipeline_run_id TEXT,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS idx_oe_company_key ON outreach_emails(company_key)"
                )
                connection.commit()

    def upsert_jobs(self, jobs: list[dict[str, Any]]) -> int:
        self.init_db()
        now_ms = int(time.time() * 1000)
        with self._connect() as connection:
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(saved_jobs)").fetchall()
            }
            for job in jobs:
                company_key = self._company_key(job)
                company_domain = self._normalize_domain(job.get("domain_derived"))
                job_key = self._job_key(job)
                values: dict[str, Any] = {
                    "job_key": job_key,
                    "company_key": company_key,
                    "company_domain": company_domain,
                    "source": str(job.get("source") or ""),
                    "title": str(job.get("title") or ""),
                    "organization": str(job.get("organization") or ""),
                    "location": str(job.get("display_location") or ""),
                    "date_posted": str(job.get("date_posted") or ""),
                    "payload_json": json.dumps(job, default=str),
                    "created_at": now_ms,
                    "updated_at": now_ms,
                }
                if "filled_fields" in columns:
                    values["filled_fields"] = self._filled_field_count(job)
                if "apply_url" in columns:
                    values["apply_url"] = str(job.get("apply_url") or job.get("url") or "")
                if "company_slug" in columns:
                    values["company_slug"] = str(job.get("company_slug") or "")

                insert_columns = list(values.keys())
                update_columns = [column for column in insert_columns if column not in {"job_key", "created_at"}]
                insert_sql = ", ".join(insert_columns)
                placeholders = ", ".join("?" for _ in insert_columns)
                update_sql = ", ".join(f"{column} = excluded.{column}" for column in update_columns)

                connection.execute(
                    f"""
                    INSERT INTO saved_jobs ({insert_sql})
                    VALUES ({placeholders})
                    ON CONFLICT(job_key) DO UPDATE SET
                        {update_sql}
                    """,
                    tuple(values[column] for column in insert_columns),
                )
                connection.execute(
                    """
                    INSERT INTO company_enrichment (
                        company_key,
                        company_name,
                        company_domain,
                        status,
                        updated_at
                    )
                    VALUES (?, ?, ?, COALESCE((SELECT status FROM company_enrichment WHERE company_key = ?), 'pending'), ?)
                    ON CONFLICT(company_key) DO UPDATE SET
                        company_name = excluded.company_name,
                        company_domain = excluded.company_domain,
                        updated_at = excluded.updated_at
                    """,
                    (
                        company_key,
                        str(job.get("organization") or ""),
                        company_domain,
                        company_key,
                        now_ms,
                    ),
                )
            connection.commit()

        return self.count_jobs()

    def upsert_company_contacts(
        self,
        company_key: str,
        company_name: str | None,
        company_domain: str | None,
        contacts: list[dict[str, Any]],
        confidence: str | None,
        run_id: str | None = None,
    ) -> int:
        self.init_db()
        normalized_company_key = self._clean_text(company_key)
        now_ms = int(time.time() * 1000)
        unique_contacts: dict[str, dict[str, Any]] = {}
        for contact in contacts:
            contact_key = self._contact_key(normalized_company_key, contact)
            unique_contacts[contact_key] = contact

        with self._connect() as connection:
            for contact_key, contact in unique_contacts.items():
                connection.execute(
                    """
                    INSERT INTO company_contacts (
                        contact_key,
                        company_key,
                        name,
                        title,
                        email,
                        linkedin_url,
                        apollo_person_id,
                        organization_id,
                        organization_domain,
                        confidence,
                        payload_json,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(contact_key) DO UPDATE SET
                        name = excluded.name,
                        title = excluded.title,
                        email = COALESCE(excluded.email, company_contacts.email),
                        linkedin_url = excluded.linkedin_url,
                        apollo_person_id = excluded.apollo_person_id,
                        organization_id = excluded.organization_id,
                        organization_domain = excluded.organization_domain,
                        confidence = excluded.confidence,
                        payload_json = excluded.payload_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        contact_key,
                        normalized_company_key,
                        self._nullable_text(contact.get("name")),
                        self._nullable_text(contact.get("title")),
                        self._nullable_text(contact.get("email")),
                        self._nullable_text(contact.get("linkedin_url")),
                        self._nullable_text(contact.get("apollo_person_id")),
                        self._nullable_text(contact.get("organization_id")),
                        self._normalize_domain(contact.get("organization_domain")) or self._normalize_domain(company_domain),
                        self._nullable_text(contact.get("confidence") or confidence),
                        json.dumps(contact, default=str),
                        now_ms,
                        now_ms,
                    ),
                )

            contacts_count = int(
                connection.execute(
                    "SELECT COUNT(*) AS count FROM company_contacts WHERE company_key = ?",
                    (normalized_company_key,),
                ).fetchone()["count"]
            )
            connection.execute(
                """
                INSERT INTO company_enrichment (
                    company_key,
                    company_name,
                    company_domain,
                    status,
                    confidence,
                    contacts_count,
                    last_run_id,
                    last_attempted_at,
                    last_completed_at,
                    updated_at
                )
                VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)
                ON CONFLICT(company_key) DO UPDATE SET
                    company_name = excluded.company_name,
                    company_domain = excluded.company_domain,
                    status = excluded.status,
                    confidence = excluded.confidence,
                    contacts_count = excluded.contacts_count,
                    last_run_id = excluded.last_run_id,
                    last_attempted_at = excluded.last_attempted_at,
                    last_completed_at = excluded.last_completed_at,
                    error_message = NULL,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized_company_key,
                    self._nullable_text(company_name),
                    self._normalize_domain(company_domain),
                    self._nullable_text(confidence),
                    contacts_count,
                    self._nullable_text(run_id),
                    now_ms,
                    now_ms,
                    now_ms,
                ),
            )
            connection.commit()
        return len(unique_contacts)

    def upsert_outreach_email(
        self,
        company_key: str,
        contact_email: str | None,
        apollo_person_id: str | None,
        contact_name: str | None,
        contact_title: str | None,
        subject_1: str | None,
        subject_2: str | None,
        body: str | None,
        qa_status: str | None,
        approved: bool,
        pipeline_run_id: str | None = None,
    ) -> None:
        self.init_db()
        now_ms = int(time.time() * 1000)
        normalized_company_key = (company_key or "").strip().lower()
        # Prefer apollo_person_id as key, fall back to email
        email_key = f"{normalized_company_key}|{apollo_person_id or contact_email or contact_name or ''}".strip("|")
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO outreach_emails (
                    email_key, company_key, contact_email, apollo_person_id,
                    contact_name, contact_title, subject_1, subject_2, body,
                    qa_status, approved, pipeline_run_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(email_key) DO UPDATE SET
                    subject_1 = excluded.subject_1,
                    subject_2 = excluded.subject_2,
                    body = excluded.body,
                    qa_status = excluded.qa_status,
                    approved = excluded.approved,
                    pipeline_run_id = excluded.pipeline_run_id,
                    updated_at = excluded.updated_at
                """,
                (
                    email_key, normalized_company_key,
                    contact_email or None, apollo_person_id or None,
                    contact_name or None, contact_title or None,
                    subject_1 or None, subject_2 or None, body or None,
                    qa_status or None, 1 if approved else 0,
                    pipeline_run_id or None, now_ms, now_ms,
                ),
            )
            connection.commit()

    def get_outreach_emails_for_company(self, company_key: str) -> list[dict[str, Any]]:
        self.init_db()
        normalized = (company_key or "").strip().lower()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT contact_name, contact_title, contact_email, apollo_person_id,
                       subject_1, subject_2, body, qa_status, approved, pipeline_run_id, updated_at
                FROM outreach_emails
                WHERE company_key = ?
                ORDER BY approved DESC, updated_at DESC
                """,
                (normalized,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_outreach_emails_for_run(self, pipeline_run_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT contact_name, contact_title, contact_email,
                       subject_1, subject_2, body, qa_status, approved,
                       company_key, pipeline_run_id, updated_at
                FROM outreach_emails
                WHERE pipeline_run_id = ?
                ORDER BY approved DESC, updated_at DESC
                """,
                (pipeline_run_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_company_contacts_for_key(self, company_key: str) -> list[dict[str, Any]]:
        self.init_db()
        normalized = (company_key or "").strip().lower()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT name, title, email, linkedin_url, apollo_person_id,
                       organization_domain, confidence, payload_json
                FROM company_contacts
                WHERE company_key = ?
                ORDER BY
                    CASE WHEN email IS NULL OR email = '' THEN 1 ELSE 0 END,
                    title COLLATE NOCASE ASC
                """,
                (normalized,),
            ).fetchall()
        result = []
        for row in rows:
            d = {
                "name": row["name"],
                "title": row["title"],
                "email": row["email"],
                "linkedin_url": row["linkedin_url"],
                "apollo_person_id": row["apollo_person_id"],
                "organization_domain": row["organization_domain"],
                "confidence": row["confidence"],
            }
            if row["payload_json"]:
                try:
                    full = json.loads(row["payload_json"])
                    d["icp_reason"] = full.get("icp_reason")
                    d["seniority"] = full.get("seniority")
                    d["department"] = full.get("department")
                except Exception:
                    pass
            result.append(d)
        return result

    def set_company_enrichment_status(
        self,
        company_key: str,
        status: str,
        company_name: str | None = None,
        company_domain: str | None = None,
        confidence: str | None = None,
        error_message: str | None = None,
        run_id: str | None = None,
    ) -> None:
        self.init_db()
        now_ms = int(time.time() * 1000)
        normalized_company_key = self._clean_text(company_key)
        last_completed_at = now_ms if status == "completed" else None
        with self._connect() as connection:
            current_contacts_count_row = connection.execute(
                "SELECT COUNT(*) AS count FROM company_contacts WHERE company_key = ?",
                (normalized_company_key,),
            ).fetchone()
            contacts_count = int(current_contacts_count_row["count"]) if current_contacts_count_row else 0
            connection.execute(
                """
                INSERT INTO company_enrichment (
                    company_key,
                    company_name,
                    company_domain,
                    status,
                    confidence,
                    error_message,
                    contacts_count,
                    last_run_id,
                    last_attempted_at,
                    last_completed_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(company_key) DO UPDATE SET
                    company_name = COALESCE(excluded.company_name, company_enrichment.company_name),
                    company_domain = COALESCE(excluded.company_domain, company_enrichment.company_domain),
                    status = excluded.status,
                    confidence = COALESCE(excluded.confidence, company_enrichment.confidence),
                    error_message = excluded.error_message,
                    contacts_count = excluded.contacts_count,
                    last_run_id = COALESCE(excluded.last_run_id, company_enrichment.last_run_id),
                    last_attempted_at = excluded.last_attempted_at,
                    last_completed_at = COALESCE(excluded.last_completed_at, company_enrichment.last_completed_at),
                    updated_at = excluded.updated_at
                """,
                (
                    normalized_company_key,
                    self._nullable_text(company_name),
                    self._normalize_domain(company_domain),
                    status,
                    self._nullable_text(confidence),
                    self._nullable_text(error_message),
                    contacts_count,
                    self._nullable_text(run_id),
                    now_ms,
                    last_completed_at,
                    now_ms,
                ),
            )
            connection.commit()

    def list_companies_for_enrichment(
        self,
        company_keys: list[str] | None = None,
        force: bool = False,
        stale_after_hours: int = 24,
    ) -> list[dict[str, Any]]:
        self.init_db()
        stale_threshold = int(time.time() * 1000) - (stale_after_hours * 60 * 60 * 1000)
        where_clauses = ["saved_jobs.company_key != ''"]
        params: list[Any] = []
        if company_keys:
            placeholders = ", ".join("?" for _ in company_keys)
            where_clauses.append(f"saved_jobs.company_key IN ({placeholders})")
            params.extend(company_keys)
        if not force:
            where_clauses.append(
                "(company_enrichment.status IS NULL OR company_enrichment.status != 'completed' OR company_enrichment.last_completed_at IS NULL OR company_enrichment.last_completed_at < ?)"
            )
            params.append(stale_threshold)
        where_sql = " AND ".join(where_clauses)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT
                    saved_jobs.company_key,
                    MAX(NULLIF(saved_jobs.organization, '')) AS company_name,
                    MAX(NULLIF(saved_jobs.company_domain, '')) AS company_domain,
                    MAX(NULLIF(saved_jobs.title, '')) AS example_role,
                    MAX(company_enrichment.status) AS status,
                    MAX(company_enrichment.last_completed_at) AS last_completed_at
                FROM saved_jobs
                LEFT JOIN company_enrichment
                  ON company_enrichment.company_key = saved_jobs.company_key
                WHERE {where_sql}
                GROUP BY saved_jobs.company_key
                ORDER BY company_name COLLATE NOCASE ASC
                """,
                tuple(params),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_company_keys_for_job_keys(self, job_keys: list[str]) -> list[str]:
        self.init_db()
        normalized_job_keys = [self._clean_text(job_key) for job_key in job_keys if self._clean_text(job_key)]
        if not normalized_job_keys:
            return []
        placeholders = ", ".join("?" for _ in normalized_job_keys)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT DISTINCT company_key
                FROM saved_jobs
                WHERE job_key IN ({placeholders})
                  AND company_key != ''
                """,
                tuple(normalized_job_keys),
            ).fetchall()
        return [str(row["company_key"]).strip().lower() for row in rows if row["company_key"]]

    def get_jobs_by_job_keys(self, job_keys: list[str]) -> list[dict[str, Any]]:
        self.init_db()
        normalized_job_keys = [self._clean_text(job_key) for job_key in job_keys if self._clean_text(job_key)]
        if not normalized_job_keys:
            return []
        placeholders = ", ".join("?" for _ in normalized_job_keys)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT payload_json
                FROM saved_jobs
                WHERE job_key IN ({placeholders})
                """,
                tuple(normalized_job_keys),
            ).fetchall()
        jobs: list[dict[str, Any]] = []
        for row in rows:
            payload = json.loads(row["payload_json"])
            if isinstance(payload, dict):
                jobs.append(payload)
        return jobs

    def annotate_jobs(self, jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        self.init_db()
        if not jobs:
            return []
        company_keys = [self._company_key(job) for job in jobs if self._company_key(job)]
        contacts_map, enrichment_map = self._load_company_metadata(company_keys)
        annotated_jobs: list[dict[str, Any]] = []
        for job in jobs:
            company_key = self._company_key(job)
            contacts = contacts_map.get(company_key, [])
            enrichment = enrichment_map.get(company_key, {})
            payload = dict(job)
            payload["job_key"] = self._job_key(job)
            payload["company_key"] = company_key
            payload["company_contacts"] = contacts
            payload["contacts_count"] = len(contacts)
            payload["apollo_enrichment_status"] = enrichment.get("status")
            payload["apollo_enrichment_confidence"] = enrichment.get("confidence")
            annotated_jobs.append(payload)
        return annotated_jobs

    def list_jobs(
        self,
        page: int = 1,
        page_size: int = 100,
        source: str | None = None,
        role_query: str | None = None,
        has_contacts: bool = False,
        contact_title_query: str | None = None,
    ) -> dict[str, Any]:
        self.init_db()
        safe_page = max(page, 1)
        safe_page_size = min(max(page_size, 1), 250)
        offset = (safe_page - 1) * safe_page_size
        normalized_source = (source or "").strip().lower()
        normalized_role_query = (role_query or "").strip().lower()
        normalized_contact_title_query = (contact_title_query or "").strip().lower()

        where_clauses = ["1 = 1"]
        params: list[Any] = []
        if normalized_source not in {"", "all"}:
            where_clauses.append("LOWER(saved_jobs.source) = ?")
            params.append(normalized_source)
        if normalized_role_query:
            where_clauses.append("LOWER(saved_jobs.title) LIKE ?")
            params.append(f"%{normalized_role_query}%")
        if has_contacts:
            where_clauses.append(
                "EXISTS (SELECT 1 FROM company_contacts WHERE company_contacts.company_key = saved_jobs.company_key)"
            )
        if normalized_contact_title_query:
            where_clauses.append(
                """
                EXISTS (
                    SELECT 1
                    FROM company_contacts
                    WHERE company_contacts.company_key = saved_jobs.company_key
                      AND LOWER(COALESCE(company_contacts.title, '')) LIKE ?
                )
                """
            )
            params.append(f"%{normalized_contact_title_query}%")

        # Heavy fields not needed for the list view — strip them to reduce response size.
        _STRIP_FIELDS = {
            "description_text", "raw_payload", "search_metadata", "experience_text",
            "ai_benefits", "ai_keywords", "ai_taxonomies_a", "ai_education_requirements",
            "ai_core_responsibilities", "ai_requirements_summary", "ai_working_hours",
            "modified_fields", "locations_raw", "locations_alt_raw", "location_requirements_raw",
            "salary_raw", "lats_derived", "lngs_derived", "timezones_derived",
        }

        where_sql = " AND ".join(where_clauses)
        # Use direct execute() without a transaction context — BEGIN on libsql costs ~300ms.
        conn = self._connect()
        total_row = conn.execute(
            f"SELECT COUNT(*) AS count FROM saved_jobs WHERE {where_sql}",
            tuple(params),
        ).fetchone()
        rows = conn.execute(
            f"""
            SELECT payload_json, company_key
            FROM saved_jobs
            WHERE {where_sql}
            ORDER BY
                created_at DESC,
                updated_at DESC
            LIMIT ? OFFSET ?
            """,
            tuple([*params, safe_page_size, offset]),
        ).fetchall()

        company_keys = [row["company_key"] for row in rows if row["company_key"]]
        contacts_map, enrichment_map = self._load_company_metadata(company_keys)
        jobs: list[dict[str, Any]] = []
        for row in rows:
            payload = json.loads(row["payload_json"])
            if not isinstance(payload, dict):
                continue
            for f in _STRIP_FIELDS:
                payload.pop(f, None)
            contacts = contacts_map.get(row["company_key"], [])
            enrichment = enrichment_map.get(row["company_key"], {})
            payload["job_key"] = self._job_key(payload)
            payload["company_key"] = row["company_key"]
            payload["company_contacts"] = contacts
            payload["contacts_count"] = len(contacts)
            payload["apollo_enrichment_status"] = enrichment.get("status")
            payload["apollo_enrichment_confidence"] = enrichment.get("confidence")
            jobs.append(payload)

        total = int(total_row["count"]) if total_row else 0
        return {
            "jobs": jobs,
            "total": total,
            "page": safe_page,
            "page_size": safe_page_size,
            "source": normalized_source or "all",
            "role_query": normalized_role_query,
            "has_contacts": has_contacts,
            "contact_title_query": normalized_contact_title_query,
        }

    def count_jobs(self) -> int:
        self.init_db()
        with self._connect() as connection:
            row = connection.execute("SELECT COUNT(*) AS count FROM saved_jobs").fetchone()
        return int(row["count"]) if row else 0

    def clear_all(self) -> None:
        self.init_db()
        with self._connect() as connection:
            connection.execute("DELETE FROM company_contacts")
            connection.execute("DELETE FROM company_enrichment")
            connection.execute("DELETE FROM saved_jobs")
            connection.commit()

    def get_fresh_people_for_company(
        self,
        company_key: str,
        max_age_days: int = 30,
    ) -> list[dict[str, Any]] | None:
        """Return cached people for a company if all records are within max_age_days, else None.

        Returns None (cache miss) when no records exist or the most-recently updated record
        is older than the threshold — forcing a fresh Apollo fetch.
        """
        self.init_db()
        normalized_key = self._clean_text(company_key)
        if not normalized_key:
            return None
        cutoff_ms = int(time.time() * 1000) - (max_age_days * 24 * 60 * 60 * 1000)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT payload_json, name, title, email, linkedin_url,
                       apollo_person_id, organization_id, organization_domain, confidence, updated_at
                FROM company_contacts
                WHERE company_key = ?
                ORDER BY updated_at DESC
                """,
                (normalized_key,),
            ).fetchall()
        if not rows:
            return None
        # Cache miss if the newest record is stale
        if rows[0]["updated_at"] < cutoff_ms:
            return None
        people: list[dict[str, Any]] = []
        for row in rows:
            if row["payload_json"]:
                try:
                    people.append(json.loads(row["payload_json"]))
                    continue
                except Exception:
                    pass
            # Fallback: reconstruct from columns if payload_json missing
            people.append({
                "name": row["name"],
                "title": row["title"],
                "email": row["email"],
                "linkedin_url": row["linkedin_url"],
                "apollo_person_id": row["apollo_person_id"],
                "organization_id": row["organization_id"],
                "organization_domain": row["organization_domain"],
                "confidence": row["confidence"],
            })
        return people

    def get_fresh_email_for_person(
        self,
        apollo_person_id: str | None,
        linkedin_url: str | None,
        name: str | None,
        organization_domain: str | None,
        max_age_days: int = 30,
    ) -> dict[str, Any] | None:
        """Return a cached enriched contact (with email) if enriched within max_age_days, else None.

        Lookup priority: apollo_person_id → linkedin_url → name + domain.
        """
        self.init_db()
        cutoff_ms = int(time.time() * 1000) - (max_age_days * 24 * 60 * 60 * 1000)
        base_select = """
            SELECT name, title, email, linkedin_url, apollo_person_id,
                   organization_id, organization_domain, confidence, payload_json
            FROM company_contacts
            WHERE email IS NOT NULL AND email != '' AND updated_at > ?
        """
        with self._connect() as connection:
            if apollo_person_id and apollo_person_id.strip():
                row = connection.execute(
                    base_select + " AND apollo_person_id = ?",
                    (cutoff_ms, apollo_person_id.strip()),
                ).fetchone()
                if row:
                    return self._contact_row_to_dict(row)

            cleaned_linkedin = self._clean_text(linkedin_url).lower() if linkedin_url else ""
            if cleaned_linkedin:
                row = connection.execute(
                    base_select + " AND LOWER(linkedin_url) = ?",
                    (cutoff_ms, cleaned_linkedin),
                ).fetchone()
                if row:
                    return self._contact_row_to_dict(row)

            cleaned_name = self._clean_text(name).lower() if name else ""
            cleaned_domain = self._normalize_domain(organization_domain) if organization_domain else ""
            if cleaned_name and cleaned_domain:
                row = connection.execute(
                    base_select + " AND LOWER(name) = ? AND organization_domain = ?",
                    (cutoff_ms, cleaned_name, cleaned_domain),
                ).fetchone()
                if row:
                    return self._contact_row_to_dict(row)
        return None

    @staticmethod
    def _contact_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        if row["payload_json"]:
            try:
                return json.loads(row["payload_json"])
            except Exception:
                pass
        return {
            "name": row["name"],
            "title": row["title"],
            "email": row["email"],
            "linkedin_url": row["linkedin_url"],
            "apollo_person_id": row["apollo_person_id"],
            "organization_id": row["organization_id"],
            "organization_domain": row["organization_domain"],
            "confidence": row["confidence"],
        }

    def _load_company_metadata(
        self,
        company_keys: list[str],
    ) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
        unique_company_keys = [key for key in dict.fromkeys(company_keys) if key]
        if not unique_company_keys:
            return {}, {}
        placeholders = ", ".join("?" for _ in unique_company_keys)
        conn = self._connect()
        contact_rows = conn.execute(
            f"""
            SELECT
                company_key,
                name,
                title,
                email,
                linkedin_url,
                apollo_person_id,
                organization_id,
                organization_domain,
                confidence
            FROM company_contacts
            WHERE company_key IN ({placeholders})
            ORDER BY
                CASE WHEN email IS NULL OR email = '' THEN 1 ELSE 0 END,
                title COLLATE NOCASE ASC,
                name COLLATE NOCASE ASC
            """,
            tuple(unique_company_keys),
        ).fetchall()
        enrichment_rows = conn.execute(
            f"""
            SELECT company_key, status, confidence, contacts_count, error_message
            FROM company_enrichment
            WHERE company_key IN ({placeholders})
            """,
            tuple(unique_company_keys),
        ).fetchall()

        contacts_map: dict[str, list[dict[str, Any]]] = {key: [] for key in unique_company_keys}
        for row in contact_rows:
            contacts_map.setdefault(row["company_key"], []).append(
                {
                    "name": row["name"],
                    "title": row["title"],
                    "email": row["email"],
                    "linkedin_url": row["linkedin_url"],
                    "apollo_person_id": row["apollo_person_id"],
                    "organization_id": row["organization_id"],
                    "organization_domain": row["organization_domain"],
                    "confidence": row["confidence"],
                }
            )

        enrichment_map: dict[str, dict[str, Any]] = {}
        for row in enrichment_rows:
            enrichment_map[row["company_key"]] = dict(row)
        return contacts_map, enrichment_map

    @staticmethod
    def _job_key(job: dict[str, Any]) -> str:
        for field in ("url", "listing_url"):
            value = str(job.get(field) or "").strip()
            if value:
                return value
        return "|".join(
            [
                str(job.get("source") or ""),
                str(job.get("organization") or ""),
                str(job.get("title") or ""),
                str(job.get("display_location") or ""),
            ]
        )

    @classmethod
    def _company_key(cls, job: dict[str, Any]) -> str:
        domain = cls._normalize_domain(job.get("domain_derived"))
        if domain:
            return domain
        company_slug = cls._clean_text(job.get("company_slug"))
        if company_slug:
            return company_slug
        organization = cls._clean_text(job.get("organization"))
        return organization

    @classmethod
    def _contact_key(cls, company_key: str, contact: dict[str, Any]) -> str:
        person_id = cls._clean_text(contact.get("apollo_person_id"))
        if person_id:
            return f"apollo:{person_id}"
        email = cls._clean_text(contact.get("email")).lower()
        if email:
            return f"email:{email}"
        name = cls._clean_text(contact.get("name")).lower()
        title = cls._clean_text(contact.get("title")).lower()
        return f"{company_key}|{name}|{title}"

    @staticmethod
    def _migrate_automation_tables(connection: sqlite3.Connection) -> None:
        """Create automation_schedules, automation_run_history, and outreach_log tables."""
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS automation_schedules (
                schedule_id              TEXT PRIMARY KEY,
                name                     TEXT NOT NULL DEFAULT '',
                is_active                INTEGER NOT NULL DEFAULT 1,
                role                     TEXT NOT NULL DEFAULT '',
                location                 TEXT NOT NULL DEFAULT '',
                date_filter              TEXT NOT NULL DEFAULT '7d',
                market                   TEXT NOT NULL DEFAULT 'us',
                job_type                 TEXT DEFAULT 'all',
                sources_json             TEXT DEFAULT '[]',
                max_companies            INTEGER NOT NULL DEFAULT 20,
                max_icps_per_company     INTEGER NOT NULL DEFAULT 5,
                campaign_id              TEXT,
                titles_json              TEXT DEFAULT '[]',
                auto_icp                 INTEGER NOT NULL DEFAULT 1,
                auto_email               INTEGER NOT NULL DEFAULT 1,
                auto_send                INTEGER NOT NULL DEFAULT 1,
                interval_minutes         INTEGER NOT NULL DEFAULT 360,
                cron_expr                TEXT,
                next_run_at              INTEGER,
                consecutive_failures     INTEGER NOT NULL DEFAULT 0,
                last_run_status          TEXT,
                last_run_id              TEXT,
                last_run_at              INTEGER,
                skip_contacted_companies INTEGER NOT NULL DEFAULT 1,
                dedup_lookback_days      INTEGER NOT NULL DEFAULT 90,
                created_at               INTEGER NOT NULL,
                updated_at               INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS automation_run_history (
                run_history_id           TEXT PRIMARY KEY,
                schedule_id              TEXT NOT NULL,
                pipeline_run_id          TEXT,
                status                   TEXT NOT NULL DEFAULT 'queued',
                triggered_at             INTEGER NOT NULL,
                started_at               INTEGER,
                completed_at             INTEGER,
                error_message            TEXT,
                jobs_found               INTEGER,
                companies                INTEGER,
                icps_found               INTEGER,
                emails_generated         INTEGER,
                leads_sent               INTEGER,
                companies_skipped_dedup  INTEGER DEFAULT 0,
                contacts_skipped_dedup   INTEGER DEFAULT 0,
                created_at               INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS outreach_log (
                log_id          TEXT PRIMARY KEY,
                contact_key     TEXT NOT NULL,
                company_key     TEXT NOT NULL DEFAULT '',
                contact_email   TEXT,
                contact_name    TEXT,
                contact_title   TEXT,
                company_name    TEXT,
                company_domain  TEXT,
                schedule_id     TEXT,
                run_history_id  TEXT,
                pipeline_run_id TEXT,
                campaign_id     TEXT,
                sent_at         INTEGER NOT NULL,
                created_at      INTEGER NOT NULL
            )
            """
        )
        # Add cron_expr column to existing schedules tables (migration safety)
        try:
            cols = {r["name"] for r in connection.execute("PRAGMA table_info(automation_schedules)").fetchall()}
            if "cron_expr" not in cols:
                connection.execute("ALTER TABLE automation_schedules ADD COLUMN cron_expr TEXT")
        except Exception:
            pass

        # Add triggered_by_email to run history
        try:
            cols = {r["name"] for r in connection.execute("PRAGMA table_info(automation_run_history)").fetchall()}
            if "triggered_by_email" not in cols:
                connection.execute("ALTER TABLE automation_run_history ADD COLUMN triggered_by_email TEXT")
        except Exception:
            pass

        # Index for fast per-run email lookups (table may not exist yet on first boot)
        try:
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_oe_pipeline_run_id ON outreach_emails(pipeline_run_id)"
            )
        except Exception:
            pass

    @staticmethod
    def _migrate_saved_jobs_table(connection: sqlite3.Connection) -> None:
        for col, defn in {
            "company_key": "TEXT DEFAULT ''",
            "company_domain": "TEXT DEFAULT ''",
            "source": "TEXT",
            "title": "TEXT",
            "organization": "TEXT",
            "location": "TEXT",
            "date_posted": "TEXT",
            "payload_json": "TEXT NOT NULL DEFAULT '{}'",
            "created_at": "INTEGER NOT NULL DEFAULT 0",
            "updated_at": "INTEGER NOT NULL DEFAULT 0",
        }.items():
            try:
                connection.execute(f"ALTER TABLE saved_jobs ADD COLUMN {col} {defn}")
            except Exception:
                pass

    @staticmethod
    def _migrate_company_contacts_table(connection: sqlite3.Connection) -> None:
        for col, defn in {
            "company_key": "TEXT NOT NULL DEFAULT ''",
            "name": "TEXT",
            "title": "TEXT",
            "email": "TEXT",
            "linkedin_url": "TEXT",
            "apollo_person_id": "TEXT",
            "organization_id": "TEXT",
            "organization_domain": "TEXT",
            "confidence": "TEXT",
            "payload_json": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT 0",
            "updated_at": "INTEGER NOT NULL DEFAULT 0",
        }.items():
            try:
                connection.execute(f"ALTER TABLE company_contacts ADD COLUMN {col} {defn}")
            except Exception:
                pass

    @staticmethod
    def _migrate_company_enrichment_table(connection: sqlite3.Connection) -> None:
        for col, defn in {
            "company_name": "TEXT",
            "company_domain": "TEXT",
            "status": "TEXT NOT NULL DEFAULT 'pending'",
            "confidence": "TEXT",
            "error_message": "TEXT",
            "contacts_count": "INTEGER NOT NULL DEFAULT 0",
            "last_run_id": "TEXT",
            "last_attempted_at": "INTEGER",
            "last_completed_at": "INTEGER",
            "updated_at": "INTEGER NOT NULL DEFAULT 0",
        }.items():
            try:
                connection.execute(f"ALTER TABLE company_enrichment ADD COLUMN {col} {defn}")
            except Exception:
                pass

    @classmethod
    def _backfill_saved_jobs_company_metadata(cls, connection: sqlite3.Connection) -> None:
        rows = connection.execute(
            """
            SELECT job_key, payload_json, company_key, company_domain
            FROM saved_jobs
            WHERE company_key = '' OR company_key IS NULL OR company_domain = '' OR company_domain IS NULL
            """
        ).fetchall()
        if not rows:
            return
        now_ms = int(time.time() * 1000)
        for row in rows:
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            company_key = cls._company_key(payload)
            company_domain = cls._normalize_domain(payload.get("domain_derived"))
            if not company_domain:
                company_domain = cls._normalize_domain(payload.get("organization_url"))
            if not company_key and company_domain:
                company_key = company_domain
            if not company_key and not company_domain:
                continue
            connection.execute(
                """
                UPDATE saved_jobs
                SET company_key = CASE WHEN company_key = '' OR company_key IS NULL THEN ? ELSE company_key END,
                    company_domain = CASE WHEN company_domain = '' OR company_domain IS NULL THEN ? ELSE company_domain END,
                    updated_at = ?
                WHERE job_key = ?
                """,
                (
                    company_key,
                    company_domain,
                    now_ms,
                    row["job_key"],
                ),
            )

    @staticmethod
    def _filled_field_count(job: dict[str, Any]) -> int:
        total = 0
        for value in job.values():
            if value in (None, "", [], {}):
                continue
            total += 1
        return total

    @staticmethod
    def _nullable_text(value: Any) -> str | None:
        cleaned = JobStore._clean_text(value)
        return cleaned or None

    @staticmethod
    def _clean_text(value: Any) -> str:
        return str(value or "").strip()

    @staticmethod
    def _normalize_domain(value: Any) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        parsed = urlparse(text if text.startswith("http") else f"https://{text}")
        domain = parsed.netloc or parsed.path
        normalized = domain.replace("www.", "").strip().lower()
        blocked_hosts = (
            "linkedin.com",
            "naukri.com",
            "indeed.com",
            "ashbyhq.com",
            "greenhouse.io",
            "lever.co",
        )
        if any(normalized == host or normalized.endswith(f".{host}") for host in blocked_hosts):
            return ""
        return normalized
