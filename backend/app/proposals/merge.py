"""Merge-proposal lifecycle: create → community vote → auto-merge or reject.

Once a user prepares a draft via the followup pipeline, they can pick
specific developments and submit them as a merge proposal. The proposal
itself is signed by the user (client-side, like votes) and **immediately
enters the Merkle log** as a ``merge_proposal`` leaf — that means the
fact that someone proposed X at time T is provably unalterable, even if
the proposal is later rejected.

Community then votes on the proposal (-1/0/1, signed). When the vote
threshold is met (>=3 votes AND weighted score >=0.5), the server
materializes each selected development as a real NewsItem (signed and
appended to the news log just like a normal ingest) and attaches it to
the event timeline as ``kind='update'``. The proposal status flips to
``passed``. If a clear rejection threshold is met instead, the proposal
status flips to ``rejected`` and no NewsItems are created.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.canonical import encode
from app.crypto.log import (
    append_merge_proposal,
    append_merge_proposal_vote,
    append_news_signed,
)
from app.db.models import (
    Event,
    EventFollowup,
    EventMergeProposal,
    EventNews,
    MergeProposalVote,
    NewsItem,
    UserAccount,
)

PASS_VOTE_MIN = 3
PASS_WEIGHTED_THRESHOLD = 0.5
REJECT_VOTE_MIN = 3
REJECT_WEIGHTED_THRESHOLD = -0.5


@dataclass(frozen=True)
class ProposalAggregate:
    vote_count: int
    score_breakdown: dict[int, int]
    weighted_score: float


def proposal_canonical(
    *,
    proposal_id: uuid.UUID,
    event_id: uuid.UUID,
    followup_id: uuid.UUID,
    proposer_id: uuid.UUID,
    selected_developments: list[dict[str, Any]],
    proposed_at: str,
) -> bytes:
    return encode(
        {
            "schema": "merge_proposal.v1",
            "id": str(proposal_id),
            "event_id": str(event_id),
            "followup_id": str(followup_id),
            "proposer_id": str(proposer_id),
            "selected_developments": selected_developments,
            "proposed_at": proposed_at,
        }
    )


def proposal_vote_canonical(
    *,
    proposal_id: uuid.UUID,
    user_id: uuid.UUID,
    score: int,
    voted_at: str,
) -> bytes:
    return encode(
        {
            "schema": "merge_proposal_vote.v1",
            "proposal_id": str(proposal_id),
            "user_id": str(user_id),
            "score": score,
            "voted_at": voted_at,
        }
    )


async def aggregate(
    session: AsyncSession, proposal_id: uuid.UUID
) -> ProposalAggregate:
    rows = (
        await session.execute(
            select(MergeProposalVote.score, UserAccount.reputation)
            .join(UserAccount, MergeProposalVote.user_id == UserAccount.id)
            .where(MergeProposalVote.proposal_id == proposal_id)
        )
    ).all()
    breakdown: dict[int, int] = {}
    for score, _rep in rows:
        breakdown[int(score)] = breakdown.get(int(score), 0) + 1
    if not rows:
        return ProposalAggregate(0, {}, 0.0)
    weight_total = sum(1.0 + max(0.0, rep) for _, rep in rows)
    weighted_sum = sum(score * (1.0 + max(0.0, rep)) for score, rep in rows)
    weighted = weighted_sum / weight_total if weight_total > 0 else 0.0
    return ProposalAggregate(len(rows), breakdown, weighted)


async def create_proposal(
    session: AsyncSession,
    *,
    proposal_id: uuid.UUID,
    event_id: uuid.UUID,
    followup_id: uuid.UUID,
    user: UserAccount,
    selected_developments: list[dict[str, Any]],
    proposed_at: str,
    sig_hex: str,
) -> EventMergeProposal:
    if not selected_developments:
        raise ValueError("must select at least one development")

    if (await session.get(EventMergeProposal, proposal_id)) is not None:
        raise ValueError("proposal id already exists")

    followup = await session.get(EventFollowup, followup_id)
    if followup is None or followup.event_id != event_id:
        raise ValueError("followup does not belong to event")

    valid_summaries = {d.get("summary") for d in followup.payload.get("developments", [])}
    for d in selected_developments:
        if d.get("summary") not in valid_summaries:
            raise ValueError("selected development not found in followup")

    canonical = proposal_canonical(
        proposal_id=proposal_id,
        event_id=event_id,
        followup_id=followup_id,
        proposer_id=user.id,
        selected_developments=selected_developments,
        proposed_at=proposed_at,
    )
    try:
        sig = bytes.fromhex(sig_hex)
    except ValueError as e:
        raise ValueError("sig must be hex") from e
    if len(sig) != 64:
        raise ValueError("sig must be 64 bytes")
    try:
        VerifyKey(user.pubkey_ed25519).verify(canonical, sig)
    except BadSignatureError as e:
        raise ValueError("signature does not verify") from e

    proposal = EventMergeProposal(
        id=proposal_id,
        event_id=event_id,
        followup_id=followup_id,
        proposed_by=user.id,
        selected_developments=selected_developments,
        canonical_bytes=canonical,
        sig=sig,
        pubkey=user.pubkey_ed25519,
        status="voting",
    )
    session.add(proposal)
    await session.flush()

    await append_merge_proposal(session, proposal)
    await session.commit()
    return proposal


async def cast_proposal_vote(
    session: AsyncSession,
    *,
    proposal_id: uuid.UUID,
    user: UserAccount,
    score: int,
    voted_at: str,
    sig_hex: str,
    service_signing_key: SigningKey,
) -> tuple[MergeProposalVote, EventMergeProposal]:
    if score not in (-1, 0, 1):
        raise ValueError("score must be -1, 0 or 1")

    proposal = await session.get(EventMergeProposal, proposal_id)
    if proposal is None:
        raise ValueError("proposal not found")
    if proposal.status != "voting":
        raise ValueError(f"proposal already {proposal.status}")

    existing = (
        await session.execute(
            select(MergeProposalVote).where(
                MergeProposalVote.proposal_id == proposal_id,
                MergeProposalVote.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ValueError("already voted on this proposal")

    canonical = proposal_vote_canonical(
        proposal_id=proposal_id, user_id=user.id, score=score, voted_at=voted_at
    )
    try:
        sig = bytes.fromhex(sig_hex)
    except ValueError as e:
        raise ValueError("sig must be hex") from e
    if len(sig) != 64:
        raise ValueError("sig must be 64 bytes")
    try:
        VerifyKey(user.pubkey_ed25519).verify(canonical, sig)
    except BadSignatureError as e:
        raise ValueError("signature does not verify") from e

    vote = MergeProposalVote(
        id=uuid.uuid4(),
        proposal_id=proposal_id,
        user_id=user.id,
        score=score,
        canonical_bytes=canonical,
        sig=sig,
    )
    session.add(vote)
    await session.flush()
    await append_merge_proposal_vote(session, vote)

    agg = await aggregate(session, proposal_id)
    if agg.vote_count >= PASS_VOTE_MIN and agg.weighted_score >= PASS_WEIGHTED_THRESHOLD:
        await _materialize_pass(
            session,
            proposal=proposal,
            service_signing_key=service_signing_key,
        )
    elif (
        agg.vote_count >= REJECT_VOTE_MIN
        and agg.weighted_score <= REJECT_WEIGHTED_THRESHOLD
    ):
        proposal.status = "rejected"
        proposal.decided_at = datetime.now(UTC)

    await session.commit()
    return vote, proposal


def _isoformat_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _development_to_news_payload(
    *,
    news_id: uuid.UUID,
    proposal_id: uuid.UUID,
    development: dict[str, Any],
    fetched_at: datetime,
) -> dict[str, Any]:
    return {
        "schema": "news_item.v1",
        "id": str(news_id),
        "source": f"merge_proposal:{proposal_id}",
        "source_url": (development.get("citations") or ["urn:none"])[0],
        "source_id": "",
        "title": str(development.get("summary", ""))[:200],
        "raw_text": str(development.get("summary", "")),
        "lang": "zh",
        "hot_rank": -1,
        "fetched_at": _isoformat_utc(fetched_at),
    }


async def _materialize_pass(
    session: AsyncSession,
    *,
    proposal: EventMergeProposal,
    service_signing_key: SigningKey,
) -> None:
    proposal.status = "passed"
    proposal.decided_at = datetime.now(UTC)

    next_pos = (
        await session.execute(
            select(EventNews.position).where(EventNews.event_id == proposal.event_id)
        )
    ).scalars().all()
    pos = max(next_pos, default=-1) + 1

    for dev in proposal.selected_developments:
        news_id = uuid.uuid4()
        fetched_at = proposal.decided_at or datetime.now(UTC)
        item = NewsItem(
            id=news_id,
            source=f"merge_proposal:{proposal.id}",
            source_url=(dev.get("citations") or ["urn:none"])[0],
            source_id=str(news_id),
            title=str(dev.get("summary", ""))[:200],
            raw_text=str(dev.get("summary", "")),
            lang="zh",
            fetched_at=fetched_at,
            hot_rank=None,
        )
        session.add(item)
        await session.flush()

        payload = _development_to_news_payload(
            news_id=news_id, proposal_id=proposal.id, development=dev, fetched_at=fetched_at
        )
        await append_news_signed(
            session=session,
            news_id=news_id,
            payload=payload,
            signer_id="merge_proposal:passed",
            signing_key=service_signing_key,
        )

        session.add(
            EventNews(
                event_id=proposal.event_id,
                news_id=news_id,
                kind="update",
                position=pos,
            )
        )
        pos += 1

    evt = await session.get(Event, proposal.event_id)
    if evt is not None:
        evt.updated_at = datetime.now(UTC)
