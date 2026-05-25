"""CLI: ``python -m app.discover.run`` — proactively find today's events.

Requires both LLM_API_KEY and SEARCH_PROVIDER to be configured. Unlike
ingest, this needs zero hot-list data — it asks the search engine and
then the LLM what happened today.
"""

from __future__ import annotations

import asyncio

from app.crypto.keys import load_or_create_signing_key
from app.db.session import SessionLocal
from app.discover.pipeline import discover_once
from app.llm.factory import build_llm_client
from app.search.factory import build_search_client
from app.settings import settings


async def _main() -> None:
    if not settings.llm_api_key:
        raise SystemExit("LLM_API_KEY is not set — discover needs an LLM provider")
    search = build_search_client(settings)
    if search is None:
        raise SystemExit(
            "SEARCH_PROVIDER is not set — discover needs a web search backend"
        )
    llm = build_llm_client(settings)
    key = load_or_create_signing_key(settings.service_signing_key_path)

    async with SessionLocal() as session:
        report = await discover_once(
            session=session,
            llm_client=llm,
            search_client=search,
            signing_key=key,
        )

    print(
        f"discover: ran {report.queries} queries → pooled "
        f"{report.search_results_pooled} unique results → "
        f"LLM proposed {report.events_proposed} events → "
        f"{report.promoted} promoted to timeline, "
        f"{report.rejected_low_citations} rejected (<2 citations), "
        f"{report.skipped_invalid} skipped (invalid)"
    )


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
