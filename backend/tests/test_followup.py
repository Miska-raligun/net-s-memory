from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from nacl.signing import SigningKey
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.followup import get_llm_for_followup, get_search_client
from app.db.models import EventFollowup, NewsItem
from app.events.cluster import cluster_one
from app.followup.pipeline import _validate_citations, run_followup
from app.main import app
from app.search.base import SearchResult
from app.search.stub import StubSearchClient


class _FakeLLM:
    name = "fake"
    model = "fake-model"

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls: list[tuple[str, str]] = []

    async def complete_json(self, *, system: str, user: str, **_: Any) -> dict[str, Any]:
        self.calls.append((system, user))
        return self.payload


async def _seed_event(session: AsyncSession) -> uuid.UUID:
    base = datetime(2026, 5, 1, tzinfo=UTC)
    items = []
    for source, title in [
        ("zhihu_hot", "化工厂凌晨发生大火"),
        ("weibo_hot", "化工厂凌晨发生大火 现场无明火"),
        ("baidu_hot", "化工厂凌晨发生大火 暂无伤亡"),
    ]:
        item = NewsItem(
            id=uuid.uuid4(),
            source=source,
            source_url=f"https://example.com/{uuid.uuid4()}",
            source_id=str(uuid.uuid4()),
            title=title,
            raw_text="",
            lang="zh",
            fetched_at=base,
        )
        session.add(item)
        items.append(item)
    await session.flush()
    event_id = await cluster_one(session, items[-1].id)
    assert event_id is not None
    return event_id


def test_validate_citations_promotes_only_with_two_sources() -> None:
    valid = {"https://a.example", "https://b.example", "https://c.example"}
    raw = [
        {"date": "2026-05-04", "summary": "A 进展", "citations": ["https://a.example"]},
        {
            "date": "2026-05-05",
            "summary": "B 进展",
            "citations": ["https://a.example", "https://b.example"],
        },
        {
            "date": "2026-05-06",
            "summary": "C 编造的",
            "citations": ["https://fake.example", "https://other-fake.example"],
        },
        {
            "date": "2026-05-07",
            "summary": "D 重复同一来源",
            "citations": ["https://a.example", "https://a.example"],
        },
    ]
    devs, leads = _validate_citations(raw, valid)
    assert len(devs) == 1
    assert devs[0].summary == "B 进展"
    assert devs[0].source_count == 2
    assert "A 进展" in leads
    assert "D 重复同一来源" in leads


@pytest.mark.asyncio
async def test_run_followup_persists_draft_and_filters_citations(
    session: AsyncSession,
) -> None:
    event_id = await _seed_event(session)

    base = datetime(2026, 5, 5, tzinfo=UTC)
    results = [
        SearchResult(
            title="化工厂事故调查取得进展",
            url="https://news.example/a",
            snippet="官方调查组完成现场勘察",
            source="news.example",
            published_at=base,
        ),
        SearchResult(
            title="化工厂事故调查取得进展(转载)",
            url="https://news.example/b",
            snippet="同一调查通报",
            source="other.example",
            published_at=base,
        ),
        SearchResult(
            title="无关",
            url="https://before-event.example",
            snippet="",
            source="x",
            published_at=datetime(2026, 4, 1, tzinfo=UTC),  # before event start
        ),
    ]
    search = StubSearchClient(results)
    llm = _FakeLLM(
        {
            "developments": [
                {
                    "date": "2026-05-05",
                    "summary": "调查组完成现场勘察",
                    "citations": ["https://news.example/a", "https://news.example/b"],
                },
                {
                    "date": "2026-05-05",
                    "summary": "孤证无法确认",
                    "citations": ["https://news.example/a"],
                },
            ],
            "leads": [],
            "still_unanswered": ["伤亡情况", "起火原因"],
            "status_suggestion": "ongoing",
        }
    )

    row = await run_followup(
        session=session,
        event_id=event_id,
        search_client=search,
        llm_client=llm,
    )
    # Stub filtered out the pre-event result.
    assert len(search.calls) == 1
    assert len(row.payload["search_results"]) == 2
    assert len(row.payload["developments"]) == 1
    assert "孤证无法确认" in row.payload["leads"]
    assert row.status == "draft"
    assert row.search_provider == "stub"


@pytest.mark.asyncio
async def test_run_followup_rejects_unknown_event(session: AsyncSession) -> None:
    search = StubSearchClient([])
    llm = _FakeLLM({})
    with pytest.raises(ValueError):
        await run_followup(
            session=session,
            event_id=uuid.uuid4(),
            search_client=search,
            llm_client=llm,
        )


@pytest.mark.asyncio
async def test_followup_api_requires_search_configured(
    session: AsyncSession, client: AsyncClient
) -> None:
    event_id = await _seed_event(session)
    # signup so we can authenticate
    key = SigningKey.generate()
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": "fu@example.com",
            "password": "supersecret123",
            "pubkey": bytes(key.verify_key).hex(),
        },
    )
    token = r.json()["token"]

    # No SEARCH_PROVIDER configured (default settings) → 503.
    app.dependency_overrides[get_search_client] = lambda: None
    app.dependency_overrides[get_llm_for_followup] = lambda: _FakeLLM({})
    try:
        r2 = await client.post(
            f"/api/events/{event_id}/followup",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 503
    finally:
        app.dependency_overrides.pop(get_search_client, None)
        app.dependency_overrides.pop(get_llm_for_followup, None)


@pytest.mark.asyncio
async def test_followup_api_full_round_trip(
    session: AsyncSession, client: AsyncClient
) -> None:
    event_id = await _seed_event(session)
    key = SigningKey.generate()
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": "fu2@example.com",
            "password": "supersecret123",
            "pubkey": bytes(key.verify_key).hex(),
        },
    )
    token = r.json()["token"]

    base = datetime(2026, 5, 5, tzinfo=UTC)
    search = StubSearchClient(
        [
            SearchResult(
                title="后续 A", url="https://a.example", snippet="x", source="a",
                published_at=base,
            ),
            SearchResult(
                title="后续 B", url="https://b.example", snippet="y", source="b",
                published_at=base + timedelta(days=1),
            ),
        ]
    )
    llm = _FakeLLM(
        {
            "developments": [
                {
                    "date": "2026-05-05",
                    "summary": "新进展",
                    "citations": ["https://a.example", "https://b.example"],
                }
            ],
            "leads": [],
            "still_unanswered": [],
            "status_suggestion": "ongoing",
        }
    )

    app.dependency_overrides[get_search_client] = lambda: search
    app.dependency_overrides[get_llm_for_followup] = lambda: llm
    try:
        post = await client.post(
            f"/api/events/{event_id}/followup",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert post.status_code == 200, post.text
        body = post.json()
        assert body["status"] == "draft"
        assert len(body["payload"]["developments"]) == 1

        latest = await client.get(f"/api/events/{event_id}/followup/latest")
        assert latest.status_code == 200
        assert latest.json()["id"] == body["id"]

        listing = await client.get(f"/api/events/{event_id}/followup")
        assert listing.status_code == 200
        assert len(listing.json()) == 1
    finally:
        app.dependency_overrides.pop(get_search_client, None)
        app.dependency_overrides.pop(get_llm_for_followup, None)


@pytest.mark.asyncio
async def test_followup_api_requires_auth(
    session: AsyncSession, client: AsyncClient
) -> None:
    event_id = await _seed_event(session)
    r = await client.post(f"/api/events/{event_id}/followup")
    assert r.status_code == 401


_ = EventFollowup
