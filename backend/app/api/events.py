from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Event, EventNews, NewsItem
from app.db.session import get_session

router = APIRouter(prefix="/api/events", tags=["events"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("")
async def list_events(
    session: SessionDep, limit: int = 50, offset: int = 0
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(
                Event,
                func.count(EventNews.id).label("count"),
            )
            .join(EventNews, EventNews.event_id == Event.id, isouter=True)
            .group_by(Event.id)
            .order_by(Event.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    out: list[dict[str, Any]] = []
    for e, c in rows:
        origin = (
            await session.execute(
                select(EventNews.news_id)
                .where(EventNews.event_id == e.id)
                .order_by(EventNews.position.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        out.append(
            {
                "id": str(e.id),
                "slug": e.slug,
                "title": e.title,
                "summary": e.summary,
                "status": e.status,
                "news_count": int(c),
                "created_at": e.created_at.isoformat(),
                "updated_at": e.updated_at.isoformat(),
                "origin_news_id": str(origin) if origin else None,
            }
        )
    return out


@router.get("/{event_id}")
async def get_event(event_id: uuid.UUID, session: SessionDep) -> dict[str, Any]:
    e = await session.get(Event, event_id)
    if e is None:
        raise HTTPException(404, "event not found")

    rows = (
        await session.execute(
            select(EventNews, NewsItem)
            .join(NewsItem, NewsItem.id == EventNews.news_id)
            .where(EventNews.event_id == event_id)
            .order_by(EventNews.position.asc(), NewsItem.fetched_at.asc())
        )
    ).all()

    return {
        "id": str(e.id),
        "slug": e.slug,
        "title": e.title,
        "summary": e.summary,
        "status": e.status,
        "created_at": e.created_at.isoformat(),
        "updated_at": e.updated_at.isoformat(),
        "timeline": [
            {
                "kind": en.kind,
                "position": en.position,
                "added_at": en.added_at.isoformat(),
                "news": {
                    "id": str(n.id),
                    "source": n.source,
                    "source_url": n.source_url,
                    "title": n.title,
                    "raw_text": n.raw_text,
                    "fetched_at": n.fetched_at.isoformat(),
                },
            }
            for en, n in rows
        ],
    }
