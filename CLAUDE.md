# CLAUDE.md — Demand Generation Pipeline

## What This Project Is

Automated B2B demand generation pipeline for **EMB TalentOS**. It identifies companies actively hiring (warm signals), enriches them into qualified leads, generates personalized outreach copy, and delivers to Instantly for email sequencing.

**Pipeline stages:**
1. Job signal discovery — Apify scrapes Ashby/Greenhouse/Lever/LinkedIn job boards
2. Company intelligence — Apollo.io enrichment of hiring companies
3. ICP selection — classify people matching ideal customer profiles (GPs, MDs, Operating Partners, Head of Talent, Hiring Managers)
4. Lead enrichment — emails and contact data from Apollo.io
5. Email content generation — AI-generated personalized outbound copy
6. Lead delivery — send enriched leads to Instantly for sequencing

The "customer" is a hiring company. The product being sold is EMB TalentOS.

---

## Tech Stack

- **Backend:** Python FastAPI, SQLite (via SQLAlchemy), async/await throughout
- **Frontend:** NextJS 14 (React 18, Tailwind) or static HTML/CSS/JS
- **LLMs:** OpenAI (primary), LiteLLM for multi-provider support (Anthropic, Gemini, Ollama, etc.)
- **Research:** GPT Researcher framework (Tavily, web scraping, ArXiv)
- **Agents:** LangGraph (multi-agent), AG2/AutoGen (alternative)
- **Integrations:** Apify, Apollo.io, Instantly.ai, Discord, Tavily
- **Infra:** Docker Compose, Terraform

---

## Key Files

| File | Purpose |
|------|---------|
| `main.py` | Entry point — starts uvicorn on port 8000 |
| `backend/server/app.py` | FastAPI app with all pipeline endpoints |
| `services/job_search_agent.py` | Job aggregation via Apify (Ashby/Greenhouse/Lever/LinkedIn/Naukri/Indeed) |
| `backend/apollo_leads.py` | Apollo.io lead enrichment + ICP role classification |
| `backend/email_generation.py` | AI-generated outreach email copy |
| `backend/instantly_service.py` | Instantly.ai bulk email delivery |
| `backend/community/community_search.py` | Discord channel scanning for hiring signals |
| `gpt_researcher/agent.py` | Core research orchestration |
| `data/companies.sqlite3` | Company data persistence |
| `data/jobs.sqlite3` | Job listings persistence |

---

## Running the Project

**Backend:**
```bash
python main.py
# or
python -m uvicorn main:app --reload
# Runs on localhost:8000
```

**Frontend (NextJS):**
```bash
cd frontend/nextjs
npm install --legacy-peer-deps
npm run dev
# Runs on localhost:3000
```

**Docker (full stack):**
```bash
docker-compose up --build
```

**CLI research:**
```bash
python cli.py "query" --report_type detailed_report --tone objective
```

**Tests:**
```bash
pytest tests/report-types.py
```

---

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

```bash
# LLM
OPENAI_API_KEY=
OPENAI_JOB_AGENT_MODEL=gpt-4.1-mini
OPENAI_OUTREACH_MODEL=gpt-4.1-mini

# Job scraping (Apify actors)
APIFY_API_TOKEN=
APIFY_LEVER_ACTOR_ID=jobo.world~lever-jobs-search
APIFY_LINKEDIN_ACTOR_ID=bebity~linkedin-jobs-scraper

# Lead enrichment
APOLLO_API_KEY=

# Email delivery
INSTANTLY_API_KEY=
INSTANTLY_CAMPAIGN_ID=

# Data paths
REPORT_STORE_PATH=data/reports.json
COMPANY_STORE_DB_PATH=data/companies.sqlite3
JOBS_DB_PATH=data/jobs.sqlite3

# Community signals (Discord)
DISCORD_BOT_TOKEN=
DISCORD_CHANNEL_IDS=[]
DISCORD_LOOKBACK_HOURS=168

# Frontend
NEXT_PUBLIC_GPTR_API_URL=http://localhost:8000

# Observability
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=
LANGCHAIN_PROJECT=gpt-researcher
```

---

## API Endpoints

All served from `backend/server/app.py`:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/research` | Run research task |
| `POST /api/chat` | Conversational research refinement |
| `POST /api/job-search` | Trigger job signal discovery |
| `POST /api/apollo-leads` | Run Apollo lead enrichment + ICP selection |
| `POST /api/instantly-send` | Deliver leads to Instantly campaign |
| `POST /api/community/search` | Scan Discord for hiring signals |

Real-time progress is streamed via WebSocket from `backend/websocket_manager.py`.

---

## Architecture

```
Frontend (localhost:3000)
    │ WebSocket + REST
    ▼
FastAPI Backend (localhost:8000)
    ├── GPT Researcher (research orchestration)
    ├── Multi-Agent System (LangGraph)
    └── Services
          ├── Job Search (Apify)
          ├── Lead Enrichment (Apollo.io)
          ├── Email Generation (OpenAI)
          └── Outreach Delivery (Instantly.ai)
```

---

## Important Context

- **ICP roles to target:** GPs, MDs, Operating Partners, Head of Talent, Hiring Managers at companies posting jobs — these are warm signals for EMB TalentOS
- **Markets:** US (Ashby, Greenhouse, Lever) and India (LinkedIn, Naukri, Indeed) job boards
- **Data is local:** SQLite for jobs and companies, JSON for research reports — no external DB
- **Async everywhere:** FastAPI backend is fully async; maintain this pattern when adding endpoints
- **Multi-LLM:** Use LiteLLM for any new LLM calls to stay provider-agnostic
- **apify-client/**: Standalone subproject for Apify integration — has its own `.gitignore` and dependencies
