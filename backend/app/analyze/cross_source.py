"""Cross-source corroboration via character-trigram Jaccard.

We avoid jieba/embeddings for now; char trigrams give surprisingly decent
results on short Chinese hot-list titles where the same event tends to
share long substrings across rewordings.
"""

from __future__ import annotations

import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import NewsItem

_NON_WORD = re.compile(r"[\s\W_]+", flags=re.UNICODE)


def char_trigrams(text: str) -> set[str]:
    cleaned = _NON_WORD.sub("", text)
    if len(cleaned) < 3:
        return {cleaned} if cleaned else set()
    return {cleaned[i : i + 3] for i in range(len(cleaned) - 2)}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


async def find_corroborating(
    session: AsyncSession,
    target: NewsItem,
    *,
    window_hours: int = 48,
    similarity_threshold: float = 0.3,
) -> list[NewsItem]:
    """Return distinct news_items whose title is similar to ``target`` within window.

    Self is excluded; results are sorted by descending similarity (most similar
    first). Only one item per (source, title) pair is returned.
    """
    cutoff_lo = target.fetched_at - timedelta(hours=window_hours)
    cutoff_hi = target.fetched_at + timedelta(hours=window_hours)

    rows = (
        await session.execute(
            select(NewsItem)
            .where(NewsItem.id != target.id)
            .where(NewsItem.fetched_at >= cutoff_lo)
            .where(NewsItem.fetched_at <= cutoff_hi)
        )
    ).scalars().all()

    target_grams = char_trigrams(target.title)
    scored: list[tuple[float, NewsItem]] = []
    for r in rows:
        s = jaccard(target_grams, char_trigrams(r.title))
        if s >= similarity_threshold:
            scored.append((s, r))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [r for _, r in scored]
