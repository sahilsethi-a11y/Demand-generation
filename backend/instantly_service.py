"""Instantly.ai lead delivery service.

Sends enriched ICP leads to an Instantly campaign.

Send flow (3 steps):
  1. POST /leads/add  — creates leads that don't exist yet (skip_if_in_workspace=true)
  2. POST /leads/list — look up each lead's ID by email
  3. PATCH /leads/{id} — write custom variables onto every lead (new and existing)

Step 3 is always required because the /leads/add endpoint never sets custom variables
on leads that already existed — it just skips them silently.

Custom variables injected per lead (must be registered in the Instantly campaign):
  subject_m1 / body_m1   — Month 1 AI-generated subject + body
  subject_m2 / body_m2   — Month 2 follow-up
  subject_m3 / body_m3   — Month 3 soft close
  sequence               — "A" or "B" for campaign routing
"""

import logging
import requests

logger = logging.getLogger(__name__)

INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2"
INSTANTLY_LEADS_URL = f"{INSTANTLY_BASE_URL}/leads/add"


def _build_custom_variables(lead: dict) -> dict:
    return {
        "subject_m1":     lead.get("subject_m1") or "",
        "body_m1":        lead.get("body_m1") or "",
        "subject_m2":     lead.get("subject_m2") or "",
        "body_m2":        lead.get("body_m2") or "",
        "subject_m3":     lead.get("subject_m3") or "",
        "body_m3":        lead.get("body_m3") or "",
        "sequence":       lead.get("sequence") or "A",
        "contact_title":  lead.get("contact_title") or "",
        "job_title":      lead.get("job_title") or "",
    }


def send_leads_to_instantly(
    leads: list[dict],
    campaign_id: str,
    api_key: str,
    overwrite: bool = False,
) -> dict:
    """Send a batch of leads to an Instantly campaign and set their custom variables.

    Three-step flow:
      1. Add leads (creates new ones, skips existing).
      2. List leads by email to get their IDs.
      3. PATCH each lead with the custom variables (subject_m1 … body_m3, sequence).

    Step 3 runs regardless of whether the lead was just created or already existed,
    because /leads/add never writes custom variables onto existing leads.

    overwrite is kept for API compatibility — the PATCH step now handles updates
    automatically, so this param no longer needs to change skip_if_in_workspace.
    """
    if not leads:
        return {"status": "skipped", "sent_count": 0, "message": "No leads to send."}

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    # ── Step 1: Add leads ─────────────────────────────────────────────────────
    instantly_leads = []
    email_to_vars: dict[str, dict] = {}
    for lead in leads:
        email = (lead.get("to_email") or lead.get("email") or "").strip()
        if not email:
            continue
        instantly_leads.append({
            "email":        email,
            "first_name":   lead.get("first_name") or "",
            "last_name":    lead.get("last_name") or "",
            "company_name": lead.get("company_name") or "",
        })
        email_to_vars[email] = _build_custom_variables(lead)

    if not instantly_leads:
        return {"status": "skipped", "sent_count": 0, "message": "No valid lead emails."}

    try:
        add_resp = requests.post(
            INSTANTLY_LEADS_URL,
            headers=headers,
            json={"campaign_id": campaign_id, "skip_if_in_workspace": True, "leads": instantly_leads},
            timeout=30,
        )
        add_data = add_resp.json() if add_resp.content else {}
        if not add_resp.ok:
            return {
                "status": "error",
                "sent_count": 0,
                "error": add_data.get("message") or f"HTTP {add_resp.status_code}",
            }
    except Exception as exc:
        return {"status": "error", "sent_count": 0, "error": str(exc)}

    # ── Step 2: Resolve lead IDs ──────────────────────────────────────────────
    email_to_id: dict[str, str] = {}
    try:
        list_resp = requests.post(
            f"{INSTANTLY_BASE_URL}/leads/list",
            headers=headers,
            json={"campaign_id": campaign_id, "email": list(email_to_vars.keys())[0], "limit": 100},
            timeout=30,
        )
        if list_resp.ok:
            items = list_resp.json().get("items") or []
            for item in items:
                e = (item.get("email") or "").strip().lower()
                if e:
                    email_to_id[e] = item["id"]

        # If we have multiple emails, fetch all of them
        if len(email_to_vars) > 1:
            all_resp = requests.post(
                f"{INSTANTLY_BASE_URL}/leads/list",
                headers=headers,
                json={"campaign_id": campaign_id, "limit": 100},
                timeout=30,
            )
            if all_resp.ok:
                for item in (all_resp.json().get("items") or []):
                    e = (item.get("email") or "").strip().lower()
                    if e in {k.lower() for k in email_to_vars}:
                        email_to_id[e] = item["id"]
    except Exception as exc:
        logger.warning("Could not resolve Instantly lead IDs: %s", exc)

    # ── Step 3: PATCH custom variables onto every lead ────────────────────────
    patched = 0
    patch_errors = []
    for email, custom_vars in email_to_vars.items():
        lead_id = email_to_id.get(email.lower())
        if not lead_id:
            patch_errors.append(f"No ID found for {email}")
            continue
        try:
            patch_resp = requests.patch(
                f"{INSTANTLY_BASE_URL}/leads/{lead_id}",
                headers=headers,
                json={"custom_variables": custom_vars},
                timeout=15,
            )
            if patch_resp.ok:
                patched += 1
            else:
                patch_errors.append(f"{email}: HTTP {patch_resp.status_code}")
        except Exception as exc:
            patch_errors.append(f"{email}: {exc}")

    created = len(add_data.get("created_leads") or [])
    return {
        "status": "sent",
        "sent_count": len(instantly_leads),
        "created_count": created,
        "patched_count": patched,
        "campaign_id": campaign_id,
        "patch_errors": patch_errors,
        "instantly_response": add_data,
    }


def get_leads_status(emails: list[str], campaign_id: str, api_key: str) -> dict[str, dict]:
    """Fetch lead status directly from Instantly for a list of email addresses.

    Returns a dict mapping email -> normalised lead data including custom variable values
    (opens, replies, status, subject_m1, body_m1, sequence, etc.).
    Calls the Instantly API — not our local DB.

    Note: Instantly stores custom variables in the `payload` field, not `custom_variables`.
    This function merges payload into the returned dict for convenience.
    """
    if not emails:
        return {}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    results: dict[str, dict] = {}
    try:
        resp = requests.post(
            f"{INSTANTLY_BASE_URL}/leads/list",
            headers=headers,
            json={"campaign_id": campaign_id, "limit": 100},
            timeout=20,
        )
        if resp.ok:
            email_set = {e.lower() for e in emails}
            for item in resp.json().get("items") or []:
                e = (item.get("email") or "").lower()
                if e in email_set:
                    # Merge payload (custom variables) into the top-level dict
                    merged = {**item, **(item.get("payload") or {})}
                    results[e] = merged
    except Exception:
        pass
    return results


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
