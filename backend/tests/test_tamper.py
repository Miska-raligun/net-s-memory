"""End-to-end tamper detection.

Demonstrates the two failure modes the integrity story has to catch:

1. Operator modifies ``news_item`` content but leaves the signature row
   alone. The cryptographic verification still passes (the leaf was
   genuinely committed) but the content the user sees no longer matches
   what was signed -- the content check picks this up.
2. Operator modifies ``news_signature.canonical_bytes`` (or ``sig``) to
   change the recorded canonical content. The recomputed leaf hash no
   longer reproduces the audit path's root -- the cryptographic check
   picks this up.

Together they cover the realistic tampering surface for a single-operator
deployment. Once the daily root is anchored on Bitcoin via OTS, even
swapping the entire log requires forging a public-chain witness.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.log import compute_leaf_bytes
from app.crypto.merkle import leaf_hash, verify_inclusion
from app.db.models import NewsItem, NewsSignature
from app.ingest.base import NewsItemDraft
from tests.conftest import seed_news


def _draft(source_id: str, title: str = "原标题") -> NewsItemDraft:
    return NewsItemDraft(
        source="zhihu_hot",
        source_url=f"https://example.com/{source_id}",
        source_id=source_id,
        title=title,
        raw_text="原始正文",
        lang="zh",
        hot_rank=1,
        fetched_at=datetime(2026, 5, 8, tzinfo=UTC),
    )


def _verify_crypto(proof: dict) -> bool:
    # The wire format decodes server bytes as latin-1; the browser verifier
    # re-encodes via TextEncoder (UTF-8). For untampered canonical (always
    # ASCII), utf-8 == ascii bytewise. For tampered canonical with high
    # bytes, the round-trip diverges and hashing correctly mismatches.
    canonical = proof["canonical"].encode("utf-8")
    sig = bytes.fromhex(proof["signature"])
    leaf_bytes = compute_leaf_bytes("news", canonical, sig)
    h = leaf_hash(leaf_bytes)
    return verify_inclusion(
        leaf=h,
        index=proof["leaf_index"],
        tree_size=proof["tree_size"],
        proof=[bytes.fromhex(x) for x in proof["audit_path"]],
        root=bytes.fromhex(proof["root_hash"]),
    )


@pytest.mark.asyncio
async def test_news_item_tamper_breaks_content_check_only(
    session: AsyncSession, client: AsyncClient
) -> None:
    key = SigningKey.generate()
    await seed_news(session, [_draft("a")], key)

    listing = (await client.get("/api/news")).json()
    nid = listing[0]["id"]

    proof_before = (await client.get(f"/api/news/{nid}/proof")).json()
    assert _verify_crypto(proof_before) is True
    assert json.loads(proof_before["canonical"])["title"] == "原标题"

    item = (
        await session.execute(select(NewsItem).where(NewsItem.id == uuid.UUID(nid)))
    ).scalar_one()
    item.title = "已被篡改的标题"
    await session.commit()

    detail = (await client.get(f"/api/news/{nid}")).json()
    assert detail["title"] == "已被篡改的标题"

    proof_after = (await client.get(f"/api/news/{nid}/proof")).json()
    assert _verify_crypto(proof_after) is True
    signed_title = json.loads(proof_after["canonical"])["title"]
    assert signed_title == "原标题"
    assert detail["title"] != signed_title


@pytest.mark.asyncio
async def test_canonical_tamper_breaks_crypto_check(
    session: AsyncSession, client: AsyncClient
) -> None:
    key = SigningKey.generate()
    await seed_news(session, [_draft("a")], key)

    listing = (await client.get("/api/news")).json()
    nid = listing[0]["id"]

    sig_row = (await session.execute(select(NewsSignature))).scalar_one()
    bad = bytearray(sig_row.canonical_bytes)
    bad[10] ^= 0xFF
    sig_row.canonical_bytes = bytes(bad)
    await session.commit()

    proof_after = (await client.get(f"/api/news/{nid}/proof")).json()
    assert _verify_crypto(proof_after) is False


@pytest.mark.asyncio
async def test_signature_tamper_breaks_crypto_check(
    session: AsyncSession, client: AsyncClient
) -> None:
    key = SigningKey.generate()
    await seed_news(session, [_draft("a")], key)

    listing = (await client.get("/api/news")).json()
    nid = listing[0]["id"]

    sig_row = (await session.execute(select(NewsSignature))).scalar_one()
    bad_sig = bytearray(sig_row.sig)
    bad_sig[0] ^= 0xFF
    sig_row.sig = bytes(bad_sig)
    await session.commit()

    proof_after = (await client.get(f"/api/news/{nid}/proof")).json()
    assert _verify_crypto(proof_after) is False
