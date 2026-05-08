from __future__ import annotations

from datetime import UTC, datetime

import pytest
from nacl.signing import SigningKey
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.canonical import encode
from app.crypto.log import compute_leaf_bytes
from app.crypto.merkle import leaf_hash
from app.db.models import MerkleLeaf, NewsItem, NewsSignature
from app.ingest.base import NewsItemDraft
from app.ingest.pipeline import ingest_drafts, to_canonical_payload


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
async def test_pipeline_inserts_signs_and_logs(session: AsyncSession) -> None:
    key = SigningKey.generate()
    inserted = await ingest_drafts(
        session=session,
        drafts=[_draft("a"), _draft("b")],
        signer_id="service:v1",
        signing_key=key,
    )
    assert inserted == 2

    items = (await session.execute(select(NewsItem).order_by(NewsItem.source_id))).scalars().all()
    assert [it.source_id for it in items] == ["a", "b"]

    leaf_count = (await session.execute(select(func.count(MerkleLeaf.seq)))).scalar_one()
    assert leaf_count == 2

    sig_count = (await session.execute(select(func.count(NewsSignature.id)))).scalar_one()
    assert sig_count == 2


@pytest.mark.asyncio
async def test_pipeline_dedupes_existing(session: AsyncSession) -> None:
    key = SigningKey.generate()
    first = await ingest_drafts(session, [_draft("a"), _draft("b")], "service:v1", key)
    assert first == 2
    second = await ingest_drafts(session, [_draft("a"), _draft("c")], "service:v1", key)
    assert second == 1

    items = (await session.execute(select(NewsItem).order_by(NewsItem.source_id))).scalars().all()
    assert [it.source_id for it in items] == ["a", "b", "c"]

    leaf_count = (await session.execute(select(func.count(MerkleLeaf.seq)))).scalar_one()
    assert leaf_count == 3


@pytest.mark.asyncio
async def test_pipeline_signature_is_recomputable(session: AsyncSession) -> None:
    key = SigningKey.generate()
    await ingest_drafts(session, [_draft("a", title="标题A")], "service:v1", key)

    item = (await session.execute(select(NewsItem))).scalar_one()
    sig_row = (
        await session.execute(select(NewsSignature).where(NewsSignature.news_id == item.id))
    ).scalar_one()
    leaf = (
        await session.execute(select(MerkleLeaf).where(MerkleLeaf.ref_id == item.id))
    ).scalar_one()

    expected_canonical = encode(to_canonical_payload(item))
    assert sig_row.canonical_bytes == expected_canonical
    expected_leaf_hash = leaf_hash(compute_leaf_bytes("news", expected_canonical, sig_row.sig))
    assert leaf.leaf_hash == expected_leaf_hash


@pytest.mark.asyncio
async def test_to_canonical_payload_is_deterministic_under_identical_input() -> None:
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
