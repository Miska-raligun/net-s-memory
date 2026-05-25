from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyze.cross_source import char_trigrams, find_corroborating, jaccard
from app.db.models import NewsItem


def test_char_trigrams_chinese() -> None:
    g = char_trigrams("某公司发生大火")
    assert "某公司" in g
    assert "发生大" in g
    assert len(g) == 5


def test_char_trigrams_strips_whitespace_and_punctuation() -> None:
    g = char_trigrams("某公司，发生大火！")
    assert "某公司" in g
    assert "司发生" in g
    assert "，" not in "".join(g)


def test_char_trigrams_short_text() -> None:
    assert char_trigrams("ab") == {"ab"}
    assert char_trigrams("") == set()


def test_jaccard_basic() -> None:
    assert jaccard(set(), set()) == 0.0
    assert jaccard({"a"}, {"a"}) == 1.0
    assert jaccard({"a", "b"}, {"a", "c"}) == pytest.approx(1 / 3)


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
async def test_find_corroborating_picks_similar_titles(session: AsyncSession) -> None:
    now = datetime.now(UTC)
    target = await _add(
        session, source="weibo_hot", title="某公司化工厂凌晨发生大火", fetched_at=now
    )
    same_event_a = await _add(
        session,
        source="zhihu_hot",
        title="某公司化工厂凌晨发生大火 现场已无明火",
        fetched_at=now,
    )
    same_event_b = await _add(
        session,
        source="baidu_hot",
        title="某公司化工厂凌晨发生大火 暂无伤亡",
        fetched_at=now,
    )
    unrelated = await _add(
        session,
        source="zhihu_hot",
        title="国家队公布奥运参赛名单",
        fetched_at=now,
    )

    out = await find_corroborating(session, target)
    ids = {c.id for c in out}
    assert same_event_a.id in ids
    assert same_event_b.id in ids
    assert unrelated.id not in ids
    assert target.id not in ids


@pytest.mark.asyncio
async def test_find_corroborating_respects_window(session: AsyncSession) -> None:
    now = datetime.now(UTC)
    target = await _add(session, source="weibo_hot", title="A股开盘下跌2%", fetched_at=now)
    in_window = await _add(
        session, source="zhihu_hot", title="A股开盘下跌2% 三大指数齐跌", fetched_at=now
    )
    out_of_window = await _add(
        session,
        source="baidu_hot",
        title="A股开盘下跌2%",
        fetched_at=now - timedelta(days=10),
    )

    out = await find_corroborating(session, target, window_hours=48)
    ids = {c.id for c in out}
    assert in_window.id in ids
    assert out_of_window.id not in ids
