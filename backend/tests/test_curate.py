from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.curate.select import (
    _parse_decision,
    cluster_candidates,
    curate_pending,
    evaluate_cluster,
)
from app.db.models import MerkleLeaf, NewsCandidate, NewsItem


class _FakeLLM:
    name = "fake"
    model = "fake-model"

    def __init__(self, responses: list[dict[str, Any]] | dict[str, Any]) -> None:
        if isinstance(responses, dict):
            responses = [responses]
        self._responses = list(responses)
        self.calls: list[str] = []

    async def complete_json(self, *, system: str, user: str, **_: Any) -> dict[str, Any]:
        self.calls.append(user)
        if not self._responses:
            raise RuntimeError("no more canned responses")
        return self._responses.pop(0)


def _candidate(
    *,
    source: str,
    title: str,
    sid: str | None = None,
    raw_text: str = "",
) -> NewsCandidate:
    return NewsCandidate(
        id=uuid.uuid4(),
        source=source,
        source_url=f"https://example.com/{sid or uuid.uuid4()}",
        source_id=sid or str(uuid.uuid4()),
        title=title,
        raw_text=raw_text,
        lang="zh",
        fetched_at=datetime.now(UTC),
        status="pending",
    )


# --- pure-function tests --------------------------------------------------


def test_cluster_candidates_groups_similar_titles() -> None:
    a = _candidate(source="zhihu_hot", title="化工厂凌晨发生大火")
    b = _candidate(source="weibo_hot", title="化工厂凌晨发生大火 现场画面")
    c = _candidate(source="baidu_hot", title="完全无关的另一件事")
    clusters = cluster_candidates([a, b, c])
    assert len(clusters) == 2
    big = max(clusters, key=len)
    assert {x.id for x in big} == {a.id, b.id}


def test_parse_decision_normalises_invalid_classification() -> None:
    d = _parse_decision(
        {
            "worth_recording": True,
            "classification": "celebrity",  # not in VALID_CLASSIFICATIONS
            "title": "x",
            "summary": "y",
            "why_matters": "z",
            "primary_citation_url": "https://a.example",
        }
    )
    assert d.classification == "other"


def test_parse_decision_excluded_defaults() -> None:
    d = _parse_decision({"worth_recording": False, "summary": "营销话题"})
    assert d.worth_recording is False
    assert d.classification == "excluded"
    assert d.rejected_reason == "营销话题"


# --- pipeline integration -------------------------------------------------


@pytest.mark.asyncio
async def test_curate_promotes_cluster_and_signs(session: AsyncSession) -> None:
    candidates = [
        _candidate(source="zhihu_hot", title="化工厂凌晨发生大火", sid="z1"),
        _candidate(source="weibo_hot", title="化工厂凌晨发生大火 现场画面", sid="w1"),
        _candidate(source="baidu_hot", title="化工厂凌晨发生大火 暂无伤亡", sid="b1"),
    ]
    for c in candidates:
        session.add(c)
    await session.commit()

    llm = _FakeLLM(
        {
            "worth_recording": True,
            "classification": "social",
            "title": "某地化工厂凌晨发生大火",
            "summary": "凌晨3点起火，目前现场已无明火，暂无伤亡报告。",
            "why_matters": "重大工业事故，关注后续问责与监管整改。",
            "primary_citation_url": candidates[0].source_url,
        }
    )
    key = SigningKey.generate()

    report = await curate_pending(
        session=session, llm_client=llm, signing_key=key, lookback_hours=24 * 365
    )

    assert report.seen_clusters == 1
    assert report.promoted == 1
    assert report.rejected == 0

    items = (await session.execute(select(NewsItem))).scalars().all()
    assert len(items) == 1
    item = items[0]
    assert item.classification == "social"
    assert item.summary and "凌晨3点起火" in item.summary
    assert item.why_matters
    assert item.curator == "llm:fake-model"
    assert {c["source"] for c in (item.citations or [])} == {
        "zhihu_hot",
        "weibo_hot",
        "baidu_hot",
    }

    # All candidates marked curated and point at the new news_item.
    refreshed = (
        await session.execute(select(NewsCandidate))
    ).scalars().all()
    assert {c.status for c in refreshed} == {"curated"}
    assert {c.news_item_id for c in refreshed} == {item.id}

    # Signature + Merkle leaf landed.
    leaves = (
        await session.execute(
            select(MerkleLeaf).where(MerkleLeaf.leaf_type == "news")
        )
    ).scalars().all()
    assert len(leaves) == 1
    assert leaves[0].ref_id == item.id


@pytest.mark.asyncio
async def test_curate_rejects_marketing(session: AsyncSession) -> None:
    candidates = [
        _candidate(source="weibo_hot", title="某品牌618大促优惠开抢", sid="w2"),
        _candidate(source="zhihu_hot", title="某品牌618大促 折扣力度盘点", sid="z2"),
    ]
    for c in candidates:
        session.add(c)
    await session.commit()

    llm = _FakeLLM(
        {
            "worth_recording": False,
            "classification": "excluded",
            "title": "",
            "summary": "",
            "why_matters": "",
            "primary_citation_url": "",
            "rejected_reason": "营销话题，无长期记录价值",
        }
    )
    key = SigningKey.generate()
    report = await curate_pending(
        session=session, llm_client=llm, signing_key=key, lookback_hours=24 * 365
    )

    assert report.promoted == 0
    assert report.rejected == 1

    items = (await session.execute(select(NewsItem))).scalars().all()
    assert items == []

    refreshed = (await session.execute(select(NewsCandidate))).scalars().all()
    assert {c.status for c in refreshed} == {"rejected"}
    assert all("营销" in (c.rejected_reason or "") for c in refreshed)


@pytest.mark.asyncio
async def test_curate_ignores_non_pending(session: AsyncSession) -> None:
    already = _candidate(source="zhihu_hot", title="已经处理的", sid="x1")
    already.status = "rejected"
    session.add(already)
    await session.commit()

    llm = _FakeLLM({"worth_recording": False, "rejected_reason": "x"})
    key = SigningKey.generate()
    report = await curate_pending(session=session, llm_client=llm, signing_key=key)
    assert report.seen_clusters == 0


@pytest.mark.asyncio
async def test_evaluate_cluster_passes_candidates_to_llm() -> None:
    llm = _FakeLLM(
        {
            "worth_recording": False,
            "classification": "excluded",
            "rejected_reason": "test",
        }
    )
    a = _candidate(source="x", title="标题1", raw_text="正文1")
    b = _candidate(source="y", title="标题2", raw_text="正文2")
    out = await evaluate_cluster(cluster=[a, b], llm_client=llm)
    assert out.worth_recording is False
    assert "标题1" in llm.calls[0]
    assert "标题2" in llm.calls[0]
