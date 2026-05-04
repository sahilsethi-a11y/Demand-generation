"""Email generation for outbound hiring outreach.

Generates personalized outbound emails for each ICP contact based on the specific
job found at their company. Mirrors the TypeScript jobOutreach.ts logic but in Python,
with richer job-context in the prompt.
"""

import json
import re
import uuid
from typing import Optional
import requests

OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
DEFAULT_OUTREACH_MODEL = "gpt-4.1-mini"

BANNED_PHRASES = [
    "guarantee",
    "world-class",
    "best-in-class",
    "we know you're scaling",
    "noticed you raised",
    "cutting-edge",
    "top-tier",
]

EMB_CONTEXT = {
    "company_name": "EMB Global",
    "platform_url": "https://embtalent.ai",
    "positioning": "tech agency providing resource augmentation (RA) services",
    "funding": "Series A funded",
    "value_points": [
        "Project-ready talent who can deliver from day one with accelerated onboarding",
        "All-in-one talent pool across frontend, backend, AI, and specialist technical roles",
        "AI talent platform (embtalent.ai) for real-time visibility into tasks, timesheets, and output",
    ],
}


def detect_role_family(job_title: Optional[str]) -> str:
    title = (job_title or "").lower()
    if any(kw in title for kw in ["engineer", "developer", "backend", "frontend", "fullstack", "devops", "sre", "software", "cloud"]):
        return "engineering"
    if any(kw in title for kw in ["product manager", "product owner", "product lead", "head of product"]):
        return "product"
    if any(kw in title for kw in ["design", "ux", "ui", "user experience"]):
        return "design"
    if any(kw in title for kw in ["marketing", "growth", "seo", "content", "brand"]):
        return "marketing"
    if any(kw in title for kw in ["sales", "account executive", "account manager", "revenue", "business development"]):
        return "sales"
    if any(kw in title for kw in ["data", "analytics", "analyst", "machine learning", "ml", "ai scientist"]):
        return "data"
    if any(kw in title for kw in ["talent", "recruiter", "recruiting", "hr ", "human resources", "people"]):
        return "people"
    if any(kw in title for kw in ["finance", "accounting", "controller", "financial"]):
        return "finance"
    if any(kw in title for kw in ["operations", "ops", "chief of staff", "strategy"]):
        return "operations"
    return "general"


def detect_seniority(job_title: Optional[str]) -> str:
    title = (job_title or "").lower()
    if "intern" in title:
        return "intern"
    if any(kw in title for kw in ["senior", "sr ", "staff", "principal", "lead", "manager", "director", "head", "vp", "chief"]):
        return "senior"
    return "mid"


def _has_valid_email(email: Optional[str]) -> bool:
    if not email:
        return False
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email.strip()))


def _normalize(value) -> str:
    return str(value or "").strip()


def _fallback_email(job: dict, contact: dict, signals: dict) -> dict:
    company = _normalize(job.get("organization")) or "your company"
    role = _normalize(job.get("title")) or "this role"
    first_name = _normalize(contact.get("name")).split()[0] if contact.get("name") else "there"
    subject_1 = f"Re: Your {role} search"
    subject_2 = f"Helping {company} hire for {role}"
    body = (
        f"Hi {first_name},\n\n"
        f"Saw {company} is hiring for {role}. EMB Global helps teams fill exactly this kind of role — "
        f"project-ready talent, fast onboarding, and real-time delivery visibility via embtalent.ai.\n\n"
        f"Worth a 15-min call this week?\n\nBest"
    )
    return {
        "subject_options": [subject_1, subject_2],
        "full_email_text": body,
        "confidence_score": 0.65,
        "facts_used": [company, role, "EMB Global"],
        "warnings": signals.get("warnings", []),
        "generated_by": "fallback",
    }


def generate_email_with_openai(
    job: dict,
    contact: dict,
    signals: dict,
    openai_api_key: str,
    model: str = DEFAULT_OUTREACH_MODEL,
) -> dict:
    """Call OpenAI to generate a personalized outbound email for the ICP contact."""
    facts = {
        "company_name": _normalize(job.get("organization")),
        "company_domain": _normalize(job.get("domain_derived") or job.get("company_key")),
        "job_title_they_are_hiring_for": _normalize(job.get("title")),
        "job_location": _normalize(job.get("display_location") or ""),
        "job_description_summary": _normalize(
            job.get("ai_requirements_summary") or job.get("ai_core_responsibilities") or job.get("description_text") or ""
        )[:800],
        "key_skills": (job.get("ai_key_skills") or [])[:6],
        "contact_first_name": _normalize(contact.get("name")).split()[0] if contact.get("name") else "",
        "contact_full_name": _normalize(contact.get("name")),
        "contact_title": _normalize(contact.get("title")),
        "role_family": signals.get("role_family", "general"),
        "seniority": signals.get("seniority", "mid"),
        "priority": signals.get("priority", "medium"),
    }

    emb_value_points = "\n".join(f"  - {p}" for p in EMB_CONTEXT["value_points"])

    prompt = f"""Return valid JSON only. No markdown, no code blocks.

Write a short outbound hiring email using ONLY the provided facts below.
- Total email body must be under 120 words.
- Subject lines: 2 options, each under 8 words. Reference the specific role being hired.
- Opening: address contact by first name, acknowledge the specific role they're hiring for ({facts['job_title_they_are_hiring_for']}).
- Body: position EMB Global as the solution for this specific role. Use 1-2 value points from the list below. Do not invent facts.
- CTA: single ask — "Worth a 15-min call this week?" or similar low-friction ask.
- Tone: professional, direct, no fluff, commercially sharp.
- Do NOT use any of these phrases: {", ".join(BANNED_PHRASES)}.

EMB Global context:
- Company: {EMB_CONTEXT['company_name']} — {EMB_CONTEXT['positioning']}
- Platform: {EMB_CONTEXT['platform_url']}
- Value points:
{emb_value_points}

Job facts:
{json.dumps(facts, indent=2)}

Return this exact JSON schema:
{{
  "subject_options": ["<subject 1>", "<subject 2>"],
  "full_email_text": "<complete email body including greeting and sign-off>",
  "confidence_score": 0.0,
  "facts_used": ["<fact 1>", "<fact 2>"],
  "warnings": []
}}"""

    try:
        response = requests.post(
            OPENAI_ENDPOINT,
            headers={
                "Authorization": f"Bearer {openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0.2,
                "max_tokens": 500,
                "messages": [
                    {
                        "role": "system",
                        "content": "You generate concise outbound hiring emails. Return valid JSON only, no markdown.",
                    },
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=30,
        )
        if not response.ok:
            return _fallback_email(job, contact, signals)

        data = response.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        if not content:
            return _fallback_email(job, contact, signals)

        # Strip markdown code blocks if present
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
        parsed = json.loads(content)
        return {
            "subject_options": parsed.get("subject_options", ["", ""])[:2],
            "full_email_text": _normalize(parsed.get("full_email_text")),
            "confidence_score": float(parsed.get("confidence_score") or 0),
            "facts_used": [_normalize(f) for f in (parsed.get("facts_used") or []) if f],
            "warnings": [_normalize(w) for w in (parsed.get("warnings") or []) if w],
            "generated_by": "openai",
        }
    except Exception:
        return _fallback_email(job, contact, signals)


def run_qa(contact: dict, email: dict) -> dict:
    """Quality-check the generated email before sending to Instantly."""
    issues = []
    if not _has_valid_email(contact.get("email")):
        issues.append("Contact email is missing or invalid.")
    if not _normalize(contact.get("title")):
        issues.append("Contact title is missing.")
    body = _normalize(email.get("full_email_text"))
    if not body:
        issues.append("Generated email body is empty.")
    if len(body) > 1200 or len(body.split()) > 130:
        issues.append("Email is too long (over 130 words).")
    if re.search(r"\{\{|\}\}|<.*?>|TBD|N\/A", body, re.IGNORECASE):
        issues.append("Email contains unresolved placeholders.")
    body_lower = body.lower()
    for phrase in BANNED_PHRASES:
        if phrase in body_lower:
            issues.append(f"Email contains banned phrase: '{phrase}'.")
    facts_used = email.get("facts_used") or []
    if not facts_used:
        issues.append("No facts cited — email may contain unsupported claims.")

    qa_passed = len(issues) == 0
    return {
        "qa_status": "passed" if qa_passed else "failed",
        "approved_for_export": qa_passed,
        "issues": issues,
    }


def generate_job_outreach(
    job: dict,
    contact: dict,
    openai_api_key: Optional[str] = None,
) -> dict:
    """Generate a complete outreach record for one (job, contact) pair.

    Returns a dict with: contact_selection, signals, email, qa, instantly_payload, status.
    """
    role_family = detect_role_family(job.get("title"))
    seniority = detect_seniority(job.get("title"))

    priority: str
    if seniority == "intern":
        priority = "low"
    elif role_family in ("engineering", "product"):
        priority = "high"
    else:
        priority = "medium"

    warnings = []
    if seniority == "intern":
        warnings.append("Internship or intern-level role — lower priority.")
    if not _normalize(job.get("description_text")):
        warnings.append("Limited job description context available.")

    hiring_signal = (
        f"The company is hiring for {_normalize(job.get('title')) or 'this role'}, "
        f"indicating active {role_family} team-building needs."
    )

    signals = {
        "role_family": role_family,
        "seniority": seniority,
        "priority": priority,
        "hiring_signal_summary": hiring_signal,
        "warnings": warnings,
    }

    if not contact or not _has_valid_email(contact.get("email")):
        return {
            "status": "needs_contact_review",
            "contact": contact,
            "signals": signals,
            "email": None,
            "qa": {
                "qa_status": "failed",
                "approved_for_export": False,
                "issues": ["No valid contact with email available."],
            },
            "instantly_payload": None,
        }

    if openai_api_key:
        email = generate_email_with_openai(job, contact, signals, openai_api_key)
    else:
        email = _fallback_email(job, contact, signals)

    qa = run_qa(contact, email)

    instantly_payload = None
    if qa["approved_for_export"]:
        name_parts = _normalize(contact.get("name")).split()
        first_name = name_parts[0] if name_parts else ""
        subject_options = email.get("subject_options") or ["", ""]
        instantly_payload = {
            "lead_id": _normalize(contact.get("email")) or f"lead-{uuid.uuid4().hex[:8]}",
            "job_id": _normalize(job.get("job_key") or job.get("id") or job.get("title")),
            "to_email": _normalize(contact.get("email")),
            "first_name": first_name,
            "last_name": " ".join(name_parts[1:]) if len(name_parts) > 1 else "",
            "company_name": _normalize(job.get("organization")),
            "company_domain": _normalize(job.get("domain_derived") or job.get("company_key")),
            "contact_title": _normalize(contact.get("title")),
            "job_title": _normalize(job.get("title")),
            "source": _normalize(job.get("source")),
            "priority": priority,
            "subject_1": _normalize(subject_options[0]) if subject_options else "",
            "subject_2": _normalize(subject_options[1]) if len(subject_options) > 1 else "",
            "email_body": _normalize(email.get("full_email_text")),
            "signal_summary": hiring_signal,
            "qa_status": qa["qa_status"],
            "approved_for_export": True,
            "confidence_score": float(email.get("confidence_score") or 0),
        }

    return {
        "status": "ready" if qa["approved_for_export"] else "needs_review",
        "contact": contact,
        "signals": signals,
        "email": email,
        "qa": qa,
        "instantly_payload": instantly_payload,
    }
