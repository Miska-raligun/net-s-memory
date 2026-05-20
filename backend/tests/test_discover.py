from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MerkleLeaf, NewsItem
from app.discover.pipeline import (
    _pool_searches_dedup,
    _validate_event,
    discover_once,
)
from app.search.base import SearchResult
from app.search.stub import StubSearchClient


class _FakeLLM:
    name = "fake"
    model = "fake-model"

    def __init__(self, response: dict[str, Any]) -> None:
        self._response = response
        self.calls: list[tuple[str, str]] = []

    async def complete_json(
        self, *, system: str, user: str, **_: Any
    ) -> dict[str, Any]:
        self.calls.append((system, user))
        return self._response


def _hit(
    title: str,
    url: str,
    *,
    snippet: str = "",
    source: str = "",
    published_at: datetime | None = None,
) -> SearchResult:
    return SearchResult(
        title=title, url=url, snippet=snippet, source=source, published_at=published_at
    )


def test_pool_dedupes_by_url_keeping_first() -> None:
    results = [
        _hit("a", "https://x/1", snippet="first"),
        _hit("a", "https://x/1", snippet="duplicate"),
        _hit("b", "https://x/2"),
    ]
    pool, by_url = _pool_searches_dedup(results)
    assert [r.url for r in pool] == ["https://x/1", "https://x/2"]
    assert by_url["https://x/1"].snippet == "first"


def test_validate_event_passes_two_real_citations() -> None:
    by_url = {
        "https://a.example": _hit("A", "https://a.example"),
        "https://b.example": _hit("B", "https://b.example"),
    }
    event = {
        "title": "事件",
        "classification": "social",
        "citations": ["https://a.example", "https://b.example"],
    }
    out = _validate_event(event, by_url)
    assert out is not None
    urls, hits = out
    assert urls == ["https://a.example", "https://b.example"]
    assert len(hits) == 2


def test_validate_event_rejects_single_citation() -> None:
    by_url = {"https://a.example": _hit("A", "https://a.example")}
    assert (
        _validate_event(
            {"title": "x", "classification": "social", "citations": ["https://a.example"]},
            by_url,
        )
        is None
    )


def test_validate_event_rejects_fabricated_citations() -> None:
    by_url = {"https://a.example": _hit("A", "https://a.example")}
    event = {
        "title": "x",
        "classification": "social",
        "citations": ["https://fake1.example", "https://fake2.example"],
    }
    assert _validate_event(event, by_url) is None


def test_validate_event_rejects_invalid_classification() -> None:
    by_url = {
        "https://a.example": _hit("A", "https://a.example"),
        "https://b.example": _hit("B", "https://b.example"),
    }
    event = {
        "title": "x",
        "classification": "celebrity",  # not in VALID_CLASSIFICATIONS
        "citations": ["https://a.example", "https://b.example"],
    }
    assert _validate_event(event, by_url) is None


def test_validate_event_dedupes_repeated_citation_url() -> None:
    by_url = {"https://a.example": _hit("A", "https://a.example")}
    event = {
        "title": "x",
        "classification": "social",
        "citations": ["https://a.example", "https://a.example"],
    }
    assert _validate_event(event, by_url) is None


@pytest.mark.asyncio
async def test_discover_once_promotes_and_signs(session: AsyncSession) -> None:
    base = datetime.now(UTC)
    search = StubSearchClient(
        [
            _hit("化工厂事故 调查取得进展", "https://a.example/1", source="a.example",
                 published_at=base),
            _hit("化工厂事故 暂无伤亡", "https://b.example/1", source="b.example",
                 published_at=base),
            _hit("化工厂事故 现场画面", "https://c.example/1", source="c.example",
                 published_at=base),
            _hit("某品牌618大促开抢", "https://m.example/1", source="m.example",
                 published_at=base),
        ]
    )
    llm = _FakeLLM(
        {
            "events": [
                {
                    "title": "某地化工厂凌晨发生大火",
                    "summary": "凌晨3点起火，现场已无明火，暂无伤亡报告。",
                    "why_matters": "重大工业事故，关注后续问责与监管整改。",
                    "classification": "social",
                    "citations": [
                        "https://a.example/1",
                        "https://b.example/1",
                        "https://c.example/1",
                    ],
                }
                # marketing item correctly omitted by the LLM
            ]
        }
    )
    key = SigningKey.generate()

    report = await discover_once(
        session=session,
        llm_client=llm,
        search_client=search,
        signing_key=key,
        queries=["q"],
    )

    assert report.queries == 1
    assert report.events_proposed == 1
    assert report.promoted == 1
    assert report.rejected_low_citations == 0
    assert report.search_results_pooled == 4

    items = (await session.execute(select(NewsItem))).scalars().all()
    assert len(items) == 1
    item = items[0]
    assert item.classification == "social"
    assert item.summary and "凌晨3点起火" in item.summary
    assert item.why_matters
    assert item.curator == "discover:fake-model"
    assert {c["source_url"] for c in (item.citations or [])} == {
        "https://a.example/1",
        "https://b.example/1",
        "https://c.example/1",
    }

    leaves = (
        await session.execute(
            select(MerkleLeaf).where(MerkleLeaf.leaf_type == "news")
        )
    ).scalars().all()
    assert len(leaves) == 1
    assert leaves[0].ref_id == item.id


@pytest.mark.asyncio
async def test_discover_drops_single_source_events(session: AsyncSession) -> None:
    search = StubSearchClient(
        [_hit("only here", "https://only.example/1", source="only.example")]
    )
    llm = _FakeLLM(
        {
            "events": [
                {
                    "title": "孤证事件",
                    "summary": "x",
                    "why_matters": "y",
                    "classification": "social",
                    "citations": ["https://only.example/1"],
                }
            ]
        }
    )
    key = SigningKey.generate()
    report = await discover_once(
        session=session,
        llm_client=llm,
        search_client=search,
        signing_key=key,
        queries=["q"],
    )
    assert report.promoted == 0
    assert report.rejected_low_citations == 1
    items = (await session.execute(select(NewsItem))).scalars().all()
    assert items == []


@pytest.mark.asyncio
async def test_discover_drops_hallucinated_citations(session: AsyncSession) -> None:
    search = StubSearchClient(
        [
            _hit("real 1", "https://real.example/1", source="real.example"),
            _hit("real 2", "https://real.example/2", source="real.example"),
        ]
    )
    llm = _FakeLLM(
        {
            "events": [
                {
                    "title": "编造来源的事件",
                    "summary": "x",
                    "why_matters": "y",
                    "classification": "social",
                    "citations": [
                        "https://fabricated.example/a",
                        "https://fabricated.example/b",
                    ],
                }
            ]
        }
    )
    key = SigningKey.generate()
    report = await discover_once(
        session=session,
        llm_client=llm,
        search_client=search,
        signing_key=key,
        queries=["q"],
    )
    assert report.promoted == 0
    assert report.rejected_low_citations == 1


@pytest.mark.asyncio
async def test_discover_empty_pool_short_circuits(session: AsyncSession) -> None:
    search = StubSearchClient([])
    llm = _FakeLLM({"events": []})
    key = SigningKey.generate()
    report = await discover_once(
        session=session,
        llm_client=llm,
        search_client=search,
        signing_key=key,
        queries=["q1", "q2"],
    )
    assert report.queries == 2
    assert report.search_results_pooled == 0
    assert report.events_proposed == 0
    assert llm.calls == []  # no LLM call when there's nothing to evaluate


@pytest.mark.asyncio
async def test_discover_pools_multiple_queries_and_dedups(session: AsyncSession) -> None:
    base = datetime.now(UTC)
    # Same URL appears under two queries — should only be in the pool once.
    shared = _hit("shared", "https://shared.example/1", source="shared.example",
                  published_at=base)
    search = StubSearchClient(
        [
            shared,
            _hit("a", "https://a.example/1", source="a.example", published_at=base),
            shared,
            _hit("b", "https://b.example/1", source="b.example", published_at=base),
        ]
    )
    captured: list[str] = []

    class _Recorder:
        name = "fake"
        model = "fake-model"

        async def complete_json(self, *, system: str, user: str, **_: Any) -> dict[str, Any]:
            captured.append(user)
            return {"events": []}

    key = SigningKey.generate()
    report = await discover_once(
        session=session,
        llm_client=_Recorder(),
        search_client=search,
        signing_key=key,
        queries=["q1"],
    )
    assert report.search_results_pooled == 3
    # The shared URL appears in the prompt exactly once.
    assert captured[0].count("https://shared.example/1") == 1
