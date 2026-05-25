"""Provider-neutral LLM client interface.

Two concrete clients exist:
- OpenAICompatibleClient covers OpenAI itself and all providers that
  expose an OpenAI-compatible /chat/completions endpoint
  (DeepSeek, MiniMax, Moonshot/Kimi, Zhipu/GLM, Qwen/DashScope, ...).
- AnthropicClient covers Anthropic's native /v1/messages.

Both expose ``complete_json`` which forces the model to emit a single
JSON object and returns it parsed.
"""

from __future__ import annotations

import json
import re
from typing import Any, Protocol


class LLMClient(Protocol):
    name: str
    model: str

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 1024,
        temperature: float = 0.0,
    ) -> dict[str, Any]: ...


class LLMError(RuntimeError):
    pass


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def parse_json_response(text: str) -> dict[str, Any]:
    """Extract a JSON object from an LLM response, tolerating markdown fences."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = _FENCE_RE.sub("", stripped).strip()
    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError as e:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start == -1 or end == -1 or end < start:
            raise LLMError(f"response is not JSON: {text[:200]!r}") from e
        obj = json.loads(stripped[start : end + 1])
    if not isinstance(obj, dict):
        raise LLMError(f"expected JSON object, got {type(obj).__name__}")
    return obj
