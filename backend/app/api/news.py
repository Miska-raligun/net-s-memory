from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MerkleLeaf, NewsItem, NewsSignature
from app.db.session import get_session
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
    }


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
