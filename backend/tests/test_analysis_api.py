from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from nacl.signing import SigningKey
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.analysis import get_llm_client, get_signing_key
from app.ingest.base import NewsItemDraft
from app.ingest.pipeline import ingest_drafts
from app.main import app


class _FakeLLM:
    name = "fake"
    model = "fake-model"

    def __init__(self) -> None:
        self.payload: dict[str, Any] = {
            "score": 90,
            "consistency": "consistent",
            "contradictions": [],
            "unverifiable_claims": [],
            "summary": "ok",
        }

    async def complete_json(self, **_: Any) -> dict[str, Any]:
        return self.payload


def _draft(source: str, sid: str, title: str) -> NewsItemDraft:
    return NewsItemDraft(
        source=source,
        source_url=f"https://example.com/{sid}",
        source_id=sid,
        title=title,
        raw_text="",
        lang="zh",
        hot_rank=1,
        fetched_at=datetime(2026, 5, 8, tzinfo=UTC),
    )


@pytest.fixture
def signing_key_override() -> SigningKey:
    key = SigningKey.generate()
    app.dependency_overrides[get_signing_key] = lambda: key
    yield key
    app.dependency_overrides.pop(get_signing_key, None)


@pytest.fixture
def llm_override() -> _FakeLLM:
    fake = _FakeLLM()
    app.dependency_overrides[get_llm_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_llm_client, None)


@pytest.mark.asyncio
async def test_post_then_get_analysis(
    session: AsyncSession,
    client: AsyncClient,
    signing_key_override: SigningKey,
    llm_override: _FakeLLM,
) -> None:
    ingest_key = signing_key_override
    await ingest_drafts(
        session,
        [
            _draft("zhihu_hot", "a", "化工厂凌晨发生大火"),
            _draft("weibo_hot", "b", "化工厂凌晨发生大火 现场无明火"),
            _draft("baidu_hot", "c", "化工厂凌晨发生大火 暂无伤亡"),
        ],
        "service:v1",
        ingest_key,
    )

    r_list = await client.get("/api/news")
    items = r_list.json()
    target = next(i for i in items if i["source"] == "zhihu_hot")

    r_get_404 = await client.get(f"/api/news/{target['id']}/analysis")
    assert r_get_404.status_code == 404

    r_post = await client.post(f"/api/news/{target['id']}/analysis")
    assert r_post.status_code == 200
    body = r_post.json()
    assert body["score"] > 0
    assert body["corroboration_count"] == 2
    assert sorted(body["corroboration_sources"]) == ["baidu_hot", "weibo_hot"]
    assert body["llm_score"] == 90
    assert body["llm_model"] == "fake-model"

    r_get = await client.get(f"/api/news/{target['id']}/analysis")
    assert r_get.status_code == 200
    assert r_get.json()["id"] == body["id"]


@pytest.mark.asyncio
async def test_post_analysis_idempotent(
    session: AsyncSession,
    client: AsyncClient,
    signing_key_override: SigningKey,
    llm_override: _FakeLLM,
) -> None:
    await ingest_drafts(
        session, [_draft("zhihu_hot", "x", "孤立标题")], "service:v1", signing_key_override
    )
    r_list = await client.get("/api/news")
    nid = r_list.json()[0]["id"]

    r1 = await client.post(f"/api/news/{nid}/analysis")
    r2 = await client.post(f"/api/news/{nid}/analysis")
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]


@pytest.mark.asyncio
async def test_post_analysis_404_unknown(
    client: AsyncClient,
    signing_key_override: SigningKey,
    llm_override: _FakeLLM,
) -> None:
    r = await client.post(
        "/api/news/00000000-0000-0000-0000-000000000000/analysis"
    )
    assert r.status_code == 404
