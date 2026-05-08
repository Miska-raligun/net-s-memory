from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.captcha import verify_captcha
from app.auth.passwords import hash_password, verify_password
from app.auth.tokens import TokenError, issue, verify
from app.db.models import UserAccount
from app.db.session import get_session

router = APIRouter(prefix="/api/auth", tags=["auth"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    pubkey: str = Field(description="hex-encoded Ed25519 public key (32 bytes)")
    encrypted_privkey: str | None = None
    captcha_token: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


def _decode_pubkey(hexed: str) -> bytes:
    try:
        b = bytes.fromhex(hexed)
    except ValueError as e:
        raise HTTPException(400, "pubkey must be hex") from e
    if len(b) != 32:
        raise HTTPException(400, "pubkey must be 32 bytes")
    return b


def _decode_encrypted_privkey(hexed: str | None) -> bytes | None:
    if hexed is None:
        return None
    try:
        return bytes.fromhex(hexed)
    except ValueError as e:
        raise HTTPException(400, "encrypted_privkey must be hex") from e


def _serialize_user(user: UserAccount) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "email": user.email,
        "pubkey": user.pubkey_ed25519.hex(),
        "encrypted_privkey": (
            user.encrypted_privkey.hex() if user.encrypted_privkey else None
        ),
        "reputation": user.reputation,
        "created_at": user.created_at.isoformat(),
    }


@router.post("/signup")
async def signup(req: SignupRequest, session: SessionDep) -> dict[str, Any]:
    if not await verify_captcha(req.captcha_token):
        raise HTTPException(400, "captcha verification failed")

    email = req.email.lower()
    existing = (
        await session.execute(select(UserAccount).where(UserAccount.email == email))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "email already registered")

    pubkey = _decode_pubkey(req.pubkey)
    encrypted_privkey = _decode_encrypted_privkey(req.encrypted_privkey)

    user = UserAccount(
        id=uuid.uuid4(),
        email=email,
        password_hash=hash_password(req.password),
        pubkey_ed25519=pubkey,
        encrypted_privkey=encrypted_privkey,
        reputation=0.0,
    )
    session.add(user)
    await session.commit()
    return {"user": _serialize_user(user), "token": issue(str(user.id))}


@router.post("/login")
async def login(req: LoginRequest, session: SessionDep) -> dict[str, Any]:
    user = (
        await session.execute(
            select(UserAccount).where(UserAccount.email == req.email.lower())
        )
    ).scalar_one_or_none()
    if user is None or not verify_password(user.password_hash, req.password):
        raise HTTPException(401, "invalid credentials")
    return {"user": _serialize_user(user), "token": issue(str(user.id))}


async def get_current_user(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> UserAccount:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization.split(None, 1)[1]
    try:
        user_id = verify(token)
    except TokenError as e:
        raise HTTPException(401, f"invalid token: {e}") from e
    try:
        uid = uuid.UUID(user_id)
    except ValueError as e:
        raise HTTPException(401, "invalid token subject") from e
    user = (
        await session.execute(select(UserAccount).where(UserAccount.id == uid))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(401, "user not found")
    return user


CurrentUser = Annotated[UserAccount, Depends(get_current_user)]


@router.get("/me")
async def me(user: CurrentUser) -> dict[str, Any]:
    return _serialize_user(user)
