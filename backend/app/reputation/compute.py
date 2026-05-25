"""Reputation calculator.

A user's reputation is a small integer summarising whether their past
votes have aligned with eventual analysis-derived consensus. Two
buckets:

- High-credibility news (analysis.score >= 70): +1 vote agrees,
  -1 vote contradicts.
- Low-credibility news (analysis.score < 30): -1 vote agrees,
  +1 vote contradicts.

Mid-credibility news (30..70) is skipped — the consensus signal is
too weak to teach us anything.

This is intentionally simple for v1. We can swap in a Bayesian /
ELO-style updater later without breaking the storage shape.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Analysis, UserAccount, Vote

HIGH_CREDIBILITY = 70
LOW_CREDIBILITY = 30
REPUTATION_MIN = -5.0
REPUTATION_MAX = 10.0


def _delta(vote_score: int, analysis_score: int) -> int:
    """Return +1 / -1 / 0 contribution from one vote-vs-analysis pair."""
    if analysis_score >= HIGH_CREDIBILITY:
        if vote_score > 0:
            return 1
        if vote_score < 0:
            return -1
        return 0
    if analysis_score < LOW_CREDIBILITY:
        if vote_score < 0:
            return 1
        if vote_score > 0:
            return -1
        return 0
    return 0


async def compute_user_reputation(session: AsyncSession, user_id: uuid.UUID) -> float:
    rows = (
        await session.execute(
            select(Vote.score, Analysis.score)
            .join(Analysis, Vote.news_id == Analysis.news_id)
            .where(Vote.user_id == user_id)
        )
    ).all()

    score = sum(_delta(int(vote_score), int(analysis_score)) for vote_score, analysis_score in rows)
    return max(REPUTATION_MIN, min(REPUTATION_MAX, float(score)))


async def recompute_all(session: AsyncSession) -> int:
    users = (await session.execute(select(UserAccount))).scalars().all()
    for u in users:
        u.reputation = await compute_user_reputation(session, u.id)
    await session.commit()
    return len(users)
