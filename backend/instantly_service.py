"""Instantly.ai lead delivery service.

Sends enriched ICP leads to an Instantly campaign.
Handles deduplication via skip_if_in_workspace and records send status.

Sequence variables injected per lead:
  {{Name}}         — contact first name  (Instantly standard: first_name)
  {{Role}}         — job title the company is hiring for (custom variable)
  {{Sender Name}}  — configured via INSTANTLY_SENDER_NAME env var (custom variable)

Two sequence templates (A and B) are assigned alternately for A/B tracking.
The assignment is stored in custom_variables.sequence so Instantly can filter.
"""

import os
import random
from typing import Optional
import requests

INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2"
INSTANTLY_LEADS_URL = f"{INSTANTLY_BASE_URL}/leads/add"

_SEQUENCE_COUNTER = 0


def _next_sequence() -> str:
    """Alternate A/B sequence assignment across leads."""
    global _SEQUENCE_COUNTER
    seq = "A" if _SEQUENCE_COUNTER % 2 == 0 else "B"
    _SEQUENCE_COUNTER += 1
    return seq


def send_leads_to_instantly(
    leads: list[dict],
    campaign_id: str,
    api_key: str,
    sender_name: str = "",
) -> dict:
    """Send a batch of leads to an Instantly campaign.

    Each lead dict must have at minimum: to_email, first_name, company_name.
    Returns the Instantly API response plus send metrics.
    """
    if not leads:
        return {"status": "skipped", "sent_count": 0, "message": "No leads to send."}

    _sender_name = sender_name or os.getenv("INSTANTLY_SENDER_NAME", "EMB Global")

    instantly_leads = []
    for lead in leads:
        first_name = lead.get("first_name") or ""
        role = lead.get("job_title") or lead.get("contact_title") or ""
        sequence = _next_sequence()

        instantly_lead = {
            "email": lead.get("to_email") or lead.get("email"),
            "first_name": first_name,
            "last_name": lead.get("last_name") or "",
            "company_name": lead.get("company_name") or "",
            "website": f"https://{lead['company_domain']}" if lead.get("company_domain") else None,
            "custom_variables": {
                # Sequence template variables — match {{...}} placeholders exactly
                "Role": role,
                "Sender Name": _sender_name,
                # Tracking / extra context
                "sequence": sequence,
                "contact_title": lead.get("contact_title") or "",
                "company_domain": lead.get("company_domain") or "",
                "source": lead.get("source") or "",
            },
        }
        # Remove None values to keep the payload clean
        instantly_lead = {k: v for k, v in instantly_lead.items() if v is not None}
        instantly_leads.append(instantly_lead)

    try:
        response = requests.post(
            INSTANTLY_LEADS_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "campaign_id": campaign_id,
                "skip_if_in_workspace": True,
                "leads": instantly_leads,
            },
            timeout=30,
        )
        data = response.json() if response.content else {}
        if not response.ok:
            return {
                "status": "error",
                "sent_count": 0,
                "error": data.get("message") or data.get("error") or f"HTTP {response.status_code}",
                "instantly_response": data,
            }

        sent_count = int(
            data.get("created_count")
            or len(data.get("created_leads") or [])
            or len(instantly_leads)
        )
        return {
            "status": "sent",
            "sent_count": sent_count,
            "campaign_id": campaign_id,
            "instantly_response": data,
        }
    except Exception as exc:
        return {
            "status": "error",
            "sent_count": 0,
            "error": str(exc),
        }


def get_campaign_analytics(campaign_id: str, api_key: str) -> dict:
    """Fetch aggregate analytics for a campaign from Instantly v2 API."""
    try:
        response = requests.get(
            f"{INSTANTLY_BASE_URL}/campaigns/analytics",
            headers={"Authorization": f"Bearer {api_key}"},
            params={"id": campaign_id},
            timeout=15,
        )
        data = response.json() if response.content else {}
        if not response.ok:
            return {"error": data.get("message") or f"HTTP {response.status_code}"}
        return data
    except Exception as exc:
        return {"error": str(exc)}


def get_campaign_sending_status(campaign_id: str, api_key: str) -> dict:
    """Fetch sending health/status for a campaign from Instantly v2 API."""
    try:
        response = requests.get(
            f"{INSTANTLY_BASE_URL}/campaigns/{campaign_id}/sending-status",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        data = response.json() if response.content else {}
        if not response.ok:
            return {"error": data.get("message") or f"HTTP {response.status_code}"}
        return data
    except Exception as exc:
        return {"error": str(exc)}
