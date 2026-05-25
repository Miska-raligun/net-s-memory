"""Deterministic stub search client for tests + local dev with no API key."""

from __future__ import annotations

from datetime import datetime

from app.search.base import SearchResult


class StubSearchClient:
    name = "stub"

    def __init__(self, results: list[SearchResult] | None = None) -> None:
        self._results = list(results or [])
        self.calls: list[tuple[str, int, datetime | None]] = []

    async def search(
        self,
        query: str,
        *,
        limit: int = 10,
        after: datetime | None = None,
    ) -> list[SearchResult]:
        self.calls.append((query, limit, after))
        out = self._results
        if after is not None:
            out = [
                r for r in out if r.published_at is None or r.published_at >= after
            ]
        return out[:limit]
