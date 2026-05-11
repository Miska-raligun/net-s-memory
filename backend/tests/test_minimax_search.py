from __future__ import annotations

import json
from datetime import UTC, datetime

import httpx
import pytest

from app.search.base import SearchError
from app.search.factory import build_search_client
from app.search.minimax import MinimaxSearchClient, _parse_date
from app.settings import Settings


def _captured(captured: list[httpx.Request], response: httpx.Response):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return response

    return handler


def test_parse_date_iso() -> None:
    out = _parse_date("2026-05-08")
    assert out == datetime(2026, 5, 8, tzinfo=UTC)


def test_parse_date_unknown_returns_none() -> None:
    assert _parse_date("2 days ago") is None
    assert _parse_date("") is None
    assert _parse_date(None) is None


@pytest.mark.asyncio
async def test_search_sends_expected_request() -> None:
    captured: list[httpx.Request] = []
    handler = _captured(
        captured,
        httpx.Response(
            200,
            json={
                "organic": [
                    {
                        "title": "事故通报",
                        "link": "https://news.example/a",
                        "snippet": "调查组完成现场勘察",
                        "date": "2026-05-05",
                    },
                    {
                        "title": "(转载)",
                        "link": "https://other.example/b",
                        "snippet": "同一通报",
                        "date": "2026-05-05",
                    },
                ],
                "related_searches": [{"query": "化工厂事故"}],
                "base_resp": {"status_code": 0, "status_msg": ""},
            },
        ),
    )
    client = MinimaxSearchClient(
        api_key="sk-test",
        transport=httpx.MockTransport(handler),
    )

    out = await client.search("化工厂 后续 进展", limit=5)

    assert len(captured) == 1
    req = captured[0]
    assert req.method == "POST"
    assert req.url.path == "/v1/coding_plan/search"
    assert req.url.host == "api.minimax.io"
    assert req.headers["authorization"] == "Bearer sk-test"
    assert req.headers["mm-api-source"] == "net-s-memory"
    assert json.loads(req.content) == {"q": "化工厂 后续 进展"}

    assert len(out) == 2
    assert out[0].title == "事故通报"
    assert out[0].url == "https://news.example/a"
    assert out[0].source == "news.example"
    assert out[0].published_at == datetime(2026, 5, 5, tzinfo=UTC)


@pytest.mark.asyncio
async def test_search_filters_by_after() -> None:
    handler = _captured(
        [],
        httpx.Response(
            200,
            json={
                "organic": [
                    {
                        "title": "old",
                        "link": "https://x.example/old",
                        "snippet": "",
                        "date": "2026-04-01",
                    },
                    {
                        "title": "new",
                        "link": "https://x.example/new",
                        "snippet": "",
                        "date": "2026-05-15",
                    },
                    {
                        "title": "no date",
                        "link": "https://x.example/u",
                        "snippet": "",
                        "date": "",
                    },
                ],
                "base_resp": {"status_code": 0},
            },
        ),
    )
    client = MinimaxSearchClient(api_key="k", transport=httpx.MockTransport(handler))

    out = await client.search("q", after=datetime(2026, 5, 1, tzinfo=UTC))
    urls = {r.url for r in out}
    # The pre-cutoff dated result is dropped; the dateless one is kept
    # (we'd rather over-include than silently drop unknown-date hits).
    assert "https://x.example/old" not in urls
    assert "https://x.example/new" in urls
    assert "https://x.example/u" in urls


@pytest.mark.asyncio
async def test_search_caps_at_limit() -> None:
    organic = [
        {"title": f"r{i}", "link": f"https://e.example/{i}", "snippet": "", "date": ""}
        for i in range(10)
    ]
    handler = _captured(
        [],
        httpx.Response(
            200, json={"organic": organic, "base_resp": {"status_code": 0}}
        ),
    )
    client = MinimaxSearchClient(api_key="k", transport=httpx.MockTransport(handler))
    out = await client.search("q", limit=3)
    assert len(out) == 3


@pytest.mark.asyncio
async def test_search_raises_on_minimax_error_code() -> None:
    handler = _captured(
        [],
        httpx.Response(
            200,
            json={
                "organic": [],
                "base_resp": {"status_code": 1004, "status_msg": "invalid api key"},
            },
        ),
    )
    client = MinimaxSearchClient(api_key="bad", transport=httpx.MockTransport(handler))
    with pytest.raises(SearchError, match="1004"):
        await client.search("q")


@pytest.mark.asyncio
async def test_search_raises_on_http_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="overloaded")

    client = MinimaxSearchClient(api_key="k", transport=httpx.MockTransport(handler))
    with pytest.raises(SearchError, match="HTTP 503"):
        await client.search("q")


@pytest.mark.asyncio
async def test_search_skips_results_without_url() -> None:
    handler = _captured(
        [],
        httpx.Response(
            200,
            json={
                "organic": [
                    {"title": "no link", "link": "", "snippet": "", "date": ""},
                    {"title": "ok", "link": "https://e.example/x", "snippet": "", "date": ""},
                ],
                "base_resp": {"status_code": 0},
            },
        ),
    )
    client = MinimaxSearchClient(api_key="k", transport=httpx.MockTransport(handler))
    out = await client.search("q")
    assert len(out) == 1
    assert out[0].url == "https://e.example/x"


def test_factory_builds_minimax_with_global_default() -> None:
    s = Settings(search_provider="minimax", search_api_key="k")
    c = build_search_client(s)
    assert isinstance(c, MinimaxSearchClient)
    assert c.base_url == "https://api.minimax.io"


def test_factory_honors_mainland_override() -> None:
    s = Settings(
        search_provider="minimax",
        search_api_key="k",
        search_base_url="https://api.minimaxi.com",
    )
    c = build_search_client(s)
    assert isinstance(c, MinimaxSearchClient)
    assert c.base_url == "https://api.minimaxi.com"
