from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import CurrentUser
from app.db.models import EventFollowup
from app.db.session import get_session
from app.followup.pipeline import run_followup
from app.llm.base import LLMClient
from app.llm.factory import build_llm_client
from app.search.base import SearchClient
from app.search.factory import build_search_client
from app.settings import settings

router = APIRouter(prefix="/api/events/{event_id}/followup", tags=["followup"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_search_client() -> SearchClient | None:
    try:
        return build_search_client(settings)
    except ValueError:
        return None


def get_llm_for_followup() -> LLMClient | None:
    if not settings.llm_api_key:
        return None
    try:
        return build_llm_client(settings)
    except ValueError:
        return None


SearchDep = Annotated["SearchClient | None", Depends(get_search_client)]
LLMDep = Annotated["LLMClient | None", Depends(get_llm_for_followup)]


def _serialize(row: EventFollowup) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "event_id": str(row.event_id),
        "requested_by": str(row.requested_by) if row.requested_by else None,
        "model": row.model,
        "search_provider": row.search_provider,
        "status": row.status,
        "generated_at": row.generated_at.isoformat(),
        "payload": row.payload,
    }


@router.post("")
async def trigger_followup(
    event_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    search_client: SearchDep,
    llm_client: LLMDep,
) -> dict[str, Any]:
    if search_client is None:
        raise HTTPException(503, "followup search not configured (set SEARCH_PROVIDER)")
    if llm_client is None:
        raise HTTPException(503, "LLM not configured (set LLM_API_KEY)")

    try:
        row = await run_followup(
            session=session,
            event_id=event_id,
            search_client=search_client,
            llm_client=llm_client,
            requested_by=user.id,
        )
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    return _serialize(row)


@router.get("/latest")
async def latest_followup(event_id: uuid.UUID, session: SessionDep) -> dict[str, Any] | None:
    row = (
        await session.execute(
            select(EventFollowup)
            .where(EventFollowup.event_id == event_id)
            .order_by(desc(EventFollowup.generated_at))
            .limit(1)
        )
    ).scalar_one_or_none()
    return _serialize(row) if row else None


@router.get("")
async def list_followups(event_id: uuid.UUID, session: SessionDep) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(EventFollowup)
            .where(EventFollowup.event_id == event_id)
            .order_by(desc(EventFollowup.generated_at))
        )
    ).scalars().all()
    return [_serialize(r) for r in rows]
