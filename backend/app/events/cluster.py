"""Incremental, char-trigram-based event clustering.

For each unassigned news item we look at similar items in a wide
window (default 7 days) using the same Jaccard heuristic as the
cross-source signal. If any of the similar items already belong to an
event, we attach the new item to that event with kind=update. If they
don't, but the cluster spans at least ``min_sources`` distinct
sources, we promote the cluster to a new event whose origin is the
oldest item.

This is intentionally simple — embeddings are deferred. The contract
of this module (events table state) won't change when we swap the
similarity backend, so the rest of the app is insulated.
"""

from __future__ import annotations

import re
import uuid
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyze.cross_source import char_trigrams, jaccard
from app.db.models import Event, EventNews, NewsItem

DEFAULT_WINDOW_HOURS = 7 * 24
DEFAULT_SIMILARITY = 0.3
DEFAULT_MIN_SOURCES = 3

_NON_WORD = re.compile(r"[\s\W_]+", flags=re.UNICODE)


def _slug_for(title: str, suffix: str) -> str:
    head = _NON_WORD.sub("-", title).strip("-")[:48]
    return f"{head}-{suffix}" if head else suffix


def _aware(dt: datetime) -> datetime:
    """Some DB backends (sqlite) drop tz on roundtrip. Normalize for sorting."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


async def _next_position(session: AsyncSession, event_id: uuid.UUID) -> int:
    cur = (
        await session.execute(
            select(func.coalesce(func.max(EventNews.position), -1)).where(
                EventNews.event_id == event_id
            )
        )
    ).scalar_one()
    return int(cur) + 1


async def event_for_news(
    session: AsyncSession, news_id: uuid.UUID
) -> uuid.UUID | None:
    """Return the event a news item already belongs to, or None."""
    return (
        await session.execute(
            select(EventNews.event_id).where(EventNews.news_id == news_id).limit(1)
        )
    ).scalar_one_or_none()


async def ensure_event_for_news(
    session: AsyncSession, news_id: uuid.UUID
) -> uuid.UUID:
    """Return the existing event id for a news item, creating a singleton
    event if none yet. Singletons are the "this story isn't yet
    corroborated by other sources, but the user wants a timeline to hang
    follow-ups off of" case. The next time the clusterer runs and finds
    same-event reports from other sources, those will attach onto this
    same event as kind='update'."""
    existing = await event_for_news(session, news_id)
    if existing is not None:
        return existing

    news = await session.get(NewsItem, news_id)
    if news is None:
        raise ValueError(f"news {news_id} not found")

    fetched_at = _aware(news.fetched_at)
    event_id = uuid.uuid4()
    event = Event(
        id=event_id,
        slug=_slug_for(news.title, str(event_id)[:8]),
        title=news.title,
        summary=news.summary or "",
        status="ongoing",
        created_at=fetched_at,
        updated_at=fetched_at,
    )
    session.add(event)
    await session.flush()
    session.add(
        EventNews(event_id=event_id, news_id=news_id, kind="origin", position=0)
    )
    await session.commit()
    return event_id


async def _attached_event_for(
    session: AsyncSession, news_ids: Iterable[uuid.UUID]
) -> uuid.UUID | None:
    ids = list(news_ids)
    if not ids:
        return None
    row = (
        await session.execute(
            select(EventNews.event_id).where(EventNews.news_id.in_(ids)).limit(1)
        )
    ).scalar_one_or_none()
    return row


async def cluster_one(
    session: AsyncSession,
    news_id: uuid.UUID,
    *,
    window_hours: int = DEFAULT_WINDOW_HOURS,
    similarity_threshold: float = DEFAULT_SIMILARITY,
    min_sources: int = DEFAULT_MIN_SOURCES,
) -> uuid.UUID | None:
    """Cluster ``news_id`` into an event. Returns the event id or None.

    Idempotent: if the news item is already in an event, returns that
    event's id without changing anything.
    """
    item = await session.get(NewsItem, news_id)
    if item is None:
        return None

    already = (
        await session.execute(select(EventNews.event_id).where(EventNews.news_id == news_id))
    ).scalar_one_or_none()
    if already is not None:
        return already

    cutoff_lo = item.fetched_at - timedelta(hours=window_hours)
    cutoff_hi = item.fetched_at + timedelta(hours=window_hours)
    candidates = (
        await session.execute(
            select(NewsItem)
            .where(NewsItem.id != news_id)
            .where(NewsItem.fetched_at >= cutoff_lo)
            .where(NewsItem.fetched_at <= cutoff_hi)
        )
    ).scalars().all()

    target_grams = char_trigrams(item.title)
    similar = [
        c
        for c in candidates
        if jaccard(target_grams, char_trigrams(c.title)) >= similarity_threshold
    ]

    existing_event = await _attached_event_for(session, (s.id for s in similar))
    if existing_event is not None:
        position = await _next_position(session, existing_event)
        session.add(
            EventNews(event_id=existing_event, news_id=news_id, kind="update", position=position)
        )
        evt = await session.get(Event, existing_event)
        if evt is not None:
            evt.updated_at = item.fetched_at
        await session.commit()
        return existing_event

    sources = {item.source} | {s.source for s in similar}
    if len(sources) < min_sources:
        return None

    cluster = sorted([item, *similar], key=lambda n: _aware(n.fetched_at))
    origin = cluster[0]
    event_id = uuid.uuid4()
    event = Event(
        id=event_id,
        slug=_slug_for(origin.title, str(event_id)[:8]),
        title=origin.title,
        summary="",
        status="ongoing",
        created_at=_aware(origin.fetched_at),
        updated_at=_aware(cluster[-1].fetched_at),
    )
    session.add(event)
    await session.flush()

    for pos, member in enumerate(cluster):
        session.add(
            EventNews(
                event_id=event_id,
                news_id=member.id,
                kind="origin" if pos == 0 else "update",
                position=pos,
            )
        )
    await session.commit()
    return event_id


async def cluster_all_unassigned(session: AsyncSession) -> dict[str, int]:
    """Run cluster_one over every news item not yet attached to an event."""
    assigned = (
        await session.execute(select(EventNews.news_id))
    ).scalars().all()
    assigned_set = set(assigned)

    items = (
        await session.execute(
            select(NewsItem).order_by(NewsItem.fetched_at.asc())
        )
    ).scalars().all()

    stats = defaultdict(int)
    for item in items:
        if item.id in assigned_set:
            continue
        result = await cluster_one(session, item.id)
        stats["seen"] += 1
        if result is not None:
            stats["assigned"] += 1
            assigned_set.add(item.id)
    return dict(stats)
