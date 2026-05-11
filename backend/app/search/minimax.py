"""MiniMax web-search client.

Wire format (from MiniMax-AI/MiniMax-Coding-Plan-MCP):

    POST {base_url}/v1/coding_plan/search
    Authorization: Bearer <api_key>
    Content-Type: application/json
    MM-API-Source: net-s-memory

    body:    {"q": "<query>"}
    success: {"organic": [{"title", "link", "snippet", "date"}, ...],
              "related_searches": [{"query"}, ...],
              "base_resp": {"status_code": 0, "status_msg": ""}}
    error:    base_resp.status_code != 0  (1004 = invalid key, 2038 = real-name)

Hosts are region-locked and must match the api key's region:
- Global   :  https://api.minimax.io
- Mainland :  https://api.minimaxi.com

The API doesn't take a result-limit or date filter, so we trim and
filter client-side after parsing the optional per-result ``date``
string into a datetime when we recognise it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import httpx

from app.search.base import SearchError, SearchResult

DEFAULT_HOST = "https://api.minimax.io"
ENDPOINT = "/v1/coding_plan/search"


class MinimaxSearchClient:
    name = "minimax"

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_HOST,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
        source_tag: str = "net-s-memory",
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._transport = transport
        self._source_tag = source_tag

    async def search(
        self,
        query: str,
        *,
        limit: int = 10,
        after: datetime | None = None,
    ) -> list[SearchResult]:
        if not query:
            raise SearchError("query is required")

        async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
            r = await client.post(
                f"{self.base_url}{ENDPOINT}",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "MM-API-Source": self._source_tag,
                },
                json={"q": query},
            )

        if r.status_code >= 400:
            raise SearchError(f"minimax HTTP {r.status_code}: {r.text[:300]}")

        try:
            data = r.json()
        except ValueError as e:
            raise SearchError(f"minimax: response is not JSON: {r.text[:200]!r}") from e

        base_resp = data.get("base_resp") or {}
        status = base_resp.get("status_code")
        if status not in (0, None):
            msg = base_resp.get("status_msg") or "unknown error"
            raise SearchError(f"minimax error {status}: {msg}")

        return self._parse_response(data, limit=limit, after=after)

    @staticmethod
    def _parse_response(
        payload: dict[str, Any],
        *,
        limit: int = 10,
        after: datetime | None = None,
    ) -> list[SearchResult]:
        organic = payload.get("organic") or []
        if not isinstance(organic, list):
            return []

        results: list[SearchResult] = []
        for item in organic:
            if not isinstance(item, dict):
                continue
            url = str(item.get("link") or "").strip()
            if not url:
                continue
            title = str(item.get("title") or "").strip()
            snippet = str(item.get("snippet") or "").strip()
            published = _parse_date(item.get("date"))
            if after is not None and published is not None and published < after:
                continue
            source = ""
            try:
                source = urlparse(url).netloc
            except ValueError:
                source = ""
            results.append(
                SearchResult(
                    title=title,
                    url=url,
                    snippet=snippet,
                    source=source,
                    published_at=published,
                )
            )
            if len(results) >= limit:
                break
        return results


_DATE_FORMATS: tuple[str, ...] = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S.%fZ",
    "%b %d, %Y",
    "%d %b %Y",
)


def _parse_date(value: Any) -> datetime | None:
    """Best-effort parse of MiniMax's free-form ``date`` string.

    Returns None for empty / relative ('2 days ago') / unrecognised inputs.
    The caller is expected to treat None as "publish date unknown" rather
    than as "matches any window".
    """
    if not value or not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt
        except ValueError:
            continue
    return None
