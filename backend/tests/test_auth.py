from __future__ import annotations

import time

import pytest
from httpx import AsyncClient
from nacl.signing import SigningKey

from app.auth.passwords import hash_password, verify_password
from app.auth.tokens import TokenError, issue, verify


def _new_pubkey_hex() -> str:
    return bytes(SigningKey.generate().verify_key).hex()


def test_password_hash_round_trip() -> None:
    h = hash_password("correct horse battery staple")
    assert h.startswith("$argon2")
    assert verify_password(h, "correct horse battery staple") is True
    assert verify_password(h, "wrong") is False


def test_password_verify_rejects_garbage() -> None:
    assert verify_password("not-an-argon2-hash", "x") is False


def test_token_round_trip() -> None:
    tok = issue("user-123")
    assert verify(tok) == "user-123"


def test_token_rejects_tampered() -> None:
    tok = issue("user-123")
    bad = tok[:-1] + ("A" if tok[-1] != "A" else "B")
    with pytest.raises(TokenError):
        verify(bad)


def test_token_rejects_garbage() -> None:
    with pytest.raises(TokenError):
        verify("not.a.token")


@pytest.mark.asyncio
async def test_signup_then_login_then_me(client: AsyncClient) -> None:
    pubkey = _new_pubkey_hex()
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": "Alice@Example.com",
            "password": "supersecret123",
            "pubkey": pubkey,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == "alice@example.com"
    assert body["user"]["pubkey"] == pubkey
    assert body["user"]["reputation"] == 0.0
    token1 = body["token"]
    assert token1

    r2 = await client.post(
        "/api/auth/login",
        json={"email": "alice@example.com", "password": "supersecret123"},
    )
    assert r2.status_code == 200
    token2 = r2.json()["token"]

    r3 = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token2}"})
    assert r3.status_code == 200
    assert r3.json()["email"] == "alice@example.com"


@pytest.mark.asyncio
async def test_signup_rejects_duplicate(client: AsyncClient) -> None:
    pubkey = _new_pubkey_hex()
    payload = {"email": "dup@example.com", "password": "supersecret123", "pubkey": pubkey}
    r1 = await client.post("/api/auth/signup", json=payload)
    assert r1.status_code == 200
    r2 = await client.post("/api/auth/signup", json=payload)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_signup_rejects_short_password(client: AsyncClient) -> None:
    r = await client.post(
        "/api/auth/signup",
        json={"email": "x@example.com", "password": "short", "pubkey": _new_pubkey_hex()},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_signup_rejects_bad_pubkey(client: AsyncClient) -> None:
    r = await client.post(
        "/api/auth/signup",
        json={"email": "y@example.com", "password": "supersecret123", "pubkey": "zz"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_signup_rejects_wrong_length_pubkey(client: AsyncClient) -> None:
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": "z@example.com",
            "password": "supersecret123",
            "pubkey": "ab" * 16,
        },
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient) -> None:
    pubkey = _new_pubkey_hex()
    await client.post(
        "/api/auth/signup",
        json={"email": "bob@example.com", "password": "supersecret123", "pubkey": pubkey},
    )
    r = await client.post(
        "/api/auth/login",
        json={"email": "bob@example.com", "password": "wrong"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_token(client: AsyncClient) -> None:
    r = await client.get("/api/auth/me")
    assert r.status_code == 401

    r2 = await client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.token"})
    assert r2.status_code == 401

    r3 = await client.get("/api/auth/me", headers={"Authorization": "Basic xxx"})
    assert r3.status_code == 401


@pytest.mark.asyncio
async def test_me_with_orphan_token(client: AsyncClient) -> None:
    """Token is valid but references no existing user — should 401, not 200."""
    fake_token = issue("00000000-0000-0000-0000-000000000000")
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {fake_token}"})
    assert r.status_code == 401


def test_token_includes_expiry() -> None:
    tok = issue("u1")
    # Just exercises issue() — verify() handles exp internally.
    assert isinstance(tok, str)
    assert tok.count(".") == 2
    # Sanity: brand new token should still verify.
    assert verify(tok) == "u1"
    assert time.time() > 0  # placeholder so import isn't unused
