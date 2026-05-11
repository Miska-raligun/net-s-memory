"""CLI: ``python -m app.ingest.run_once <source>``.

Pulls a hot-list source and persists each entry as a *candidate*. Nothing
is signed or entered into the Merkle log here — that only happens when
the LLM curator (``python -m app.curate.run``) decides a cluster is
worth recording.
"""

from __future__ import annotations

import asyncio
import sys

from app.db.session import SessionLocal
from app.ingest.pipeline import ingest_candidates
from app.ingest.sources.rsshub import RsshubSource

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

    async with SessionLocal() as session:
        return await ingest_candidates(session=session, drafts=drafts)


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "zhihu"
    count = asyncio.run(run(name))
    print(f"ingested {count} new candidates from {name}")
    print("next: python -m app.curate.run  (LLM-driven curation)")


if __name__ == "__main__":
    main()
