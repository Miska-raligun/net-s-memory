"""On-demand followup tracker: search → LLM synthesis → off-chain draft.

The pipeline is intentionally read-only with respect to the chain:
results are persisted as ``EventFollowup`` rows for the requesting
user to review. To merge any of the developments into the public
timeline (and the Merkle log), the user must explicitly create a
merge_proposal — that is the chain-touching step (next PR).

LLM output is required to cite real result URLs; developments without
≥2 distinct citations from the actual search result set are demoted to
``leads`` rather than discarded, and never count as "progress".
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Event, EventFollowup
from app.llm.base import LLMClient, LLMError
from app.search.base import SearchClient, SearchResult

logger = logging.getLogger(__name__)

MIN_CITATIONS = 2

SYSTEM_PROMPT = (
    "你是事件追踪助手。给定一个事件的当前状态，以及在事件之后产生的多条相关报道，"
    "请总结从事件起点到现在的关键进展。\n\n"
    "只输出一个 JSON 对象，包含以下字段：\n"
    "- developments: 数组，每条包含 date(字符串)、summary(中文)、citations(URL 数组)。"
    "每条至少使用提供搜索结果中的 2 个不同来源 URL，引用必须真实存在于搜索结果中。\n"
    "- leads: 数组，单一来源或未达到 2 个引用的线索摘要。\n"
    "- still_unanswered: 数组，事件尚未回答的关键问题。\n"
    "- status_suggestion: 取值 \"ongoing\" / \"resolved\" / \"stalled\" / \"retracted\" 之一。\n\n"
    "禁止编造未在搜索结果中出现的报道；如果信息不足，应返回较短的 developments 列表。"
    "请只输出 JSON 对象，不要 Markdown 或额外说明。"
)


@dataclass(frozen=True)
class Development:
    date: str
    summary: str
    citations: list[str]
    source_count: int


@dataclass
class FollowupOutput:
    developments: list[Development] = field(default_factory=list)
    leads: list[str] = field(default_factory=list)
    still_unanswered: list[str] = field(default_factory=list)
    status_suggestion: str = "ongoing"
    raw: dict[str, Any] = field(default_factory=dict)
    search_results: list[dict[str, Any]] = field(default_factory=list)


def _format_user_prompt(event: Event, results: list[SearchResult]) -> str:
    parts = [
        "## 事件",
        f"标题: {event.title}",
        f"起点: {event.created_at.isoformat()}",
        f"当前摘要: {event.summary or '（暂无）'}",
        "",
        f"## 搜索结果（共 {len(results)} 条，按需要引用其中的 URL）",
    ]
    for i, r in enumerate(results, 1):
        parts.append(f"### 结果 {i}")
        parts.append(f"标题: {r.title}")
        parts.append(f"URL: {r.url}")
        if r.published_at is not None:
            parts.append(f"发布时间: {r.published_at.isoformat()}")
        parts.append(f"来源: {r.source}")
        if r.snippet:
            parts.append(f"摘要: {r.snippet[:500]}")
        parts.append("")
    parts.append("请输出 JSON。")
    return "\n".join(parts)


def _validate_citations(
    raw_developments: list[dict[str, Any]],
    valid_urls: set[str],
) -> tuple[list[Development], list[str]]:
    developments: list[Development] = []
    leads: list[str] = []
    for d in raw_developments:
        cites = [c for c in (d.get("citations") or []) if isinstance(c, str)]
        real = [c for c in cites if c in valid_urls]
        date = str(d.get("date", ""))
        summary = str(d.get("summary", ""))
        if len(set(real)) >= MIN_CITATIONS:
            developments.append(
                Development(
                    date=date,
                    summary=summary,
                    citations=list(dict.fromkeys(real)),
                    source_count=len(set(real)),
                )
            )
        elif summary:
            leads.append(summary)
    return developments, leads


async def run_followup(
    session: AsyncSession,
    event_id: uuid.UUID,
    *,
    search_client: SearchClient,
    llm_client: LLMClient,
    requested_by: uuid.UUID | None = None,
    limit: int = 10,
) -> EventFollowup:
    event = await session.get(Event, event_id)
    if event is None:
        raise ValueError(f"event {event_id} not found")

    after = event.created_at if event.created_at.tzinfo else event.created_at.replace(tzinfo=UTC)
    query = f"{event.title} 进展 最新 后续"
    raw_results = await search_client.search(query, limit=limit, after=after)

    valid_urls = {r.url for r in raw_results}
    user_prompt = _format_user_prompt(event, raw_results)

    out = FollowupOutput(
        search_results=[
            {
                "title": r.title,
                "url": r.url,
                "snippet": r.snippet,
                "source": r.source,
                "published_at": r.published_at.isoformat() if r.published_at else None,
            }
            for r in raw_results
        ]
    )

    if raw_results:
        try:
            raw = await llm_client.complete_json(
                system=SYSTEM_PROMPT, user=user_prompt, max_tokens=1500
            )
        except LLMError as e:
            logger.warning("followup LLM failed for %s: %s", event_id, e)
            raw = {}
    else:
        raw = {}

    out.raw = raw
    devs_in = raw.get("developments") or []
    if isinstance(devs_in, list):
        out.developments, derived_leads = _validate_citations(devs_in, valid_urls)
        out.leads = [*derived_leads, *[str(x) for x in (raw.get("leads") or [])]]
    out.still_unanswered = [str(x) for x in (raw.get("still_unanswered") or [])]
    suggestion = raw.get("status_suggestion") or "ongoing"
    if suggestion not in {"ongoing", "resolved", "stalled", "retracted"}:
        suggestion = "ongoing"
    out.status_suggestion = suggestion

    payload = {
        "event_id": str(event_id),
        "since": after.isoformat(),
        "developments": [
            {
                "date": d.date,
                "summary": d.summary,
                "citations": d.citations,
                "source_count": d.source_count,
            }
            for d in out.developments
        ],
        "leads": out.leads,
        "still_unanswered": out.still_unanswered,
        "status_suggestion": out.status_suggestion,
        "search_results": out.search_results,
        "raw_llm": out.raw,
    }

    row = EventFollowup(
        id=uuid.uuid4(),
        event_id=event_id,
        requested_by=requested_by,
        model=getattr(llm_client, "model", "unknown"),
        search_provider=getattr(search_client, "name", "unknown"),
        payload=payload,
        status="draft",
        generated_at=datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    return row
