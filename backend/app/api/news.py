from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import CurrentUser
from app.db.models import MerkleLeaf, NewsItem, NewsSignature
from app.db.session import get_session
from app.events.cluster import ensure_event_for_news, event_for_news
from app.log_state import load_log_state

router = APIRouter(prefix="/api/news", tags=["news"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("")
async def list_news(session: SessionDep, limit: int = 50, offset: int = 0) -> list[dict]:
    rows = (
        (
            await session.execute(
                select(NewsItem)
                .order_by(NewsItem.fetched_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(r.id),
            "source": r.source,
            "title": r.title,
            "source_url": r.source_url,
            "lang": r.lang,
            "hot_rank": r.hot_rank,
            "fetched_at": r.fetched_at.isoformat(),
            "classification": r.classification,
            "summary": r.summary,
            "why_matters": r.why_matters,
            "curator": r.curator,
        }
        for r in rows
    ]


@router.get("/{news_id}")
async def get_news(news_id: uuid.UUID, session: SessionDep) -> dict:
    item = (
        await session.execute(select(NewsItem).where(NewsItem.id == news_id))
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="news not found")
    event_id = await event_for_news(session, news_id)
    return {
        "id": str(item.id),
        "source": item.source,
        "source_url": item.source_url,
        "source_id": item.source_id,
        "title": item.title,
        "raw_text": item.raw_text,
        "lang": item.lang,
        "hot_rank": item.hot_rank,
        "fetched_at": item.fetched_at.isoformat(),
        "classification": item.classification,
        "summary": item.summary,
        "why_matters": item.why_matters,
        "citations": item.citations or [],
        "curator": item.curator,
        "event_id": str(event_id) if event_id else None,
    }


@router.post("/{news_id}/ensure-event")
async def post_ensure_event(
    news_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
) -> dict:
    """Return the event_id for this news, creating a singleton event
    if there isn't one yet. Used by the news detail page so a user can
    track follow-ups even on an isolated record. Requires auth so the
    creation is attributable to a request."""
    _ = user  # auth gate; we don't persist requester here
    try:
        event_id = await ensure_event_for_news(session, news_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    return {"event_id": str(event_id)}


@router.get("/{news_id}/proof")
async def get_proof(news_id: uuid.UUID, session: SessionDep) -> dict:
    sig = (
        await session.execute(
            select(NewsSignature)
            .where(NewsSignature.news_id == news_id)
            .order_by(NewsSignature.id)
        )
    ).scalars().first()
    leaf = (
        await session.execute(
            select(MerkleLeaf).where(
                MerkleLeaf.ref_id == news_id,
                MerkleLeaf.leaf_type == "news",
            )
        )
    ).scalars().first()
    if sig is None or leaf is None:
        raise HTTPException(status_code=404, detail="proof not found")

    state = await load_log_state(session)
    leaf_index, audit_path = state.proof_for_seq(leaf.seq)
    root = state.root()
    assert root is not None

    return {
        "news_id": str(news_id),
        "leaf_type": leaf.leaf_type,
        "leaf_hash": leaf.leaf_hash.hex(),
        "leaf_index": leaf_index,
        "tree_size": state.size,
        "root_hash": root.hex(),
        "canonical": sig.canonical_bytes.decode("latin-1"),
        "signature": sig.sig.hex(),
        "pubkey": sig.pubkey.hex(),
        "signer": sig.signer,
        "alg": sig.alg,
        "audit_path": [p.hex() for p in audit_path],
    }
