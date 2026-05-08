"""Credibility orchestration: combine four signals → persist + sign + log.

Final credibility is a 0-100 score split across four buckets:
  cross-source (≤30) + reputation (≤30) + LLM (≤30) + community (≤10).

The LLM signal is **optional**: if no client is wired up or the call
fails, we use a neutral default and skip the LLM-specific fields. The
community-vote signal is a placeholder of 5 until Phase 3 lands voting.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyze import source_reputation
from app.analyze.cross_source import find_corroborating
from app.analyze.llm_check import LLMCheckInput, llm_check
from app.crypto.log import append_analysis_signed
from app.db.models import Analysis, NewsItem
from app.llm.base import LLMClient, LLMError

logger = logging.getLogger(__name__)


CORROBORATION_MAX = 30
REPUTATION_MAX = 30
LLM_MAX = 30
COMMUNITY_MAX = 10
NEUTRAL_LLM_SCORE = 50
NEUTRAL_COMMUNITY = 5


def _isoformat_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class SignalBreakdown:
    corroboration_score: int
    reputation_score: int
    llm_score_contribution: int
    community_score: int

    @property
    def total(self) -> int:
        return (
            self.corroboration_score
            + self.reputation_score
            + self.llm_score_contribution
            + self.community_score
        )


def combine_signals(
    *,
    corroboration_count: int,
    reputation_weight: float,
    llm_score: int | None,
) -> SignalBreakdown:
    corro = min(CORROBORATION_MAX, corroboration_count * 8)
    rep = int(round(max(0.0, min(1.0, reputation_weight)) * REPUTATION_MAX))
    raw_llm = NEUTRAL_LLM_SCORE if llm_score is None else max(0, min(100, llm_score))
    llm_contrib = int(round(raw_llm / 100 * LLM_MAX))
    return SignalBreakdown(
        corroboration_score=corro,
        reputation_score=rep,
        llm_score_contribution=llm_contrib,
        community_score=NEUTRAL_COMMUNITY,
    )


def _to_canonical_payload(analysis: Analysis) -> dict[str, Any]:
    # The canonical encoder bans floats. Reputation is encoded as an
    # integer in basis points (1.0 → 10000) for determinism.
    rep_bp = int(round(max(0.0, min(1.0, analysis.reputation_weight)) * 10000))
    return {
        "schema": "analysis.v1",
        "id": str(analysis.id),
        "news_id": str(analysis.news_id),
        "score": analysis.score,
        "corroboration_count": analysis.corroboration_count,
        "corroboration_sources": list(analysis.corroboration_sources),
        "reputation_label": analysis.reputation_label,
        "reputation_weight_bp": rep_bp,
        "llm_score": analysis.llm_score if analysis.llm_score is not None else -1,
        "llm_consistency": analysis.llm_consistency or "",
        "llm_model": analysis.llm_model or "",
        "generated_at": _isoformat_utc(analysis.generated_at),
    }


async def get_existing(
    session: AsyncSession, news_id: uuid.UUID
) -> Analysis | None:
    return (
        await session.execute(select(Analysis).where(Analysis.news_id == news_id))
    ).scalar_one_or_none()


async def analyze_news(
    session: AsyncSession,
    news_id: uuid.UUID,
    *,
    signing_key: SigningKey,
    signer_id: str = "analyzer:v1",
    llm_client: LLMClient | None = None,
    commit: bool = True,
) -> Analysis:
    item = await session.get(NewsItem, news_id)
    if item is None:
        raise ValueError(f"news {news_id} not found")

    corroborating = await find_corroborating(session, item)
    sources = sorted({c.source for c in corroborating} - {item.source})

    rep_label, rep_weight = source_reputation.lookup(item.source)

    llm_score: int | None = None
    llm_consistency: str | None = None
    llm_summary: str | None = None
    llm_evidence: dict[str, Any] | None = None
    llm_model: str | None = None

    if llm_client is not None and corroborating:
        try:
            result = await llm_check(
                client=llm_client,
                payload=LLMCheckInput(
                    target_source=item.source,
                    target_title=item.title,
                    target_text=item.raw_text,
                    corroborating=[(c.source, c.title, c.raw_text) for c in corroborating[:5]],
                ),
            )
            llm_score = result.score
            llm_consistency = result.consistency
            llm_summary = result.summary
            llm_evidence = result.raw
            llm_model = llm_client.model
        except LLMError as e:
            logger.warning("LLM check failed for news %s: %s", news_id, e)

    breakdown = combine_signals(
        corroboration_count=len(corroborating),
        reputation_weight=rep_weight,
        llm_score=llm_score,
    )

    analysis = Analysis(
        id=uuid.uuid4(),
        news_id=news_id,
        score=breakdown.total,
        corroboration_count=len(corroborating),
        corroboration_sources=sources,
        reputation_label=rep_label,
        reputation_weight=rep_weight,
        llm_score=llm_score,
        llm_consistency=llm_consistency,
        llm_summary=llm_summary,
        llm_evidence=llm_evidence,
        llm_model=llm_model,
        signer=signer_id,
        alg="ed25519",
        pubkey=b"",
        sig=b"",
        canonical_bytes=b"",
    )
    session.add(analysis)
    await session.flush()

    await append_analysis_signed(
        session=session,
        analysis=analysis,
        payload=_to_canonical_payload(analysis),
        signer_id=signer_id,
        signing_key=signing_key,
    )
    if commit:
        await session.commit()
    return analysis
