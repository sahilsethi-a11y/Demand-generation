import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

import httpx

logger = logging.getLogger(__name__)

# US market sources (ATS job boards via Apify)
SOURCE_ASHBY = "ashby"
SOURCE_GREENHOUSE = "greenhouse"
SOURCE_LEVER = "lever"

# India market sources via Apify
SOURCE_LINKEDIN = "linkedin"
SOURCE_NAUKRI = "naukri"
SOURCE_INDEED = "indeed"

US_SOURCES = (SOURCE_ASHBY, SOURCE_GREENHOUSE, SOURCE_LEVER)
INDIA_SOURCES = (SOURCE_LINKEDIN, SOURCE_NAUKRI, SOURCE_INDEED)
ALL_SOURCES = (*US_SOURCES, *INDIA_SOURCES)

DEFAULT_MODEL = os.getenv("OPENAI_JOB_AGENT_MODEL", "gpt-4.1-mini")
APIFY_API_BASE = "https://api.apify.com/v2"

# US actor IDs
ASHBY_ACTOR_ID = "fantastic-jobs~ashby-jobs-api"
GREENHOUSE_ACTOR_ID = "fantastic-jobs~greenhouse-jobs-api"
LEVER_ACTOR_ID = os.getenv("APIFY_LEVER_ACTOR_ID", "jobo.world~lever-jobs-search")

# India actor IDs
LINKEDIN_ACTOR_ID = os.getenv("APIFY_LINKEDIN_ACTOR_ID", "bebity~linkedin-jobs-scraper")
NAUKRI_ACTOR_ID = os.getenv("APIFY_NAUKRI_ACTOR_ID", "muhammetakkurtt~naukri-job-scraper")

# Naukri city IDs — from https://console.apify.com/actors/alpcnRV9YI9lYVPWk/input
# Add more entries as needed; values must be strings matching the actor's enum.
NAUKRI_CITY_IDS: dict[str, list[str]] = {
    "delhi": ["6"],
    "new delhi": ["6"],
    "gurugram": ["73"],
    "gurgaon": ["73"],
    "delhi ncr": ["6", "73"],
    "ncr": ["6", "73"],
    "hyderabad": ["17"],
    "bangalore": ["97"],
    "bengalore": ["97"],
    "bengaluru": ["97"],
    "mumbai": ["9509"],
}
INDEED_ACTOR_ID = os.getenv("APIFY_INDEED_ACTOR_ID", "borderline~indeed-scraper")

NON_COMPANY_HOSTS = (
    "linkedin.com",
    "naukri.com",
    "indeed.com",
    "ashbyhq.com",
    "greenhouse.io",
    "lever.co",
)

UNIFIED_JOB_FIELDS = [
    "id",
    "date_posted",
    "date_created",
    "title",
    "organization",
    "organization_url",
    "date_validthrough",
    "locations_raw",
    "locations_alt_raw",
    "location_type",
    "location_requirements_raw",
    "salary_raw",
    "employment_type",
    "url",
    "source_type",
    "source",
    "source_domain",
    "organization_logo",
    "cities_derived",
    "regions_derived",
    "countries_derived",
    "counties_derived",
    "locations_derived",
    "timezones_derived",
    "lats_derived",
    "lngs_derived",
    "remote_derived",
    "domain_derived",
    "date_modified",
    "modified_fields",
    "description_text",
    "ai_salary_currency",
    "ai_salary_value",
    "ai_salary_minvalue",
    "ai_salary_maxvalue",
    "ai_salary_unittext",
    "ai_benefits",
    "ai_experience_level",
    "ai_work_arrangement",
    "ai_work_arrangement_office_days",
    "ai_remote_location",
    "ai_remote_location_derived",
    "ai_key_skills",
    "ai_hiring_manager_name",
    "ai_hiring_manager_email_address",
    "ai_core_responsibilities",
    "ai_requirements_summary",
    "ai_working_hours",
    "ai_employment_type",
    "ai_job_language",
    "ai_visa_sponsorship",
    "ai_keywords",
    "ai_taxonomies_a",
    "ai_education_requirements",
]

LogCallback = Callable[[dict[str, Any]], None]


class JobSearchError(Exception):
    def __init__(self, message: str, debug_log: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.debug_log = debug_log or []


@dataclass
class JobSearchFilters:
    role: str
    location: str
    date_filter: str
    job_type: str
    sources: list[str]
    run_id: str
    market: str = "us"
    max_jobs: int = 200  # target jobs to fetch per actor; floor is actor-specific

    @property
    def max_age_days(self) -> int:
        if self.date_filter == "24h":
            return 1
        return 7 if self.date_filter == "7d" else 30

    @property
    def linkedin_published_at(self) -> str:
        """Map date_filter to LinkedIn actor's publishedAt parameter."""
        mapping = {
            "24h": "r86400",
            "7d": "r604800",
            "30d": "r2592000",
        }
        return mapping.get(self.date_filter, "r604800")

    @property
    def indeed_date_posted(self) -> int:
        """Map date_filter to Indeed's fromage (days old) parameter."""
        return 7 if self.date_filter == "7d" else 30

    @property
    def linkedin_job_type(self) -> str | None:
        """Map job_type to LinkedIn actor's contractType parameter value."""
        mapping = {
            "full_time": "F",
            "contract": "C",
        }
        return mapping.get(self.job_type)

    @property
    def indeed_job_type(self) -> str | None:
        """Map job_type to Indeed's jt parameter value. None means no filter (all types)."""
        mapping = {
            "full_time": "fulltime",
            "part_time": "parttime",
            "contract": "contract",
            "internship": "internship",
        }
        return mapping.get(self.job_type)

    @property
    def naukri_freshness(self) -> str:
        """Map date_filter to muhammetakkurtt/naukri-job-scraper freshness (days as string)."""
        return {"24h": "1", "7d": "7"}.get(self.date_filter, "30")

    @property
    def naukri_city_ids(self) -> list[str]:
        """Resolve location string to Naukri city ID list. Empty list = all India."""
        return NAUKRI_CITY_IDS.get(self.location.strip().lower(), [])

    @property
    def title_search_terms(self) -> list[str]:
        return _title_search_terms(self.role)


async def run_job_search_workflow(
    role: str,
    location: str,
    date_filter: str,
    job_type: str = "all",
    sources: list[str] | None = None,
    market: str = "us",
    run_id: str | None = None,
    log_callback: LogCallback | None = None,
    max_jobs: int = 200,
) -> dict[str, Any]:
    market_normalized = (market or "us").strip().lower()
    default_sources = list(US_SOURCES) if market_normalized == "us" else list(INDIA_SOURCES)
    valid_sources = US_SOURCES if market_normalized == "us" else INDIA_SOURCES
    requested_sources = default_sources if sources is None else sources
    selected_sources = [source for source in requested_sources if source in valid_sources]
    if not selected_sources:
        raise JobSearchError(
            f"At least one job source must be selected. Valid sources for market '{market_normalized}': {list(valid_sources)}"
        )

    filters = JobSearchFilters(
        role=role.strip(),
        location=location.strip(),
        date_filter=date_filter,
        job_type=(job_type or "all").strip().lower(),
        sources=selected_sources,
        run_id=run_id or "",
        market=market_normalized,
        max_jobs=max_jobs,
    )
    debug_log: list[dict[str, Any]] = []

    def emit(level: str, message: str, **metadata: Any) -> None:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "message": message,
            **metadata,
        }
        debug_log.append(entry)
        logger.log(_to_log_level(level), "%s | %s", message, json.dumps(metadata, default=str))
        if log_callback:
            log_callback(entry)

    emit(
        "info",
        "Starting job search workflow",
        role=filters.role,
        location=filters.location,
        date_filter=filters.date_filter,
        job_type=filters.job_type,
        sources=filters.sources,
    )

    try:
        result = await _run_direct(filters, emit)
        result["debug_log"] = debug_log
        return result
    except Exception as exc:
        emit("error", "Job search workflow failed", error=str(exc))
        raise JobSearchError(str(exc), debug_log) from exc


async def _run_with_agents_sdk(
    filters: JobSearchFilters,
    emit: LogCallback,
) -> dict[str, Any]:
    try:
        from agents import Agent, Runner, function_tool
    except ImportError as exc:
        raise RuntimeError("openai-agents package is not installed in the active environment") from exc

    @function_tool
    async def search_ashby(role: str, location: str, date_filter: str) -> dict[str, Any]:
        return await _search_ashby(JobSearchFilters(role, location, date_filter, filters.job_type, [SOURCE_ASHBY], filters.run_id, filters.market, filters.max_jobs), emit)

    @function_tool
    async def search_greenhouse(role: str, location: str, date_filter: str) -> dict[str, Any]:
        return await _search_greenhouse(JobSearchFilters(role, location, date_filter, filters.job_type, [SOURCE_GREENHOUSE], filters.run_id, filters.market, filters.max_jobs), emit)

    @function_tool
    async def search_lever(role: str, location: str, date_filter: str) -> dict[str, Any]:
        return await _search_lever(JobSearchFilters(role, location, date_filter, filters.job_type, [SOURCE_LEVER], filters.run_id, filters.market, filters.max_jobs), emit)

    @function_tool
    async def search_linkedin(role: str, location: str, date_filter: str) -> dict[str, Any]:
        return await _search_linkedin(JobSearchFilters(role, location, date_filter, filters.job_type, [SOURCE_LINKEDIN], filters.run_id, filters.market, filters.max_jobs), emit)

    @function_tool
    async def search_naukri(role: str, location: str, date_filter: str) -> dict[str, Any]:
        return await _search_naukri(JobSearchFilters(role, location, date_filter, filters.job_type, [SOURCE_NAUKRI], filters.run_id, filters.market, filters.max_jobs), emit)

    @function_tool
    async def search_indeed(role: str, location: str, date_filter: str) -> dict[str, Any]:
        return await _search_indeed(JobSearchFilters(role, location, date_filter, filters.job_type, [SOURCE_INDEED], filters.run_id, filters.market, filters.max_jobs), emit)

    source_tool_map = {
        SOURCE_ASHBY: (search_ashby, "Use the Ashby tool once and return the jobs JSON only."),
        SOURCE_GREENHOUSE: (search_greenhouse, "Use the Greenhouse tool once and return the jobs JSON only."),
        SOURCE_LEVER: (search_lever, "Use the Lever tool once and return the jobs JSON only."),
        SOURCE_LINKEDIN: (search_linkedin, "Use the LinkedIn tool once and return the jobs JSON only."),
        SOURCE_NAUKRI: (search_naukri, "Use the Naukri tool once and return the jobs JSON only."),
        SOURCE_INDEED: (search_indeed, "Use the Indeed tool once and return the jobs JSON only."),
    }

    async def run_agent(source: str) -> dict[str, Any]:
        tool, instructions = source_tool_map[source]
        agent = Agent(
            name=f"{source.title()} Jobs Agent",
            instructions=instructions,
            model=DEFAULT_MODEL,
            tools=[tool],
        )
        prompt = (
            f"Search for role '{filters.role}' in location '{filters.location}' "
            f"with date filter '{filters.date_filter}' and job type '{filters.job_type}'. Return the tool output."
        )
        emit("info", "Running source agent", source=source, model=DEFAULT_MODEL)
        result = await Runner.run(agent, prompt)
        final_output = getattr(result, "final_output", result)
        if isinstance(final_output, dict):
            jobs = final_output.get("jobs")
            if isinstance(jobs, list):
                return {
                    "source": source,
                    "jobs": jobs,
                    "fetched_jobs": final_output.get("fetched_jobs") if isinstance(final_output.get("fetched_jobs"), list) else jobs,
                    "fetched_count": int(final_output.get("fetched_count") or len(jobs)),
                    "matched_count": int(final_output.get("matched_count") or len(jobs)),
                }
        if isinstance(final_output, str):
            parsed = json.loads(final_output)
            if isinstance(parsed, dict) and isinstance(parsed.get("jobs"), list):
                return {
                    "source": source,
                    "jobs": parsed["jobs"],
                    "fetched_jobs": parsed.get("fetched_jobs") if isinstance(parsed.get("fetched_jobs"), list) else parsed["jobs"],
                    "fetched_count": int(parsed.get("fetched_count") or len(parsed["jobs"])),
                    "matched_count": int(parsed.get("matched_count") or len(parsed["jobs"])),
                }
        raise RuntimeError(f"{source} agent did not return a jobs payload")

    source_results = await asyncio.gather(*(run_agent(source) for source in filters.sources))
    combined_jobs = [job for result in source_results for job in result["jobs"]]
    fetched_jobs = [job for result in source_results for job in result.get("fetched_jobs", [])]
    fetched_count = sum(int(result.get("fetched_count") or 0) for result in source_results)
    deduplicated_jobs = _deduplicate_jobs(fetched_jobs)
    emit(
        "info",
        "Agent workflow complete",
        fetched=fetched_count,
        matched=len(combined_jobs),
        unique=len(deduplicated_jobs),
    )
    return {
        "jobs": deduplicated_jobs,
        "all_jobs": fetched_jobs,
        "unique_jobs": deduplicated_jobs,
        "fetched_jobs": fetched_jobs,
        "collected_count": fetched_count,
        "matched_count": len(combined_jobs),
        "unique_count": len(deduplicated_jobs),
        "sources": filters.sources,
    }


async def _run_direct(filters: JobSearchFilters, emit: LogCallback) -> dict[str, Any]:
    handlers: dict[str, Callable[[JobSearchFilters, LogCallback], Awaitable[dict[str, Any]]]] = {
        SOURCE_ASHBY: _search_ashby,
        SOURCE_GREENHOUSE: _search_greenhouse,
        SOURCE_LEVER: _search_lever,
        SOURCE_LINKEDIN: _search_linkedin,
        SOURCE_NAUKRI: _search_naukri,
        SOURCE_INDEED: _search_indeed,
    }
    results = await asyncio.gather(*(handlers[source](filters, emit) for source in filters.sources))
    combined_jobs: list[dict[str, Any]] = []
    fetched_jobs: list[dict[str, Any]] = []
    fetched_count = 0
    for result in results:
        combined_jobs.extend(result["jobs"])
        fetched_jobs.extend(result.get("fetched_jobs") or result["jobs"])
        fetched_count += int(result.get("fetched_count") or len(result["jobs"]))
    deduplicated_jobs = _deduplicate_jobs(fetched_jobs)
    emit(
        "info",
        "Direct workflow complete",
        fetched=fetched_count,
        matched=len(combined_jobs),
        unique=len(deduplicated_jobs),
    )
    return {
        "jobs": deduplicated_jobs,
        "all_jobs": fetched_jobs,
        "unique_jobs": deduplicated_jobs,
        "fetched_jobs": fetched_jobs,
        "collected_count": fetched_count,
        "matched_count": len(combined_jobs),
        "unique_count": len(deduplicated_jobs),
        "sources": filters.sources,
    }


async def _search_ashby(filters: JobSearchFilters, emit: LogCallback) -> dict[str, Any]:
    payload = {
        "includeAi": True,
        "locationSearch": [filters.location.lower()],
        "titleSearch": [term.lower() for term in filters.title_search_terms],
        "limit": max(200, filters.max_jobs),  # actor minimum is 200; cannot go lower
    }
    items = await _post_actor_dataset_items(ASHBY_ACTOR_ID, payload, SOURCE_ASHBY, emit)
    normalized = [
        _normalize_structured_job(item, SOURCE_ASHBY, filters)
        for item in items
    ]
    matched = [job for job in normalized if _matches_filters(job, filters)]
    emit("info", "Ashby search complete", source=SOURCE_ASHBY, count=len(normalized))
    return {
        "source": SOURCE_ASHBY,
        "jobs": matched,
        "fetched_jobs": normalized,
        "fetched_count": len(items),
        "matched_count": len(matched),
    }


async def _search_greenhouse(filters: JobSearchFilters, emit: LogCallback) -> dict[str, Any]:
    payload = {
        "includeAi": True,
        "locationSearch": [filters.location.lower()],
        "titleSearch": [term.lower() for term in filters.title_search_terms],
        "limit": max(200, filters.max_jobs),  # actor minimum is 200; cannot go lower
    }
    items = await _post_actor_dataset_items(GREENHOUSE_ACTOR_ID, payload, SOURCE_GREENHOUSE, emit)
    normalized = [
        _normalize_structured_job(item, SOURCE_GREENHOUSE, filters)
        for item in items
    ]
    matched = [job for job in normalized if _matches_filters(job, filters)]
    emit("info", "Greenhouse search complete", source=SOURCE_GREENHOUSE, count=len(normalized))
    return {
        "source": SOURCE_GREENHOUSE,
        "jobs": matched,
        "fetched_jobs": normalized,
        "fetched_count": len(items),
        "matched_count": len(matched),
    }


async def _search_lever(filters: JobSearchFilters, emit: LogCallback) -> dict[str, Any]:
    lever_input = {
        "locations": [filters.location],
        "queries": filters.title_search_terms,
        "page_size": 100,  # max per page; actor is paginated — capped at 100 per single run
        "page": 1,
    }
    items = await _post_lever_actor_dataset_items(emit, lever_input)
    normalized = []
    for item in items:
        normalized_job = _normalize_lever_job(item, filters)
        normalized.append(normalized_job)
    matched = [job for job in normalized if _matches_filters(job, filters)]
    emit(
        "info",
        "Lever actor search complete",
        source=SOURCE_LEVER,
        requested_input=lever_input,
        count=len(normalized),
    )
    return {
        "source": SOURCE_LEVER,
        "jobs": matched,
        "fetched_jobs": normalized,
        "fetched_count": len(items),
        "matched_count": len(matched),
    }



async def _post_actor_dataset_items(
    actor_id: str,
    payload: dict[str, Any],
    source: str,
    emit: LogCallback,
) -> list[dict[str, Any]]:
    token = os.getenv("APIFY_API_TOKEN")
    if not token:
        raise RuntimeError("APIFY_API_TOKEN is not configured")

    url = f"{APIFY_API_BASE}/acts/{actor_id}/run-sync-get-dataset-items"
    params = {"token": token}
    emit("info", "Calling Apify actor", source=source, endpoint=url, payload=payload)
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
        try:
            response = await client.post(url, params=params, json=payload)
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            emit(
                "error",
                "Apify actor request failed",
                source=source,
                endpoint=url,
                payload=payload,
                error=str(exc) or type(exc).__name__,
            )
            raise

    emit(
        "info",
        "Apify actor response received",
        source=source,
        endpoint=url,
        payload=payload,
        response_status=response.status_code,
        response_count=len(data) if isinstance(data, list) else None,
        response_preview=_response_preview(data),
    )

    if not isinstance(data, list):
        raise RuntimeError(f"{source} actor returned an unexpected response shape")
    return [item for item in data if isinstance(item, dict)]


async def _post_lever_actor_dataset_items(
    emit: LogCallback,
    request_payload: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    token = os.getenv("APIFY_API_TOKEN")
    if not token:
        raise RuntimeError("APIFY_API_TOKEN is not configured")

    url = f"{APIFY_API_BASE}/acts/{LEVER_ACTOR_ID}/run-sync-get-dataset-items"
    params = {"token": token}
    emit(
        "info",
        "Calling Lever actor",
        source=SOURCE_LEVER,
        endpoint=url,
        payload=request_payload or {},
    )
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
        try:
            response = await client.post(url, params=params, json=request_payload or {})
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            emit(
                "error",
                "Lever actor request failed",
                source=SOURCE_LEVER,
                endpoint=url,
                payload=request_payload or {},
                error=str(exc) or type(exc).__name__,
            )
            raise

    emit(
        "info",
        "Lever actor response received",
        source=SOURCE_LEVER,
        endpoint=url,
        payload=request_payload or {},
        response_status=response.status_code,
        response_count=len(data) if isinstance(data, list) else None,
        response_preview=_response_preview(data),
    )

    if not isinstance(data, list):
        raise RuntimeError("Lever actor returned an unexpected response shape")
    return [item for item in data if isinstance(item, dict)]


async def _search_linkedin(filters: JobSearchFilters, emit: LogCallback) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "title": filters.role,
        "location": filters.location,
        "publishedAt": filters.linkedin_published_at,
        "rows": min(1000, filters.max_jobs),
    }
    if filters.linkedin_job_type:
        payload["contractType"] = filters.linkedin_job_type
    items = await _post_actor_dataset_items(LINKEDIN_ACTOR_ID, payload, SOURCE_LINKEDIN, emit)
    normalized = [_normalize_india_job(item, SOURCE_LINKEDIN, filters) for item in items]
    matched = [job for job in normalized if _matches_filters(job, filters)]
    emit("info", "LinkedIn search complete", source=SOURCE_LINKEDIN, count=len(normalized))
    return {
        "source": SOURCE_LINKEDIN,
        "jobs": matched,
        "fetched_jobs": normalized,
        "fetched_count": len(items),
        "matched_count": len(matched),
    }


async def _search_naukri(filters: JobSearchFilters, emit: LogCallback) -> dict[str, Any]:
    city_ids = filters.naukri_city_ids
    payload: dict[str, Any] = {
        "keyword": filters.role,
        "maxJobs": max(50, filters.max_jobs),  # actor minimum is 50
        "fetchDetails": False,
        "freshness": filters.naukri_freshness,
    }
    if city_ids:
        payload["cities"] = city_ids
    items = await _post_actor_dataset_items(NAUKRI_ACTOR_ID, payload, SOURCE_NAUKRI, emit)
    normalized = [_normalize_india_job(item, SOURCE_NAUKRI, filters) for item in items]
    matched = [job for job in normalized if _matches_filters(job, filters)]
    emit("info", "Naukri search complete", source=SOURCE_NAUKRI, count=len(normalized))
    return {
        "source": SOURCE_NAUKRI,
        "jobs": matched,
        "fetched_jobs": normalized,
        "fetched_count": len(items),
        "matched_count": len(matched),
    }


async def _search_indeed(filters: JobSearchFilters, emit: LogCallback) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query": filters.role,
        "location": filters.location,
        "country": "in",
        "fromage": filters.indeed_date_posted,
        "maxRows": filters.max_jobs,  # no default set; omitting causes unbounded scraping
    }
    if filters.indeed_job_type:
        payload["jt"] = filters.indeed_job_type
    items = await _post_actor_dataset_items(INDEED_ACTOR_ID, payload, SOURCE_INDEED, emit)
    normalized = [_normalize_india_job(item, SOURCE_INDEED, filters) for item in items]
    matched = [job for job in normalized if _matches_filters(job, filters)]
    emit("info", "Indeed search complete", source=SOURCE_INDEED, count=len(normalized))
    return {
        "source": SOURCE_INDEED,
        "jobs": matched,
        "fetched_jobs": normalized,
        "fetched_count": len(items),
        "matched_count": len(matched),
    }


def _normalize_india_job(raw_job: dict[str, Any], source: str, filters: JobSearchFilters) -> dict[str, Any]:
    """Normalize job records from LinkedIn, Naukri, and Indeed Apify actors into the unified schema."""
    # Field extraction — each actor uses different keys
    title = (
        raw_job.get("title")
        or raw_job.get("positionName")
        or raw_job.get("jobTitle")
        or ""
    )
    organization = (
        raw_job.get("company")
        or raw_job.get("companyName")
        or raw_job.get("employer")
        or ""
    )
    company_url = (
        raw_job.get("companyUrl")
        or raw_job.get("companyLink")
        or raw_job.get("employerUrl")
        or raw_job.get("companyJobsUrl")  # memo23/naukri-scraper
    )
    listing_url = (
        raw_job.get("url")
        or raw_job.get("jobUrl")
        or raw_job.get("jdURL")           # memo23/naukri-scraper
        or raw_job.get("applyUrl")
        or raw_job.get("link")
    )
    apply_url = raw_job.get("applyUrl") or listing_url
    description = _strip_html(str(
        raw_job.get("description")
        or raw_job.get("jobDescription")
        or ""
    ))
    location_raw = (
        raw_job.get("location")
        or raw_job.get("jobLocation")
        or raw_job.get("place")
        or filters.location
    )
    date_posted = (
        raw_job.get("date")
        or raw_job.get("datePosted")
        or raw_job.get("postedAt")
        or raw_job.get("postedDate")
        or raw_job.get("publishedAt")
        or raw_job.get("createdDate")     # memo23/naukri-scraper
    )
    employment_type_raw = str(
        raw_job.get("jobType")
        or raw_job.get("employmentType")
        or raw_job.get("contractType")
        or ""
    ).strip()

    # Salary: prefer structured salaryDetail (Naukri), fall back to string fields
    salary_raw = None
    salary_detail = raw_job.get("salaryDetail")
    if isinstance(salary_detail, dict) and not salary_detail.get("hideSalary"):
        min_sal = salary_detail.get("minimumSalary") or 0
        max_sal = salary_detail.get("maximumSalary") or 0
        currency = salary_detail.get("currency", "INR")
        if max_sal > 0:
            salary_raw = f"{currency} {min_sal:,}–{max_sal:,}"
    if not salary_raw:
        salary_raw = (
            raw_job.get("salary")
            or raw_job.get("salaryRange")
            or raw_job.get("compensation")
        )
        # Discard uninformative placeholder strings
        if isinstance(salary_raw, str) and salary_raw.strip().lower() in ("not disclosed", ""):
            salary_raw = None

    is_remote = bool(raw_job.get("remote") or raw_job.get("isRemote"))

    # Skills from Naukri's tagsAndSkills comma-separated string
    tags_and_skills = raw_job.get("tagsAndSkills")
    skills_list = (
        [s.strip() for s in tags_and_skills.split(",") if s.strip()]
        if isinstance(tags_and_skills, str)
        else None
    )

    # Experience range (Naukri)
    experience_text = (
        raw_job.get("experienceText")
        or raw_job.get("experience")
    )
    min_exp = raw_job.get("minimumExperience")
    max_exp = raw_job.get("maximumExperience")

    # Company logo
    logo = raw_job.get("logoPath") or raw_job.get("logoPathV3") or raw_job.get("companyLogo")

    # Ambition Box company rating (Naukri)
    ambition_box = raw_job.get("ambitionBoxData")
    company_rating = None
    if isinstance(ambition_box, dict):
        company_rating = ambition_box.get("AggregateRating")

    inferred_domain = None
    if source != SOURCE_LINKEDIN:
        inferred_domain = _infer_company_domain(None, company_url, listing_url)

    # Build locations_derived with country appended so _matches_filters passes
    # when user queries "India" but actor returns city-level locations ("Noida", "Gurgaon")
    if location_raw:
        locations_derived: list[str] | None = [location_raw, "India"]
    else:
        locations_derived = ["India"]

    normalized = {field: None for field in UNIFIED_JOB_FIELDS}
    normalized.update({
        "id": raw_job.get("id") or raw_job.get("jobId"),
        "date_posted": date_posted,
        "date_created": date_posted,
        "title": title,
        "organization": organization,
        "organization_url": _organization_url_from_domain(inferred_domain) or company_url,
        "organization_logo": logo,
        "url": listing_url,
        "source_type": "india_job_board",
        "source": source,
        "source_domain": {
            SOURCE_LINKEDIN: "linkedin.com",
            SOURCE_NAUKRI: "naukri.com",
            SOURCE_INDEED: "indeed.com",
        }.get(source, ""),
        "description_text": description or None,
        "locations_derived": locations_derived,
        "countries_derived": ["India"],
        "domain_derived": inferred_domain,
        "remote_derived": is_remote,
        "salary_raw": salary_raw,
        "employment_type": [employment_type_raw.upper()] if employment_type_raw else None,
        "ai_work_arrangement": "Remote" if is_remote else None,
        "ai_key_skills": skills_list,
    })
    normalized["listing_url"] = listing_url
    normalized["apply_url"] = apply_url
    normalized["display_location"] = str(location_raw) if location_raw else ""
    normalized["company_slug"] = (
        _company_slug(organization, inferred_domain)
        if inferred_domain or source != SOURCE_LINKEDIN
        else ""
    )
    normalized["search_metadata"] = _search_metadata(filters)
    normalized["experience_text"] = experience_text
    normalized["min_experience"] = min_exp
    normalized["max_experience"] = max_exp
    normalized["company_rating"] = company_rating
    normalized["raw_payload"] = raw_job

    # LinkedIn-specific fields
    if source == SOURCE_LINKEDIN:
        normalized["poster_profile_url"] = raw_job.get("posterProfileUrl") or None
        normalized["poster_name"] = raw_job.get("posterFullName") or None
        normalized["applications_count"] = raw_job.get("applicationsCount") or None
        normalized["experience_level"] = raw_job.get("experienceLevel") or None
        normalized["sector"] = raw_job.get("sector") or None
        normalized["work_type"] = raw_job.get("workType") or None

    # Naukri actor returns all-India results regardless of search location —
    # skip location filtering so Delhi searches still return Bengaluru results.
    if source == SOURCE_NAUKRI:
        normalized["_skip_location_filter"] = True

    return normalized


def _normalize_structured_job(
    raw_job: dict[str, Any],
    source: str,
    filters: JobSearchFilters,
) -> dict[str, Any]:
    normalized = {field: raw_job.get(field) for field in UNIFIED_JOB_FIELDS}
    listing_url = raw_job.get("url")
    inferred_slug = _company_slug_from_listing_url(listing_url)
    inferred_domain = _infer_company_domain(
        raw_job.get("domain_derived"),
        raw_job.get("organization_url"),
        listing_url,
    )
    normalized["source"] = source
    normalized["url"] = listing_url
    normalized["listing_url"] = listing_url
    normalized["apply_url"] = listing_url
    normalized["domain_derived"] = inferred_domain
    normalized["organization_url"] = (
        raw_job.get("organization_url")
        or _organization_url_from_domain(inferred_domain)
        or listing_url
    )
    normalized["display_location"] = _derive_display_location(raw_job)
    normalized["company_slug"] = _company_slug(
        raw_job.get("organization"),
        inferred_domain or inferred_slug,
    )
    normalized["search_metadata"] = _search_metadata(filters)
    normalized["raw_payload"] = raw_job
    return normalized


def _normalize_lever_job(raw_job: dict[str, Any], filters: JobSearchFilters) -> dict[str, Any]:
    company = raw_job.get("company") if isinstance(raw_job.get("company"), dict) else {}
    compensation = raw_job.get("compensation") if isinstance(raw_job.get("compensation"), dict) else {}
    workplace_type = str(raw_job.get("workplace_type") or "").strip()
    employment_type = str(raw_job.get("employment_type") or "").strip()
    listing_url = raw_job.get("listing_url")
    inferred_slug = _company_slug_from_listing_url(listing_url)
    inferred_domain = _infer_company_domain(
        None,
        company.get("website_url") if isinstance(company, dict) else None,
        listing_url,
    )
    normalized = {field: None for field in UNIFIED_JOB_FIELDS}
    normalized.update(
        {
            "id": raw_job.get("id"),
            "date_posted": raw_job.get("date_posted"),
            "date_created": raw_job.get("created_at"),
            "title": raw_job.get("title"),
            "organization": company.get("name") or _organization_from_lever_url(listing_url),
            "organization_url": _organization_url_from_domain(inferred_domain) or listing_url,
            "date_validthrough": raw_job.get("valid_through"),
            "locations_raw": raw_job.get("locations"),
            "salary_raw": raw_job.get("compensation"),
            "employment_type": [employment_type.upper()] if employment_type else None,
            "url": listing_url,
            "source_type": "ats",
            "source": SOURCE_LEVER,
            "source_domain": "jobs.lever.co",
            "cities_derived": _lever_list_values(raw_job.get("locations"), "city"),
            "regions_derived": _lever_list_values(raw_job.get("locations"), "state"),
            "countries_derived": _lever_list_values(raw_job.get("locations"), "country"),
            "locations_derived": _lever_location_strings(raw_job.get("locations")),
            "lats_derived": _lever_list_values(raw_job.get("locations"), "latitude"),
            "lngs_derived": _lever_list_values(raw_job.get("locations"), "longitude"),
            "remote_derived": raw_job.get("is_remote"),
            "domain_derived": inferred_domain,
            "date_modified": raw_job.get("updated_at"),
            "description_text": _strip_html(str(raw_job.get("description") or "")) or None,
            "ai_salary_currency": compensation.get("currency"),
            "ai_salary_minvalue": compensation.get("min"),
            "ai_salary_maxvalue": compensation.get("max"),
            "ai_salary_unittext": compensation.get("period"),
            "ai_work_arrangement": workplace_type.title() if workplace_type else None,
            "ai_employment_type": [employment_type.upper()] if employment_type else None,
        }
    )
    normalized["listing_url"] = listing_url
    normalized["apply_url"] = raw_job.get("apply_url") or listing_url
    normalized["display_location"] = _derive_display_location(normalized)
    normalized["company_slug"] = _company_slug(normalized.get("organization"), inferred_domain or inferred_slug)
    normalized["search_metadata"] = _search_metadata(filters)
    normalized["raw_payload"] = raw_job
    return normalized



def _matches_filters(raw_job: dict[str, Any], filters: JobSearchFilters) -> bool:
    if not _matches_date_filter(raw_job.get("date_posted"), filters.max_age_days):
        return False

    if not _matches_job_type(raw_job, filters.job_type):
        return False

    # Role filtering is intentionally skipped here: every actor already filters
    # by role/keyword at the API level (LinkedIn uses title=, Naukri uses keyword=,
    # Ashby uses titleSearch=, etc.). Re-filtering with exact substring matching
    # causes false negatives — e.g. "AI/ML Engineer" rejected when query is "AI engineer".

    # Skip location filter when the job opted out of it (e.g. Naukri national results)
    if raw_job.get("_skip_location_filter"):
        return True

    location_query = filters.location.strip().lower()
    if not location_query:
        return True

    haystacks = [
        str(raw_job.get("location") or ""),
        str(raw_job.get("location_type") or ""),
        str(raw_job.get("url") or raw_job.get("listing_url") or ""),
        str(raw_job.get("organization") or ""),
        str(raw_job.get("description_text") or raw_job.get("description") or ""),
        json.dumps(raw_job.get("locations_raw") or []),
        json.dumps(raw_job.get("locations_alt_raw") or []),
        json.dumps(raw_job.get("location_requirements_raw") or []),
        json.dumps(raw_job.get("locations_derived") or []),
        json.dumps(raw_job.get("countries_derived") or []),
        json.dumps(raw_job.get("locations") or []),
    ]
    location_blob = " ".join(haystacks).lower()
    if location_query == "remote":
        return bool(raw_job.get("remote_derived") or raw_job.get("is_remote")) or "remote" in location_blob
    return location_query in location_blob


def _matches_date_filter(date_posted: Any, max_age_days: int) -> bool:
    parsed = _parse_iso_datetime(date_posted)
    if parsed is None:
        # If date can't be parsed, allow the job through rather than discard it
        return True
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    return parsed >= cutoff


def _parse_iso_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _derive_display_location(job: dict[str, Any]) -> str:
    if isinstance(job.get("locations_derived"), list) and job["locations_derived"]:
        return ", ".join(str(value) for value in job["locations_derived"] if value)
    if isinstance(job.get("locations_alt_raw"), list) and job["locations_alt_raw"]:
        return ", ".join(str(value) for value in job["locations_alt_raw"] if value)
    if isinstance(job.get("locations_raw"), list) and job["locations_raw"]:
        chunks: list[str] = []
        for item in job["locations_raw"]:
            if not isinstance(item, dict):
                continue
            address = item.get("address")
            if not isinstance(address, dict):
                continue
            values = [
                address.get("addressLocality"),
                address.get("addressRegion"),
                address.get("addressCountry"),
            ]
            formatted = ", ".join(str(value) for value in values if value)
            if formatted:
                chunks.append(formatted)
        if chunks:
            return " | ".join(chunks)
    return ""


def _company_slug(organization: Any, domain: Any) -> str:
    if domain:
        text = str(domain).strip().lower()
        if text:
            return text
    name = str(organization or "").strip().lower()
    return "-".join(part for part in name.replace("&", " ").split() if part)


def _organization_from_lever_url(url: Any) -> str:
    text = str(url or "")
    marker = "jobs.lever.co/"
    if marker in text:
        remainder = text.split(marker, 1)[1]
        return remainder.split("/", 1)[0]
    return ""


def _company_slug_from_listing_url(url: Any) -> str:
    text = str(url or "").strip()
    if not text:
        return ""
    markers = [
        "job-boards.greenhouse.io/",
        "jobs.ashbyhq.com/",
        "jobs.lever.co/",
    ]
    for marker in markers:
        if marker in text:
            remainder = text.split(marker, 1)[1]
            return remainder.split("/", 1)[0].strip().lower()
    return ""


def _normalize_domain_value(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.startswith("http://") or text.startswith("https://"):
        text = text.split("://", 1)[1]
    text = text.split("/", 1)[0].strip().lower()
    text = text.removeprefix("www.")
    if any(text == host or text.endswith(f".{host}") for host in NON_COMPANY_HOSTS):
        return None
    return text or None


def _infer_company_domain(domain: Any, organization_url: Any, listing_url: Any) -> str | None:
    direct_domain = _normalize_domain_value(domain)
    if direct_domain:
        return direct_domain
    org_domain = _normalize_domain_value(organization_url)
    if org_domain:
        return org_domain
    slug = _company_slug_from_listing_url(listing_url)
    if slug:
        return f"{slug}.com"
    return None


def _organization_url_from_domain(domain: Any) -> str | None:
    normalized_domain = _normalize_domain_value(domain)
    if not normalized_domain:
        return None
    return f"https://{normalized_domain}"


def _title_search_terms(role: str) -> list[str]:
    normalized = re.sub(r"[^a-z0-9]+", " ", str(role or "").strip().lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return []

    terms = [normalized]
    tokens = [token for token in normalized.split() if len(token) >= 3]
    if len(tokens) >= 2:
        terms.append(" ".join(tokens[-2:]))
    if len(tokens) >= 3:
        terms.append(" ".join(tokens[:2]))

    seen: set[str] = set()
    unique_terms: list[str] = []
    for term in terms:
        if term and term not in seen:
            seen.add(term)
            unique_terms.append(term)
    return unique_terms


def _lever_list_values(locations: Any, key: str) -> list[Any] | None:
    if not isinstance(locations, list):
        return None
    values = [item.get(key) for item in locations if isinstance(item, dict) and item.get(key) is not None]
    return values or None


def _lever_location_strings(locations: Any) -> list[str] | None:
    if not isinstance(locations, list):
        return None
    values: list[str] = []
    for item in locations:
        if not isinstance(item, dict):
            continue
        if item.get("location"):
            values.append(str(item["location"]))
            continue
        parts = [item.get("city"), item.get("state"), item.get("country")]
        formatted = ", ".join(str(value) for value in parts if value)
        if formatted:
            values.append(formatted)
    return values or None


def _deduplicate_jobs(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduplicated: dict[str, dict[str, Any]] = {}
    for job in jobs:
        key = str(job.get("apply_url") or job.get("url") or job.get("listing_url") or "").strip()
        if not key:
            key = "|".join(
                [
                    str(job.get("source") or ""),
                    str(job.get("organization") or ""),
                    str(job.get("title") or ""),
                    str(job.get("display_location") or ""),
                ]
            )
        existing = deduplicated.get(key)
        if existing is None or _filled_fields(job) > _filled_fields(existing):
            deduplicated[key] = job
    return list(deduplicated.values())


def _filled_fields(job: dict[str, Any]) -> int:
    total = 0
    for value in job.values():
        if value in (None, "", [], {}):
            continue
        total += 1
    return total


def _search_metadata(filters: JobSearchFilters) -> dict[str, Any]:
    return {
        "role": filters.role,
        "location": filters.location,
        "date_filter": filters.date_filter,
        "job_type": filters.job_type,
        "sources": filters.sources,
    }


def _response_preview(data: Any, limit: int = 3) -> Any:
    if isinstance(data, list):
        return data[:limit]
    if isinstance(data, dict):
        return data
    return str(data)


def _to_log_level(level: str) -> int:
    return {
        "debug": logging.DEBUG,
        "info": logging.INFO,
        "warning": logging.WARNING,
        "error": logging.ERROR,
    }.get(level.lower(), logging.INFO)


def _strip_html(value: str) -> str:
    text = value.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ")
    text = text.replace("</div>", " ").replace("</li>", " ").replace("</p>", " ")
    text = text.replace("</h3>", " ")
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(text.split())


def _matches_job_type(job: dict[str, Any], job_type: str) -> bool:
    normalized_job_type = (job_type or "all").strip().lower()
    if normalized_job_type in {"", "all"}:
        return True

    candidates: list[str] = []
    for value in job.get("employment_type") or []:
        candidates.append(str(value).lower())
    for value in job.get("ai_employment_type") or []:
        candidates.append(str(value).lower())
    location_type = str(job.get("location_type") or "").lower()
    work_arrangement = str(job.get("ai_work_arrangement") or "").lower()
    if location_type:
        candidates.append(location_type)
    if work_arrangement:
        candidates.append(work_arrangement)

    normalized_candidates = " ".join(candidates)
    alias_map = {
        "full_time": ["full_time", "full time", "full-time"],
        "part_time": ["part_time", "part time", "part-time"],
        "contract": ["contract", "contractor"],
        "internship": ["internship", "intern"],
        "remote": ["remote", "telecommute", "remote solely", "remote ok"],
        "hybrid": ["hybrid"],
        "onsite": ["onsite", "on-site", "on site"],
    }
    expected_tokens = alias_map.get(normalized_job_type, [normalized_job_type.replace("_", " ")])
    return any(token in normalized_candidates for token in expected_tokens)
