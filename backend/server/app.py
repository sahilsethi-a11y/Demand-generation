import json
import os
import re
import uuid
from typing import Dict, List, Any
import time
import logging
import sys
import warnings
from pathlib import Path
import asyncio
from collections import defaultdict

from dotenv import load_dotenv

# Suppress Pydantic V2 migration warnings
warnings.filterwarnings("ignore", message="Valid config keys have changed in V2")
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, File, UploadFile, BackgroundTasks, HTTPException
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel, ConfigDict

# Add the parent directory to sys.path to make sure we can import from server
sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

load_dotenv(dotenv_path=Path(__file__).resolve().parents[2] / ".env")

from server.websocket_manager import WebSocketManager
from server.company_store import CompanyStore
from server.server_utils import (
    get_config_dict, sanitize_filename,
    update_environment_variables, handle_file_upload, handle_file_deletion,
    handle_websocket_communication
)

from server.websocket_manager import run_agent
from utils import write_md_to_word, write_md_to_pdf
from gpt_researcher.utils.enum import Tone
from chat.chat import ChatAgentWithMemory
from apollo_leads import (
    run_apollo_company_employee_enrichment,
    run_apollo_lead_enrichment,
    build_bulk_match_payload,
    enrich_people,
    normalize_company_person,
)
from email_generation import generate_job_outreach
from instantly_service import send_leads_to_instantly, get_campaign_analytics, get_campaign_sending_status
from gpt_researcher.config import Config
from server.job_store import JobStore
from server.report_store import ReportStore
from server.schedule_store import ScheduleStore
from gpt_researcher.retrievers.tavily.tavily_search import TavilySearch
from services.job_search_agent import JobSearchError, run_job_search_workflow

# MongoDB services removed - no database persistence needed

# Setup logging
logger = logging.getLogger(__name__)

# Don't override parent logger settings
logger.propagate = True

# Silence uvicorn reload logs
logging.getLogger("uvicorn.supervisors.ChangeReload").setLevel(logging.WARNING)

# Models


class ResearchRequest(BaseModel):
    task: str
    report_type: str
    report_source: str
    tone: str
    headers: dict | None = None
    repo_name: str
    branch_name: str
    generate_in_background: bool = True


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="allow")  # Allow extra fields in the request
    
    report: str
    messages: List[Dict[str, Any]]


class ApolloLeadRequest(BaseModel):
    domains: List[str] | None = None
    organization_ids: List[str] | None = None
    companies: List[Dict[str, Any]] | None = None
    role: str | None = None
    titles: List[str] | None = None
    return_all_people: bool = False


class JobSearchRequest(BaseModel):
    role: str
    location: str
    date_filter: str
    market: str = "us"
    job_type: str | None = "all"
    sources: List[str] | None = None
    use_apollo_enrichment: bool = False
    max_jobs: int = 200


class JobEnrichmentRequest(BaseModel):
    role: str | None = None
    source: str | None = "all"
    force: bool = False
    max_companies: int | None = 100
    selected_company_keys: List[str] | None = None
    selected_job_keys: List[str] | None = None
    titles: List[str] | None = None


class PipelineRunRequest(BaseModel):
    role: str
    location: str
    date_filter: str = "7d"
    market: str = "us"
    job_type: str | None = "all"
    sources: List[str] | None = None
    auto_icp: bool = True
    auto_email: bool = True
    auto_send: bool = False
    max_companies: int = 20
    max_icps_per_company: int = 5
    campaign_id: str | None = None
    titles: List[str] | None = None
    target_emails: int = 250  # India smart-fetch: keep enriching until this many emails are ready


class CompanyPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str | None = None
    name: str
    website_url: str | None = None
    linkedin_url: str | None = None
    portfolio_companies: List[str] | None = None
    hq: str | None = None
    source: str | None = None
    apollo_org_id: str | None = None
    organization_domain: str | None = None
    employees: List[Dict[str, Any]] | None = None
    all_employees: List[Dict[str, Any]] | None = None
    total_employees_count: int | None = None
    icp_employees_count: int | None = None


class EmployeePayload(BaseModel):
    employees: List[Dict[str, Any]]


class ApolloEmployeeEnrichmentPayload(BaseModel):
    titles: List[str] | None = None


class PortfolioSearchCompany(BaseModel):
    name: str
    website_url: str | None = None


class PortfolioSearchRequest(BaseModel):
    companies: List[PortfolioSearchCompany]


async def _schedule_poller() -> None:
    """Background asyncio task: fires due automation schedules every 30 seconds."""
    import threading
    while True:
        await asyncio.sleep(30)
        try:
            due = schedule_store.get_due_schedules()
            for sched in due:
                pipeline_run_id = str(uuid.uuid4())
                run_history_id = schedule_store.create_run_history(sched["schedule_id"], pipeline_run_id)
                schedule_store.mark_schedule_running(sched["schedule_id"], run_history_id)
                _update_pipeline_run(
                    pipeline_run_id,
                    run_id=pipeline_run_id,
                    status="queued",
                    request=sched,
                    current_stage=None,
                    current_stage_status=None,
                    events=[],
                    summary=None,
                    outreach_results=[],
                    created_at=int(time.time() * 1000),
                )
                t = threading.Thread(
                    target=_run_pipeline,
                    args=(pipeline_run_id, sched),
                    kwargs={"automation_context": {"schedule_id": sched["schedule_id"], "run_history_id": run_history_id}},
                    daemon=True,
                )
                t.start()
                logger.info("Automation[%s] fired schedule %s (run_history=%s)", sched["name"], sched["schedule_id"][:8], run_history_id[:8])
        except Exception as exc:
            logger.error("Schedule poller error: %s", exc, exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    os.makedirs("outputs", exist_ok=True)
    company_store.init_db()
    job_store.init_db()
    app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")

    # Mount frontend static files
    frontend_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend")
    if os.path.exists(frontend_path):
        app.mount("/site", StaticFiles(directory=frontend_path), name="frontend")
        logger.debug(f"Frontend mounted from: {frontend_path}")

        # Also mount the static directory directly for assets referenced as /static/
        static_path = os.path.join(frontend_path, "static")
        if os.path.exists(static_path):
            app.mount("/static", StaticFiles(directory=static_path), name="static")
            logger.debug(f"Static assets mounted from: {static_path}")
    else:
        logger.warning(f"Frontend directory not found: {frontend_path}")

    # Start automation schedule poller
    poller_task = asyncio.create_task(_schedule_poller())
    logger.info("GPT Researcher API ready - local mode with job persistence")
    yield
    # Shutdown
    poller_task.cancel()
    logger.info("Research API shutting down")

# App initialization
app = FastAPI(lifespan=lifespan)

# Configure allowed origins for CORS
allowed_origins_env = os.getenv("CORS_ALLOW_ORIGINS")
ALLOWED_ORIGINS = (
    [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
    if allowed_origins_env
    else [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://app.gptr.dev",
    ]
)

# Standard JSON response - no custom MongoDB encoding needed

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use default JSON response class

# Mount static files for frontend
# Get the absolute path to the frontend directory
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))

# Mount static directories
app.mount("/static", StaticFiles(directory=os.path.join(frontend_dir, "static")), name="static")
app.mount("/site", StaticFiles(directory=frontend_dir), name="site")

# WebSocket manager
manager = WebSocketManager()

report_store = ReportStore(Path(os.getenv('REPORT_STORE_PATH', os.path.join('data', 'reports.json'))))
company_store = CompanyStore(
    Path(os.getenv("COMPANY_STORE_DB_PATH", os.path.join("data", "companies.sqlite3")))
)
job_store = JobStore(Path(os.getenv("JOBS_DB_PATH", os.path.join("data", "jobs.sqlite3"))))
schedule_store = ScheduleStore(Path(os.getenv("JOBS_DB_PATH", os.path.join("data", "jobs.sqlite3"))))
job_enrichment_runs: dict[str, dict[str, Any]] = {}
pipeline_runs: dict[str, dict[str, Any]] = {}

# Constants
DOC_PATH = os.getenv("DOC_PATH", "./my-docs")


def _update_job_enrichment_run(run_id: str, **updates: Any) -> dict[str, Any]:
    current = job_enrichment_runs.get(run_id, {})
    current.update(updates)
    current["updated_at"] = int(time.time() * 1000)
    job_enrichment_runs[run_id] = current
    return current


def _extract_company_targets(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for job in jobs:
        company_domain = _normalize_company_domain(job.get("domain_derived"))
        company_name = str(job.get("organization") or "").strip()
        company_key = str(company_domain or job.get("company_slug") or company_name).strip().lower()
        if not company_key:
            continue
        entry = grouped.setdefault(
            company_key,
            {
                "company_key": company_key,
                "company_name": company_name or None,
                "company_domain": company_domain or None,
                "example_role": job.get("title"),
            },
        )
        if not entry.get("company_name") and company_name:
            entry["company_name"] = company_name
        if not entry.get("company_domain") and company_domain:
            entry["company_domain"] = company_domain
        if not entry.get("example_role") and job.get("title"):
            entry["example_role"] = job.get("title")
    return list(grouped.values())


def _normalize_company_domain(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "." not in text and not text.startswith("http://") and not text.startswith("https://"):
        return ""
    parsed = re.sub(r"^https?://", "", text, flags=re.IGNORECASE)
    parsed = parsed.lstrip("/").split("/")[0].strip().lower()
    normalized = parsed.removeprefix("www.")
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


def _queue_apollo_company_enrichment(
    role: str,
    jobs: list[dict[str, Any]],
    background_tasks: BackgroundTasks,
    force: bool,
    titles: List[str] | None = None,
    request_endpoint: str = "/api/jobs",
) -> tuple[str | None, dict[str, Any] | None]:
    api_key = os.getenv("APOLLO_API_KEY")
    if not api_key:
        return None, {
            "status": "disabled",
            "message": "APOLLO_API_KEY is not configured",
        }

    extracted_companies = _extract_company_targets(jobs)
    available_company_keys = [str(company["company_key"]) for company in extracted_companies if company.get("company_key")]
    targets = job_store.list_companies_for_enrichment(company_keys=available_company_keys, force=force)
    if not targets:
        return None, {
            "status": "skipped",
            "message": "No companies require Apollo enrichment",
            "total_companies": 0,
        }

    target_lookup = {str(item["company_key"]): item for item in extracted_companies}
    merged_targets: list[dict[str, Any]] = []
    for target in targets:
        company_key = str(target.get("company_key") or "")
        merged = {**target_lookup.get(company_key, {}), **target}
        merged_targets.append(merged)

    run_id = str(uuid.uuid4())
    for target in merged_targets:
        job_store.set_company_enrichment_status(
            company_key=str(target.get("company_key") or ""),
            status="queued",
            company_name=target.get("company_name"),
            company_domain=target.get("company_domain"),
            run_id=run_id,
        )
    run_status = _update_job_enrichment_run(
        run_id,
        status="queued",
        role=role,
        titles=titles or [],
        request={
            "endpoint": request_endpoint,
            "payload": {
                "role": role,
                "titles": titles or [],
                "force": force,
                "company_keys": [str(target.get("company_key") or "") for target in merged_targets],
            },
        },
        total_companies=len(merged_targets),
        completed_companies=0,
        enriched_companies=0,
        failed_companies=0,
        remaining_companies=len(merged_targets),
        message=f"Queued Apollo enrichment for {len(merged_targets)} companies",
        logs=[],
        created_at=int(time.time() * 1000),
    )
    _append_run_log(
        run_id,
        "Apollo enrichment request queued",
        endpoint=request_endpoint,
        payload={
            "role": role,
            "titles": titles or [],
            "force": force,
            "company_keys": [str(target.get("company_key") or "") for target in merged_targets],
        },
    )
    background_tasks.add_task(_run_apollo_company_enrichment, run_id, role, merged_targets, titles)
    return run_id, run_status


def _queue_apollo_target_enrichment(
    role: str,
    targets: list[dict[str, Any]],
    background_tasks: BackgroundTasks,
    force: bool,
    titles: List[str] | None = None,
    request_endpoint: str = "/api/jobs/enrich",
    request_payload: dict[str, Any] | None = None,
) -> tuple[str | None, dict[str, Any] | None]:
    api_key = os.getenv("APOLLO_API_KEY")
    if not api_key:
        return None, {
            "status": "disabled",
            "message": "APOLLO_API_KEY is not configured",
        }
    if not targets:
        return None, {
            "status": "skipped",
            "message": "No companies require Apollo enrichment",
            "total_companies": 0,
            "request": {
                "endpoint": request_endpoint,
                "payload": request_payload or {},
            },
        }

    run_id = str(uuid.uuid4())
    for target in targets:
        job_store.set_company_enrichment_status(
            company_key=str(target.get("company_key") or ""),
            status="queued",
            company_name=target.get("company_name"),
            company_domain=target.get("company_domain"),
            run_id=run_id,
        )
    run_status = _update_job_enrichment_run(
        run_id,
        status="queued",
        role=role,
        titles=titles or [],
        request={
            "endpoint": request_endpoint,
            "payload": request_payload or {},
        },
        total_companies=len(targets),
        completed_companies=0,
        enriched_companies=0,
        failed_companies=0,
        remaining_companies=len(targets),
        message=f"Queued Apollo enrichment for {len(targets)} companies",
        logs=[],
        created_at=int(time.time() * 1000),
    )
    _append_run_log(
        run_id,
        "Apollo enrichment request queued",
        endpoint=request_endpoint,
        payload=request_payload or {},
    )
    background_tasks.add_task(_run_apollo_company_enrichment, run_id, role, targets, titles)
    return run_id, run_status


def _append_run_log(run_id: str, message: str, **metadata: Any) -> None:
    current = job_enrichment_runs.get(run_id, {})
    logs = list(current.get("logs") or [])
    logs.append(
        {
            "timestamp": int(time.time() * 1000),
            "message": message,
            **metadata,
        }
    )
    if len(logs) > 200:
        logs = logs[-200:]
    _update_job_enrichment_run(run_id, logs=logs)


def _run_apollo_company_enrichment(
    run_id: str,
    role: str,
    targets: list[dict[str, Any]],
    titles: List[str] | None = None,
) -> None:
    api_key = os.getenv("APOLLO_API_KEY")
    if not api_key:
        _update_job_enrichment_run(run_id, status="failed", message="APOLLO_API_KEY is not configured")
        return

    _update_job_enrichment_run(run_id, status="running", message="Apollo employee enrichment in progress")
    enriched_companies = 0
    failed_companies = 0

    for index, target in enumerate(targets, start=1):
        company_key = str(target.get("company_key") or "")
        company_name = str(target.get("company_name") or "").strip() or None
        company_domain = _normalize_company_domain(target.get("company_domain"))
        company_role = target.get("example_role") or role
        try:
            if not company_domain and not company_name:
                raise ValueError("No valid company domain or company name available for Apollo enrichment")

            job_store.set_company_enrichment_status(
                company_key=company_key,
                status="running",
                company_name=company_name,
                company_domain=company_domain,
                run_id=run_id,
            )
            _append_run_log(
                run_id,
                "Running Apollo company enrichment",
                company_key=company_key,
                company_name=company_name,
                company_domain=company_domain,
                match_strategy="domain" if company_domain else "company_name",
                titles=titles or [],
            )
            result = run_apollo_company_employee_enrichment(
                company_key=company_key,
                api_key=api_key,
                domain=company_domain,
                company_name=company_name,
                role=company_role,
                titles=titles,
                include_debug=True,
            )
            if isinstance(result, dict):
                debug_payload = result.get("debug")
                if isinstance(debug_payload, dict):
                    people_search_log = debug_payload.get("people_search")
                    if isinstance(people_search_log, dict):
                        _append_run_log(
                            run_id,
                            "Apollo people search",
                            company_key=company_key,
                            company_name=company_name,
                            endpoint=people_search_log.get("endpoint"),
                            payload=people_search_log.get("payloads"),
                            response=people_search_log.get("responses"),
                        )
                    bulk_match_log = debug_payload.get("bulk_match")
                    if isinstance(bulk_match_log, dict):
                        _append_run_log(
                            run_id,
                            "Apollo bulk match",
                            company_key=company_key,
                            company_name=company_name,
                            endpoint=bulk_match_log.get("endpoint"),
                            payload=bulk_match_log.get("payload"),
                            response=bulk_match_log.get("response"),
                        )
            contacts = result.get("contacts") if isinstance(result, dict) else []
            job_store.upsert_company_contacts(
                company_key=company_key,
                company_name=str(company_name or ""),
                company_domain=str(company_domain or ""),
                contacts=contacts if isinstance(contacts, list) else [],
                confidence=str(result.get("match_strategy") or ""),
                run_id=run_id,
            )
            enriched_companies += 1
            _append_run_log(
                run_id,
                "Apollo enrichment complete",
                company_key=company_key,
                company_name=company_name,
                company_domain=company_domain,
                match_strategy="domain" if company_domain else "company_name",
                contacts_count=len(contacts) if isinstance(contacts, list) else 0,
            )
        except Exception as exc:
            failed_companies += 1
            job_store.set_company_enrichment_status(
                company_key=company_key,
                status="failed",
                company_name=company_name,
                company_domain=company_domain,
                error_message=str(exc),
                run_id=run_id,
            )
            _append_run_log(
                run_id,
                "Apollo enrichment failed",
                company_key=company_key,
                company_name=company_name,
                error=str(exc),
            )

        completed_companies = index
        remaining_companies = max(len(targets) - completed_companies, 0)
        _update_job_enrichment_run(
            run_id,
            status="running" if remaining_companies > 0 else "completed",
            total_companies=len(targets),
            completed_companies=completed_companies,
            enriched_companies=enriched_companies,
            failed_companies=failed_companies,
            remaining_companies=remaining_companies,
            message=(
                f"Employees enriched for {completed_companies}/{len(targets)} companies"
                if remaining_companies > 0
                else f"Employees enriched for {enriched_companies} companies"
            ),
        )

    if failed_companies:
        _update_job_enrichment_run(
            run_id,
            status="completed",
            message=f"Employee enrichment finished with {failed_companies} failed companies",
        )

# Startup event


# Lifespan events now handled in the lifespan context manager above


# Routes
@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    """Serve the main frontend HTML page."""
    frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
    index_path = os.path.join(frontend_dir, "index.html")
    
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail="Frontend index.html not found")
    
    with open(index_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    return HTMLResponse(content=content)

@app.get("/report/{research_id}")
async def read_report(request: Request, research_id: str):
    docx_path = os.path.join('outputs', f"{research_id}.docx")
    if not os.path.exists(docx_path):
        return {"message": "Report not found."}
    return FileResponse(docx_path)


# Simplified API routes - no database persistence
@app.get("/api/reports")
async def get_all_reports(report_ids: str = None):
    report_ids_list = report_ids.split(",") if report_ids else None
    reports = await report_store.list_reports(report_ids_list)
    return {"reports": reports}


@app.get("/api/reports/{research_id}")
async def get_report_by_id(research_id: str):
    report = await report_store.get_report(research_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"report": report}


@app.post("/api/reports")
async def create_or_update_report(request: Request):
    try:
        data = await request.json()
        research_id = data.get("id", "temp_id")

        now_ms = int(time.time() * 1000)
        existing = await report_store.get_report(research_id)
        incoming_timestamp = data.get("timestamp")
        timestamp = incoming_timestamp if isinstance(incoming_timestamp, int) else now_ms
        if existing and isinstance(existing.get("timestamp"), int):
            timestamp = max(timestamp, existing["timestamp"])

        report = {
            "id": research_id,
            "question": data.get("question"),
            "answer": data.get("answer"),
            "orderedData": data.get("orderedData") or [],
            "chatMessages": data.get("chatMessages") or [],
            "timestamp": timestamp,
        }

        await report_store.upsert_report(research_id, report)
        return {"success": True, "id": research_id}
    except Exception as e:
        logger.error(f"Error processing report creation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/reports/{research_id}")
async def update_report(research_id: str, request: Request):
    existing = await report_store.get_report(research_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Report not found")

    data = await request.json()
    now_ms = int(time.time() * 1000)

    updated = {
        **existing,
        **{k: v for k, v in data.items() if v is not None},
        "id": research_id,
        "timestamp": now_ms,
    }

    await report_store.upsert_report(research_id, updated)
    return {"success": True, "id": research_id}


@app.delete("/api/reports/{research_id}")
async def delete_report(research_id: str):
    existed = await report_store.delete_report(research_id)
    if not existed:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"success": True}


def _extract_portfolio_companies(answer: str) -> List[str]:
    if not answer:
        return []
    raw_tokens = re.split(r"[\n,;•\-]+", answer)
    cleaned = [token.strip() for token in raw_tokens if token.strip()]
    return list(dict.fromkeys(cleaned))


def _employee_identity(employee: Dict[str, Any]) -> str:
    return (
        f"{employee.get('email','')}-{employee.get('linkedin_url','')}-"
        f"{employee.get('name','')}-{employee.get('title','')}"
    )


def _merge_employee_lists(
    existing: List[Dict[str, Any]] | None,
    incoming: List[Dict[str, Any]] | None,
) -> List[Dict[str, Any]]:
    existing_list = [employee for employee in (existing or []) if isinstance(employee, dict)]
    incoming_list = [employee for employee in (incoming or []) if isinstance(employee, dict)]
    merged = list(existing_list)
    indexed = {_employee_identity(employee): index for index, employee in enumerate(existing_list)}
    for employee in incoming_list:
      identity = _employee_identity(employee)
      if identity in indexed:
          current = merged[indexed[identity]]
          merged[indexed[identity]] = {**current, **{key: value for key, value in employee.items() if value not in (None, "", [], {})}}
          continue
      indexed[identity] = len(merged)
      merged.append(employee)
    return merged


@app.get("/api/companies")
async def list_companies(
    include_employees: bool = False,
    page: int = 1,
    page_size: int = 100,
    query: str = "",
    location_query: str = "",
    employee_filter: str = "all",
    portfolio_filter: str = "all",
):
    return await company_store.list_companies(
        include_employees=include_employees,
        page=page,
        page_size=page_size,
        query=query,
        location_query=location_query,
        employee_filter=employee_filter,
        portfolio_filter=portfolio_filter,
    )


@app.get("/api/companies/{company_id}")
async def get_company(company_id: str):
    company = await company_store.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return {"company": company}


@app.post("/api/companies")
async def upsert_company(payload: CompanyPayload):
    incoming = payload.model_dump(exclude_unset=True)
    existing_match = await company_store.find_company_by_key(incoming)
    matched_company_id = existing_match[0] if existing_match else None
    company_id = payload.id or matched_company_id or uuid.uuid4().hex
    existing = await company_store.get_company(company_id) or {}
    employees = incoming.get("employees")
    if employees is None:
        employees = existing.get("employees") or []
    else:
        employees = _merge_employee_lists(existing.get("employees"), employees)
    all_employees = incoming.get("all_employees")
    if all_employees is None:
        all_employees = existing.get("all_employees") or []
    else:
        all_employees = _merge_employee_lists(existing.get("all_employees"), all_employees)
    company = {
        **existing,
        **incoming,
        "id": company_id,
        "employees": employees,
        "all_employees": all_employees,
        "total_employees_count": int(incoming.get("total_employees_count") or existing.get("total_employees_count") or len(all_employees)),
        "icp_employees_count": int(incoming.get("icp_employees_count") or existing.get("icp_employees_count") or len(employees)),
    }
    await company_store.upsert_company(company_id, company)
    return {
        "id": company_id,
        "company": company,
        "existing": bool(existing_match or existing),
        "employees_count": len(employees),
    }


@app.post("/api/companies/{company_id}/employees")
async def add_company_employees(company_id: str, payload: EmployeePayload):
    company = await company_store.get_company(company_id) or {"id": company_id}
    existing_employees = company.get("employees") if isinstance(company.get("employees"), list) else []
    updated_employees = list(existing_employees)
    for employee in payload.employees:
        if not isinstance(employee, dict):
            continue
        normalized_employee = {
            "name": employee.get("name") or employee.get("Name"),
            "title": employee.get("title") or employee.get("Title"),
            "email": (
                employee.get("email")
                or employee.get("Email")
                or employee.get("work_email")
                or employee.get("personal_email")
            ),
            "phone": employee.get("phone") or employee.get("Phone") or employee.get("phone_number"),
            "linkedin_url": (
                employee.get("linkedin_url")
                or employee.get("LinkedIn URL")
                or employee.get("linkedinUrl")
                or employee.get("linkedin")
            ),
            "icp_reason": employee.get("icp_reason") or "Added manually to ICPs.",
        }
        updated_employees = _merge_employee_lists(updated_employees, [normalized_employee])
    company["employees"] = updated_employees
    company["icp_employees_count"] = len(updated_employees)
    company["total_employees_count"] = int(company.get("total_employees_count") or len(updated_employees))
    await company_store.upsert_company(company_id, company)
    return {"id": company_id, "employees": updated_employees}


@app.post("/api/companies/{company_id}/apollo-employees")
async def fetch_company_employees_from_apollo(
    company_id: str,
    payload: ApolloEmployeeEnrichmentPayload | None = None,
):
    api_key = os.getenv("APOLLO_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="APOLLO_API_KEY is not configured")

    company = await company_store.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")

    company_name = str(company.get("name") or "").strip()
    company_domain = str(
        company.get("organization_domain") or company.get("website_url") or ""
    ).strip()
    if not company_name and not company_domain:
        raise HTTPException(status_code=400, detail="Company is missing a usable Apollo identifier")

    try:
        result = await asyncio.to_thread(
            run_apollo_company_employee_enrichment,
            company_id,
            api_key,
            company_domain or None,
            company_name or None,
            None,
            payload.titles if payload else None,
            False,
        )
    except Exception as exc:
        logger.error("Apollo employee enrichment failed for company %s: %s", company_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))

    contacts = result.get("contacts") if isinstance(result, dict) else []
    if not isinstance(contacts, list):
        contacts = []

    existing_employees = company.get("employees") if isinstance(company.get("employees"), list) else []
    updated_employees = list(existing_employees)
    for contact in contacts:
        if not isinstance(contact, dict):
            continue
        normalized_employee = {
            "name": contact.get("name"),
            "title": contact.get("title"),
            "email": contact.get("email"),
            "phone": None,
            "linkedin_url": contact.get("linkedin_url"),
            "icp_reason": contact.get("icp_reason"),
            "apollo_person_id": contact.get("apollo_person_id"),
            "organization_id": contact.get("organization_id"),
            "organization_domain": contact.get("organization_domain"),
        }
        updated_employees = _merge_employee_lists(updated_employees, [normalized_employee])

    company["employees"] = updated_employees
    company["all_employees"] = _merge_employee_lists(
        company.get("all_employees") if isinstance(company.get("all_employees"), list) else [],
        result.get("all_people") if isinstance(result, dict) and isinstance(result.get("all_people"), list) else [],
    )
    company["total_employees_count"] = int(result.get("people_count") or company.get("total_employees_count") or len(updated_employees))
    company["icp_employees_count"] = int(result.get("shortlisted_count") or len(updated_employees))
    if result.get("company_domain"):
        company["organization_domain"] = result.get("company_domain")
    first_contact = contacts[0] if contacts and isinstance(contacts[0], dict) else {}
    if first_contact.get("organization_id"):
        company["apollo_org_id"] = first_contact.get("organization_id")
    await company_store.upsert_company(company_id, company)
    return {
        "id": company_id,
        "employees": updated_employees,
        "added_count": max(len(updated_employees) - len(existing_employees), 0),
        "enriched_count": len(contacts),
        "people_count": result.get("people_count") if isinstance(result, dict) else 0,
        "shortlisted_count": result.get("shortlisted_count") if isinstance(result, dict) else 0,
        "match_strategy": result.get("match_strategy") if isinstance(result, dict) else None,
        "total_employees_count": company.get("total_employees_count", 0),
        "icp_employees_count": company.get("icp_employees_count", 0),
        "company": company,
    }


@app.post("/api/companies/portfolio-search")
async def portfolio_search(payload: PortfolioSearchRequest):
    results = []
    for company in payload.companies:
        query = f"{company.name} {company.website_url or ''} portfolio companies".strip()
        searcher = TavilySearch(query)
        response = searcher._search(
            query,
            search_depth="basic",
            max_results=5,
            include_answer=True,
        )
        answer = response.get("answer") if isinstance(response, dict) else ""
        portfolio_companies = _extract_portfolio_companies(str(answer or ""))
        results.append({
            "name": company.name,
            "portfolio_companies": portfolio_companies,
            "answer": answer,
        })
    return {"results": results}



@app.get("/api/reports/{research_id}/chat")
async def get_report_chat(research_id: str):
    report = await report_store.get_report(research_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"chatMessages": report.get("chatMessages") or []}


@app.post("/api/reports/{research_id}/chat")
async def add_report_chat_message(research_id: str, request: Request):
    report = await report_store.get_report(research_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")

    message = await request.json()
    chat_messages = report.get("chatMessages") or []
    if isinstance(chat_messages, list):
        chat_messages = [*chat_messages, message]
    else:
        chat_messages = [message]

    now_ms = int(time.time() * 1000)
    updated = {
        **report,
        "chatMessages": chat_messages,
        "timestamp": now_ms,
    }

    await report_store.upsert_report(research_id, updated)
    return {"success": True, "id": research_id}


async def write_report(research_request: ResearchRequest, research_id: str = None):
    report_information = await run_agent(
        task=research_request.task,
        report_type=research_request.report_type,
        report_source=research_request.report_source,
        source_urls=[],
        document_urls=[],
        tone=Tone[research_request.tone],
        websocket=None,
        stream_output=None,
        headers=research_request.headers,
        query_domains=[],
        config_path="",
        return_researcher=True
    )

    docx_path = await write_md_to_word(report_information[0], research_id)
    pdf_path = await write_md_to_pdf(report_information[0], research_id)
    if research_request.report_type != "multi_agents":
        report, researcher = report_information
        response = {
            "research_id": research_id,
            "research_information": {
                "source_urls": researcher.get_source_urls(),
                "research_costs": researcher.get_costs(),
                "visited_urls": list(researcher.visited_urls),
                "research_images": researcher.get_research_images(),
                # "research_sources": researcher.get_research_sources(),  # Raw content of sources may be very large
            },
            "report": report,
            "docx_path": docx_path,
            "pdf_path": pdf_path
        }
    else:
        response = { "research_id": research_id, "report": "", "docx_path": docx_path, "pdf_path": pdf_path }

    return response

@app.post("/report/")
async def generate_report(research_request: ResearchRequest, background_tasks: BackgroundTasks):
    research_id = sanitize_filename(f"task_{int(time.time())}_{research_request.task}")

    if research_request.generate_in_background:
        background_tasks.add_task(write_report, research_request=research_request, research_id=research_id)
        return {"message": "Your report is being generated in the background. Please check back later.",
                "research_id": research_id}
    else:
        response = await write_report(research_request, research_id)
        return response


@app.get("/files/")
async def list_files():
    if not os.path.exists(DOC_PATH):
        os.makedirs(DOC_PATH, exist_ok=True)
    files = os.listdir(DOC_PATH)
    print(f"Files in {DOC_PATH}: {files}")
    return {"files": files}



@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)):
    return await handle_file_upload(file, DOC_PATH)


@app.delete("/files/{filename}")
async def delete_file(filename: str):
    return await handle_file_deletion(filename, DOC_PATH)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        await handle_websocket_communication(websocket, manager)
    except WebSocketDisconnect as e:
        # Disconnect with more detailed logging about the WebSocket disconnect reason
        logger.info(f"WebSocket disconnected with code {e.code} and reason: '{e.reason}'")
        await manager.disconnect(websocket)
    except Exception as e:
        # More general exception handling
        logger.error(f"Unexpected WebSocket error: {str(e)}")
        await manager.disconnect(websocket)

@app.post("/api/chat")
async def chat(chat_request: ChatRequest):
    """Process a chat request with a report and message history.

    Args:
        chat_request: ChatRequest object containing report text and message history

    Returns:
        JSON response with the assistant's message and any tool usage metadata
    """
    try:
        logger.info(f"Received chat request with {len(chat_request.messages)} messages")

        # Create chat agent with the report
        chat_agent = ChatAgentWithMemory(
            report=chat_request.report,
            config_path="default",
            headers=None
        )

        # Process the chat and get response with metadata
        response_content, tool_calls_metadata = await chat_agent.chat(chat_request.messages, None)
        logger.info(f"response_content: {response_content}")
        logger.info(f"Got chat response of length: {len(response_content) if response_content else 0}")
        
        if tool_calls_metadata:
            logger.info(f"Tool calls used: {json.dumps(tool_calls_metadata)}")

        # Format response as a ChatMessage object with role, content, timestamp and metadata
        response_message = {
            "role": "assistant",
            "content": response_content,
            "timestamp": int(time.time() * 1000),  # Current time in milliseconds
            "metadata": {
                "tool_calls": tool_calls_metadata
            } if tool_calls_metadata else None
        }

        logger.info(f"Returning formatted response: {json.dumps(response_message)[:100]}...")
        return {"response": response_message}
    except Exception as e:
        logger.error(f"Error processing chat request: {str(e)}", exc_info=True)
        return {"error": str(e)}


def _derive_apollo_company_key(company: dict[str, Any]) -> str:
    """Derive a stable cache key for a company dict from the Apollo leads request."""
    from apollo_leads import normalize_domain as _nd
    domain = _nd(str(company.get("company_domain") or ""))
    if domain:
        return domain
    key = str(company.get("company_key") or "").strip().lower()
    if key:
        return key
    return str(company.get("company_name") or "").strip().lower()


_CACHE_DAYS = 30


@app.post("/api/apollo/leads")
async def apollo_leads(request: ApolloLeadRequest):
    api_key = os.getenv("APOLLO_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="APOLLO_API_KEY is not configured")

    try:
        title_filters = request.titles or ([request.role] if request.role else None)

        # ── Per-company cache check ──────────────────────────────────────────
        companies_to_fetch: list[dict[str, Any]] = []
        cached_people: list[dict[str, Any]] = []
        cache_hits: list[str] = []

        for company in (request.companies or []):
            ck = _derive_apollo_company_key(company)
            if ck:
                fresh = job_store.get_fresh_people_for_company(ck, max_age_days=_CACHE_DAYS)
                if fresh is not None:
                    cached_people.extend(fresh)
                    cache_hits.append(str(company.get("company_name") or ck))
                    continue
            companies_to_fetch.append(company)

        # ── Fetch only uncached companies from Apollo ────────────────────────
        fresh_people: list[dict[str, Any]] = []
        resolved_companies: list[dict[str, Any]] = []
        debug_data: dict[str, Any] = {}

        if companies_to_fetch or request.domains or request.organization_ids:
            results = await asyncio.to_thread(
                run_apollo_lead_enrichment,
                request.domains,
                api_key,
                title_filters,
                True,
                request.organization_ids,
                companies_to_fetch or None,
                request.return_all_people,
            )
            if isinstance(results, dict):
                fresh_people = results.get("people") or []
                resolved_companies = results.get("resolved_companies") or []
                debug_data = results.get("debug") or {}

            # ── Persist fresh people to cache grouped by company ─────────────
            from apollo_leads import normalize_domain as _nd
            company_people_map: dict[str, list[dict[str, Any]]] = {}
            for person in fresh_people:
                org_domain = _nd(str(person.get("organization_domain") or ""))
                org_name = str(person.get("organization_name") or "").strip().lower()
                ck = org_domain or org_name
                if ck:
                    company_people_map.setdefault(ck, []).append(person)

            for ck, people_list in company_people_map.items():
                contacts_to_save = [
                    {
                        "name": p.get("name"),
                        "title": p.get("title"),
                        "email": p.get("email"),
                        "linkedin_url": p.get("linkedin_url"),
                        "apollo_person_id": p.get("apollo_person_id"),
                        "organization_id": p.get("organization_id"),
                        "organization_domain": p.get("organization_domain"),
                        "confidence": "people_discovery",
                        **p,  # preserve all fields (dept, seniority, etc.) in payload_json
                    }
                    for p in people_list
                ]
                org_name_display = people_list[0].get("organization_name") or ck
                job_store.upsert_company_contacts(
                    company_key=ck,
                    company_name=org_name_display,
                    company_domain=ck,
                    contacts=contacts_to_save,
                    confidence="people_discovery",
                )

        # ── Merge and return ─────────────────────────────────────────────────
        all_people = cached_people + fresh_people
        response: dict[str, Any] = {
            "people": all_people,
            "resolved_companies": resolved_companies,
        }
        if cache_hits:
            response["cache_hits"] = cache_hits
            response["cache_note"] = (
                f"{len(cache_hits)} company/companies served from cache "
                f"(data < {_CACHE_DAYS} days old): {', '.join(cache_hits)}"
            )
        if debug_data:
            response["debug"] = debug_data
        return response

    except Exception as exc:
        logger.error(f"Apollo lead enrichment failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/jobs")
async def run_job_search(request: JobSearchRequest, background_tasks: BackgroundTasks):
    try:
        workflow_result = await run_job_search_workflow(
            role=request.role,
            location=request.location,
            date_filter=request.date_filter,
            job_type=request.job_type or "all",
            sources=request.sources,
            market=request.market,
            max_jobs=request.max_jobs,
        )
    except JobSearchError as exc:
        logger.error("Job search failed: %s", exc)
        return JSONResponse(
            {"error": str(exc), "debug_log": exc.debug_log},
            status_code=500,
        )

    unique_jobs = workflow_result.get("unique_jobs", workflow_result["jobs"])
    all_jobs = workflow_result.get("all_jobs", workflow_result.get("fetched_jobs", unique_jobs))

    saved_total = job_store.upsert_jobs(unique_jobs)
    apollo_run_id = None
    apollo_status: dict[str, Any] | None = None
    if request.use_apollo_enrichment:
        apollo_run_id, apollo_status = _queue_apollo_company_enrichment(
            role=request.role,
            jobs=unique_jobs,
            background_tasks=background_tasks,
            force=False,
            titles=None,
        )

    annotated_jobs = job_store.annotate_jobs(unique_jobs)
    annotated_all_jobs = job_store.annotate_jobs(all_jobs)
    saved_page = job_store.list_jobs(page=1, page_size=100)
    return {
        "jobs": annotated_jobs,
        "unique_jobs": annotated_jobs,
        "all_jobs": annotated_all_jobs,
        "fetched_jobs": annotated_all_jobs,
        "collected_count": workflow_result["collected_count"],
        "matched_count": workflow_result.get("matched_count", len(all_jobs)),
        "unique_count": workflow_result.get("unique_count", len(unique_jobs)),
        "saved_total": saved_total,
        "saved_jobs": saved_page["jobs"],
        "saved_jobs_total": saved_page["total"],
        "saved_jobs_page": saved_page["page"],
        "saved_jobs_page_size": saved_page["page_size"],
        "sources": workflow_result["sources"],
        "market": request.market,
        "debug_log": workflow_result["debug_log"],
        "apollo_enrichment_enabled": request.use_apollo_enrichment,
        "apollo_enrichment_run_id": apollo_run_id,
        "apollo_enrichment_status": apollo_status,
    }


@app.get("/api/jobs/saved")
async def get_saved_jobs(
    page: int = 1,
    page_size: int = 100,
    source: str = "all",
    role_query: str = "",
    has_contacts: bool = False,
    contact_title_query: str = "",
):
    return job_store.list_jobs(
        page=page,
        page_size=page_size,
        source=source,
        role_query=role_query,
        has_contacts=has_contacts,
        contact_title_query=contact_title_query,
    )


@app.get("/api/companies/{company_key}/people")
async def get_company_people(company_key: str):
    """Return all stored contacts + generated emails for a company."""
    contacts = job_store.get_company_contacts_for_key(company_key)
    emails = job_store.get_outreach_emails_for_company(company_key)
    return {"company_key": company_key, "contacts": contacts, "emails": emails}


@app.get("/api/jobs/enrichment-status/{run_id}")
async def get_job_enrichment_status(run_id: str):
    status = job_enrichment_runs.get(run_id)
    if not status:
        raise HTTPException(status_code=404, detail="Enrichment run not found")
    return status


@app.post("/api/jobs/enrich")
async def rerun_job_enrichment(request: JobEnrichmentRequest, background_tasks: BackgroundTasks):
    request_payload = {
        "role": request.role or "",
        "titles": request.titles or [],
        "force": request.force,
        "selected_job_keys": request.selected_job_keys or [],
        "selected_company_keys": request.selected_company_keys or [],
        "source": request.source or "all",
        "max_companies": request.max_companies or 100,
    }
    selected_company_keys = [
        str(company_key).strip().lower()
        for company_key in (request.selected_company_keys or [])
        if str(company_key).strip()
    ]
    selected_jobs: list[dict[str, Any]] = []
    selected_targets: list[dict[str, Any]] = []
    if request.selected_job_keys:
        selected_jobs = job_store.get_jobs_by_job_keys(request.selected_job_keys)
        selected_targets = _extract_company_targets(selected_jobs)
        if selected_targets:
            selected_company_keys = [
                str(target.get("company_key") or "").strip().lower()
                for target in selected_targets
                if str(target.get("company_key") or "").strip()
            ]
            apollo_run_id, apollo_status = _queue_apollo_target_enrichment(
                role=request.role or "",
                targets=selected_targets,
                background_tasks=background_tasks,
                force=request.force,
                titles=request.titles,
                request_endpoint="/api/jobs/enrich",
                request_payload={
                    **request_payload,
                    "selected_company_keys": selected_company_keys,
                },
            )
            return {
                "apollo_enrichment_run_id": apollo_run_id,
                "apollo_enrichment_status": apollo_status,
                "jobs_sampled": len(selected_jobs),
            }
    if not selected_company_keys and request.selected_job_keys:
        selected_company_keys = job_store.get_company_keys_for_job_keys(request.selected_job_keys)
    if selected_company_keys:
        targets = job_store.list_companies_for_enrichment(
            company_keys=selected_company_keys,
            force=True if request.force else False,
        )
        if not targets:
            return {
                "apollo_enrichment_run_id": None,
                "apollo_enrichment_status": {
                    "status": "skipped",
                    "message": "No selected jobs require Apollo enrichment",
                    "total_companies": 0,
                    "request": {
                        "endpoint": "/api/jobs/enrich",
                        "payload": {
                            **request_payload,
                            "selected_company_keys": selected_company_keys,
                        },
                    },
                },
                "jobs_sampled": 0,
            }
        run_id = str(uuid.uuid4())
        for target in targets:
            job_store.set_company_enrichment_status(
                company_key=str(target.get("company_key") or ""),
                status="queued",
                company_name=target.get("company_name"),
                company_domain=target.get("company_domain"),
                run_id=run_id,
            )
        run_status = _update_job_enrichment_run(
            run_id,
            run_id=run_id,
            status="queued",
            role=request.role or "",
            titles=request.titles or [],
            request={
                "endpoint": "/api/jobs/enrich",
                "payload": {
                    **request_payload,
                    "selected_company_keys": selected_company_keys,
                },
            },
            total_companies=len(targets),
            completed_companies=0,
            enriched_companies=0,
            failed_companies=0,
            remaining_companies=len(targets),
            message=f"Queued Apollo enrichment for {len(targets)} selected companies",
            logs=[],
            created_at=int(time.time() * 1000),
        )
        _append_run_log(
            run_id,
            "Apollo enrichment request queued",
            endpoint="/api/jobs/enrich",
            payload={
                **request_payload,
                "selected_company_keys": selected_company_keys,
            },
        )
        background_tasks.add_task(
            _run_apollo_company_enrichment,
            run_id,
            request.role or "",
            targets,
            request.titles,
        )
        return {
            "apollo_enrichment_run_id": run_id,
            "apollo_enrichment_status": run_status,
            "jobs_sampled": len(selected_company_keys),
        }

    saved_page = job_store.list_jobs(page=1, page_size=max(request.max_companies or 100, 1), source=request.source or "all")
    apollo_run_id, apollo_status = _queue_apollo_company_enrichment(
        role=request.role or "",
        jobs=saved_page["jobs"],
        background_tasks=background_tasks,
        force=request.force,
        titles=request.titles,
        request_endpoint="/api/jobs/enrich",
    )
    if not apollo_run_id and isinstance(apollo_status, dict):
        apollo_status = {
            **apollo_status,
            "request": {
                "endpoint": "/api/jobs/enrich",
                "payload": request_payload,
            },
        }
    return {
        "apollo_enrichment_run_id": apollo_run_id,
        "apollo_enrichment_status": apollo_status,
        "jobs_sampled": len(saved_page["jobs"]),
    }

@app.post("/api/reports/{research_id}/chat")
async def research_report_chat(research_id: str, request: Request):
    """Handle chat requests for a specific research report.
    Directly processes the raw request data to avoid validation errors.
    """
    try:
        # Get raw JSON data from request
        data = await request.json()
        
        # Create chat agent with the report
        chat_agent = ChatAgentWithMemory(
            report=data.get("report", ""),
            config_path="default",
            headers=None
        )

        # Process the chat and get response with metadata
        response_content, tool_calls_metadata = await chat_agent.chat(data.get("messages", []), None)
        
        if tool_calls_metadata:
            logger.info(f"Tool calls used: {json.dumps(tool_calls_metadata)}")

        # Format response as a ChatMessage object
        response_message = {
            "role": "assistant",
            "content": response_content,
            "timestamp": int(time.time() * 1000),
            "metadata": {
                "tool_calls": tool_calls_metadata
            } if tool_calls_metadata else None
        }

        return {"response": response_message}
    except Exception as e:
        logger.error(f"Error in research report chat: {str(e)}", exc_info=True)
        return {"error": str(e)}

@app.put("/api/reports/{research_id}")
async def update_report(research_id: str, request: Request):
    """Update a specific research report by ID - no database configured."""
    logger.debug(f"Update requested for report {research_id} - no database configured, not persisted")
    return {"success": True, "id": research_id}

@app.delete("/api/reports/{research_id}")
async def delete_report(research_id: str):
    """Delete a specific research report by ID - no database configured."""
    logger.debug(f"Delete requested for report {research_id} - no database configured, nothing to delete")
    return {"success": True, "id": research_id}


# ─────────────────────────────────────────────
# Pipeline orchestration endpoint
# ─────────────────────────────────────────────

PIPELINE_STAGES = [
    "job_search",
    "company_extraction",
    "people_discovery",
    "icp_selection",
    "email_enrichment",
    "email_generation",
    "instantly_send",
]


def _update_pipeline_run(run_id: str, **updates: Any) -> dict[str, Any]:
    current = pipeline_runs.get(run_id, {})
    current.update(updates)
    current["updated_at"] = int(time.time() * 1000)
    pipeline_runs[run_id] = current
    return current


def _pipeline_stage_event(
    run_id: str,
    stage: str,
    status: str,
    message: str,
    data: dict[str, Any] | None = None,
    counts: dict[str, Any] | None = None,
) -> None:
    stage_index = PIPELINE_STAGES.index(stage) if stage in PIPELINE_STAGES else -1
    event = {
        "stage": stage,
        "stage_number": stage_index + 1,
        "total_stages": len(PIPELINE_STAGES),
        "status": status,
        "message": message,
        "data": data or {},
        "counts": counts or {},
        "timestamp": int(time.time() * 1000),
    }
    current = pipeline_runs.get(run_id, {})
    events = list(current.get("events") or [])
    events.append(event)
    _update_pipeline_run(run_id, current_stage=stage, current_stage_status=status, events=events)
    logger.info("Pipeline[%s] %s | %s | %s", run_id[:8], stage, status, message)


def _run_pipeline(
    run_id: str,
    request_data: dict[str, Any],
    automation_context: dict[str, Any] | None = None,
) -> None:
    """Background task that orchestrates all pipeline stages sequentially.

    automation_context (optional): dict with keys schedule_id, run_history_id.
    When present, dedup filtering is applied at Stage 2 (companies) and Stage 6 (contacts),
    and outreach_log is written after Stage 7 succeeds.
    """
    import math as _math
    from services.job_search_agent import INDIA_SOURCES as _INDIA_SOURCES

    role = request_data["role"]
    location = request_data["location"]
    date_filter = request_data.get("date_filter", "7d")
    market = request_data.get("market", "us")
    job_type = request_data.get("job_type", "all")
    sources = request_data.get("sources")
    max_companies = int(request_data.get("max_companies") or 20)
    max_icps = int(request_data.get("max_icps_per_company") or 5)
    auto_email = bool(request_data.get("auto_email", True))
    auto_send = bool(request_data.get("auto_send", False))
    campaign_id = request_data.get("campaign_id") or os.getenv("INSTANTLY_CAMPAIGN_ID", "")
    titles = request_data.get("titles")
    target_emails = int(request_data.get("target_emails") or 250)

    # India smart-fetch: 100 jobs initially split across selected actors,
    # then top-up in batches of 50 until the email target is reached.
    _INDIA_INITIAL_JOBS = 100
    _INDIA_REFETCH_JOBS = 50
    _INDIA_MAX_REFETCHES = 4   # 100 + 4×50 = 300 companies ceiling
    is_india = (market or "us").strip().lower() == "india"
    _india_selected_sources = [s for s in (sources or list(_INDIA_SOURCES)) if s in _INDIA_SOURCES]
    _n_india_actors = max(1, len(_india_selected_sources))

    # Automation dedup settings (only active when called from scheduler)
    _schedule_id = (automation_context or {}).get("schedule_id")
    _run_history_id = (automation_context or {}).get("run_history_id")
    _skip_contacted_companies = bool(request_data.get("skip_contacted_companies", False)) if automation_context else False
    _dedup_lookback_days = int(request_data.get("dedup_lookback_days") or 90)
    _companies_skipped_dedup = 0
    _contacts_skipped_dedup = 0

    if _run_history_id:
        schedule_store.start_run_history(_run_history_id)

    try:
        # ── Stage 1: Job Search ─────────────────────────────────────────────
        from services.job_search_agent import run_job_search_workflow, JobSearchError as _JobSearchError
        import asyncio as _asyncio

        def _do_job_search(max_jobs_per_actor: int, run_id_label: str) -> list[dict[str, Any]]:
            """Run one Apify fetch and return deduplicated jobs."""
            _pipeline_stage_event(run_id, "job_search", "in_progress",
                f"Searching {market.upper()} jobs for '{role}' in {location}... ({run_id_label})")
            try:
                _loop = _asyncio.new_event_loop()
                _result = _loop.run_until_complete(
                    run_job_search_workflow(
                        role=role,
                        location=location,
                        date_filter=date_filter,
                        job_type=job_type or "all",
                        sources=sources,
                        market=market,
                        run_id=run_id,
                        max_jobs=max_jobs_per_actor,
                    )
                )
                _loop.close()
            except _JobSearchError as exc:
                _pipeline_stage_event(run_id, "job_search", "error", f"Job search failed: {exc}")
                raise
            _jobs = _result.get("jobs") or []
            job_store.upsert_jobs(_jobs)
            return _jobs

        # For India: 100 jobs total split across selected actors.
        # For US: keep the existing formula.
        if is_india:
            _initial_per_actor = _math.ceil(_INDIA_INITIAL_JOBS / _n_india_actors)
        else:
            _initial_per_actor = max(200, max_companies * 4)

        try:
            all_jobs = _do_job_search(_initial_per_actor, "initial fetch")
        except _JobSearchError:
            _update_pipeline_run(run_id, status="failed", error="Job search failed")
            return

        _pipeline_stage_event(
            run_id, "job_search", "done",
            f"{len(all_jobs)} unique jobs found — initial fetch",
            counts={"jobs": len(all_jobs)},
        )

        # ── Stage 2: Company Extraction ─────────────────────────────────────
        _pipeline_stage_event(run_id, "company_extraction", "in_progress", "Extracting unique companies from job results...")
        company_targets = _extract_company_targets(all_jobs)

        # Dedup: skip companies already contacted within the lookback window
        if _skip_contacted_companies and automation_context:
            contacted_company_keys = schedule_store.get_contacted_company_keys(_dedup_lookback_days)
            before_count = len(company_targets)
            company_targets = [c for c in company_targets if c.get("company_key") not in contacted_company_keys]
            _companies_skipped_dedup = before_count - len(company_targets)
            if _companies_skipped_dedup:
                logger.info("Automation dedup: skipped %d already-contacted companies", _companies_skipped_dedup)

        # For US, cap at max_companies. For India, we manage count via the enrichment loop.
        if not is_india and len(company_targets) > max_companies:
            company_targets = company_targets[:max_companies]

        dedup_note = f" ({_companies_skipped_dedup} skipped — already contacted)" if _companies_skipped_dedup else ""
        _pipeline_stage_event(
            run_id, "company_extraction", "done",
            f"{len(company_targets)} unique companies identified{dedup_note}",
            counts={"companies": len(company_targets), "skipped_dedup": _companies_skipped_dedup},
        )

        if not company_targets:
            _update_pipeline_run(run_id, status="completed", message="No companies to enrich.")
            return

        # ── Stage 3 & 4: People Discovery + ICP Selection ───────────────────
        apollo_api_key = os.getenv("APOLLO_API_KEY")
        all_icps: list[dict[str, Any]] = []
        company_details_map: dict[str, dict[str, Any]] = {}

        if not apollo_api_key:
            _pipeline_stage_event(run_id, "people_discovery", "skipped", "APOLLO_API_KEY not configured — skipping people discovery.")
            _pipeline_stage_event(run_id, "icp_selection", "skipped", "Skipped — no Apollo API key.")
        else:
            # For India we loop: enrich companies one-by-one, counting contacts with valid
            # emails, and top-up from Apify whenever we exhaust the current batch but are
            # still below the daily email target.
            _processed_keys: set[str] = set()
            _valid_email_count = 0  # contacts with a non-empty email address
            _refetch_count = 0
            _company_pool: list[dict[str, Any]] = list(company_targets)

            def _enrich_company(target: dict[str, Any], idx: int, total: int) -> None:
                nonlocal _valid_email_count
                company_key = str(target.get("company_key") or "")
                company_name = str(target.get("company_name") or "")
                company_domain = _normalize_company_domain(target.get("company_domain") or "")
                example_role = target.get("example_role") or role

                _pipeline_stage_event(
                    run_id, "people_discovery", "in_progress",
                    f"Searching Apollo for {company_name or company_domain}...",
                    counts={"companies_done": idx - 1, "companies_total": total,
                            "emails_found": _valid_email_count, "target_emails": target_emails},
                )
                try:
                    result = run_apollo_company_employee_enrichment(
                        company_key=company_key,
                        api_key=apollo_api_key,
                        domain=company_domain or None,
                        company_name=company_name or None,
                        role=example_role,
                        titles=titles,
                        include_debug=False,
                        max_contacts=max_icps,
                    )
                    contacts = result.get("contacts") if isinstance(result, dict) else []
                    job_store.upsert_company_contacts(
                        company_key=company_key,
                        company_name=company_name,
                        company_domain=company_domain,
                        contacts=contacts if isinstance(contacts, list) else [],
                        confidence=str(result.get("match_strategy") or ""),
                        run_id=run_id,
                    )
                    for contact in (contacts or []):
                        contact["_company_key"] = company_key
                        contact["_company_name"] = company_name
                        contact["_company_domain"] = company_domain
                        contact["_example_role"] = example_role
                    all_icps.extend(contacts or [])

                    # Count contacts that carry a valid email (usable outreach targets)
                    _valid_email_count += sum(
                        1 for c in (contacts or []) if str(c.get("email") or "").strip()
                    )

                    all_people_slim = [
                        {"name": p.get("name"), "title": p.get("title"), "linkedin_url": p.get("linkedin_url")}
                        for p in (result.get("all_people") or [])
                    ][:50]
                    company_details_map[company_key] = {
                        "company_key": company_key,
                        "company_name": company_name,
                        "company_domain": company_domain,
                        "people_count": result.get("people_count", 0),
                        "all_people": all_people_slim,
                        "icps": [
                            {
                                "name": c.get("name"),
                                "title": c.get("title"),
                                "email": c.get("email"),
                                "linkedin_url": c.get("linkedin_url"),
                                "icp_reason": c.get("icp_reason"),
                            }
                            for c in (contacts or [])
                        ],
                        "emails": [],
                    }
                    _update_pipeline_run(run_id, company_details=list(company_details_map.values()))
                    _pipeline_stage_event(
                        run_id, "icp_selection", "in_progress",
                        f"{len(contacts or [])} ICPs at {company_name or company_domain} "
                        f"({_valid_email_count}/{target_emails} emails so far)",
                        data={"company": company_name, "icps_count": len(contacts or [])},
                        counts={"companies_done": idx, "companies_total": total,
                                "icps_total": len(all_icps), "emails_found": _valid_email_count,
                                "target_emails": target_emails},
                    )
                except Exception as exc:
                    logger.warning("Apollo enrichment failed for %s: %s", company_key, exc)
                    _pipeline_stage_event(
                        run_id, "people_discovery", "in_progress",
                        f"Apollo lookup failed for {company_name or company_domain}: {exc}",
                        counts={"companies_done": idx, "companies_total": total},
                    )

            _pipeline_stage_event(
                run_id, "people_discovery", "in_progress",
                f"Starting enrichment — target {target_emails} emails "
                f"({'India smart-fetch' if is_india else 'standard'})",
                counts={"companies_total": len(_company_pool), "companies_done": 0,
                        "emails_found": 0, "target_emails": target_emails},
            )

            _global_idx = 0
            while True:
                # Enrich all unprocessed companies in the current pool
                pending = [c for c in _company_pool if c.get("company_key") not in _processed_keys]
                for target in pending:
                    if is_india and _valid_email_count >= target_emails:
                        break
                    _global_idx += 1
                    _processed_keys.add(str(target.get("company_key") or ""))
                    _enrich_company(target, _global_idx, len(_company_pool))

                # Check whether we need more companies (India only)
                if not is_india or _valid_email_count >= target_emails:
                    break
                if _refetch_count >= _INDIA_MAX_REFETCHES:
                    logger.info(
                        "India fetch ceiling reached (%d refetches). "
                        "Stopping with %d/%d emails.",
                        _refetch_count, _valid_email_count, target_emails,
                    )
                    break

                # Top-up: fetch more jobs from Apify, extract new companies
                _refetch_count += 1
                _refetch_per_actor = _math.ceil(_INDIA_REFETCH_JOBS / _n_india_actors)
                _pipeline_stage_event(
                    run_id, "job_search", "in_progress",
                    f"Email target not met ({_valid_email_count}/{target_emails}). "
                    f"Fetching {_INDIA_REFETCH_JOBS} more jobs (top-up #{_refetch_count})...",
                    counts={"emails_found": _valid_email_count, "target_emails": target_emails},
                )
                try:
                    _new_jobs = _do_job_search(
                        _refetch_per_actor,
                        f"top-up #{_refetch_count}",
                    )
                except _JobSearchError:
                    logger.warning("Top-up fetch #%d failed — stopping.", _refetch_count)
                    break

                all_jobs = list({
                    str(j.get("job_key") or j.get("listing_url") or j.get("url") or id(j)): j
                    for j in [*all_jobs, *_new_jobs]
                }.values())

                _new_companies = _extract_company_targets(_new_jobs)
                _new_unique = [
                    c for c in _new_companies
                    if c.get("company_key") not in _processed_keys
                ]
                if not _new_unique:
                    logger.info("Top-up #%d returned no new companies — stopping.", _refetch_count)
                    break
                _company_pool.extend(_new_unique)
                _pipeline_stage_event(
                    run_id, "company_extraction", "in_progress",
                    f"Top-up #{_refetch_count}: {len(_new_unique)} new companies added to pool "
                    f"(pool now {len(_company_pool)})",
                    counts={"new_companies": len(_new_unique), "pool_size": len(_company_pool)},
                )

            _pipeline_stage_event(
                run_id, "people_discovery", "done",
                f"Enrichment complete — {len(_processed_keys)} companies processed",
                counts={"companies_done": len(_processed_keys), "companies_total": len(_company_pool)},
            )
            _pipeline_stage_event(
                run_id, "icp_selection", "done",
                f"{len(all_icps)} ICPs selected, {_valid_email_count} with valid emails "
                f"({'target met' if _valid_email_count >= target_emails else 'below target — exhausted pool'})",
                counts={"icps_total": len(all_icps), "emails_found": _valid_email_count,
                        "target_emails": target_emails, "companies": len(_processed_keys)},
            )

        # ── Stage 5: Email Enrichment (already done via bulk_match in Stage 3) ─
        _pipeline_stage_event(
            run_id, "email_enrichment", "done",
            f"Emails enriched for {len(all_icps)} ICPs (via Apollo bulk match in Stage 3)",
            counts={"icps_with_email": sum(1 for icp in all_icps if icp.get("email"))},
        )

        # ── Stage 6: Email Generation ────────────────────────────────────────
        outreach_results: list[dict[str, Any]] = []
        if auto_email and all_icps:
            openai_api_key = os.getenv("OPENAI_API_KEY")

            # Contact-level dedup: skip ICPs already in outreach_log
            icps_to_generate = all_icps
            if automation_context:
                contacted_contact_keys = schedule_store.get_contacted_contact_keys()
                before_icp_count = len(icps_to_generate)
                filtered_icps = []
                for icp in icps_to_generate:
                    company_key = str(icp.get("_company_key") or icp.get("organization_domain") or "").lower()
                    person_id = str(icp.get("apollo_person_id") or "").strip()
                    email_addr = str(icp.get("email") or "").strip().lower()
                    name = str(icp.get("name") or "").strip().lower()
                    title = str(icp.get("title") or "").strip().lower()
                    if person_id:
                        ckey = f"apollo:{person_id}"
                    elif email_addr:
                        ckey = f"email:{email_addr}"
                    else:
                        ckey = f"{company_key}|{name}|{title}"
                    if ckey not in contacted_contact_keys:
                        filtered_icps.append(icp)
                _contacts_skipped_dedup = before_icp_count - len(filtered_icps)
                icps_to_generate = filtered_icps
                if _contacts_skipped_dedup:
                    logger.info("Automation dedup: skipped %d already-contacted ICPs", _contacts_skipped_dedup)

            _pipeline_stage_event(
                run_id, "email_generation", "in_progress",
                f"Generating emails for {len(icps_to_generate)} ICPs...",
                counts={"icps_total": len(icps_to_generate), "generated": 0},
            )
            # Find the example job for each ICP based on company
            jobs_by_company: dict[str, dict[str, Any]] = {}
            for job in all_jobs:
                key = str(job.get("company_slug") or job.get("domain_derived") or job.get("organization") or "").lower()
                if key and key not in jobs_by_company:
                    jobs_by_company[key] = job

            for icp in icps_to_generate:
                company_key = str(icp.get("_company_key") or icp.get("_company_domain") or "").lower()
                example_job = jobs_by_company.get(company_key) or {}
                result = generate_job_outreach(
                    job={
                        **example_job,
                        "organization": icp.get("_company_name") or example_job.get("organization"),
                        "domain_derived": icp.get("_company_domain") or icp.get("organization_domain"),
                    },
                    contact=icp,
                    openai_api_key=openai_api_key,
                )
                result["_icp"] = icp
                outreach_results.append(result)
                # Persist to DB so Jobs page can show emails
                email_data = result.get("email") or {}
                subjects = email_data.get("subject_options") or []
                job_store.upsert_outreach_email(
                    company_key=company_key,
                    contact_email=icp.get("email"),
                    apollo_person_id=icp.get("apollo_person_id"),
                    contact_name=icp.get("name"),
                    contact_title=icp.get("title"),
                    subject_1=subjects[0] if subjects else None,
                    subject_2=subjects[1] if len(subjects) > 1 else None,
                    body=email_data.get("full_email_text"),
                    qa_status=(result.get("qa") or {}).get("qa_status"),
                    approved=bool((result.get("qa") or {}).get("approved_for_export")),
                    pipeline_run_id=run_id,
                )
                _pipeline_stage_event(
                    run_id, "email_generation", "in_progress",
                    f"Generating emails... {len(outreach_results)}/{len(icps_to_generate)} done",
                    counts={"icps_total": len(icps_to_generate), "generated": len(outreach_results)},
                )

            approved_count = sum(1 for r in outreach_results if r.get("qa", {}).get("approved_for_export"))
            # Attach generated emails to per-company details
            for r in outreach_results:
                icp = r.get("_icp") or {}
                ckey = str(icp.get("_company_key") or "")
                if ckey and ckey in company_details_map:
                    email_data = r.get("email") or {}
                    subjects = email_data.get("subject_options") or []
                    company_details_map[ckey]["emails"].append({
                        "name": icp.get("name"),
                        "title": icp.get("title"),
                        "email": icp.get("email"),
                        "subject_1": subjects[0] if subjects else "",
                        "subject_2": subjects[1] if len(subjects) > 1 else "",
                        "body": email_data.get("full_email_text") or "",
                        "qa_status": (r.get("qa") or {}).get("qa_status"),
                        "approved": bool((r.get("qa") or {}).get("approved_for_export")),
                    })
            _update_pipeline_run(run_id, company_details=list(company_details_map.values()))
            _pipeline_stage_event(
                run_id, "email_generation", "done",
                f"{approved_count}/{len(outreach_results)} emails generated and approved",
                counts={"generated": len(outreach_results), "approved": approved_count},
            )
        else:
            _pipeline_stage_event(run_id, "email_generation", "skipped", "Email generation skipped (auto_email=False or no ICPs).")

        # ── Stage 7: Instantly Send ──────────────────────────────────────────
        send_result: dict[str, Any] = {}
        if auto_send and outreach_results:
            instantly_api_key = os.getenv("INSTANTLY_API_KEY")
            if not instantly_api_key:
                _pipeline_stage_event(run_id, "instantly_send", "skipped", "INSTANTLY_API_KEY not configured — skipping Instantly send.")
            elif not campaign_id:
                _pipeline_stage_event(run_id, "instantly_send", "skipped", "No campaign_id configured — skipping Instantly send.")
            else:
                _pipeline_stage_event(run_id, "instantly_send", "in_progress", "Sending approved leads to Instantly...")
                leads_to_send = [
                    r["instantly_payload"]
                    for r in outreach_results
                    if r.get("qa", {}).get("approved_for_export") and r.get("instantly_payload")
                ]
                send_result = send_leads_to_instantly(leads_to_send, campaign_id, instantly_api_key)
                if send_result.get("status") == "sent":
                    _pipeline_stage_event(
                        run_id, "instantly_send", "done",
                        f"Sent {send_result.get('sent_count', 0)} leads to Instantly campaign",
                        counts={"sent": send_result.get("sent_count", 0)},
                    )
                    # Write outreach_log for dedup in future runs
                    sent_icps = [
                        r["_icp"]
                        for r in outreach_results
                        if r.get("qa", {}).get("approved_for_export") and r.get("instantly_payload") and "_icp" in r
                    ]
                    if sent_icps:
                        schedule_store.log_outreach(
                            sent_icps,
                            schedule_id=_schedule_id,
                            run_history_id=_run_history_id,
                            pipeline_run_id=run_id,
                            campaign_id=campaign_id or None,
                        )
                else:
                    _pipeline_stage_event(
                        run_id, "instantly_send", "error",
                        f"Instantly send failed: {send_result.get('error', 'Unknown error')}",
                    )
        else:
            _pipeline_stage_event(run_id, "instantly_send", "skipped", "Auto-send disabled or no approved emails.")

        pipeline_summary = {
            "jobs_found": len(all_jobs),
            "companies": len(company_targets),
            "icps": len(all_icps),
            "emails_generated": len(outreach_results),
            "emails_approved": sum(1 for r in outreach_results if r.get("qa", {}).get("approved_for_export")),
            "leads_sent": send_result.get("sent_count", 0),
        }
        _update_pipeline_run(
            run_id,
            status="completed",
            message=f"Pipeline complete: {len(all_jobs)} jobs → {len(company_targets)} companies → {len(all_icps)} ICPs → {send_result.get('sent_count', 0)} leads sent",
            summary=pipeline_summary,
            outreach_results=[
                {
                    "icp_name": r.get("contact", {}).get("name"),
                    "icp_title": r.get("contact", {}).get("title"),
                    "icp_email": r.get("contact", {}).get("email"),
                    "company": r.get("contact", {}).get("_company_name") or r["_icp"].get("_company_name") if "_icp" in r else None,
                    "status": r.get("status"),
                    "qa_status": r.get("qa", {}).get("qa_status"),
                    "subject_1": (r.get("email") or {}).get("subject_options", [""])[0],
                    "email_preview": ((r.get("email") or {}).get("full_email_text") or "")[:300],
                }
                for r in outreach_results
            ],
        )
        if _run_history_id:
            schedule_store.complete_run_history(
                _run_history_id, "completed",
                summary=pipeline_summary,
                companies_skipped_dedup=_companies_skipped_dedup,
                contacts_skipped_dedup=_contacts_skipped_dedup,
            )
            schedule_store.update_after_run(_schedule_id, "completed", _run_history_id)

    except Exception as exc:
        logger.error("Pipeline run %s failed: %s", run_id, exc, exc_info=True)
        _update_pipeline_run(run_id, status="failed", error=str(exc))
        if _run_history_id:
            schedule_store.complete_run_history(_run_history_id, "failed", error_message=str(exc))
            schedule_store.update_after_run(_schedule_id, "failed", _run_history_id)


@app.post("/api/pipeline/run")
async def start_pipeline_run(request: PipelineRunRequest, background_tasks: BackgroundTasks):
    """Start a full demand generation pipeline run.

    Orchestrates: Job Search → Company Extraction → People Discovery →
    ICP Selection → Email Enrichment → Email Generation → Instantly Send.

    Returns a run_id immediately. Poll GET /api/pipeline/status/{run_id} for progress.
    Existing individual endpoints (/api/jobs, /api/jobs/enrich, etc.) remain fully functional.
    """
    run_id = str(uuid.uuid4())
    request_data = {
        "role": request.role,
        "location": request.location,
        "date_filter": request.date_filter,
        "market": request.market,
        "job_type": request.job_type or "all",
        "sources": request.sources,
        "auto_icp": request.auto_icp,
        "auto_email": request.auto_email,
        "auto_send": request.auto_send,
        "max_companies": request.max_companies,
        "max_icps_per_company": request.max_icps_per_company,
        "campaign_id": request.campaign_id or os.getenv("INSTANTLY_CAMPAIGN_ID", ""),
        "titles": request.titles,
    }

    _update_pipeline_run(
        run_id,
        status="queued",
        request=request_data,
        current_stage=None,
        current_stage_status=None,
        events=[],
        summary=None,
        outreach_results=[],
        created_at=int(time.time() * 1000),
    )

    background_tasks.add_task(_run_pipeline, run_id, request_data)

    return {
        "run_id": run_id,
        "status": "queued",
        "message": f"Pipeline run started for '{request.role}' in {request.location} ({request.market.upper()} market)",
        "stages": PIPELINE_STAGES,
        "poll_url": f"/api/pipeline/status/{run_id}",
    }


@app.get("/api/pipeline/status/{run_id}")
async def get_pipeline_status(run_id: str):
    """Poll for the status of a pipeline run.

    Returns current stage, all events so far, and the final summary when complete.
    """
    run = pipeline_runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    return run


@app.get("/api/pipeline/runs")
async def list_pipeline_runs(limit: int = 20):
    """List recent pipeline runs, newest first."""
    runs = sorted(
        pipeline_runs.values(),
        key=lambda r: r.get("created_at") or 0,
        reverse=True,
    )[:limit]
    return {"runs": [{"run_id": r.get("run_id"), "status": r.get("status"), "request": r.get("request"), "created_at": r.get("created_at"), "summary": r.get("summary")} for r in runs]}


# ──────────────────────────────────────────────────────────────────────────────
# Automation Schedules API
# ──────────────────────────────────────────────────────────────────────────────

class AutomationScheduleCreate(BaseModel):
    name: str
    role: str
    location: str
    date_filter: str = "7d"
    market: str = "us"
    job_type: str | None = "all"
    sources: List[str] | None = None
    max_companies: int = 20
    max_icps_per_company: int = 5
    campaign_id: str | None = None
    titles: List[str] | None = None
    auto_icp: bool = True
    auto_email: bool = True
    auto_send: bool = True
    interval_minutes: int = 360
    cron_expr: str | None = None
    skip_contacted_companies: bool = True
    dedup_lookback_days: int = 90


@app.post("/api/automations")
async def create_automation(request: AutomationScheduleCreate):
    """Create a new automation schedule."""
    data = request.model_dump()
    schedule = schedule_store.create_schedule(data)
    return schedule


@app.get("/api/automations")
async def list_automations():
    """List all automation schedules with enriched next_run/last_run info."""
    schedules = schedule_store.list_schedules()
    return {"schedules": schedules}


@app.get("/api/automations/{schedule_id}")
async def get_automation(schedule_id: str):
    schedule = schedule_store.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@app.put("/api/automations/{schedule_id}")
async def update_automation(schedule_id: str, request: AutomationScheduleCreate):
    updated = schedule_store.update_schedule(schedule_id, request.model_dump())
    if not updated:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return updated


@app.delete("/api/automations/{schedule_id}")
async def delete_automation(schedule_id: str):
    deleted = schedule_store.delete_schedule(schedule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"deleted": True, "schedule_id": schedule_id}


@app.post("/api/automations/{schedule_id}/pause")
async def pause_automation(schedule_id: str):
    updated = schedule_store.pause_schedule(schedule_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return updated


@app.post("/api/automations/{schedule_id}/resume")
async def resume_automation(schedule_id: str):
    updated = schedule_store.resume_schedule(schedule_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return updated


@app.post("/api/automations/{schedule_id}/trigger")
async def trigger_automation_now(schedule_id: str):
    """Force a schedule to fire on the next poller tick (within 30s)."""
    schedule = schedule_store.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    schedule_store.trigger_now(schedule_id)
    return {"triggered": True, "schedule_id": schedule_id, "message": "Schedule will fire within 30 seconds"}


@app.get("/api/automations/{schedule_id}/history")
async def get_automation_history(schedule_id: str, limit: int = 50):
    schedule = schedule_store.get_schedule(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    history = schedule_store.list_run_history(schedule_id, limit=limit)
    return {"schedule_id": schedule_id, "history": history}


@app.get("/api/automations/runs/{run_history_id}")
async def get_automation_run(run_history_id: str):
    entry = schedule_store.get_run_history_entry(run_history_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Run history entry not found")
    # Also attach live pipeline events if still in memory
    pipeline_run = pipeline_runs.get(entry.get("pipeline_run_id", ""))
    return {**entry, "pipeline_events": (pipeline_run or {}).get("events", [])}


# ──────────────────────────────────────────────────────────────────────────────
# Outreach Log API
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/outreach-log")
async def get_outreach_log(
    company_key: str | None = None,
    schedule_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    entries = schedule_store.list_outreach_log(
        company_key=company_key,
        schedule_id=schedule_id,
        limit=limit,
        offset=offset,
    )
    return {"entries": entries, "count": len(entries)}


@app.delete("/api/outreach-log/{log_id}")
async def delete_outreach_log_entry(log_id: str):
    deleted = schedule_store.delete_outreach_log_entry(log_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Outreach log entry not found")
    return {"deleted": True, "log_id": log_id}


# ──────────────────────────────────────────────────────────────────────────────
# Test Console endpoints — individual stage testing
# ──────────────────────────────────────────────────────────────────────────────

class TestExtractCompaniesRequest(BaseModel):
    jobs: List[Dict[str, Any]]


class TestIcpSelectRequest(BaseModel):
    people: List[Dict[str, Any]]
    role: str
    company_name: str = ""


class TestEnrichContactsRequest(BaseModel):
    people: List[Dict[str, Any]]


class TestGenerateEmailRequest(BaseModel):
    job: Dict[str, Any]
    contact: Dict[str, Any]


class TestInstantlySendRequest(BaseModel):
    leads: List[Dict[str, Any]]
    campaign_id: str = ""


@app.post("/api/test/extract-companies")
async def test_extract_companies(request: TestExtractCompaniesRequest):
    """Extract unique company targets from a list of jobs."""
    companies: dict[str, dict] = {}
    for job in request.jobs:
        company_name = str(
            job.get("company_name")
            or job.get("company")
            or job.get("organization")
            or ""
        ).strip()
        company_domain = _normalize_company_domain(
            job.get("company_domain")
            or job.get("domain")
            or job.get("domain_derived")
        )
        company_linkedin_url = str(
            job.get("company_linkedin_url")
            or job.get("organization_url")
            or ""
        ).strip()
        key = str(company_domain or job.get("company_slug") or company_name).strip().lower()
        if not key:
            continue
        if key not in companies:
            companies[key] = {
                "company_key": key,
                "company_name": company_name,
                "company_domain": company_domain,
                "company_linkedin_url": company_linkedin_url,
                "job_count": 0,
                "roles": [],
                "sources": [],
                "sample_job_id": job.get("id") or job.get("job_id") or "",
            }
        entry = companies[key]
        entry["job_count"] += 1
        role = job.get("job_title") or job.get("title") or ""
        if role and role not in entry["roles"]:
            entry["roles"].append(role)
        source = job.get("source") or ""
        if source and source not in entry["sources"]:
            entry["sources"].append(source)

    result = sorted(companies.values(), key=lambda c: -c["job_count"])
    return {
        "companies": result,
        "total": len(result),
        "input_jobs": len(request.jobs),
    }


@app.post("/api/test/icp-select")
async def test_icp_select(request: TestIcpSelectRequest):
    """Use OpenAI to shortlist top 3 ICPs from a list of Apollo people records."""
    import openai as _openai

    openai_api_key = os.getenv("OPENAI_API_KEY", "")
    model = os.getenv("OPENAI_JOB_AGENT_MODEL", "gpt-4.1-mini")

    if not openai_api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")
    if not request.people:
        raise HTTPException(status_code=400, detail="No people provided")

    # Build a compact people list for the prompt
    people_lines = []
    for i, p in enumerate(request.people):
        name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() or p.get("name", f"Person {i+1}")
        title = p.get("title") or p.get("job_title") or "Unknown Title"
        dept = p.get("department") or p.get("departments") or ""
        if isinstance(dept, list):
            dept = dept[0] if dept else ""
        seniority = p.get("seniority") or ""
        people_lines.append(f"  {i+1}. {name} — {title}" + (f" ({dept}, {seniority})" if dept or seniority else ""))

    people_block = "\n".join(people_lines)
    people_count = len(request.people)
    role_context = f"The hiring role is: **{request.role}**" if request.role else "No specific role context."
    company_context = f"Company: **{request.company_name}**" if request.company_name else ""

    # Derive company size signal from how many employees Apollo returned
    if people_count <= 10:
        size_band = "very small (startup / seed-stage)"
        size_guidance = (
            "With so few employees visible, this is likely a small startup. "
            "The CEO, Co-Founder, or CTO almost certainly owns hiring decisions directly — prioritise them. "
            "A dedicated Head of Talent is unlikely to exist; skip generic 'Recruiter' titles."
        )
    elif people_count <= 30:
        size_band = "small (Series A–B)"
        size_guidance = (
            "This is a small but growing company. The VP or Director of the function being hired into "
            "is usually the hiring manager and budget owner. Head of Talent / Talent Acquisition Lead "
            "is a strong secondary contact. Avoid C-suite unless no functional leader is present."
        )
    elif people_count <= 75:
        size_band = "mid-size (Series C or established SMB)"
        size_guidance = (
            "Mid-size company — there will be a dedicated recruiting function. "
            "Prioritise Head of Talent or Talent Acquisition Manager as the primary champion, "
            "paired with the VP/Director of the function hiring (they approve the vendor). "
            "C-suite is too far removed unless no other option exists."
        )
    else:
        size_band = "large / enterprise"
        size_guidance = (
            "Large company with a mature talent org. "
            "The Talent Acquisition Lead or Senior Recruiter responsible for the specific function is the primary ICP — "
            "they run the vendor evaluation. The VP/Director of the hiring function is a secondary stakeholder. "
            "Avoid C-suite entirely; they delegate hiring vendor decisions."
        )

    # Derive which functional leader to prioritise based on the hiring role
    role_lower = (request.role or "").lower()
    if any(kw in role_lower for kw in ["engineer", "developer", "software", "backend", "frontend", "devops", "sre"]):
        functional_leader = "VP Engineering, Head of Engineering, CTO, or Engineering Director"
    elif any(kw in role_lower for kw in ["product", "pm ", "product manager"]):
        functional_leader = "VP Product, Head of Product, CPO, or Product Director"
    elif any(kw in role_lower for kw in ["design", "ux", "ui"]):
        functional_leader = "VP Design, Head of Design, or Design Director"
    elif any(kw in role_lower for kw in ["data", "analytics", "ml", "machine learning", "ai"]):
        functional_leader = "VP Data, Head of Analytics, Chief Data Officer, or Data Director"
    elif any(kw in role_lower for kw in ["marketing", "growth", "seo", "content"]):
        functional_leader = "CMO, VP Marketing, or Head of Marketing"
    elif any(kw in role_lower for kw in ["sales", "account", "revenue", "business development"]):
        functional_leader = "CRO, VP Sales, Head of Sales, or Sales Director"
    elif any(kw in role_lower for kw in ["finance", "accounting", "financial"]):
        functional_leader = "CFO, VP Finance, or Head of Finance"
    elif any(kw in role_lower for kw in ["operations", "ops", "strategy"]):
        functional_leader = "COO, VP Operations, or Head of Operations"
    else:
        functional_leader = "the relevant VP, Director, or Head of the function being hired into"

    system_prompt = (
        "You are an expert B2B sales strategist for EMB TalentOS, a talent-as-a-service platform. "
        "EMB provides on-demand technical and business talent to companies. "
        "Your task: given a list of employees at a company, the role they are actively hiring for, "
        "and signals about company size, identify the top 3 people most likely to be the "
        "decision-maker or champion for purchasing EMB's talent services. "
        "Use the company size and role context to adjust who you pick — the right ICP at a 10-person "
        "startup is very different from the right ICP at a 500-person enterprise. "
        "Return ONLY valid JSON, no markdown fences."
    )

    user_prompt = (
        f"{company_context}\n"
        f"{role_context}\n"
        f"Estimated company size: **{size_band}** ({people_count} employees visible in Apollo)\n"
        f"Functional leader to prioritise for this role: {functional_leader}\n\n"
        f"Size-based guidance:\n{size_guidance}\n\n"
        f"Employees at this company ({people_count} total):\n{people_block}\n\n"
        "Return JSON with this exact shape:\n"
        "{\n"
        '  "top_3": [\n'
        '    {"index": 1, "name": "...", "title": "...", "reason": "one sentence why they are the best ICP for this role and company size"},\n'
        '    ...\n'
        "  ],\n"
        '  "excluded_count": <number of people not in top 3>,\n'
        '  "reasoning_summary": "2-3 sentences covering role fit, company size signal, and why these 3 beat the rest"\n'
        "}"
    )

    client = _openai.AsyncOpenAI(api_key=openai_api_key)
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        max_tokens=600,
    )

    raw = response.choices[0].message.content or ""
    # Strip any accidental markdown fences
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip().rstrip("```").strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"OpenAI returned non-JSON response: {raw[:300]}")

    usage = response.usage
    cost_usd = round((usage.prompt_tokens * 0.0000004) + (usage.completion_tokens * 0.0000016), 5) if usage else 0

    return {
        "top_3": parsed.get("top_3", []),
        "excluded_count": parsed.get("excluded_count", max(0, len(request.people) - 3)),
        "reasoning_summary": parsed.get("reasoning_summary", ""),
        "input_people_count": len(request.people),
        "model": model,
        "tokens_used": {"prompt": usage.prompt_tokens, "completion": usage.completion_tokens} if usage else {},
        "estimated_cost_usd": cost_usd,
    }


@app.post("/api/test/enrich-contacts")
async def test_enrich_contacts(request: TestEnrichContactsRequest):
    """Bulk-enrich a shortlist of Apollo people to reveal verified email addresses."""
    api_key = os.getenv("APOLLO_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="APOLLO_API_KEY is not configured")
    if not request.people:
        raise HTTPException(status_code=400, detail="No people provided")

    try:
        # ── Per-person email cache check ─────────────────────────────────────
        contacts: list[dict[str, Any]] = []
        people_to_enrich: list[dict[str, Any]] = []
        cache_hits: list[str] = []

        for person in request.people:
            cached = job_store.get_fresh_email_for_person(
                apollo_person_id=person.get("apollo_person_id") or person.get("id"),
                linkedin_url=person.get("linkedin_url"),
                name=person.get("name") or f"{person.get('first_name', '')} {person.get('last_name', '')}".strip(),
                organization_domain=person.get("organization_domain"),
                max_age_days=_CACHE_DAYS,
            )
            if cached and cached.get("email"):
                contacts.append({**cached, "_from_cache": True})
                cache_hits.append(str(person.get("name") or person.get("first_name") or "unknown"))
            else:
                people_to_enrich.append(person)

        # ── Enrich only the uncached people ──────────────────────────────────
        newly_enriched: list[dict[str, Any]] = []
        if people_to_enrich:
            matches = build_bulk_match_payload(people_to_enrich)
            if matches:
                raw_enriched = await asyncio.to_thread(enrich_people, api_key, matches)
                for person in (raw_enriched if isinstance(raw_enriched, list) else []):
                    normalized = normalize_company_person(person)
                    if normalized.get("email"):
                        newly_enriched.append(normalized)

                # ── Persist newly enriched contacts to cache ─────────────────
                from apollo_leads import normalize_domain as _nd
                company_groups: dict[str, list[dict[str, Any]]] = {}
                for contact in newly_enriched:
                    ck = _nd(str(contact.get("organization_domain") or "")) or "unknown"
                    company_groups.setdefault(ck, []).append(contact)

                for ck, group in company_groups.items():
                    job_store.upsert_company_contacts(
                        company_key=ck,
                        company_name=None,
                        company_domain=ck,
                        contacts=group,
                        confidence="email_enrichment",
                    )

        contacts.extend(newly_enriched)
        response: dict[str, Any] = {
            "contacts": contacts,
            "enriched_count": len(contacts),
            "input_count": len(request.people),
            "no_email_count": len(people_to_enrich) - len(newly_enriched),
        }
        if cache_hits:
            response["cache_hits"] = cache_hits
            response["cache_note"] = (
                f"{len(cache_hits)} contact(s) served from cache "
                f"(email < {_CACHE_DAYS} days old): {', '.join(cache_hits)}"
            )
        return response

    except Exception as exc:
        logger.error("Contact enrichment failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/test/generate-email")
async def test_generate_email(request: TestGenerateEmailRequest):
    """Generate outreach email for a single job + contact pair."""
    openai_api_key = os.getenv("OPENAI_API_KEY", "")
    if not openai_api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")

    result = await asyncio.to_thread(generate_job_outreach, request.job, request.contact, openai_api_key)
    return result


@app.post("/api/test/instantly-send")
async def test_instantly_send(request: TestInstantlySendRequest):
    """Send a list of leads to an Instantly campaign. WARNING: actually delivers to Instantly."""
    api_key = os.getenv("INSTANTLY_API_KEY", "")
    campaign_id = request.campaign_id or os.getenv("INSTANTLY_CAMPAIGN_ID", "")

    if not api_key:
        raise HTTPException(status_code=400, detail="INSTANTLY_API_KEY not configured")
    if not campaign_id:
        raise HTTPException(status_code=400, detail="campaign_id required (or set INSTANTLY_CAMPAIGN_ID)")
    if not request.leads:
        raise HTTPException(status_code=400, detail="No leads provided")

    result = await send_leads_to_instantly(request.leads, campaign_id, api_key)
    return result


@app.get("/api/instantly-analytics")
async def instantly_analytics():
    """Return campaign-level analytics and sending health from Instantly."""
    api_key = os.getenv("INSTANTLY_API_KEY", "")
    campaign_id = os.getenv("INSTANTLY_CAMPAIGN_ID", "")

    if not api_key:
        raise HTTPException(status_code=400, detail="INSTANTLY_API_KEY not configured")
    if not campaign_id:
        raise HTTPException(status_code=400, detail="INSTANTLY_CAMPAIGN_ID not configured")

    analytics, sending_status = await asyncio.gather(
        asyncio.to_thread(get_campaign_analytics, campaign_id, api_key),
        asyncio.to_thread(get_campaign_sending_status, campaign_id, api_key),
    )

    return {
        "campaign_id": campaign_id,
        "analytics": analytics,
        "sending_status": sending_status,
    }
