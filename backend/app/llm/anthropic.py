from __future__ import annotations

from typing import Any

import httpx

from app.llm.base import LLMError, parse_json_response


class AnthropicClient:
    """Anthropic /v1/messages. Uses x-api-key auth and `system` field.

    Anthropic does not have a built-in JSON mode, so we instruct the
    model in the system prompt to emit a single JSON object and parse
    tolerantly.
    """

    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = "https://api.anthropic.com/v1",
        anthropic_version: str = "2023-06-01",
        timeout: float = 60.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.anthropic_version = anthropic_version
        self.timeout = timeout
        self._transport = transport

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 1024,
        temperature: float = 0.0,
    ) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": (
                system + "\n\n请仅输出一个 JSON 对象，不要使用 Markdown 代码块或额外文字。"
            ),
            "messages": [{"role": "user", "content": user}],
        }
        async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
            r = await client.post(
                f"{self.base_url}/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": self.anthropic_version,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if r.status_code >= 400:
            raise LLMError(f"{self.name} HTTP {r.status_code}: {r.text[:300]}")

        data = r.json()
        try:
            blocks = data["content"]
            text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        except (KeyError, TypeError) as e:
            raise LLMError(f"unexpected response shape: {data!r}") from e
        if not text:
            raise LLMError(f"empty content in response: {data!r}")
        return parse_json_response(text)
