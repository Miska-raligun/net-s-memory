from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from nacl.signing import SigningKey
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.log import compute_leaf_bytes
from app.crypto.merkle import leaf_hash, verify_inclusion
from app.ingest.base import NewsItemDraft
from tests.conftest import seed_news


def _draft(source_id: str, title: str = "标题") -> NewsItemDraft:
    return NewsItemDraft(
        source="zhihu_hot",
        source_url=f"https://example.com/{source_id}",
        source_id=source_id,
        title=title,
        raw_text="正文",
        lang="zh",
        hot_rank=1,
        fetched_at=datetime(2026, 5, 8, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_health(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_list_and_detail(session: AsyncSession, client: AsyncClient) -> None:
    key = SigningKey.generate()
    await seed_news(session, [_draft("a", "事件A"), _draft("b", "事件B")], key)

    r = await client.get("/api/news")
    assert r.status_code == 200
    items = r.json()
    assert {it["title"] for it in items} == {"事件A", "事件B"}

    nid = items[0]["id"]
    r2 = await client.get(f"/api/news/{nid}")
    assert r2.status_code == 200
    assert r2.json()["raw_text"] == "正文"


@pytest.mark.asyncio
async def test_proof_round_trip(session: AsyncSession, client: AsyncClient) -> None:
    key = SigningKey.generate()
    drafts = [_draft(f"id-{i}", f"事件{i}") for i in range(5)]
    await seed_news(session, drafts, key)

    r = await client.get("/api/news")
    items = r.json()
    assert len(items) == 5

    for item in items:
        proof_resp = await client.get(f"/api/news/{item['id']}/proof")
        assert proof_resp.status_code == 200
        body = proof_resp.json()

        canonical = body["canonical"].encode("ascii")
        sig = bytes.fromhex(body["signature"])
        leaf_bytes = compute_leaf_bytes("news", canonical, sig)
        recomputed = leaf_hash(leaf_bytes)
        assert recomputed.hex() == body["leaf_hash"]

        ok = verify_inclusion(
            leaf=recomputed,
            index=body["leaf_index"],
            tree_size=body["tree_size"],
            proof=[bytes.fromhex(h) for h in body["audit_path"]],
            root=bytes.fromhex(body["root_hash"]),
        )
        assert ok is True


@pytest.mark.asyncio
async def test_proof_404_for_unknown_id(client: AsyncClient) -> None:
    r = await client.get("/api/news/00000000-0000-0000-0000-000000000000/proof")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_transparency_reflects_log_state(
    session: AsyncSession, client: AsyncClient
) -> None:
    r0 = await client.get("/api/transparency")
    assert r0.status_code == 200
    body0 = r0.json()
    assert body0["tree_size"] == 0
    assert body0["root_hash"] is None

    key = SigningKey.generate()
    await seed_news(session, [_draft(f"id-{i}") for i in range(3)], key)

    r1 = await client.get("/api/transparency")
    body1 = r1.json()
    assert body1["tree_size"] == 3
    assert body1["root_hash"] is not None
    assert len(body1["root_hash"]) == 64
