from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime

import pytest
from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.canonical import encode
from app.crypto.log import append_news_signed, compute_leaf_bytes
from app.crypto.merkle import leaf_hash
from app.db.models import MerkleLeaf, NewsItem, NewsSignature


@pytest.mark.asyncio
async def test_append_news_signed_writes_signature_and_leaf(session: AsyncSession) -> None:
    key = SigningKey.generate()
    item = NewsItem(
        id=uuid.uuid4(),
        source="test",
        source_url="https://example.com/a",
        source_id="a-1",
        title="标题",
        raw_text="正文",
        lang="zh",
        hot_rank=1,
        fetched_at=datetime(2026, 5, 8, 12, 0, 0, tzinfo=UTC),
    )
    session.add(item)
    await session.flush()

    payload = {
        "schema": "news_item.v1",
        "id": str(item.id),
        "source": item.source,
        "title": item.title,
    }
    seq, h = await append_news_signed(
        session=session,
        news_id=item.id,
        payload=payload,
        signer_id="service:v1",
        signing_key=key,
    )
    await session.commit()

    sig_row = (
        await session.execute(select(NewsSignature).where(NewsSignature.news_id == item.id))
    ).scalar_one()
    assert sig_row.signer == "service:v1"
    assert sig_row.alg == "ed25519"
    assert sig_row.pubkey == bytes(key.verify_key)
    assert sig_row.canonical_bytes == encode(payload)

    expected_leaf_hash = leaf_hash(compute_leaf_bytes("news", sig_row.canonical_bytes, sig_row.sig))
    assert h == expected_leaf_hash

    leaf = (await session.execute(select(MerkleLeaf).where(MerkleLeaf.seq == seq))).scalar_one()
    assert leaf.leaf_hash == expected_leaf_hash
    assert leaf.leaf_type == "news"
    assert leaf.ref_id == item.id
    assert leaf.payload_digest == hashlib.sha256(sig_row.canonical_bytes).digest()


@pytest.mark.asyncio
async def test_append_news_signed_seq_is_monotonic(session: AsyncSession) -> None:
    key = SigningKey.generate()
    seqs: list[int] = []
    for i in range(3):
        item = NewsItem(
            id=uuid.uuid4(),
            source="test",
            source_url=f"https://example.com/{i}",
            source_id=f"id-{i}",
            title=f"t{i}",
            raw_text="",
            lang="zh",
            hot_rank=i,
            fetched_at=datetime.now(UTC),
        )
        session.add(item)
        await session.flush()
        seq, _ = await append_news_signed(
            session=session,
            news_id=item.id,
            payload={"schema": "news_item.v1", "id": str(item.id), "i": i},
            signer_id="service:v1",
            signing_key=key,
        )
        seqs.append(seq)
    await session.commit()
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == 3


def test_compute_leaf_bytes_unknown_type_raises() -> None:
    with pytest.raises(ValueError):
        compute_leaf_bytes("nope", b"x", b"y")


def test_domain_tags_make_collision_impossible() -> None:
    canonical = b'{"a":1}'
    sig = b"\x00" * 64
    a = compute_leaf_bytes("news", canonical, sig)
    b = compute_leaf_bytes("vote", canonical, sig)
    assert a != b
    assert leaf_hash(a) != leaf_hash(b)
