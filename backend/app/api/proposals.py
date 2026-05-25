from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.analysis import SigningKeyDep
from app.api.auth import CurrentUser
from app.db.models import EventMergeProposal, MergeProposalVote
from app.db.session import get_session
from app.proposals.merge import (
    aggregate,
    cast_proposal_vote,
    create_proposal,
)

router = APIRouter(prefix="/api", tags=["merge-proposals"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class ProposalRequest(BaseModel):
    proposal_id: str
    followup_id: str
    selected_developments: list[dict[str, Any]] = Field(min_length=1)
    proposed_at: str
    sig: str


class ProposalVoteRequest(BaseModel):
    score: int = Field(ge=-1, le=1)
    voted_at: str
    sig: str


def _serialize_proposal(p: EventMergeProposal) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "event_id": str(p.event_id),
        "followup_id": str(p.followup_id),
        "proposed_by": str(p.proposed_by),
        "selected_developments": p.selected_developments,
        "proposed_at": p.proposed_at.isoformat(),
        "status": p.status,
        "decided_at": p.decided_at.isoformat() if p.decided_at else None,
        "pubkey": p.pubkey.hex(),
        "sig": p.sig.hex(),
    }


@router.post("/events/{event_id}/merge-proposals")
async def post_proposal(
    event_id: uuid.UUID,
    req: ProposalRequest,
    user: CurrentUser,
    session: SessionDep,
) -> dict[str, Any]:
    try:
        followup_id = uuid.UUID(req.followup_id)
        proposal_id = uuid.UUID(req.proposal_id)
    except ValueError as e:
        raise HTTPException(400, "invalid uuid") from e
    try:
        proposal = await create_proposal(
            session=session,
            proposal_id=proposal_id,
            event_id=event_id,
            followup_id=followup_id,
            user=user,
            selected_developments=req.selected_developments,
            proposed_at=req.proposed_at,
            sig_hex=req.sig,
        )
    except ValueError as e:
        msg = str(e)
        if "already exists" in msg:
            raise HTTPException(409, msg) from e
        raise HTTPException(400, msg) from e
    return _serialize_proposal(proposal)


@router.get("/events/{event_id}/merge-proposals")
async def list_proposals(
    event_id: uuid.UUID, session: SessionDep
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(EventMergeProposal)
            .where(EventMergeProposal.event_id == event_id)
            .order_by(EventMergeProposal.proposed_at.desc())
        )
    ).scalars().all()
    return [_serialize_proposal(p) for p in rows]


@router.get("/merge-proposals/{proposal_id}")
async def get_proposal(
    proposal_id: uuid.UUID, session: SessionDep
) -> dict[str, Any]:
    p = await session.get(EventMergeProposal, proposal_id)
    if p is None:
        raise HTTPException(404, "proposal not found")
    agg = await aggregate(session, proposal_id)
    body = _serialize_proposal(p)
    body["aggregate"] = {
        "vote_count": agg.vote_count,
        "score_breakdown": {str(k): v for k, v in agg.score_breakdown.items()},
        "weighted_score": agg.weighted_score,
    }
    return body


@router.post("/merge-proposals/{proposal_id}/vote")
async def post_proposal_vote(
    proposal_id: uuid.UUID,
    req: ProposalVoteRequest,
    user: CurrentUser,
    session: SessionDep,
    signing_key: SigningKeyDep,
) -> dict[str, Any]:
    try:
        vote, proposal = await cast_proposal_vote(
            session=session,
            proposal_id=proposal_id,
            user=user,
            score=req.score,
            voted_at=req.voted_at,
            sig_hex=req.sig,
            service_signing_key=signing_key,
        )
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise HTTPException(404, msg) from e
        if "already voted" in msg or "already" in msg:
            raise HTTPException(409, msg) from e
        raise HTTPException(400, msg) from e
    return {
        "vote_id": str(vote.id),
        "proposal_status": proposal.status,
        "decided_at": proposal.decided_at.isoformat() if proposal.decided_at else None,
    }


_ = MergeProposalVote
