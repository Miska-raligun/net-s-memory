from __future__ import annotations

from datetime import UTC, datetime

import pytest
from nacl.signing import SigningKey
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.canonical import encode
from app.crypto.log import compute_leaf_bytes
from app.crypto.merkle import leaf_hash
from app.db.models import MerkleLeaf, NewsCandidate, NewsItem, NewsSignature
from app.ingest.base import NewsItemDraft
from app.ingest.pipeline import ingest_candidates, to_canonical_payload
from tests.conftest import seed_news


def _draft(source_id: str, title: str = "t") -> NewsItemDraft:
    return NewsItemDraft(
        source="zhihu_hot",
        source_url=f"https://example.com/{source_id}",
        source_id=source_id,
        title=title,
        raw_text="正文",
        lang="zh",
        hot_rank=1,
        fetched_at=datetime(2026, 5, 8, 12, 0, 0, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_ingest_candidates_does_not_sign_or_publish(session: AsyncSession) -> None:
    inserted = await ingest_candidates(session, [_draft("a"), _draft("b")])
    assert inserted == 2

    cands = (
        await session.execute(select(NewsCandidate).order_by(NewsCandidate.source_id))
    ).scalars().all()
    assert [c.source_id for c in cands] == ["a", "b"]
    assert all(c.status == "pending" for c in cands)

    # No public timeline / chain side-effects from ingest alone.
    news_count = (await session.execute(select(func.count(NewsItem.id)))).scalar_one()
    leaf_count = (await session.execute(select(func.count(MerkleLeaf.seq)))).scalar_one()
    sig_count = (await session.execute(select(func.count(NewsSignature.id)))).scalar_one()
    assert news_count == 0
    assert leaf_count == 0
    assert sig_count == 0


@pytest.mark.asyncio
async def test_ingest_candidates_dedupes_by_source_pair(session: AsyncSession) -> None:
    first = await ingest_candidates(session, [_draft("a"), _draft("b")])
    assert first == 2
    second = await ingest_candidates(session, [_draft("a"), _draft("c")])
    assert second == 1

    cands = (
        await session.execute(select(NewsCandidate).order_by(NewsCandidate.source_id))
    ).scalars().all()
    assert [c.source_id for c in cands] == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_seed_news_helper_signs_and_logs(session: AsyncSession) -> None:
    """The test helper keeps v1 canonical bytes byte-for-byte identical to
    the legacy pre-curation ingest, so old signed payloads still verify."""
    key = SigningKey.generate()
    await seed_news(session, [_draft("a", title="标题A")], key)

    item = (await session.execute(select(NewsItem))).scalar_one()
    sig_row = (
        await session.execute(select(NewsSignature).where(NewsSignature.news_id == item.id))
    ).scalar_one()
    leaf = (
        await session.execute(select(MerkleLeaf).where(MerkleLeaf.ref_id == item.id))
    ).scalar_one()

    expected_canonical = encode(to_canonical_payload(item))
    assert sig_row.canonical_bytes == expected_canonical
    expected_leaf_hash = leaf_hash(
        compute_leaf_bytes("news", expected_canonical, sig_row.sig)
    )
    assert leaf.leaf_hash == expected_leaf_hash


@pytest.mark.asyncio
async def test_v1_canonical_payload_is_deterministic_under_identical_input() -> None:
    item = NewsItem(
        id=__import__("uuid").UUID("00000000-0000-0000-0000-000000000001"),
        source="x",
        source_url="https://x",
        source_id="s",
        title="t",
        raw_text="r",
        lang="zh",
        hot_rank=3,
        fetched_at=datetime(2026, 5, 8, 12, 0, 0, tzinfo=UTC),
    )
    a = encode(to_canonical_payload(item))
    b = encode(to_canonical_payload(item))
    assert a == b
    assert b'"schema":"news_item.v1"' in a


def test_v2_canonical_payload_includes_curation_fields() -> None:
    item = NewsItem(
        id=__import__("uuid").UUID("00000000-0000-0000-0000-000000000002"),
        source="zhihu_hot",
        source_url="https://x",
        source_id="s",
        title="化工厂事故",
        raw_text="",
        lang="zh",
        fetched_at=datetime(2026, 5, 8, tzinfo=UTC),
        classification="social",
        summary="100字摘要",
        why_matters="50字解释",
        citations=[
            {
                "source": "zhihu_hot",
                "source_url": "https://x",
                "source_id": "s",
                "title": "化工厂事故",
            }
        ],
        curator="llm:test-model",
    )
    a = encode(to_canonical_payload(item))
    assert b'"schema":"news_item.v2"' in a
    assert b'"classification":"social"' in a
    assert b'"curator":"llm:test-model"' in a
