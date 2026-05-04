"""Instantly.ai lead delivery service.

Sends enriched, email-generated ICP leads to an Instantly campaign.
Handles deduplication via skip_if_in_workspace and records send status.
"""

from typing import Optional
import requests

INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2"
INSTANTLY_LEADS_URL = f"{INSTANTLY_BASE_URL}/leads/add"


def send_leads_to_instantly(
    leads: list[dict],
    campaign_id: str,
    api_key: str,
) -> dict:
    """Send a batch of leads to an Instantly campaign.

    Each lead dict must have at minimum: to_email, first_name, company_name.
    Returns the Instantly API response plus send metrics.
    """
    if not leads:
        return {"status": "skipped", "sent_count": 0, "message": "No leads to send."}

    instantly_leads = []
    for lead in leads:
        instantly_lead = {
            "email": lead.get("to_email") or lead.get("email"),
            "first_name": lead.get("first_name") or "",
            "last_name": lead.get("last_name") or "",
            "company_name": lead.get("company_name") or "",
            "website": f"https://{lead['company_domain']}" if lead.get("company_domain") else None,
            "personalization": lead.get("email_body") or "",
            "custom_variables": {
                "subject_1": lead.get("subject_1") or "",
                "subject_2": lead.get("subject_2") or "",
                "email_body": lead.get("email_body") or "",
                "signal_summary": lead.get("signal_summary") or "",
                "job_title": lead.get("job_title") or "",
                "company_domain": lead.get("company_domain") or "",
                "contact_title": lead.get("contact_title") or "",
                "priority": lead.get("priority") or "medium",
                "source": lead.get("source") or "",
                "first_name": lead.get("first_name") or "",
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
