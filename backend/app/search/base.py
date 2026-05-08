"""Provider-neutral web-search interface for the followup pipeline.

Concrete clients (MiniMax web search, Brave, GDELT, etc.) implement
``search`` and return a flat list of ``SearchResult``. The followup
pipeline consumes that list — it never reads provider-specific fields.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str
    source: str
    published_at: datetime | None


class SearchClient(Protocol):
    name: str

    async def search(
        self,
        query: str,
        *,
        limit: int = 10,
        after: datetime | None = None,
    ) -> list[SearchResult]: ...


class SearchError(RuntimeError):
    pass
