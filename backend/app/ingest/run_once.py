"""CLI: ``python -m app.ingest.run_once <source>``.

Fetches a single source synchronously, runs the ingest pipeline against the
configured database, and prints the number of newly inserted items.
"""

from __future__ import annotations

import asyncio
import sys

from app.crypto.keys import load_or_create_signing_key
from app.db.session import SessionLocal
from app.ingest.pipeline import ingest_drafts
from app.ingest.sources.rsshub import RsshubSource
from app.settings import settings

SOURCES: dict[str, tuple[str, str]] = {
    "zhihu": ("zhihu_hot", "https://rsshub.app/zhihu/hotlist"),
    "baidu": ("baidu_hot", "https://rsshub.app/baidu/realtime"),
    "weibo": ("weibo_hot", "https://rsshub.app/weibo/search/hot"),
}


async def run(name: str) -> int:
    if name not in SOURCES:
        raise SystemExit(f"unknown source {name}; available: {sorted(SOURCES)}")
    source_name, url = SOURCES[name]
    src = RsshubSource(name=source_name, url=url)
    drafts = await src.fetch()

    key = load_or_create_signing_key(settings.service_signing_key_path)
    async with SessionLocal() as session:
        return await ingest_drafts(
            session=session,
            drafts=drafts,
            signer_id="service:v1",
            signing_key=key,
        )


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "zhihu"
    count = asyncio.run(run(name))
    print(f"ingested {count} new items from {name}")


if __name__ == "__main__":
    main()
