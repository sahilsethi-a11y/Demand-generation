"""Apollo organization search retriever for GPT Researcher."""

from __future__ import annotations

import logging
import os
import re
from math import ceil
from typing import List, Dict, Any

import requests


logger = logging.getLogger(__name__)


class ApolloOrganizationSearch:
    def __init__(self, query: str, headers: dict | None = None, query_domains: List[str] | None = None):
        self.query = query
        self.headers = headers or {}
        self.query_domains = query_domains or []
        self.api_key = self.headers.get("apollo_api_key") or os.getenv("APOLLO_API_KEY", "")
        self.base_url = "https://api.apollo.io/api/v1/mixed_companies/search"
        self.organization_industries = self._resolve_organization_industries()
        self.organization_locations = self._resolve_organization_locations()
        self.keyword_tags = self._resolve_keyword_tags()
        self.per_page = self._resolve_per_page()
        self.last_debug: dict | None = None

    @staticmethod
    def _normalize_string_list(value: Any) -> List[str]:
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return []

    def _resolve_organization_industries(self) -> List[str]:
        header_value = self.headers.get("organization_industries") or self.headers.get("investor_type")
        normalized_header = self._normalize_string_list(header_value)
        if normalized_header:
            mapped = [self._normalize_industry_value(value) for value in normalized_header]
            return list(dict.fromkeys([value for value in mapped if value]))

        query_lower = (self.query or "").lower()
        if (
            re.search(r"\bvc\b", query_lower)
            or "venture capital" in query_lower
            or "private equity" in query_lower
        ):
            return ["venture capital & private equity"]

        return []

    @staticmethod
    def _normalize_industry_value(value: str) -> str:
        cleaned = value.strip()
        lowered = cleaned.lower()
        if "venture capital" in lowered or "private equity" in lowered or lowered == "vc":
            return "venture capital & private equity"
        return cleaned

    def _resolve_organization_locations(self) -> List[str]:
        header_value = (
            self.headers.get("organization_locations")
            or self.headers.get("hq_country")
            or self.headers.get("hqCountry")
        )
        return self._normalize_string_list(header_value)

    def _resolve_keyword_tags(self) -> List[str]:
        header_value = (
            self.headers.get("organization_keyword_tags")
            or self.headers.get("q_organization_keyword_tags")
        )
        tags = self._normalize_string_list(header_value)
        if not tags:
            tags.extend(self._normalize_string_list(self.headers.get("industry")))
            tags.extend(self._normalize_string_list(self.headers.get("investor_type")))
        normalized = [tag.lower() for tag in tags if tag.strip()]
        return list(dict.fromkeys(normalized))

    def _resolve_per_page(self) -> int | None:
        header_value = self.headers.get("company_count") or self.headers.get("per_page")
        if isinstance(header_value, str) and header_value.strip().isdigit():
            return int(header_value)
        if isinstance(header_value, (int, float)):
            return int(header_value)
        return None

    def _build_payload(self, page: int, per_page: int) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "page": page,
            "per_page": per_page,
        }
        if self.organization_locations:
            payload["organization_locations"] = self.organization_locations
        if self.organization_industries:
            payload["organization_industries"] = self.organization_industries
        if self.keyword_tags:
            payload["q_organization_keyword_tags"] = self.keyword_tags
        return payload

    @staticmethod
    def _normalize_url(value: str | None) -> str:
        if not value:
            return ""
        if value.startswith("http://") or value.startswith("https://"):
            return value
        return f"https://{value}"

    def _format_results(self, data: Dict[str, Any]) -> List[Dict[str, str]]:
        organizations = (
            data.get("companies")
            or data.get("organizations")
            or data.get("accounts")
            or []
        )
        results: List[Dict[str, str]] = []
        for org in organizations:
            if not isinstance(org, dict):
                continue
            name = org.get("name") or "Unknown organization"
            website = org.get("website_url") or org.get("primary_domain") or ""
            linkedin = org.get("linkedin_url") or ""
            href = self._normalize_url(website) or self._normalize_url(linkedin)
            body_parts = [f"Name: {name}"]
            if website:
                body_parts.append(f"Website: {website}")
            if linkedin:
                body_parts.append(f"LinkedIn: {linkedin}")
            results.append({
                "href": href,
                "body": "\n".join(body_parts),
            })
        return results

    def search(self, max_results: int = 10) -> List[Dict[str, str]]:
        if not self.api_key:
            return []
        try:
            per_page = min(self.per_page or 100, 100)
            pages_to_fetch = min(2, max(1, ceil(max_results / per_page)))
            collected: List[Dict[str, str]] = []
            responses: List[Dict[str, Any]] = []
            payloads: List[Dict[str, Any]] = []
            for page in range(1, pages_to_fetch + 1):
                payload = self._build_payload(page, per_page)
                payloads.append(payload)
                logger.info("Apollo organization search payload: %s", payload)
                response = requests.post(
                    self.base_url,
                    headers={
                        "Content-Type": "application/json",
                        "X-Api-Key": self.api_key,
                    },
                    json=payload,
                    timeout=60,
                )
                response.raise_for_status()
                data = response.json()
                responses.append(data)
                collected.extend(self._format_results(data))
                if len(collected) >= max_results:
                    break
            self.last_debug = {
                "provider": "apollo",
                "endpoint": self.base_url,
                "payload": payloads,
                "response": responses,
            }
            return collected[:max_results]
        except Exception as exc:
            if self.last_debug is None:
                self.last_debug = {
                    "provider": "apollo",
                    "endpoint": self.base_url,
                    "payload": payloads if "payloads" in locals() else [],
                    "response": {"error": str(exc)},
                }
            return []