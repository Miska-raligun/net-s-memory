from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.canonical import encode
from app.db.models import Analysis, NewsItem, UserAccount, Vote
from app.reputation.compute import (
    HIGH_CREDIBILITY,
    LOW_CREDIBILITY,
    _delta,
    compute_user_reputation,
    recompute_all,
)


def test_delta_high_credibility() -> None:
    assert _delta(1, 80) == 1
    assert _delta(-1, 80) == -1
    assert _delta(0, 80) == 0


def test_delta_low_credibility() -> None:
    assert _delta(-1, 10) == 1
    assert _delta(1, 10) == -1
    assert _delta(0, 10) == 0


def test_delta_mid_credibility_skipped() -> None:
    assert _delta(1, 50) == 0
    assert _delta(-1, 50) == 0
    assert _delta(1, HIGH_CREDIBILITY - 1) == 0
    assert _delta(-1, LOW_CREDIBILITY) == 0


async def _add_user(session: AsyncSession, email: str) -> UserAccount:
    u = UserAccount(
        id=uuid.uuid4(),
        email=email,
        password_hash="x",
        pubkey_ed25519=bytes(SigningKey.generate().verify_key),
        reputation=0.0,
    )
    session.add(u)
    await session.flush()
    return u


async def _add_news(session: AsyncSession) -> NewsItem:
    item = NewsItem(
        id=uuid.uuid4(),
        source="zhihu_hot",
        source_url=f"https://example.com/{uuid.uuid4()}",
        source_id=str(uuid.uuid4()),
        title="标题",
        raw_text="",
        lang="zh",
        fetched_at=datetime.now(UTC),
    )
    session.add(item)
    await session.flush()
    return item


async def _add_analysis(session: AsyncSession, news_id: uuid.UUID, score: int) -> Analysis:
    a = Analysis(
        id=uuid.uuid4(),
        news_id=news_id,
        score=score,
        corroboration_count=0,
        corroboration_sources=[],
        reputation_label="medium",
        reputation_weight=0.5,
        signer="test",
        alg="ed25519",
        pubkey=b"\x00" * 32,
        sig=b"\x00" * 64,
        canonical_bytes=b"{}",
    )
    session.add(a)
    await session.flush()
    return a


async def _add_vote(
    session: AsyncSession,
    user: UserAccount,
    news_id: uuid.UUID,
    score: int,
) -> Vote:
    canonical = encode(
        {
            "schema": "vote.v1",
            "news_id": str(news_id),
            "user_id": str(user.id),
            "score": score,
            "reason": "",
            "voted_at": "2026-05-08T12:00:00Z",
        }
    )
    v = Vote(
        id=uuid.uuid4(),
        news_id=news_id,
        user_id=user.id,
        score=score,
        reason="",
        sig=b"\x00" * 64,
        canonical_bytes=canonical,
    )
    session.add(v)
    await session.flush()
    return v


@pytest.mark.asyncio
async def test_aligned_user_gains_reputation(session: AsyncSession) -> None:
    user = await _add_user(session, "good@x.com")
    for _ in range(3):
        n = await _add_news(session)
        await _add_analysis(session, n.id, 80)
        await _add_vote(session, user, n.id, 1)

    rep = await compute_user_reputation(session, user.id)
    assert rep == 3.0


@pytest.mark.asyncio
async def test_contradicting_user_loses_reputation(session: AsyncSession) -> None:
    user = await _add_user(session, "bad@x.com")
    for _ in range(2):
        n = await _add_news(session)
        await _add_analysis(session, n.id, 80)
        await _add_vote(session, user, n.id, -1)

    rep = await compute_user_reputation(session, user.id)
    assert rep == -2.0


@pytest.mark.asyncio
async def test_mid_credibility_does_not_count(session: AsyncSession) -> None:
    user = await _add_user(session, "mid@x.com")
    n = await _add_news(session)
    await _add_analysis(session, n.id, 50)
    await _add_vote(session, user, n.id, 1)

    rep = await compute_user_reputation(session, user.id)
    assert rep == 0.0


@pytest.mark.asyncio
async def test_unanalyzed_news_does_not_count(session: AsyncSession) -> None:
    user = await _add_user(session, "noan@x.com")
    n = await _add_news(session)  # no analysis
    await _add_vote(session, user, n.id, 1)

    rep = await compute_user_reputation(session, user.id)
    assert rep == 0.0


@pytest.mark.asyncio
async def test_clamping(session: AsyncSession) -> None:
    user = await _add_user(session, "clamp@x.com")
    for _ in range(20):
        n = await _add_news(session)
        await _add_analysis(session, n.id, 80)
        await _add_vote(session, user, n.id, 1)
    rep = await compute_user_reputation(session, user.id)
    assert rep == 10.0  # clamped


@pytest.mark.asyncio
async def test_recompute_all_updates_users(session: AsyncSession) -> None:
    alice = await _add_user(session, "a@x.com")
    bob = await _add_user(session, "b@x.com")
    n = await _add_news(session)
    await _add_analysis(session, n.id, 80)
    await _add_vote(session, alice, n.id, 1)
    await _add_vote(session, bob, n.id, -1)

    n2 = await recompute_all(session)
    assert n2 == 2

    refreshed_alice = (
        await session.execute(select(UserAccount).where(UserAccount.id == alice.id))
    ).scalar_one()
    refreshed_bob = (
        await session.execute(select(UserAccount).where(UserAccount.id == bob.id))
    ).scalar_one()
    assert refreshed_alice.reputation == 1.0
    assert refreshed_bob.reputation == -1.0
