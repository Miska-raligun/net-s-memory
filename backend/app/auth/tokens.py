from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt

from app.settings import Settings
from app.settings import settings as default_settings

ALGORITHM = "HS256"


class TokenError(ValueError):
    pass


def issue(user_id: str, *, s: Settings | None = None) -> str:
    s = s or default_settings
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=s.jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=ALGORITHM)


def verify(token: str, *, s: Settings | None = None) -> str:
    s = s or default_settings
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError as e:
        raise TokenError(str(e)) from e
    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise TokenError("missing or non-string subject")
    return sub
