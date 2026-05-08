from __future__ import annotations

from app.search.base import SearchClient
from app.search.minimax import MinimaxSearchClient
from app.search.stub import StubSearchClient
from app.settings import Settings
from app.settings import settings as default_settings


def build_search_client(s: Settings | None = None) -> SearchClient | None:
    """Return a search client based on settings, or None if not configured.

    Returning None lets the followup pipeline degrade gracefully — the
    caller handles the "no search backend" case explicitly rather than
    suddenly seeing empty result lists.
    """
    s = s or default_settings
    provider = (s.search_provider or "").strip().lower()
    if not provider:
        return None
    if provider == "stub":
        return StubSearchClient()
    if provider == "minimax":
        return MinimaxSearchClient(
            api_key=s.search_api_key,
            base_url=s.search_base_url or "https://api.minimaxi.chat/v1",
            timeout=s.search_timeout,
        )
    raise ValueError(f"unknown SEARCH_PROVIDER {provider!r}")
