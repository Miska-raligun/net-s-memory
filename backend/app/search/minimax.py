"""MiniMax web-search client.

NOTE: the wire format is filled in once the user shares their MiniMax
search code plan. The skeleton below documents the contract the rest
of the app expects so swapping in the real implementation is a one-file
change.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.search.base import SearchError, SearchResult


class MinimaxSearchClient:
    name = "minimax"

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.minimaxi.chat/v1",
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._transport = transport

    async def search(
        self,
        query: str,
        *,
        limit: int = 10,
        after: datetime | None = None,
    ) -> list[SearchResult]:
        # TODO: wire to MiniMax web-search per user's code plan.
        # The contract is: send query (and optional date filter), parse
        # the response into SearchResult tuples. Until that lands the
        # client refuses to be used to avoid silent empty results.
        raise SearchError(
            "MinimaxSearchClient is not wired up yet — provide the search code plan"
        )

    @staticmethod
    def _parse_response(payload: dict[str, Any]) -> list[SearchResult]:
        """Parse MiniMax search response into SearchResult list.

        Implemented as a static method so it can be unit-tested
        independently once the response shape is known.
        """
        raise NotImplementedError
