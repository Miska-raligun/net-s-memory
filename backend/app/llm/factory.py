from __future__ import annotations

from app.llm.anthropic import AnthropicClient
from app.llm.base import LLMClient
from app.llm.openai_compat import OpenAICompatibleClient
from app.settings import Settings
from app.settings import settings as default_settings

# Aliases that map a friendly provider name to the underlying client kind
# and (when known) the canonical base_url. Users may always override
# base_url via LLM_BASE_URL.
OPENAI_COMPAT_BASES: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "openai_compatible": "",
    "deepseek": "https://api.deepseek.com/v1",
    "siliconflow": "https://api.siliconflow.cn/v1",
    "minimax": "https://api.minimaxi.chat/v1",
    "moonshot": "https://api.moonshot.cn/v1",
    "kimi": "https://api.moonshot.cn/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "glm": "https://open.bigmodel.cn/api/paas/v4",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
}
ANTHROPIC_PROVIDERS = {"anthropic", "claude"}


def build_llm_client(s: Settings | None = None) -> LLMClient:
    s = s or default_settings
    provider = s.llm_provider.strip().lower()

    if provider in ANTHROPIC_PROVIDERS:
        return AnthropicClient(
            api_key=s.llm_api_key,
            model=s.llm_model,
            base_url=s.llm_base_url or "https://api.anthropic.com/v1",
            timeout=s.llm_timeout,
        )

    if provider in OPENAI_COMPAT_BASES:
        base_url = s.llm_base_url or OPENAI_COMPAT_BASES[provider]
        if not base_url:
            raise ValueError(
                "LLM_BASE_URL is required when LLM_PROVIDER is "
                f"{provider!r} (no default base URL known)"
            )
        return OpenAICompatibleClient(
            base_url=base_url,
            api_key=s.llm_api_key,
            model=s.llm_model,
            timeout=s.llm_timeout,
        )

    raise ValueError(
        f"unknown LLM_PROVIDER {provider!r}; expected one of "
        f"{sorted(set(OPENAI_COMPAT_BASES) | ANTHROPIC_PROVIDERS)}"
    )
