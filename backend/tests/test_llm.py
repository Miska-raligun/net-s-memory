from __future__ import annotations

import json

import httpx
import pytest

from app.llm.anthropic import AnthropicClient
from app.llm.base import LLMError, parse_json_response
from app.llm.factory import build_llm_client
from app.llm.openai_compat import OpenAICompatibleClient
from app.settings import Settings


def test_parse_json_response_plain() -> None:
    assert parse_json_response('{"a": 1}') == {"a": 1}


def test_parse_json_response_strips_fences() -> None:
    body = '```json\n{"a": 1}\n```'
    assert parse_json_response(body) == {"a": 1}


def test_parse_json_response_extracts_first_object() -> None:
    body = "Here is your answer:\n{\"a\": 1}\nThanks"
    assert parse_json_response(body) == {"a": 1}


def test_parse_json_response_rejects_non_object() -> None:
    with pytest.raises(LLMError):
        parse_json_response("[1, 2, 3]")


def test_parse_json_response_rejects_garbage() -> None:
    with pytest.raises(LLMError):
        parse_json_response("definitely not json")


def _captured_request_handler(captured: list[httpx.Request], response_body: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=response_body)

    return handler


@pytest.mark.asyncio
async def test_openai_compat_sends_bearer_and_parses_json() -> None:
    captured: list[httpx.Request] = []
    handler = _captured_request_handler(
        captured,
        {"choices": [{"message": {"content": '{"score": 80, "verdict": "ok"}'}}]},
    )
    client = OpenAICompatibleClient(
        base_url="https://api.deepseek.com/v1",
        api_key="sk-test",
        model="deepseek-chat",
        transport=httpx.MockTransport(handler),
    )

    out = await client.complete_json(system="be helpful", user="hi")
    assert out == {"score": 80, "verdict": "ok"}
    assert len(captured) == 1
    req = captured[0]
    assert req.url.path.endswith("/chat/completions")
    assert req.headers["authorization"] == "Bearer sk-test"
    body = json.loads(req.content)
    assert body["model"] == "deepseek-chat"
    assert body["response_format"] == {"type": "json_object"}
    assert [m["role"] for m in body["messages"]] == ["system", "user"]


@pytest.mark.asyncio
async def test_openai_compat_propagates_http_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="invalid key")

    client = OpenAICompatibleClient(
        base_url="https://api.example.com/v1",
        api_key="bad",
        model="m",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(LLMError, match="HTTP 401"):
        await client.complete_json(system="", user="")


@pytest.mark.asyncio
async def test_openai_compat_handles_fenced_json() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '```json\n{"a":1}\n```'}}]},
        )

    client = OpenAICompatibleClient(
        base_url="https://x/v1",
        api_key="k",
        model="m",
        transport=httpx.MockTransport(handler),
    )
    out = await client.complete_json(system="", user="")
    assert out == {"a": 1}


@pytest.mark.asyncio
async def test_anthropic_sends_xapikey_and_parses_json() -> None:
    captured: list[httpx.Request] = []
    handler = _captured_request_handler(
        captured,
        {"content": [{"type": "text", "text": '{"score": 60}'}]},
    )
    client = AnthropicClient(
        api_key="sk-ant-test",
        model="claude-sonnet-4-6",
        transport=httpx.MockTransport(handler),
    )

    out = await client.complete_json(system="be helpful", user="hi")
    assert out == {"score": 60}
    assert len(captured) == 1
    req = captured[0]
    assert req.url.path.endswith("/messages")
    assert req.headers["x-api-key"] == "sk-ant-test"
    assert req.headers["anthropic-version"] == "2023-06-01"
    body = json.loads(req.content)
    assert body["model"] == "claude-sonnet-4-6"
    assert "system" in body
    assert body["messages"] == [{"role": "user", "content": "hi"}]


@pytest.mark.asyncio
async def test_anthropic_propagates_http_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(529, text="overloaded")

    client = AnthropicClient(
        api_key="k",
        model="m",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(LLMError, match="HTTP 529"):
        await client.complete_json(system="", user="")


def test_factory_builds_openai_compat_with_default_base() -> None:
    s = Settings(llm_provider="deepseek", llm_api_key="x", llm_model="deepseek-chat")
    c = build_llm_client(s)
    assert isinstance(c, OpenAICompatibleClient)
    assert c.base_url == "https://api.deepseek.com/v1"


def test_factory_builds_minimax() -> None:
    s = Settings(llm_provider="minimax", llm_api_key="x", llm_model="abab6.5")
    c = build_llm_client(s)
    assert isinstance(c, OpenAICompatibleClient)
    assert "minimax" in c.base_url


def test_factory_builds_anthropic() -> None:
    s = Settings(llm_provider="anthropic", llm_api_key="x", llm_model="claude-sonnet-4-6")
    c = build_llm_client(s)
    assert isinstance(c, AnthropicClient)


def test_factory_overrides_base_url() -> None:
    s = Settings(
        llm_provider="openai_compatible",
        llm_base_url="http://localhost:11434/v1",
        llm_api_key="x",
        llm_model="llama3",
    )
    c = build_llm_client(s)
    assert isinstance(c, OpenAICompatibleClient)
    assert c.base_url == "http://localhost:11434/v1"


def test_factory_rejects_unknown_provider() -> None:
    s = Settings(llm_provider="bogus", llm_api_key="x", llm_model="m")
    with pytest.raises(ValueError, match="unknown LLM_PROVIDER"):
        build_llm_client(s)


def test_factory_requires_base_url_for_generic_compat() -> None:
    s = Settings(llm_provider="openai_compatible", llm_api_key="x", llm_model="m")
    with pytest.raises(ValueError, match="LLM_BASE_URL is required"):
        build_llm_client(s)
