"""hCaptcha verification.

When ``HCAPTCHA_SECRET`` is empty (the default in dev), captcha is not
enforced and ``verify_captcha`` returns True regardless of input. In
production, set the secret and the front-end must include the token.
"""

from __future__ import annotations

import httpx

from app.settings import Settings
from app.settings import settings as default_settings

VERIFY_URL = "https://api.hcaptcha.com/siteverify"


async def verify_captcha(
    token: str | None,
    *,
    s: Settings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> bool:
    s = s or default_settings
    if not s.hcaptcha_secret:
        return True
    if not token:
        return False
    async with httpx.AsyncClient(timeout=10.0, transport=transport) as client:
        r = await client.post(
            VERIFY_URL,
            data={"secret": s.hcaptcha_secret, "response": token},
        )
    if r.status_code >= 400:
        return False
    body = r.json()
    return bool(body.get("success", False))
