"""Ingest writes *candidates* — never directly to news_item.

This is deliberate: aggregator hot lists are noisy (营销/娱乐/短期情绪话题
混在真正值得记录的事件里), so the public, signed timeline must not be a
verbatim mirror of them. Candidates are the raw pool; the LLM curator
(``app.curate``) decides which clusters get promoted to NewsItem, signed,
and entered into the Merkle log.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import NewsCandidate, NewsItem
from app.ingest.base import NewsItemDraft


def _isoformat_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_canonical_payload(item: NewsItem) -> dict[str, Any]:
    """Canonical payload for an already-promoted (curated) NewsItem.

    Uses schema v2 when curation metadata is present, otherwise falls back
    to v1 for legacy / direct-seeded items so older signed rows continue
    to verify byte-for-byte.
    """
    if item.classification or item.summary or item.citations or item.curator:
        return {
            "schema": "news_item.v2",
            "id": str(item.id),
            "title": item.title,
            "summary": item.summary or "",
            "why_matters": item.why_matters or "",
            "classification": item.classification or "",
            "lang": item.lang,
            "fetched_at": _isoformat_utc(item.fetched_at),
            "citations": [
                {
                    "source": str(c.get("source", "")),
                    "source_url": str(c.get("source_url", "")),
                    "source_id": str(c.get("source_id", "")),
                    "title": str(c.get("title", "")),
                }
                for c in (item.citations or [])
            ],
            "curator": item.curator or "",
        }
    return {
        "schema": "news_item.v1",
        "id": str(item.id),
        "source": item.source,
        "source_url": item.source_url,
        "source_id": item.source_id or "",
        "title": item.title,
        "raw_text": item.raw_text,
        "lang": item.lang,
        "hot_rank": item.hot_rank if item.hot_rank is not None else -1,
        "fetched_at": _isoformat_utc(item.fetched_at),
    }


async def ingest_candidates(
    session: AsyncSession, drafts: list[NewsItemDraft]
) -> int:
    """Persist drafts as pending candidates. No signing, no Merkle log.

    Deduplicated on (source, source_id). Returns the number of newly
    inserted candidates. The curator is the only thing that decides
    whether any of these reach the public timeline.
    """
    inserted = 0
    for draft in drafts:
        existing = await session.execute(
            select(NewsCandidate.id).where(
                NewsCandidate.source == draft.source,
                NewsCandidate.source_id == draft.source_id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            continue

        session.add(
            NewsCandidate(
                id=uuid.uuid4(),
                source=draft.source,
                source_url=draft.source_url,
                source_id=draft.source_id,
                title=draft.title,
                raw_text=draft.raw_text,
                lang=draft.lang,
                hot_rank=draft.hot_rank,
                fetched_at=draft.fetched_at,
                status="pending",
            )
        )
        inserted += 1

    await session.commit()
    return inserted
