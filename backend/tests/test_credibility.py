from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyze.credibility import analyze_news, combine_signals
from app.crypto.canonical import encode
from app.db.models import MerkleLeaf, NewsItem
from app.llm.base import LLMError


class _FakeLLM:
    name = "fake"
    model = "fake-model-v1"

    def __init__(self, response: dict[str, Any] | Exception) -> None:
        self._response = response
        self.calls: list[tuple[str, str]] = []

    async def complete_json(self, *, system: str, user: str, **_: Any) -> dict[str, Any]:
        self.calls.append((system, user))
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def test_combine_signals_caps_corroboration() -> None:
    b = combine_signals(corroboration_count=10, reputation_weight=0.5, llm_score=80)
    assert b.corroboration_score == 30
    assert b.reputation_score == 15
    assert b.llm_score_contribution == 24
    assert b.community_score == 5
    assert b.total == 74


def test_combine_signals_neutral_when_no_llm() -> None:
    b = combine_signals(corroboration_count=0, reputation_weight=0.5, llm_score=None)
    # 0 + 15 + (50/100)*30=15 + 5 = 35
    assert b.total == 35
    assert b.llm_score_contribution == 15


def test_combine_signals_clamps_inputs() -> None:
    b = combine_signals(corroboration_count=0, reputation_weight=2.0, llm_score=200)
    assert b.reputation_score == 30
    assert b.llm_score_contribution == 30


async def _add_news(
    session: AsyncSession,
    *,
    source: str,
    title: str,
    raw_text: str = "",
) -> NewsItem:
    item = NewsItem(
        id=uuid.uuid4(),
        source=source,
        source_url=f"https://example.com/{uuid.uuid4()}",
        source_id=str(uuid.uuid4()),
        title=title,
        raw_text=raw_text,
        lang="zh",
        fetched_at=datetime.now(UTC),
    )
    session.add(item)
    await session.flush()
    return item


@pytest.mark.asyncio
async def test_analyze_news_signs_and_logs_leaf(session: AsyncSession) -> None:
    target = await _add_news(
        session, source="zhihu_hot", title="某公司化工厂凌晨发生大火", raw_text="凌晨3点起火"
    )
    await _add_news(
        session, source="weibo_hot", title="某公司化工厂凌晨发生大火 现场无明火"
    )
    await _add_news(
        session, source="baidu_hot", title="某公司化工厂凌晨发生大火 无伤亡"
    )

    fake = _FakeLLM(
        {
            "score": 85,
            "consistency": "consistent",
            "contradictions": [],
            "unverifiable_claims": ["伤亡情况"],
            "summary": "三家平台一致报道",
        }
    )
    key = SigningKey.generate()

    a = await analyze_news(
        session=session,
        news_id=target.id,
        signing_key=key,
        signer_id="analyzer:test",
        llm_client=fake,
    )

    assert a.score > 0
    assert a.corroboration_count == 2
    assert sorted(a.corroboration_sources) == ["baidu_hot", "weibo_hot"]
    assert a.reputation_label == "medium"
    assert a.llm_score == 85
    assert a.llm_consistency == "consistent"
    assert a.llm_model == "fake-model-v1"
    assert len(fake.calls) == 1

    # Signature is valid against the canonical bytes.
    assert a.pubkey == bytes(key.verify_key)
    key.verify_key.verify(a.canonical_bytes, a.sig)

    # A merkle leaf was appended for the analysis.
    leaf = (
        await session.execute(
            select(MerkleLeaf).where(
                MerkleLeaf.leaf_type == "analysis",
                MerkleLeaf.ref_id == a.id,
            )
        )
    ).scalar_one()
    assert len(leaf.leaf_hash) == 32

    # Canonical bytes round-trip through the JCS encoder.
    assert a.canonical_bytes.startswith(b"{")


@pytest.mark.asyncio
async def test_analyze_news_without_llm(session: AsyncSession) -> None:
    target = await _add_news(session, source="zhihu_hot", title="孤立事件标题")
    key = SigningKey.generate()

    a = await analyze_news(
        session=session,
        news_id=target.id,
        signing_key=key,
        llm_client=None,
    )
    assert a.llm_score is None
    assert a.llm_consistency is None
    assert a.corroboration_count == 0
    # 0 corroboration + 15 reputation + 15 neutral LLM + 5 community = 35
    assert a.score == 35


@pytest.mark.asyncio
async def test_analyze_news_tolerates_llm_failure(session: AsyncSession) -> None:
    target = await _add_news(session, source="zhihu_hot", title="某公司化工厂凌晨发生大火")
    await _add_news(session, source="weibo_hot", title="某公司化工厂凌晨发生大火")
    fake = _FakeLLM(LLMError("provider down"))
    key = SigningKey.generate()

    a = await analyze_news(
        session=session,
        news_id=target.id,
        signing_key=key,
        llm_client=fake,
    )
    assert a.llm_score is None
    assert a.corroboration_count >= 1


@pytest.mark.asyncio
async def test_analyze_news_canonical_bytes_match_payload(session: AsyncSession) -> None:
    target = await _add_news(session, source="zhihu_hot", title="测试标题")
    key = SigningKey.generate()
    a = await analyze_news(
        session=session, news_id=target.id, signing_key=key, llm_client=None
    )
    assert encode({}) != a.canonical_bytes
    # The canonical payload must include the analysis id and news_id.
    assert str(a.id).encode() in a.canonical_bytes
    assert str(a.news_id).encode() in a.canonical_bytes


@pytest.mark.asyncio
async def test_analyze_news_unknown_id_raises(session: AsyncSession) -> None:
    key = SigningKey.generate()
    with pytest.raises(ValueError, match="not found"):
        await analyze_news(
            session=session, news_id=uuid.uuid4(), signing_key=key, llm_client=None
        )
