from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import CurrentUser, get_current_user
from app.crypto.canonical import encode
from app.crypto.log import append_vote
from app.db.models import NewsItem, UserAccount, Vote
from app.db.session import get_session

router = APIRouter(prefix="/api/news/{news_id}", tags=["vote"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class VoteRequest(BaseModel):
    score: int = Field(ge=-1, le=1)
    reason: str = ""
    voted_at: str = Field(
        description="ISO 8601 UTC timestamp string used in the canonical payload"
    )
    sig: str = Field(description="hex-encoded Ed25519 signature over canonical bytes")


def _canonical(
    news_id: uuid.UUID, user_id: uuid.UUID, score: int, reason: str, voted_at: str
) -> bytes:
    return encode(
        {
            "schema": "vote.v1",
            "news_id": str(news_id),
            "user_id": str(user_id),
            "score": score,
            "reason": reason,
            "voted_at": voted_at,
        }
    )


def _decode_sig(hexed: str) -> bytes:
    try:
        b = bytes.fromhex(hexed)
    except ValueError as e:
        raise HTTPException(400, "sig must be hex") from e
    if len(b) != 64:
        raise HTTPException(400, "sig must be 64 bytes")
    return b


@router.post("/vote")
async def cast_vote(
    news_id: uuid.UUID,
    req: VoteRequest,
    user: CurrentUser,
    session: SessionDep,
) -> dict[str, Any]:
    if (await session.get(NewsItem, news_id)) is None:
        raise HTTPException(404, "news not found")

    existing = (
        await session.execute(
            select(Vote).where(Vote.news_id == news_id, Vote.user_id == user.id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "already voted")

    canonical = _canonical(news_id, user.id, req.score, req.reason, req.voted_at)
    sig = _decode_sig(req.sig)
    try:
        VerifyKey(user.pubkey_ed25519).verify(canonical, sig)
    except BadSignatureError as e:
        raise HTTPException(400, "signature does not verify") from e

    vote = Vote(
        id=uuid.uuid4(),
        news_id=news_id,
        user_id=user.id,
        score=req.score,
        reason=req.reason,
        sig=sig,
        canonical_bytes=canonical,
    )
    session.add(vote)
    await session.flush()

    seq, h = await append_vote(session, vote)
    await session.commit()

    return {
        "id": str(vote.id),
        "score": vote.score,
        "leaf_seq": seq,
        "leaf_hash": h.hex(),
    }


def _vote_to_dict(vote: Vote) -> dict[str, Any]:
    return {
        "id": str(vote.id),
        "score": vote.score,
        "reason": vote.reason,
        "voted_at": vote.voted_at.isoformat(),
    }


@router.get("/votes")
async def list_votes(news_id: uuid.UUID, session: SessionDep) -> dict[str, Any]:
    counts = (
        await session.execute(
            select(Vote.score, func.count())
            .where(Vote.news_id == news_id)
            .group_by(Vote.score)
        )
    ).all()
    breakdown = {str(score): count for score, count in counts}
    total = sum(breakdown.values()) if breakdown else 0

    rows = (
        await session.execute(
            select(Vote.score, UserAccount.reputation)
            .join(UserAccount, Vote.user_id == UserAccount.id)
            .where(Vote.news_id == news_id)
        )
    ).all()

    if rows:
        weight_total = sum(1.0 + max(0.0, rep) for _, rep in rows)
        weighted_sum = sum(score * (1.0 + max(0.0, rep)) for score, rep in rows)
        weighted_score = weighted_sum / weight_total if weight_total > 0 else 0.0
    else:
        weighted_score = 0.0

    return {
        "news_id": str(news_id),
        "vote_count": total,
        "score_breakdown": breakdown,
        "weighted_score": weighted_score,
    }


@router.get("/vote/me")
async def my_vote(
    news_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
) -> dict[str, Any] | None:
    vote = (
        await session.execute(
            select(Vote).where(Vote.news_id == news_id, Vote.user_id == user.id)
        )
    ).scalar_one_or_none()
    if vote is None:
        return None
    return _vote_to_dict(vote)


_ = get_current_user  # re-export keeps the dep importable for tests
