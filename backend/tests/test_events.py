from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Event, EventNews, NewsItem
from app.events.cluster import cluster_all_unassigned, cluster_one


async def _add(
    session: AsyncSession,
    *,
    source: str,
    title: str,
    fetched_at: datetime,
) -> NewsItem:
    item = NewsItem(
        id=uuid.uuid4(),
        source=source,
        source_url=f"https://example.com/{uuid.uuid4()}",
        source_id=str(uuid.uuid4()),
        title=title,
        raw_text="",
        lang="zh",
        fetched_at=fetched_at,
    )
    session.add(item)
    await session.flush()
    return item


@pytest.mark.asyncio
async def test_cluster_creates_event_with_three_sources(session: AsyncSession) -> None:
    now = datetime.now(UTC)
    a = await _add(session, source="zhihu_hot", title="某公司化工厂凌晨发生大火", fetched_at=now)
    b = await _add(
        session, source="weibo_hot", title="某公司化工厂凌晨发生大火 现场无明火", fetched_at=now
    )
    c = await _add(
        session, source="baidu_hot", title="某公司化工厂凌晨发生大火 暂无伤亡", fetched_at=now
    )

    event_id = await cluster_one(session, c.id)
    assert event_id is not None

    members = (
        await session.execute(
            select(EventNews).where(EventNews.event_id == event_id).order_by(EventNews.position)
        )
    ).scalars().all()
    assert {m.news_id for m in members} == {a.id, b.id, c.id}
    assert members[0].kind == "origin"
    assert all(m.kind in {"origin", "update"} for m in members)


@pytest.mark.asyncio
async def test_cluster_attaches_followup_to_existing(session: AsyncSession) -> None:
    base = datetime.now(UTC)
    a = await _add(session, source="zhihu_hot", title="化工厂大火", fetched_at=base)
    b = await _add(session, source="weibo_hot", title="化工厂大火 进展", fetched_at=base)
    c = await _add(session, source="baidu_hot", title="化工厂大火 暂无伤亡", fetched_at=base)
    event_id = await cluster_one(session, c.id)
    assert event_id is not None

    later = base + timedelta(days=2)
    d = await _add(session, source="thepaper", title="化工厂大火 警方介入", fetched_at=later)
    same = await cluster_one(session, d.id)
    assert same == event_id

    rows = (
        await session.execute(
            select(EventNews).where(EventNews.event_id == event_id).order_by(EventNews.position)
        )
    ).scalars().all()
    assert {r.news_id for r in rows} == {a.id, b.id, c.id, d.id}
    follow = next(r for r in rows if r.news_id == d.id)
    assert follow.kind == "update"


@pytest.mark.asyncio
async def test_cluster_skips_when_too_few_sources(session: AsyncSession) -> None:
    now = datetime.now(UTC)
    a = await _add(session, source="zhihu_hot", title="某事件首发", fetched_at=now)
    await _add(session, source="weibo_hot", title="某事件首发 现场画面", fetched_at=now)
    # only 2 distinct sources → cluster_one should return None for an isolated item
    out = await cluster_one(session, a.id)
    assert out is None


@pytest.mark.asyncio
async def test_cluster_idempotent(session: AsyncSession) -> None:
    now = datetime.now(UTC)
    a = await _add(session, source="zhihu_hot", title="重复幂等检验", fetched_at=now)
    await _add(session, source="weibo_hot", title="重复幂等检验 续报", fetched_at=now)
    await _add(session, source="baidu_hot", title="重复幂等检验 解释", fetched_at=now)

    e1 = await cluster_one(session, a.id)
    e2 = await cluster_one(session, a.id)
    assert e1 == e2


@pytest.mark.asyncio
async def test_cluster_all_unassigned(session: AsyncSession) -> None:
    now = datetime.now(UTC)
    titles = [
        ("zhihu_hot", "国际半导体峰会今日在上海开幕"),
        ("weibo_hot", "国际半导体峰会今日在上海开幕 多家厂商参展"),
        ("baidu_hot", "国际半导体峰会今日在上海开幕 行业聚焦"),
        ("zhihu_hot", "完全无关的另一件事"),
    ]
    for source, title in titles:
        await _add(session, source=source, title=title, fetched_at=now)

    stats = await cluster_all_unassigned(session)
    assert stats["seen"] == 4
    assert stats["assigned"] == 3
    events = (await session.execute(select(Event))).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_events_api(session: AsyncSession, client: AsyncClient) -> None:
    now = datetime.now(UTC)
    items = []
    for source, title in [
        ("zhihu_hot", "API 事件 首发"),
        ("weibo_hot", "API 事件 进展"),
        ("baidu_hot", "API 事件 调查"),
    ]:
        items.append(await _add(session, source=source, title=title, fetched_at=now))
    event_id = await cluster_one(session, items[-1].id)
    assert event_id is not None

    r_list = await client.get("/api/events")
    assert r_list.status_code == 200
    body = r_list.json()
    assert len(body) == 1
    assert body[0]["news_count"] == 3
    assert body[0]["status"] == "ongoing"

    r_get = await client.get(f"/api/events/{event_id}")
    assert r_get.status_code == 200
    detail = r_get.json()
    assert len(detail["timeline"]) == 3
    assert detail["timeline"][0]["kind"] == "origin"

    r_404 = await client.get(f"/api/events/{uuid.uuid4()}")
    assert r_404.status_code == 404
