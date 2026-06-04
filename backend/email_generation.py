"""Email generation for outbound hiring outreach.

Generates all 3 monthly emails per lead in a single OpenAI call, personalized to the
specific job posting and contact.

Company: EMB Global  |  Product: embtalent.ai (https://embtalent.ai)

A/B test on source placement:
  Sequence A — source appears in the subject line ("re: your [Role] on Greenhouse")
               angle: speed — best candidates leave the market in days
  Sequence B — source appears as the first body line ("Saw your [Role] on LinkedIn.")
               angle: signal over noise — cut screening waste

All 3 emails follow a strict 4-line formula: Hook → Bridge → Proof → CTA

Custom variables sent to Instantly per lead:
  subject_m1 / body_m1  — Month 1 cold intro
  subject_m2 / body_m2  — Month 2 follow-up (different angle)
  subject_m3 / body_m3  — Month 3 soft close

Email bodies do NOT include a greeting or sign-off — both added by Instantly automatically.
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
    "I hope this finds you well",
    "I wanted to reach out",
    "just checking in",
    "touching base",
]

EMB_CONTEXT = {
    "company": "EMB Global",
    "platform": "embtalent.ai",
    "platform_url": "https://embtalent.ai",
    "proof_companies": "Rakuten, Accenture, and KPMG",
    "proof_metric": "cut their engineering hiring cycle by half",
    "stacks": "75+ stacks",
}

# Human-readable source names for use in subject lines and body openers.
SOURCE_DISPLAY = {
    "ashby": "Ashby",
    "greenhouse": "Greenhouse",
    "lever": "Lever",
    "linkedin": "LinkedIn",
    "naukri": "Naukri",
    "indeed": "Indeed",
}

SEQUENCE_ANGLES = {
    "A": {
        # Source in subject. Speed angle: best candidates leave the market fast.
        "source_placement": "subject",
        "m1_hook": "Hiring {role}s in this market takes 6 to 10 weeks on average, most of that lost in resume screening.",
        "m2_hook": "The strongest {role} candidates are typically off the market within 10 days of becoming available.",
        "m2_bridge": "embtalent.ai gives you pre-assessed profiles ready to interview before the window closes.",
        "m3_proof": "A team recently closed a {role} in 6 days: 3 profiles, 2 interviews, 1 offer.",
    },
    "B": {
        # Source in body. Signal/noise angle: skip the screening pile entirely.
        "source_placement": "body",
        "m1_hook": "For a typical {role} search, 97% of applicants never make it to interview but your team screens every one.",
        "m2_hook": "The issue with most {role} hires is not a lack of candidates.",
        "m2_bridge": "Pre-screening still falls on your team and the best engineers rarely apply to job boards. embtalent.ai takes that off you completely.",
        "m3_proof": "One team recently hired a {role} from our shortlist in under a week: three pre-assessed profiles, no screening time.",
    },
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


def _fallback_emails(job: dict, signals: dict, sequence: str = "A") -> dict:
    role = _normalize(job.get("title")) or "this role"
    company = _normalize(job.get("organization")) or "your company"
    source_display = SOURCE_DISPLAY.get(_normalize(job.get("source") or ""), "")
    if sequence == "A":
        s1 = f"{role} on {source_display} - EMB Global" if source_display else f"{role} search - EMB Global"
        s2 = f"{role} closed in 6 days - EMB Global"
    else:
        s1 = f"{role} in 6 days, not 6 weeks - EMB Global"
        s2 = f"{role}s without the CV pile - EMB Global"
    s3 = f"3 pre-vetted {role}s - EMB Global"
    return {
        "months": [
            {
                "subject": s1,
                "body": (
                    f"Hiring {role}s typically takes 6 to 10 weeks, most of that lost in resume screening.\n\n"
                    f"embtalent.ai pre-vets engineers across 75+ stacks with full technical reports before your first call.\n\n"
                    f"Rakuten, Accenture, and KPMG cut their engineering hiring cycle by half.\n\n"
                    f"Worth a 15-minute call this week?"
                ),
            },
            {
                "subject": s2,
                "body": (
                    f"The strongest {role} candidates are off the market within 10 days.\n\n"
                    f"embtalent.ai gives you pre-assessed profiles ready to interview before the window closes.\n\n"
                    f"Worth a quick call?"
                ),
            },
            {
                "subject": s3,
                "body": (
                    f"One last note.\n\n"
                    f"A team recently closed a {role} in 6 days: 3 profiles, 2 interviews, 1 offer.\n\n"
                    f"Happy to share a sample profile if useful. If not, all good."
                ),
            },
        ],
        "confidence_score": 0.55,
        "facts_used": [company, role, "EMB Global"],
        "warnings": signals.get("warnings", []),
        "generated_by": "fallback",
        "sequence": sequence,
    }


def generate_emails_with_openai(
    job: dict,
    contact: dict,
    signals: dict,
    openai_api_key: str,
    model: str = DEFAULT_OUTREACH_MODEL,
    sequence: str = "A",
) -> dict:
    """Generate all 3 monthly outbound emails in a single OpenAI call.

    Sequence A: source in subject line, speed angle.
    Sequence B: source as first body line, signal/noise angle.

    Returns a dict with a `months` list of 3 {subject, body} dicts plus metadata.
    """
    role = _normalize(job.get("title")) or "this role"
    angle = SEQUENCE_ANGLES.get(sequence, SEQUENCE_ANGLES["A"])
    source_raw = _normalize(job.get("source") or "")
    source_display = SOURCE_DISPLAY.get(source_raw, "")

    facts = {
        "company_name": _normalize(job.get("organization")),
        "job_title": role,
        "key_skills": (job.get("ai_key_skills") or [])[:4],
        "job_description_summary": _normalize(
            job.get("ai_requirements_summary") or job.get("ai_core_responsibilities") or job.get("description_text") or ""
        )[:400],
        "contact_title": _normalize(contact.get("title")),
    }

    # Pre-compute all 6 subjects deterministically — AI does not choose subjects.
    if sequence == "A":
        if source_display:
            m1_subject = f"{role} on {source_display} - EMB Global"
        else:
            m1_subject = f"{role} search - EMB Global"
        m2_subject = f"{role} closed in 6 days - EMB Global"
        m3_subject = f"3 pre-vetted {role}s - EMB Global"
        m1_body_source = ""
    else:  # Sequence B
        m1_subject = f"{role} in 6 days, not 6 weeks - EMB Global"
        m2_subject = f"{role}s without the CV pile - EMB Global"
        m3_subject = f"3 pre-vetted {role}s - EMB Global"
        m1_body_source = (
            f'Saw your {role} posting on {source_display}.'
            if source_display else ""
        )

    m1_hook   = angle["m1_hook"].format(role=role)
    m2_hook   = angle["m2_hook"].format(role=role)
    m2_bridge = angle["m2_bridge"].format(role=role)
    m3_proof  = angle["m3_proof"].format(role=role)

    skills_str = ", ".join(facts["key_skills"]) if facts["key_skills"] else ""

    prompt = f"""Return valid JSON only. No markdown, no code blocks.

You are writing 3 cold outbound emails from EMB Global to a hiring manager at {facts['company_name'] or 'a company'} who posted a {role} role.

NAMING — use exactly as written, no variations:
- Company: EMB Global
- Product: embtalent.ai (always lowercase)

STRICT STYLE RULES:
- No greeting line. No sign-off line. Both are added automatically.
- Each paragraph is exactly 1 sentence. One blank line between paragraphs.
- Max 20 words per sentence.
- No em dashes (—). Use a comma or colon instead if needed.
- No filler: {", ".join(BANNED_PHRASES)}.
- Do NOT invent statistics or company names not listed below.
- Do NOT use em dashes anywhere in body text.

FORMULA for every email: Hook / Bridge / Proof / CTA
Each part is its own paragraph separated by a blank line.

ABOUT embtalent.ai:
- Pre-vetted engineers assessed by senior tech practitioners, full technical reports included
- Hiring managers interview only candidates who already passed evaluation, no screening pile
- {EMB_CONTEXT['proof_companies']} {EMB_CONTEXT['proof_metric']}

JOB: {role} | Skills: {skills_str or 'not specified'} | Contact: {facts['contact_title'] or 'Hiring Manager'}

---

EMAIL 1
Subject (use exactly, do not change): "{m1_subject}"
{('First line before the hook: "' + m1_body_source + '"') if m1_body_source else ''}
Hook: "{m1_hook}"
Bridge: embtalent.ai pre-vets engineers across {(skills_str + " and ") if skills_str else ""}{EMB_CONTEXT['stacks']} with full technical reports before the first call.{(" Mention " + skills_str + " specifically.") if skills_str else ""}
Proof: {EMB_CONTEXT['proof_companies']} {EMB_CONTEXT['proof_metric']}.
CTA: "Worth a 15-minute call this week?"
Word limit: 60 words.

EMAIL 2
Subject (use exactly, do not change): "{m2_subject}"
Hook: "{m2_hook}"
Bridge: "{m2_bridge}"
Proof: write one sentence with a specific outcome different from email 1 (e.g. time-to-hire metric, shortlist process). No em dashes.
CTA: "Worth a quick call?"
Word limit: 50 words.

EMAIL 3
Subject (use exactly, do not change): "{m3_subject}"
Opener: one natural sentence signalling this is the last note. Keep it brief and pressure-free.
Proof: "{m3_proof}"
CTA: "Happy to share a sample profile if useful. If not, all good."
Word limit: 40 words.

---

Return exactly:
{{
  "months": [
    {{"subject": "{m1_subject}", "body": "<email 1 body only, no subject>"}},
    {{"subject": "{m2_subject}", "body": "<email 2 body only, no subject>"}},
    {{"subject": "{m3_subject}", "body": "<email 3 body only, no subject>"}}
  ],
  "confidence_score": 0.0,
  "facts_used": ["<facts used>"],
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
                "temperature": 0.3,
                "max_tokens": 900,
                "messages": [
                    {
                        "role": "system",
                        "content": "You generate concise 3-email outbound sequences. Return valid JSON only, no markdown.",
                    },
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=45,
        )
        if not response.ok:
            return _fallback_emails(job, signals, sequence)

        data = response.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        if not content:
            return _fallback_emails(job, signals, sequence)

        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
        parsed = json.loads(content)

        months = parsed.get("months") or []
        # Ensure exactly 3 months; pad with fallback if AI returned fewer
        fallback = _fallback_emails(job, signals, sequence)["months"]
        while len(months) < 3:
            months.append(fallback[len(months)])

        return {
            "months": [
                {"subject": _normalize(m.get("subject")), "body": _normalize(m.get("body"))}
                for m in months[:3]
            ],
            "confidence_score": float(parsed.get("confidence_score") or 0),
            "facts_used": [_normalize(f) for f in (parsed.get("facts_used") or []) if f],
            "warnings": [_normalize(w) for w in (parsed.get("warnings") or []) if w],
            "generated_by": "openai",
            "sequence": sequence,
        }
    except Exception:
        return _fallback_emails(job, signals, sequence)


def run_qa(contact: dict, email: dict) -> dict:
    """Quality-check the generated emails before sending to Instantly."""
    issues = []
    if not _has_valid_email(contact.get("email")):
        issues.append("Contact email is missing or invalid.")
    if not _normalize(contact.get("title")):
        issues.append("Contact title is missing.")

    months = email.get("months") or []
    if len(months) < 3:
        issues.append(f"Expected 3 monthly emails, got {len(months)}.")

    for i, m in enumerate(months, 1):
        body = _normalize(m.get("body"))
        if not body:
            issues.append(f"Month {i} email body is empty.")
            continue
        if len(body.split()) > 130:
            issues.append(f"Month {i} email exceeds 130 words.")
        if re.search(r"TBD|N\/A", body, re.IGNORECASE):
            issues.append(f"Month {i} contains unresolved placeholders.")
        for phrase in BANNED_PHRASES:
            if phrase in body.lower():
                issues.append(f"Month {i} contains banned phrase: '{phrase}'.")

    if not (email.get("facts_used") or []):
        issues.append("No facts cited — emails may contain unsupported claims.")

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
    sequence: Optional[str] = None,
) -> dict:
    """Generate a complete 3-email outreach record for one (job, contact) pair.

    sequence: "A" or "B" — if None, assigned deterministically from the contact email
    so the same lead always maps to the same sequence across re-runs.

    Returns a dict with: contact, signals, email, qa, instantly_payload, status.
    """
    role_family = detect_role_family(job.get("title"))
    seniority = detect_seniority(job.get("title"))

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

    if sequence is None:
        email_str = _normalize(contact.get("email"))
        sequence = "A" if (sum(ord(c) for c in email_str) % 2 == 0) else "B"

    if openai_api_key:
        email = generate_emails_with_openai(job, contact, signals, openai_api_key, sequence=sequence)
    else:
        email = _fallback_emails(job, signals, sequence)

    qa = run_qa(contact, email)

    instantly_payload = None
    if qa["approved_for_export"]:
        name_parts = _normalize(contact.get("name")).split()
        months = email.get("months") or [{}, {}, {}]
        instantly_payload = {
            "lead_id": _normalize(contact.get("email")) or f"lead-{uuid.uuid4().hex[:8]}",
            "job_id": _normalize(job.get("job_key") or job.get("id") or job.get("title")),
            "to_email": _normalize(contact.get("email")),
            "first_name": name_parts[0] if name_parts else "",
            "last_name": " ".join(name_parts[1:]) if len(name_parts) > 1 else "",
            "company_name": _normalize(job.get("organization")),
            "company_domain": _normalize(job.get("domain_derived") or job.get("company_key")),
            "contact_title": _normalize(contact.get("title")),
            "job_title": _normalize(job.get("title")),
            "source": _normalize(job.get("source")),
            "priority": priority,
            # AI-generated email content — maps to {{subject_m1}}, {{body_m1}}, etc. in Instantly
            "subject_m1": _normalize(months[0].get("subject")) if months else "",
            "body_m1": _normalize(months[0].get("body")) if months else "",
            "subject_m2": _normalize(months[1].get("subject")) if len(months) > 1 else "",
            "body_m2": _normalize(months[1].get("body")) if len(months) > 1 else "",
            "subject_m3": _normalize(months[2].get("subject")) if len(months) > 2 else "",
            "body_m3": _normalize(months[2].get("body")) if len(months) > 2 else "",
            # Sequence routing — used in Instantly to pick the A or B sub-sequence
            "sequence": sequence,
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
