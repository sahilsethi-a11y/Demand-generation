import asyncio
import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .db_connect import connect as _db_connect


class CompanyStore:
    _US_STATE_CODES = {
        "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
        "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
        "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
        "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
        "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
        "DC",
    }
    _US_STATE_NAMES = {
        "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
        "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
        "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
        "maine", "maryland", "massachusetts", "michigan", "minnesota",
        "mississippi", "missouri", "montana", "nebraska", "nevada",
        "new hampshire", "new jersey", "new mexico", "new york",
        "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
        "pennsylvania", "rhode island", "south carolina", "south dakota",
        "tennessee", "texas", "utah", "vermont", "virginia", "washington",
        "west virginia", "wisconsin", "wyoming", "district of columbia",
    }

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._lock = asyncio.Lock()

    def _connect(self) -> sqlite3.Connection:
        return _db_connect(self._db_path, "TURSO_COMPANY_DB_URL")

    def _normalize_domain(self, value: str) -> str:
        trimmed = (value or "").strip().lower()
        if not trimmed:
            return ""
        trimmed = trimmed.replace("http://", "").replace("https://", "")
        trimmed = trimmed.lstrip("www.")
        return trimmed.split("/")[0]

    def _normalize_key(self, company: dict[str, Any]) -> str:
        organization_domain = self._normalize_domain(
            str(company.get("organization_domain") or company.get("website_url") or "")
        )
        if organization_domain:
            return organization_domain
        return str(company.get("name") or "").strip().lower()

    def _matches_location_query(self, hq_value: Any, location_query: str) -> bool:
        normalized_hq = str(hq_value or "").strip().lower()
        normalized_query = str(location_query or "").strip().lower()
        if not normalized_query:
            return True
        if not normalized_hq:
            return False
        if normalized_query in normalized_hq:
            return True

        if normalized_query == "united states":
            if any(alias in normalized_hq for alias in ("united states", "usa", "u.s.", "u.s.a", " us ")):
                return True
            tokens = [token.strip(" .") for token in normalized_hq.replace(",", " ").split() if token.strip(" .")]
            uppercase_tokens = {token.upper() for token in tokens}
            if uppercase_tokens.intersection(self._US_STATE_CODES):
                return True
            if any(state_name in normalized_hq for state_name in self._US_STATE_NAMES):
                return True

        return False

    def _merge_companies(self, primary: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        merged = {**primary}
        for key, value in incoming.items():
            if value in (None, "", [], {}):
                continue
            if key in {"employees", "all_employees"} and isinstance(value, list):
                existing_employees = merged.get("employees") if isinstance(merged.get("employees"), list) else []
                if key == "all_employees":
                    existing_employees = merged.get("all_employees") if isinstance(merged.get("all_employees"), list) else []
                combined = list(existing_employees)
                indexed = {
                    (
                        f"{employee.get('email', '')}-{employee.get('linkedin_url', '')}-"
                        f"{employee.get('name', '')}-{employee.get('title', '')}"
                    ): index
                    for index, employee in enumerate(existing_employees)
                    if isinstance(employee, dict)
                }
                for employee in value:
                    if not isinstance(employee, dict):
                        continue
                    employee_key = (
                        f"{employee.get('email', '')}-{employee.get('linkedin_url', '')}-"
                        f"{employee.get('name', '')}-{employee.get('title', '')}"
                    )
                    if employee_key in indexed:
                        current = combined[indexed[employee_key]]
                        combined[indexed[employee_key]] = {
                            **current,
                            **{field: field_value for field, field_value in employee.items() if field_value not in (None, "", [], {})},
                        }
                        continue
                    indexed[employee_key] = len(combined)
                    combined.append(employee)
                merged[key] = combined
            elif key == "portfolio_companies" and isinstance(value, list):
                existing_portfolio = (
                    merged.get("portfolio_companies") if isinstance(merged.get("portfolio_companies"), list) else []
                )
                merged[key] = list(dict.fromkeys([*existing_portfolio, *value]))
            else:
                merged[key] = value
        return merged

    def init_db(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS companies (
                    id TEXT PRIMARY KEY,
                    company_key TEXT NOT NULL UNIQUE,
                    name TEXT,
                    website_url TEXT,
                    linkedin_url TEXT,
                    organization_domain TEXT,
                    apollo_org_id TEXT,
                    hq TEXT,
                    source TEXT,
                    total_employees_count INTEGER NOT NULL DEFAULT 0,
                    icp_employees_count INTEGER NOT NULL DEFAULT 0,
                    employees_count INTEGER NOT NULL DEFAULT 0,
                    verified_emails_count INTEGER NOT NULL DEFAULT 0,
                    portfolio_companies_count INTEGER NOT NULL DEFAULT 0,
                    payload_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            self._migrate_columns(connection)
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_companies_created_at ON companies(created_at DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name COLLATE NOCASE)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_companies_hq ON companies(hq COLLATE NOCASE)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_companies_total_employees_count ON companies(total_employees_count DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_companies_icp_employees_count ON companies(icp_employees_count DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_companies_employees_count ON companies(employees_count DESC)"
            )
            connection.commit()

    def _migrate_columns(self, connection: sqlite3.Connection) -> None:
        existing_columns = {row["name"] for row in connection.execute("PRAGMA table_info(companies)").fetchall()}
        if "total_employees_count" not in existing_columns:
            connection.execute(
                "ALTER TABLE companies ADD COLUMN total_employees_count INTEGER NOT NULL DEFAULT 0"
            )
        if "icp_employees_count" not in existing_columns:
            connection.execute(
                "ALTER TABLE companies ADD COLUMN icp_employees_count INTEGER NOT NULL DEFAULT 0"
            )
        connection.execute(
            """
            UPDATE companies
            SET total_employees_count = CASE
                WHEN total_employees_count > 0 THEN total_employees_count
                WHEN employees_count > 0 THEN employees_count
                ELSE 0
            END,
            icp_employees_count = CASE
                WHEN icp_employees_count > 0 THEN icp_employees_count
                WHEN employees_count > 0 THEN employees_count
                ELSE 0
            END
            """
        )

    def _row_to_company(self, row: sqlite3.Row) -> dict[str, Any] | None:
        try:
            payload = json.loads(row["payload_json"])
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        payload["id"] = str(payload.get("id") or row["id"])
        return payload

    def _dedupe_companies_unlocked(self, connection: sqlite3.Connection) -> dict[str, dict[str, Any]]:
        rows = connection.execute(
            "SELECT id, payload_json, created_at FROM companies ORDER BY created_at DESC, updated_at DESC"
        ).fetchall()
        deduped: dict[str, dict[str, Any]] = {}
        duplicate_ids: list[str] = []
        for row in rows:
            company = self._row_to_company(row)
            if not company:
                duplicate_ids.append(str(row["id"]))
                continue
            company_key = self._normalize_key(company)
            if not company_key:
                deduped[str(row["id"])] = company
                continue
            existing_id = next(
                (stored_id for stored_id, stored in deduped.items() if self._normalize_key(stored) == company_key),
                None,
            )
            if existing_id:
                deduped[existing_id] = self._merge_companies(deduped[existing_id], company)
                duplicate_ids.append(str(row["id"]))
                continue
            deduped[str(row["id"])] = company
        if duplicate_ids:
            now_ms = int(time.time() * 1000)
            for company_id, company in deduped.items():
                existing_row = connection.execute(
                    "SELECT created_at FROM companies WHERE id = ?",
                    (company_id,),
                ).fetchone()
                record = self._build_record(
                    {**company, "id": company_id},
                    existing={"created_at": existing_row["created_at"] if existing_row else now_ms},
                    now_ms=now_ms,
                )
                connection.execute(
                    """
                    INSERT OR REPLACE INTO companies (
                        id,
                        company_key,
                        name,
                        website_url,
                        linkedin_url,
                        organization_domain,
                        apollo_org_id,
                        hq,
                        source,
                        total_employees_count,
                        icp_employees_count,
                        employees_count,
                        verified_emails_count,
                        portfolio_companies_count,
                        payload_json,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    record,
                )
            connection.executemany("DELETE FROM companies WHERE id = ?", [(company_id,) for company_id in duplicate_ids])
            connection.commit()
        return deduped

    def _company_summary(self, company: dict[str, Any]) -> dict[str, Any]:
        employees = company.get("employees") if isinstance(company.get("employees"), list) else []
        all_employees = company.get("all_employees") if isinstance(company.get("all_employees"), list) else []
        total_employees_count = int(company.get("total_employees_count") or len(all_employees) or len(employees))
        icp_employees_count = int(company.get("icp_employees_count") or len(employees))
        portfolio_companies = (
            company.get("portfolio_companies") if isinstance(company.get("portfolio_companies"), list) else []
        )
        instantly_sent_icp_count = len(
            [
                employee
                for employee in employees
                if isinstance(employee, dict) and employee.get("instantly_sent")
            ]
        )
        return {
            **{key: value for key, value in company.items() if key not in {"employees", "all_employees"}},
            "all_employees_count": len(all_employees),
            "total_employees_count": total_employees_count,
            "icp_employees_count": icp_employees_count,
            "employees_count": len(employees),
            "verified_emails_count": len(
                [employee for employee in employees if isinstance(employee, dict) and employee.get("email")]
            ),
            "instantly_sent_icp_count": instantly_sent_icp_count,
            "portfolio_companies_count": len(portfolio_companies),
        }

    def _build_record(
        self,
        company: dict[str, Any],
        existing: dict[str, Any] | None,
        now_ms: int,
    ) -> tuple[Any, ...]:
        employees = company.get("employees") if isinstance(company.get("employees"), list) else []
        total_employees_count = int(company.get("total_employees_count") or len(employees))
        icp_employees_count = int(company.get("icp_employees_count") or len(employees))
        portfolio_companies = (
            company.get("portfolio_companies") if isinstance(company.get("portfolio_companies"), list) else []
        )
        created_at = int(existing.get("created_at") or now_ms) if existing else now_ms
        payload_json = json.dumps(company, ensure_ascii=False, default=str)
        return (
            str(company["id"]),
            self._normalize_key(company),
            str(company.get("name") or ""),
            str(company.get("website_url") or ""),
            str(company.get("linkedin_url") or ""),
            self._normalize_domain(str(company.get("organization_domain") or company.get("website_url") or "")),
            str(company.get("apollo_org_id") or ""),
            str(company.get("hq") or ""),
            str(company.get("source") or ""),
            total_employees_count,
            icp_employees_count,
            len(employees),
            len([employee for employee in employees if isinstance(employee, dict) and employee.get("email")]),
            len(portfolio_companies),
            payload_json,
            created_at,
            now_ms,
        )

    async def find_company_by_key(self, company: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
        target_key = self._normalize_key(company)
        if not target_key:
            return None
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT id, payload_json FROM companies WHERE company_key = ?",
                    (target_key,),
                ).fetchone()
            if not row:
                return None
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                return None
            if not isinstance(payload, dict):
                return None
            payload["id"] = str(payload.get("id") or row["id"])
            return str(row["id"]), payload

    async def dedupe_companies(self) -> dict[str, dict[str, Any]]:
        async with self._lock:
            with self._connect() as connection:
                return self._dedupe_companies_unlocked(connection)

    async def list_companies(
        self,
        include_employees: bool = True,
        page: int = 1,
        page_size: int = 100,
        query: str | None = None,
        location_query: str | None = None,
        employee_filter: str = "all",
        portfolio_filter: str = "all",
    ) -> dict[str, Any]:
        safe_page = max(page, 1)
        safe_page_size = min(max(page_size, 1), 250)
        offset = (safe_page - 1) * safe_page_size
        normalized_query = (query or "").strip().lower()
        normalized_location_query = (location_query or "").strip().lower()
        normalized_employee_filter = employee_filter if employee_filter in {"all", "with", "without"} else "all"
        normalized_portfolio_filter = portfolio_filter if portfolio_filter in {"all", "with"} else "all"

        where_clauses = ["1 = 1"]
        params: list[Any] = []
        if normalized_query:
            where_clauses.append(
                "(LOWER(COALESCE(name, '')) LIKE ? OR LOWER(COALESCE(website_url, '')) LIKE ? OR LOWER(COALESCE(organization_domain, '')) LIKE ?)"
            )
            query_value = f"%{normalized_query}%"
            params.extend([query_value, query_value, query_value])
        if normalized_employee_filter == "with":
            where_clauses.append("icp_employees_count > 0")
        elif normalized_employee_filter == "without":
            where_clauses.append("icp_employees_count = 0")
        if normalized_portfolio_filter == "with":
            where_clauses.append("portfolio_companies_count > 0")

        where_sql = " AND ".join(where_clauses)
        async with self._lock:
            with self._connect() as connection:
                self._dedupe_companies_unlocked(connection)
                total_row = connection.execute(
                    f"SELECT COUNT(*) AS count FROM companies WHERE {where_sql}",
                    tuple(params),
                ).fetchone()
                rows = connection.execute(
                    f"""
                    SELECT payload_json
                    FROM companies
                    WHERE {where_sql}
                    ORDER BY created_at DESC, updated_at DESC, name COLLATE NOCASE ASC
                    """,
                    tuple(params),
                ).fetchall()

        matching_companies: list[dict[str, Any]] = []
        for row in rows:
            try:
                company = json.loads(row["payload_json"])
            except Exception:
                continue
            if not isinstance(company, dict):
                continue
            if normalized_location_query and not self._matches_location_query(company.get("hq"), normalized_location_query):
                continue
            matching_companies.append(company)

        total = len(matching_companies)
        paged_companies = matching_companies[offset:offset + safe_page_size]
        companies: list[dict[str, Any]] = []
        for company in paged_companies:
            if include_employees:
                companies.append(company)
            else:
                companies.append(self._company_summary(company))
        return {
            "companies": companies,
            "total": total,
            "page": safe_page,
            "page_size": safe_page_size,
            "query": normalized_query,
            "location_query": normalized_location_query,
            "employee_filter": normalized_employee_filter,
            "portfolio_filter": normalized_portfolio_filter,
        }

    async def get_company(self, company_id: str) -> dict[str, Any] | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT payload_json FROM companies WHERE id = ?",
                    (company_id,),
                ).fetchone()
            if not row:
                return None
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                return None
            if isinstance(payload, dict):
                payload["id"] = str(payload.get("id") or company_id)
                return payload
            return None

    async def upsert_company(self, company_id: str, company: dict[str, Any]) -> None:
        async with self._lock:
            now_ms = int(time.time() * 1000)
            with self._connect() as connection:
                existing_row = connection.execute(
                    "SELECT payload_json, created_at FROM companies WHERE id = ?",
                    (company_id,),
                ).fetchone()
                existing_payload: dict[str, Any] | None = None
                if existing_row:
                    try:
                        parsed_payload = json.loads(existing_row["payload_json"])
                        if isinstance(parsed_payload, dict):
                            existing_payload = parsed_payload
                    except Exception:
                        existing_payload = None
                merged_company = self._merge_companies(existing_payload or {}, {**company, "id": company_id})
                record = self._build_record(
                    merged_company,
                    existing={"created_at": existing_row["created_at"]} if existing_row else None,
                    now_ms=now_ms,
                )
                connection.execute(
                    """
                    INSERT INTO companies (
                        id,
                        company_key,
                        name,
                        website_url,
                        linkedin_url,
                        organization_domain,
                        apollo_org_id,
                        hq,
                        source,
                        total_employees_count,
                        icp_employees_count,
                        employees_count,
                        verified_emails_count,
                        portfolio_companies_count,
                        payload_json,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        company_key = excluded.company_key,
                        name = excluded.name,
                        website_url = excluded.website_url,
                        linkedin_url = excluded.linkedin_url,
                        organization_domain = excluded.organization_domain,
                        apollo_org_id = excluded.apollo_org_id,
                        hq = excluded.hq,
                        source = excluded.source,
                        total_employees_count = excluded.total_employees_count,
                        icp_employees_count = excluded.icp_employees_count,
                        employees_count = excluded.employees_count,
                        verified_emails_count = excluded.verified_emails_count,
                        portfolio_companies_count = excluded.portfolio_companies_count,
                        payload_json = excluded.payload_json,
                        updated_at = excluded.updated_at
                    """,
                    record,
                )
                connection.commit()

    async def delete_company(self, company_id: str) -> bool:
        async with self._lock:
            with self._connect() as connection:
                cursor = connection.execute("DELETE FROM companies WHERE id = ?", (company_id,))
                connection.commit()
            return cursor.rowcount > 0
