from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import NewsCandidate
from app.db.session import get_session

router = APIRouter(prefix="/api/candidates", tags=["candidates"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

_ALLOWED = {"pending", "curated", "rejected"}


def _serialize(c: NewsCandidate) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "source": c.source,
        "source_url": c.source_url,
        "source_id": c.source_id,
        "title": c.title,
        "raw_text": c.raw_text,
        "lang": c.lang,
        "hot_rank": c.hot_rank,
        "fetched_at": c.fetched_at.isoformat(),
        "status": c.status,
        "news_item_id": str(c.news_item_id) if c.news_item_id else None,
        "rejected_reason": c.rejected_reason,
        "decided_at": c.decided_at.isoformat() if c.decided_at else None,
    }


@router.get("")
async def list_candidates(
    session: SessionDep,
    status: Annotated[str, Query(description="pending / curated / rejected")] = "pending",
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    if status not in _ALLOWED:
        raise HTTPException(400, f"status must be one of {sorted(_ALLOWED)}")
    rows = (
        await session.execute(
            select(NewsCandidate)
            .where(NewsCandidate.status == status)
            .order_by(NewsCandidate.fetched_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return [_serialize(r) for r in rows]
