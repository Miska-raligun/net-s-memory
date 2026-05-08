from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.log import append_news_signed
from app.db.models import NewsItem
from app.ingest.base import NewsItemDraft


def _isoformat_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_canonical_payload(item: NewsItem) -> dict[str, Any]:
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


async def ingest_drafts(
    session: AsyncSession,
    drafts: list[NewsItemDraft],
    signer_id: str,
    signing_key: SigningKey,
) -> int:
    inserted = 0
    for draft in drafts:
        existing = await session.execute(
            select(NewsItem.id).where(
                NewsItem.source == draft.source,
                NewsItem.source_id == draft.source_id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            continue

        item = NewsItem(
            id=uuid.uuid4(),
            source=draft.source,
            source_url=draft.source_url,
            source_id=draft.source_id,
            title=draft.title,
            raw_text=draft.raw_text,
            lang=draft.lang,
            hot_rank=draft.hot_rank,
            fetched_at=draft.fetched_at,
        )
        session.add(item)
        await session.flush()

        await append_news_signed(
            session=session,
            news_id=item.id,
            payload=to_canonical_payload(item),
            signer_id=signer_id,
            signing_key=signing_key,
        )
        inserted += 1

    await session.commit()
    return inserted
