import math
import time
from typing import Dict, List, Optional
from urllib.parse import urlparse

import requests

PEOPLE_SEARCH_ENDPOINT = "https://api.apollo.io/v1/mixed_people/api_search"
BULK_ENRICH_ENDPOINT = "https://api.apollo.io/api/v1/people/bulk_match"
ORGANIZATION_SEARCH_ENDPOINT = "https://api.apollo.io/api/v1/mixed_companies/search"

# Maximum pages to fetch per company/domain in people search (25 per page → 100 people max).
# Prevents unbounded pagination for large companies that triggers Apollo rate limits.
DEFAULT_MAX_PAGES = 4


def _apollo_post(url: str, headers: dict, payload: dict, timeout: int = 30, retries: int = 3) -> requests.Response:
    """POST to Apollo with retry on connection errors and 429 rate-limit responses."""
    delay = 2.0
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=timeout)
            if response.status_code == 429:
                retry_after = float(response.headers.get("Retry-After", delay))
                time.sleep(retry_after)
                delay *= 2
                continue
            return response
        except requests.exceptions.ConnectionError as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
        except requests.exceptions.Timeout as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
    raise RuntimeError(f"Apollo request to {url} failed after {retries} attempts: {last_exc}")
DEFAULT_TITLES = [
    "Partner",
    "General Partner",
    "Managing Director",
    "Investment Principal",
    "Associate",
]
DEFAULT_CONTACT_LIMIT = 5

# Role-family to ICP title mapping — used for job-aware ICP selection
ROLE_FAMILY_ICP_TITLES: dict[str, list[str]] = {
    "engineering": [
        "CTO", "VP Engineering", "Head of Engineering", "Engineering Manager",
        "Director of Engineering", "Tech Lead", "VP of Technology",
    ],
    "product": [
        "CPO", "VP Product", "Head of Product", "Product Manager",
        "Director of Product", "VP of Product Management",
    ],
    "design": [
        "VP Design", "Head of Design", "Design Director", "Director of UX",
        "Chief Design Officer",
    ],
    "marketing": [
        "CMO", "VP Marketing", "Head of Marketing", "Director of Marketing",
        "Growth Lead",
    ],
    "sales": [
        "CRO", "VP Sales", "Head of Sales", "Sales Director",
        "Director of Revenue", "Head of Revenue",
    ],
    "data": [
        "Chief Data Officer", "VP Data", "Head of Analytics", "Director of Data",
        "Head of Data Science",
    ],
    "finance": [
        "CFO", "VP Finance", "Head of Finance", "Director of Finance",
        "Controller",
    ],
    "operations": [
        "COO", "VP Operations", "Head of Operations", "Director of Operations",
        "Chief of Staff",
    ],
    "people": [
        "CHRO", "VP People", "Head of People", "Head of HR",
        "Director of People Operations",
    ],
    "general": [
        "CEO", "Founder", "Co-Founder", "COO", "Chief of Staff",
        "Managing Director",
    ],
}

# Always include these talent contacts regardless of job role family
TALENT_SIGNAL_TITLES = [
    "Head of Talent", "Talent Acquisition Lead", "Recruiter",
    "Senior Recruiter", "Technical Recruiter", "Talent Acquisition Manager",
    "Hiring Manager",
]


def classify_company_contact_reason(title_value: Optional[str], role: Optional[str] = None) -> str:
    title = (title_value or "").strip().lower()
    role_family = get_role_family(role)

    if any(kw in title for kw in ["cto", "vp engineering", "head of engineering", "engineering director"]):
        return "Chosen as an ICP: leads engineering — directly responsible for the open engineering role."
    if any(kw in title for kw in ["cpo", "vp product", "head of product", "product director"]):
        return "Chosen as an ICP: leads product — directly responsible for the open product role."
    if any(kw in title for kw in ["cmo", "vp marketing", "head of marketing"]):
        return "Chosen as an ICP: leads marketing — directly responsible for the open marketing role."
    if any(kw in title for kw in ["cro", "vp sales", "head of sales", "revenue director"]):
        return "Chosen as an ICP: leads sales/revenue — directly responsible for the open sales role."
    if any(kw in title for kw in ["cdo", "head of data", "vp data", "head of analytics"]):
        return "Chosen as an ICP: leads data/analytics — directly responsible for the open data role."
    if any(kw in title for kw in ["coo", "chief operating", "vp operations", "head of operations"]):
        return "Chosen as an ICP: leads operations — decision-maker for the open operations role."
    if any(kw in title for kw in ["chro", "vp people", "head of people", "head of hr"]):
        return "Chosen as an ICP: leads people/HR — owns hiring strategy and talent decisions."
    if any(kw in title for kw in ["head of talent", "talent acquisition", "recruiter", "hiring manager"]):
        return "Chosen as an ICP: directly manages recruiting and talent acquisition for this role."
    if any(kw in title for kw in ["ceo", "founder", "co-founder", "managing director"]):
        return "Chosen as an ICP: company leadership with direct influence over hiring decisions."
    if any(kw in title for kw in ["director", "head of", "vp "]):
        return f"Chosen as an ICP: senior leader relevant to the {role_family} hiring decision."
    return "Chosen as an ICP: best available contact match based on title and hiring context."


def normalize_company_person(person: Dict[str, Optional[str]]) -> Dict[str, Optional[str]]:
    organization = person.get("organization") or {}
    email_value = (
        person.get("email")
        or person.get("email_address")
        or person.get("work_email")
        or person.get("personal_email")
    )
    if not email_value:
        email_candidates = person.get("emails") or person.get("email_addresses")
        if isinstance(email_candidates, list) and email_candidates:
            first_email = email_candidates[0]
            if isinstance(first_email, dict):
                email_value = first_email.get("email") or first_email.get("address")
            else:
                email_value = str(first_email)

    return {
        "name": " ".join(part for part in [person.get("first_name"), person.get("last_name")] if part).strip() or None,
        "title": person.get("title"),
        "email": email_value,
        "phone": person.get("phone_number"),
        "linkedin_url": person.get("linkedin_url") or person.get("linkedin"),
        "apollo_person_id": person.get("id"),
        "organization_id": organization.get("id") if isinstance(organization, dict) else None,
        "organization_domain": (
            organization.get("primary_domain")
            or organization.get("domain")
            or organization.get("website_url")
        )
        if isinstance(organization, dict)
        else person.get("_source_domain"),
    }


def normalize_domain(value: str) -> str:
    if not value:
        return ""

    parsed = urlparse(value if value.startswith("http") else f"https://{value}")
    domain = parsed.netloc or parsed.path
    return domain.replace("www.", "").strip()


def _normalize_name(value: Optional[str]) -> str:
    text = (value or "").strip().lower()
    if not text:
        return ""
    return "".join(ch for ch in text if ch.isalnum())


def _extract_linkedin_slug(value: Optional[str]) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text if text.startswith("http") else f"https://{text}")
    path = parsed.path.strip("/")
    if "/company/" in f"/{path}/":
        slug = path.split("company/", 1)[1].split("/", 1)[0]
        return slug.strip().lower()
    return ""


def _organization_domain(organization: Dict[str, object]) -> str:
    domain = (
        organization.get("primary_domain")
        or organization.get("domain")
        or organization.get("website_url")
    )
    if not domain:
        domains = organization.get("domains")
        if isinstance(domains, list) and domains:
            domain = domains[0]
    return normalize_domain(str(domain or ""))


def search_organizations(
    api_key: str,
    companies: List[Dict[str, object]],
    include_debug: bool = False,
) -> List[Dict[str, object]] | tuple[List[Dict[str, object]], Dict[str, object]]:
    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
    }
    resolved: List[Dict[str, object]] = []
    debug_payloads: List[Dict[str, object]] = []
    debug_responses: List[Dict[str, object]] = []

    for company in companies:
        company_key = str(company.get("company_key") or "").strip().lower()
        company_name = str(company.get("company_name") or "").strip()
        company_domain = normalize_domain(str(company.get("company_domain") or ""))
        company_linkedin_url = str(company.get("company_linkedin_url") or "").strip()
        if company_domain:
            resolved.append(
                {
                    "company_key": company_key or company_domain,
                    "company_name": company_name or None,
                    "company_domain": company_domain,
                    "organization_id": None,
                    "company_linkedin_url": company_linkedin_url or None,
                    "match_strategy": "input_domain",
                }
            )
            continue

        if not company_name:
            continue

        payload: Dict[str, object] = {
            "q_organization_name": company_name,
            "page": 1,
            "per_page": 10,
        }
        response = _apollo_post(ORGANIZATION_SEARCH_ENDPOINT, headers=headers, payload=payload)
        if response.status_code != 200:
            raise RuntimeError(f"Apollo organization search failed for {company_name}: {response.text}")

        data = response.json()
        if include_debug:
            debug_payloads.append(payload)
            debug_responses.append(data)

        organizations = []
        if isinstance(data, dict):
            raw_orgs = data.get("organizations")
            if isinstance(raw_orgs, list):
                organizations = [item for item in raw_orgs if isinstance(item, dict)]
            else:
                accounts = data.get("accounts")
                if isinstance(accounts, list):
                    organizations = [item for item in accounts if isinstance(item, dict)]

        target_name = _normalize_name(company_name)
        target_slug = _extract_linkedin_slug(company_linkedin_url)
        best_score = -1
        best_match: Optional[Dict[str, object]] = None
        for organization in organizations:
            org_name = str(organization.get("name") or organization.get("organization_name") or "").strip()
            org_name_norm = _normalize_name(org_name)
            org_domain = _organization_domain(organization)
            org_linkedin_slug = _extract_linkedin_slug(
                str(
                    organization.get("linkedin_url")
                    or organization.get("linkedin")
                    or organization.get("linkedin_company_url")
                    or ""
                )
            )

            score = 0
            if org_name_norm and org_name_norm == target_name:
                score += 100
            elif org_name_norm and target_name and (
                org_name_norm.startswith(target_name) or target_name.startswith(org_name_norm)
            ):
                score += 70
            elif org_name_norm and target_name and target_name in org_name_norm:
                score += 50
            if target_slug and org_linkedin_slug and target_slug == org_linkedin_slug:
                score += 80
            if org_domain:
                score += 20

            if score > best_score:
                best_score = score
                best_match = organization

        if best_match and best_score >= 50:
            resolved.append(
                {
                    "company_key": company_key or company_name.lower(),
                    "company_name": str(best_match.get("name") or company_name).strip() or company_name,
                    "company_domain": _organization_domain(best_match),
                    "organization_id": best_match.get("id"),
                    "company_linkedin_url": company_linkedin_url or None,
                    "match_strategy": "organization_search",
                }
            )

    if include_debug:
        return resolved, {
            "endpoint": ORGANIZATION_SEARCH_ENDPOINT,
            "payloads": debug_payloads,
            "responses": debug_responses,
        }

    return resolved


def search_people(
    api_key: str,
    domains: Optional[List[str]],
    titles: Optional[List[str]],
    organization_ids: Optional[List[str]] = None,
    include_debug: bool = False,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> List[Dict[str, Optional[str]]] | tuple[List[Dict[str, Optional[str]]], Dict[str, object]]:
    people: List[Dict[str, Optional[str]]] = []
    debug_payloads: List[Dict[str, object]] = []
    debug_responses: List[Dict[str, object]] = []
    resolved_domains = [normalize_domain(domain) for domain in (domains or []) if normalize_domain(domain)]
    resolved_org_ids = [str(org_id).strip() for org_id in (organization_ids or []) if str(org_id).strip()]
    search_targets: List[Dict[str, Optional[str]]] = []
    for domain in resolved_domains:
        search_targets.append({"domain": domain, "organization_id": None})
    for organization_id in resolved_org_ids:
        search_targets.append({"domain": None, "organization_id": organization_id})

    for target in search_targets:
        domain = target.get("domain")
        organization_id = target.get("organization_id")
        headers = {
            "Content-Type": "application/json",
            "X-Api-Key": api_key,
        }
        page = 1
        per_page = 25
        total_pages = 1
        while page <= total_pages and page <= max_pages:
            payload = {
                "page": page,
                "per_page": per_page,
            }
            if titles:
                payload["person_titles"] = titles
            if organization_id:
                payload["organization_ids"] = [organization_id]
            elif domain:
                payload["q_organization_domains"] = domain

            response = _apollo_post(PEOPLE_SEARCH_ENDPOINT, headers=headers, payload=payload)
            if response.status_code != 200:
                raise RuntimeError(
                    f"Apollo people search failed for {organization_id or domain}: {response.text}"
                )

            data = response.json()
            page_people = data.get("people", [])
            for person in page_people:
                if isinstance(person, dict):
                    person = {
                        **person,
                        "_source_domain": domain,
                        "_source_organization_id": organization_id,
                    }
                people.append(person)
            if include_debug:
                debug_payloads.append(payload)
                debug_responses.append(data)

            if page == 1:
                pagination = data.get("pagination") if isinstance(data, dict) else {}
                total_entries = None
                if isinstance(pagination, dict):
                    total_entries = pagination.get("total_entries")
                if total_entries is None and isinstance(data, dict):
                    total_entries = data.get("total_entries")
                if isinstance(total_entries, int) and total_entries > 0:
                    total_pages = math.ceil(total_entries / per_page)

            page += 1
            time.sleep(0.5)

    if include_debug:
        return people, {
            "endpoint": PEOPLE_SEARCH_ENDPOINT,
            "payloads": debug_payloads,
            "responses": debug_responses,
        }

    return people


def search_people_for_company(
    api_key: str,
    domain: Optional[str] = None,
    company_name: Optional[str] = None,
    titles: Optional[List[str]] = None,
    include_debug: bool = False,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> List[Dict[str, Optional[str]]] | tuple[List[Dict[str, Optional[str]]], Dict[str, object]]:
    normalized_domain = normalize_domain(domain or "")
    cleaned_company_name = (company_name or "").strip()
    if not normalized_domain and not cleaned_company_name:
        raise ValueError("A company domain or company name is required.")

    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
    }
    page = 1
    per_page = 25
    total_pages = 1
    people: List[Dict[str, Optional[str]]] = []
    debug_payloads: List[Dict[str, object]] = []
    debug_responses: List[Dict[str, object]] = []

    while page <= total_pages and page <= max_pages:
        payload: Dict[str, object] = {
            "page": page,
            "per_page": per_page,
        }
        if titles:
            payload["person_titles"] = titles
        if normalized_domain:
            payload["q_organization_domains"] = normalized_domain
        else:
            payload["q_organization_name"] = cleaned_company_name

        response = _apollo_post(PEOPLE_SEARCH_ENDPOINT, headers=headers, payload=payload)
        if response.status_code != 200:
            raise RuntimeError(
                f"Apollo company people search failed for {normalized_domain or cleaned_company_name}: {response.text}"
            )

        data = response.json()
        page_people = data.get("people", [])
        for person in page_people:
            if isinstance(person, dict):
                person = {
                    **person,
                    "_source_domain": normalized_domain or None,
                    "_source_company_name": cleaned_company_name or None,
                }
            people.append(person)
        if include_debug:
            debug_payloads.append(payload)
            debug_responses.append(data)

        if page == 1:
            pagination = data.get("pagination") if isinstance(data, dict) else {}
            total_entries = None
            if isinstance(pagination, dict):
                total_entries = pagination.get("total_entries")
            if total_entries is None and isinstance(data, dict):
                total_entries = data.get("total_entries")
            if isinstance(total_entries, int) and total_entries > 0:
                total_pages = math.ceil(total_entries / per_page)

        page += 1
        time.sleep(0.5)

    if include_debug:
        return people, {
            "endpoint": PEOPLE_SEARCH_ENDPOINT,
            "payloads": debug_payloads,
            "responses": debug_responses,
        }

    return people


def build_bulk_match_payload(people: List[Dict[str, Optional[str]]]) -> List[Dict[str, Optional[str]]]:
    details: List[Dict[str, Optional[str]]] = []
    for person in people:
        if not isinstance(person, dict):
            continue

        # Person ID — raw Apollo response uses "id", formatted people use "apollo_person_id"
        person_id = person.get("id") or person.get("apollo_person_id")

        linkedin_url = person.get("linkedin_url")

        # Domain — raw Apollo response nests it under "organization"; formatted people expose it flat
        organization = person.get("organization") or {}
        domain_value = None
        if isinstance(organization, dict):
            domain_value = (
                organization.get("primary_domain")
                or organization.get("domain")
                or organization.get("website_url")
            )
            if not domain_value:
                domains = organization.get("domains")
                if isinstance(domains, list) and domains:
                    domain_value = domains[0]
        if not domain_value:
            domain_value = (
                person.get("organization_domain")
                or person.get("_source_domain")
            )

        detail: Dict[str, Optional[str]] = {}
        if person_id:
            detail["id"] = str(person_id)
        if linkedin_url:
            detail["linkedin_url"] = linkedin_url
        if domain_value:
            detail["domain"] = normalize_domain(str(domain_value))

        # If we only have a name + org name, include them so Apollo can try a fuzzy match
        if not detail or (not person_id and not linkedin_url):
            first = str(person.get("first_name") or "").strip()
            last = str(person.get("last_name") or "").strip()
            name = str(person.get("name") or "").strip() or f"{first} {last}".strip()
            org_name = str(person.get("organization_name") or "").strip()
            if name:
                detail["name"] = name
            if org_name:
                detail["organization_name"] = org_name

        if detail:
            details.append(detail)
    return details


def enrich_people(
    api_key: str,
    matches: List[Dict[str, Optional[str]]],
    include_debug: bool = False,
) -> List[Dict[str, Optional[str]]] | tuple[List[Dict[str, Optional[str]]], Dict[str, object]]:
    if not matches:
        return [] if not include_debug else ([], {"endpoint": BULK_ENRICH_ENDPOINT, "payload": {}, "response": {}})

    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
    }
    payload = {
        "reveal_personal_emails": True,
        "reveal_work_emails": True,
        "reveal_phone_number": False,
        "details": matches,
    }

    response = _apollo_post(BULK_ENRICH_ENDPOINT, headers=headers, payload=payload)
    if response.status_code != 200:
        raise RuntimeError(f"Apollo bulk enrichment failed: {response.text}")
    data = response.json()
    people = data.get("people")
    if not isinstance(people, list):
        people = data.get("matches", [])
    if include_debug:
        return people, {
            "endpoint": BULK_ENRICH_ENDPOINT,
            "payload": payload,
            "response": data,
        }

    return people


def format_results(people: List[Dict[str, Optional[str]]]) -> List[Dict[str, Optional[str]]]:
    results: List[Dict[str, Optional[str]]] = []
    for person in people:
        organization = person.get("organization") or {}
        organization_id = None
        organization_domain = None
        if isinstance(organization, dict):
            organization_id = organization.get("id")
            organization_domain = (
                organization.get("primary_domain")
                or organization.get("domain")
                or organization.get("website_url")
            )
        if not organization_domain:
            organization_domain = person.get("_source_domain") if isinstance(person, dict) else None
        email_value = (
            person.get("email")
            or person.get("email_address")
            or person.get("work_email")
            or person.get("personal_email")
        )
        if not email_value:
            email_candidates = person.get("emails") or person.get("email_addresses")
            if isinstance(email_candidates, list) and email_candidates:
                first_email = email_candidates[0]
                if isinstance(first_email, dict):
                    email_value = first_email.get("email") or first_email.get("address")
                else:
                    email_value = str(first_email)
        linkedin_url = person.get("linkedin_url") or person.get("linkedin")
        phone_number = person.get("phone_number")
        if not phone_number:
            phone_numbers = person.get("phone_numbers")
            if isinstance(phone_numbers, list) and phone_numbers:
                first_phone = phone_numbers[0]
                if isinstance(first_phone, dict):
                    phone_number = (
                        first_phone.get("sanitized_number")
                        or first_phone.get("raw_number")
                        or first_phone.get("number")
                    )
                else:
                    phone_number = str(first_phone)
        results.append(
            {
                "First Name": person.get("first_name"),
                "Last Name": person.get("last_name"),
                "Title": person.get("title"),
                "Company": organization.get("name") if isinstance(organization, dict) else None,
                "Organization ID": organization_id,
                "Organization Domain": organization_domain,
                "Email": email_value,
                "Phone": phone_number,
                "LinkedIn URL": linkedin_url,
            }
        )
    return results


def format_people_for_icp(people: List[Dict[str, Optional[str]]]) -> List[Dict[str, Optional[str]]]:
    formatted: List[Dict[str, Optional[str]]] = []
    for person in people:
        organization = person.get("organization") or {}
        department = person.get("department") or person.get("departments")
        if isinstance(department, list):
            department = ", ".join(str(item) for item in department if item)
        name = " ".join(
            part for part in [person.get("first_name"), person.get("last_name")] if part
        ).strip()
        formatted.append(
            {
                "first_name": person.get("first_name"),
                "last_name": person.get("last_name"),
                "name": name or person.get("name"),
                "title": person.get("title"),
                "department": department if isinstance(department, str) else None,
                "seniority": person.get("seniority"),
                "linkedin_url": person.get("linkedin_url") or person.get("linkedin"),
                "apollo_person_id": person.get("id"),
                "organization_id": organization.get("id") if isinstance(organization, dict) else person.get("_source_organization_id"),
                "organization_domain": (
                    organization.get("primary_domain")
                    or organization.get("domain")
                    or organization.get("website_url")
                ) if isinstance(organization, dict) else person.get("_source_domain"),
                "organization_name": organization.get("name") if isinstance(organization, dict) else person.get("_source_company_name"),
            }
        )
    return formatted


def get_role_family(role: Optional[str]) -> str:
    """Detect the functional role family from a job title."""
    role_lower = (role or "").strip().lower()
    if not role_lower:
        return "general"
    if any(kw in role_lower for kw in ["engineer", "developer", "backend", "frontend", "fullstack", "devops", "sre", "infrastructure", "cloud", "software"]):
        return "engineering"
    if any(kw in role_lower for kw in ["product manager", "product owner", "product lead", "head of product", "vp product"]):
        return "product"
    if any(kw in role_lower for kw in ["design", "ux", "ui", "user experience", "visual design"]):
        return "design"
    if any(kw in role_lower for kw in ["marketing", "growth", "seo", "content", "brand", "demand gen"]):
        return "marketing"
    if any(kw in role_lower for kw in ["sales", "account executive", "account manager", "business development", "revenue"]):
        return "sales"
    if any(kw in role_lower for kw in ["data", "analytics", "data science", "machine learning", "ml", "ai", "analyst"]):
        return "data"
    if any(kw in role_lower for kw in ["finance", "accounting", "controller", "financial"]):
        return "finance"
    if any(kw in role_lower for kw in ["operations", "ops", "chief of staff", "strategy"]):
        return "operations"
    if any(kw in role_lower for kw in ["people", "hr ", "human resources", "talent", "recruiter", "recruiting"]):
        return "people"
    return "general"


def get_icp_titles_for_role(role: Optional[str]) -> List[str]:
    """Return the list of ICP titles to search for, given a job role being hired."""
    family = get_role_family(role)
    functional_titles = ROLE_FAMILY_ICP_TITLES.get(family, ROLE_FAMILY_ICP_TITLES["general"])
    # Always include talent signal titles to capture the hiring decision-maker
    combined = list(dict.fromkeys([*functional_titles, *TALENT_SIGNAL_TITLES]))
    return combined


def build_employee_contact_titles(role: Optional[str]) -> List[str]:
    recruiting_titles = [
        "Recruiter",
        "Senior Recruiter",
        "Technical Recruiter",
        "Talent Acquisition",
        "Talent Acquisition Manager",
        "Hiring Manager",
    ]
    exec_titles = ["VP", "Head", "Director"]
    role_value = (role or "").strip()
    if not role_value:
        return list(dict.fromkeys([*recruiting_titles, "Director", "VP", "Head"]))

    role_lower = role_value.lower()
    if "product" in role_lower:
        function = "Product"
    elif "engineer" in role_lower or "developer" in role_lower:
        function = "Engineering"
    elif "design" in role_lower:
        function = "Design"
    elif "marketing" in role_lower:
        function = "Marketing"
    elif "sales" in role_lower:
        function = "Sales"
    elif "data" in role_lower or "analytics" in role_lower:
        function = "Data"
    else:
        function = role_value.title()

    titles = [
        *recruiting_titles,
        role_value.title(),
        f"Director of {function}",
        f"Head of {function}",
        f"VP {function}",
        *exec_titles,
    ]
    return list(dict.fromkeys(title for title in titles if title))


def shortlist_company_contacts(
    people: List[Dict[str, Optional[str]]],
    role: Optional[str],
    limit: int = DEFAULT_CONTACT_LIMIT,
) -> List[Dict[str, Optional[str]]]:
    """Score and shortlist people as ICPs based on the job role being hired for.

    Scoring is job-aware: functional leaders matching the role family score highest,
    talent/hiring contacts are always valued, and finance/legal/compliance are penalized.
    Only contacts with score >= 100 are considered valid ICPs.
    """
    role_lower = (role or "").strip().lower()
    role_family = get_role_family(role)
    functional_icp_titles = [t.lower() for t in ROLE_FAMILY_ICP_TITLES.get(role_family, [])]
    talent_titles = [t.lower() for t in TALENT_SIGNAL_TITLES]

    ranked: List[tuple[int, Dict[str, Optional[str]]]] = []
    for person in people:
        title = str(person.get("title") or "").lower()
        score = 0

        # Functional leader match — highest priority (role-family aware)
        if any(icp in title for icp in functional_icp_titles):
            score += 200

        # C-suite and top leadership
        if any(kw in title for kw in ["cto", "cpo", "cmo", "cro", "cdo", "coo", "cfo", "chro", "chief"]):
            score += 180
        if any(kw in title for kw in ["vp ", "vp of", "vice president"]):
            score += 150
        if any(kw in title for kw in ["head of", "director of", "director"]):
            score += 120

        # Talent / hiring decision-makers — always valuable
        if any(t in title for t in talent_titles):
            score += 160
        if "talent acquisition" in title or "recruiting" in title:
            score += 140
        if "hiring manager" in title:
            score += 130

        # Exact role keyword match in title
        if role_lower and role_lower in title:
            score += 60

        # Manager / lead level
        if "manager" in title or "lead" in title:
            score += 40

        # Penalties — not decision-makers for hiring
        if any(kw in title for kw in ["finance", "controller", "legal", "compliance", "counsel", "tax", "audit"]):
            score -= 300
        if any(kw in title for kw in ["advisor", "board member", "board observer", "non-executive"]):
            score -= 200
        if "intern" in title:
            score -= 150

        # Boost for having LinkedIn (reachable)
        if person.get("linkedin_url"):
            score += 10

        ranked.append((score, person))

    ranked.sort(key=lambda item: item[0], reverse=True)
    # Only include contacts with a meaningful ICP score
    qualified = [person for score, person in ranked if score >= 100]
    return qualified[:limit]


def format_company_contacts(
    people: List[Dict[str, Optional[str]]],
    confidence: str,
    role: Optional[str] = None,
) -> List[Dict[str, Optional[str]]]:
    contacts: List[Dict[str, Optional[str]]] = []
    for person in people:
        normalized = normalize_company_person(person)
        contacts.append(
            {
                **normalized,
                "confidence": confidence,
                "icp_reason": classify_company_contact_reason(person.get("title"), role),
                "role_context": role,
                "role_family": get_role_family(role),
            }
        )
    return contacts


def run_apollo_company_employee_enrichment(
    company_key: str,
    api_key: str,
    domain: Optional[str] = None,
    company_name: Optional[str] = None,
    role: Optional[str] = None,
    titles: Optional[List[str]] = None,
    include_debug: bool = False,
    max_contacts: int = DEFAULT_CONTACT_LIMIT,
) -> Dict[str, object]:
    # Use job-aware ICP titles when no explicit titles are provided
    search_titles = titles or get_icp_titles_for_role(role)
    confidence = "domain_match" if normalize_domain(domain or "") else "name_match"

    if include_debug:
        discovered_people, search_debug = search_people_for_company(
            api_key=api_key,
            domain=domain,
            company_name=company_name,
            titles=search_titles,
            include_debug=True,
        )
    else:
        discovered_people = search_people_for_company(
            api_key=api_key,
            domain=domain,
            company_name=company_name,
            titles=search_titles,
            include_debug=False,
        )
        search_debug = None

    shortlisted_people = shortlist_company_contacts(discovered_people, role, limit=max_contacts)
    bulk_details = build_bulk_match_payload(shortlisted_people)
    if len(bulk_details) > max_contacts:
        bulk_details = bulk_details[:max_contacts]

    if include_debug:
        enriched_people, bulk_debug = enrich_people(api_key, bulk_details, include_debug=True)
    else:
        enriched_people = enrich_people(api_key, bulk_details, include_debug=False)
        bulk_debug = None

    formatted_contacts = [
        contact
        for contact in format_company_contacts(
            enriched_people if isinstance(enriched_people, list) else [],
            confidence=confidence,
            role=role,
        )
        if contact.get("email")
    ][:max_contacts]

    payload: Dict[str, object] = {
        "company_key": company_key,
        "company_domain": normalize_domain(domain or "") or None,
        "company_name": company_name,
        "match_strategy": confidence,
        "contacts": formatted_contacts,
        "all_people": [normalize_company_person(person) for person in discovered_people] if isinstance(discovered_people, list) else [],
        "search_titles": search_titles or [],
        "people_count": len(discovered_people) if isinstance(discovered_people, list) else 0,
        "shortlisted_count": len(shortlisted_people),
        "enriched_count": len(formatted_contacts),
    }
    if include_debug:
        payload["debug"] = {
            "people_search": search_debug,
            "bulk_match": bulk_debug,
        }
    return payload


def run_apollo_lead_enrichment(
    domains: Optional[List[str]],
    api_key: str,
    titles: Optional[List[str]] = None,
    include_debug: bool = False,
    organization_ids: Optional[List[str]] = None,
    companies: Optional[List[Dict[str, object]]] = None,
    return_all_people: bool = False,
) -> List[Dict[str, Optional[str]]] | Dict[str, object]:
    cleaned_domains = [normalize_domain(domain) for domain in (domains or []) if normalize_domain(domain)]
    cleaned_org_ids = [str(org_id).strip() for org_id in (organization_ids or []) if str(org_id).strip()]
    resolved_companies: List[Dict[str, object]] = []
    org_search_debug = None

    if companies and not cleaned_domains and not cleaned_org_ids:
        if include_debug:
            resolved_companies, org_search_debug = search_organizations(api_key, companies, include_debug=True)
        else:
            resolved_companies = search_organizations(api_key, companies, include_debug=False)
        cleaned_domains = [
            normalize_domain(str(company.get("company_domain") or ""))
            for company in resolved_companies
            if normalize_domain(str(company.get("company_domain") or ""))
        ]
        cleaned_org_ids = [
            str(company.get("organization_id") or "").strip()
            for company in resolved_companies
            if str(company.get("organization_id") or "").strip()
        ]

    if not cleaned_domains and not cleaned_org_ids:
        raise ValueError("At least one company domain or organization ID is required.")

    title_filters = None if return_all_people else (titles or DEFAULT_TITLES)
    if include_debug:
        discovered_people, search_debug = search_people(
            api_key,
            cleaned_domains,
            title_filters,
            organization_ids=cleaned_org_ids,
            include_debug=True,
        )
        if return_all_people:
            return {
                "people": format_people_for_icp(discovered_people),
                "resolved_companies": resolved_companies,
                "debug": {
                    "organization_search": org_search_debug,
                    "people_search": search_debug,
                },
            }
        matches = build_bulk_match_payload(discovered_people)
        total_match_count = len(matches)
        limit_note = None
        if total_match_count > 10:
            matches = matches[:10]
            limit_note = f"Limited bulk match payload to first 10 of {total_match_count} entries."
        if not matches:
            bulk_debug = {
                "endpoint": BULK_ENRICH_ENDPOINT,
                "payload": {"details": []},
                "response": {},
                "people_count": len(discovered_people),
                "details_count": 0,
                "note": "No people returned from search had linkedin_url or domain values.",
            }
            enriched_people = []
        else:
            enriched_people, bulk_debug = enrich_people(
                api_key,
                matches,
                include_debug=True,
            )
            if isinstance(bulk_debug, dict):
                bulk_debug["people_count"] = len(discovered_people)
                bulk_debug["details_count"] = len(matches)
                bulk_debug["total_details_count"] = total_match_count
                if limit_note:
                    existing_note = bulk_debug.get("note")
                    bulk_debug["note"] = (
                        f"{existing_note} {limit_note}" if existing_note else limit_note
                    )
        return {
            "results": format_results(enriched_people),
            "resolved_companies": resolved_companies,
            "debug": {
                "organization_search": org_search_debug,
                "people_search": search_debug,
                "bulk_match": bulk_debug,
            },
        }

    discovered_people = search_people(
        api_key,
        cleaned_domains,
        title_filters,
        organization_ids=cleaned_org_ids,
    )
    if return_all_people:
        return {
            "people": format_people_for_icp(discovered_people),
            "resolved_companies": resolved_companies,
        }
    matches = build_bulk_match_payload(discovered_people)
    if len(matches) > 10:
        matches = matches[:10]
    enriched_people = enrich_people(api_key, matches)
    return {
        "results": format_results(enriched_people),
        "resolved_companies": resolved_companies,
    }


if __name__ == "__main__":
    sample_domains = ["sequoiacap.com"]
    sample_api_key = "YOUR_APOLLO_API_KEY"
    results = run_apollo_lead_enrichment(sample_domains, sample_api_key)
    for lead in results:
        print(lead)
