from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.canonical import encode
from app.crypto.log import compute_leaf_bytes
from app.crypto.merkle import leaf_hash
from app.db.models import MerkleLeaf, Vote
from app.ingest.base import NewsItemDraft
from tests.conftest import seed_news


def _draft(sid: str, title: str = "标题") -> NewsItemDraft:
    return NewsItemDraft(
        source="zhihu_hot",
        source_url=f"https://example.com/{sid}",
        source_id=sid,
        title=title,
        raw_text="正文",
        lang="zh",
        hot_rank=1,
        fetched_at=datetime(2026, 5, 8, tzinfo=UTC),
    )


async def _ingest_one(session: AsyncSession) -> str:
    key = SigningKey.generate()
    await seed_news(session, [_draft("a", "事件A")], key)
    rows = (await session.execute(select(_news_id_col()))).scalars().all()
    return str(rows[0])


def _news_id_col():
    from app.db.models import NewsItem

    return NewsItem.id


async def _signup(client: AsyncClient, *, signing_key: SigningKey, email: str) -> str:
    pubkey = bytes(signing_key.verify_key).hex()
    r = await client.post(
        "/api/auth/signup",
        json={"email": email, "password": "supersecret123", "pubkey": pubkey},
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _signed_payload(
    *,
    signing_key: SigningKey,
    news_id: str,
    user_id: str,
    score: int,
    reason: str = "",
    voted_at: str = "2026-05-08T12:00:00Z",
) -> dict[str, str | int]:
    canonical = encode(
        {
            "schema": "vote.v1",
            "news_id": news_id,
            "user_id": user_id,
            "score": score,
            "reason": reason,
            "voted_at": voted_at,
        }
    )
    sig = signing_key.sign(canonical).signature
    return {"score": score, "reason": reason, "voted_at": voted_at, "sig": sig.hex()}


@pytest.mark.asyncio
async def test_cast_vote_appends_signed_leaf(
    session: AsyncSession, client: AsyncClient
) -> None:
    news_id = await _ingest_one(session)
    user_key = SigningKey.generate()
    token = await _signup(client, signing_key=user_key, email="alice@x.com")

    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me.json()["id"]

    payload = _signed_payload(
        signing_key=user_key, news_id=news_id, user_id=user_id, score=1, reason="ok"
    )
    r = await client.post(
        f"/api/news/{news_id}/vote",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["score"] == 1
    assert len(body["leaf_hash"]) == 64

    # The merkle leaf must hash to what the server returned.
    canonical = encode(
        {
            "schema": "vote.v1",
            "news_id": news_id,
            "user_id": user_id,
            "score": 1,
            "reason": "ok",
            "voted_at": "2026-05-08T12:00:00Z",
        }
    )
    sig = bytes.fromhex(payload["sig"])
    expected = leaf_hash(compute_leaf_bytes("vote", canonical, sig)).hex()
    assert body["leaf_hash"] == expected

    leaf = (
        await session.execute(
            select(MerkleLeaf).where(MerkleLeaf.leaf_hash == bytes.fromhex(expected))
        )
    ).scalar_one()
    assert leaf.leaf_type == "vote"


@pytest.mark.asyncio
async def test_cast_vote_rejects_bad_signature(
    session: AsyncSession, client: AsyncClient
) -> None:
    news_id = await _ingest_one(session)
    real_key = SigningKey.generate()
    impostor_key = SigningKey.generate()
    token = await _signup(client, signing_key=real_key, email="bob@x.com")

    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me.json()["id"]

    payload = _signed_payload(
        signing_key=impostor_key, news_id=news_id, user_id=user_id, score=1
    )
    r = await client.post(
        f"/api/news/{news_id}/vote",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_cast_vote_rejects_tampered_score(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Signature was over score=1 but body sends score=-1 → must fail."""
    news_id = await _ingest_one(session)
    user_key = SigningKey.generate()
    token = await _signup(client, signing_key=user_key, email="carol@x.com")

    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me.json()["id"]

    payload = _signed_payload(
        signing_key=user_key, news_id=news_id, user_id=user_id, score=1
    )
    payload["score"] = -1  # tamper after signing
    r = await client.post(
        f"/api/news/{news_id}/vote",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_cast_vote_requires_auth(session: AsyncSession, client: AsyncClient) -> None:
    news_id = await _ingest_one(session)
    user_key = SigningKey.generate()
    payload = _signed_payload(
        signing_key=user_key, news_id=news_id, user_id=str(uuid.uuid4()), score=1
    )
    r = await client.post(f"/api/news/{news_id}/vote", json=payload)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_cast_vote_rejects_duplicate(
    session: AsyncSession, client: AsyncClient
) -> None:
    news_id = await _ingest_one(session)
    user_key = SigningKey.generate()
    token = await _signup(client, signing_key=user_key, email="dave@x.com")
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me.json()["id"]

    p1 = _signed_payload(
        signing_key=user_key, news_id=news_id, user_id=user_id, score=1
    )
    r1 = await client.post(
        f"/api/news/{news_id}/vote", json=p1, headers={"Authorization": f"Bearer {token}"}
    )
    assert r1.status_code == 200

    p2 = _signed_payload(
        signing_key=user_key,
        news_id=news_id,
        user_id=user_id,
        score=-1,
        voted_at="2026-05-08T13:00:00Z",
    )
    r2 = await client.post(
        f"/api/news/{news_id}/vote", json=p2, headers={"Authorization": f"Bearer {token}"}
    )
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_cast_vote_rejects_unknown_news(client: AsyncClient) -> None:
    user_key = SigningKey.generate()
    token = await _signup(client, signing_key=user_key, email="erin@x.com")
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me.json()["id"]

    fake_news_id = str(uuid.uuid4())
    payload = _signed_payload(
        signing_key=user_key, news_id=fake_news_id, user_id=user_id, score=1
    )
    r = await client.post(
        f"/api/news/{fake_news_id}/vote",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cast_vote_rejects_out_of_range_score(
    session: AsyncSession, client: AsyncClient
) -> None:
    news_id = await _ingest_one(session)
    user_key = SigningKey.generate()
    token = await _signup(client, signing_key=user_key, email="frank@x.com")
    r = await client.post(
        f"/api/news/{news_id}/vote",
        json={"score": 7, "reason": "", "voted_at": "2026-05-08T12:00:00Z", "sig": "ab" * 64},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_list_votes_aggregates(
    session: AsyncSession, client: AsyncClient
) -> None:
    news_id = await _ingest_one(session)
    for i, score in enumerate([1, 1, 1, -1, 0]):
        key = SigningKey.generate()
        token = await _signup(client, signing_key=key, email=f"u{i}@x.com")
        me = await client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
        )
        user_id = me.json()["id"]
        payload = _signed_payload(
            signing_key=key,
            news_id=news_id,
            user_id=user_id,
            score=score,
            voted_at=f"2026-05-08T12:0{i}:00Z",
        )
        r = await client.post(
            f"/api/news/{news_id}/vote",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text

    r = await client.get(f"/api/news/{news_id}/votes")
    assert r.status_code == 200
    body = r.json()
    assert body["vote_count"] == 5
    assert body["score_breakdown"] == {"1": 3, "-1": 1, "0": 1}
    # All reps default to 0 → equal weights → mean = (3 - 1 + 0) / 5 = 0.4
    assert body["weighted_score"] == pytest.approx(0.4, abs=1e-9)


@pytest.mark.asyncio
async def test_my_vote_returns_null_when_not_voted(
    session: AsyncSession, client: AsyncClient
) -> None:
    news_id = await _ingest_one(session)
    key = SigningKey.generate()
    token = await _signup(client, signing_key=key, email="g@x.com")
    r = await client.get(
        f"/api/news/{news_id}/vote/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json() is None


@pytest.mark.asyncio
async def test_my_vote_returns_existing(
    session: AsyncSession, client: AsyncClient
) -> None:
    news_id = await _ingest_one(session)
    key = SigningKey.generate()
    token = await _signup(client, signing_key=key, email="h@x.com")
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me.json()["id"]
    payload = _signed_payload(
        signing_key=key, news_id=news_id, user_id=user_id, score=1, reason="believable"
    )
    await client.post(
        f"/api/news/{news_id}/vote",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    r = await client.get(
        f"/api/news/{news_id}/vote/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["score"] == 1
    assert body["reason"] == "believable"


_ = Vote  # ensures import lint-clean even if unused directly in this module
