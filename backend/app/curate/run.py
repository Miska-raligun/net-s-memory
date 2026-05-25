"""CLI: ``python -m app.curate.run`` — run the LLM curator over pending candidates."""

from __future__ import annotations

import asyncio

from app.crypto.keys import load_or_create_signing_key
from app.curate.select import curate_pending
from app.db.session import SessionLocal
from app.llm.factory import build_llm_client
from app.settings import settings


async def _main() -> None:
    if not settings.llm_api_key:
        raise SystemExit("LLM_API_KEY is not set — curation requires an LLM provider")
    llm = build_llm_client(settings)
    key = load_or_create_signing_key(settings.service_signing_key_path)
    async with SessionLocal() as session:
        report = await curate_pending(
            session=session, llm_client=llm, signing_key=key
        )
    print(
        f"curated {report.promoted} clusters, rejected {report.rejected}, "
        f"skipped {report.skipped} (of {report.seen_clusters} seen)"
    )


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
