"""Active news discovery: web search → LLM curator → signed timeline entry.

This is the inverse of the ingest/curate path. Instead of pulling hot
lists and asking the LLM "is any of this worth keeping?", we make the
LLM the editor and the search tool its researcher:

1. Run a small set of event-shaped queries against the web (MiniMax
   search / Brave / etc., whatever ``SearchClient`` is configured).
2. Pool the results, dedupe by URL.
3. Hand the pool to the LLM with a strict prompt: identify the
   genuinely significant events from today, merge multi-source
   reports into single records, and cite ≥2 distinct URLs from the
   provided pool. The LLM never invents citations.
4. Each valid event becomes a NewsItem with classification +
   synthesized summary + why_matters + the cluster's citations,
   gets signed by the service Ed25519 key, and appended to the
   Merkle log just like a curated v2 record.

Events with <2 verifiable citations are dropped (not written) and
counted in the report — the operator sees them in the discover run's
output so they can adjust queries if too much gets discarded.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from nacl.signing import SigningKey
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.log import append_news_signed
from app.db.models import NewsItem
from app.discover.queries import DEFAULT_QUERIES
from app.ingest.pipeline import to_canonical_payload
from app.llm.base import LLMClient, LLMError
from app.search.base import SearchClient, SearchError, SearchResult

logger = logging.getLogger(__name__)

MIN_CITATIONS = 2

VALID_CLASSIFICATIONS = {
    "social",
    "international",
    "policy",
    "judicial",
    "science",
    "economy",
    "other",
}

SYSTEM_PROMPT = (
    "你是互联网长期记忆的策展编辑。本项目的使命是**抢在内容被删除、篡改或压制"
    "之前，为争议性事件留下不可篡改的存证**。\n\n"
    "下面是今天从多条搜索查询返回的网页结果，"
    "请你识别出**最有可能在未来被从互联网上抹去痕迹的真实事件**。\n\n"
    "只输出一个 JSON 对象：\n"
    "{\n"
    "  \"events\": [\n"
    "    {\n"
    "      \"title\": \"中文 14-40 字，事件性而非情绪化\",\n"
    "      \"summary\": \"100-200 字，仅基于搜索结果中的事实陈述\",\n"
    "      \"why_matters\": \"30-100 字，为何这件事有被删除/压制的风险，"
    "为何值得永久存证\",\n"
    "      \"classification\": "
    "\"social\"|\"international\"|\"policy\"|\"judicial\"|\"science\""
    "|\"economy\"|\"other\",\n"
    "      \"citations\": [\"必须来自下面给定的 URL，≥2 个不同 URL\"]\n"
    "    }\n"
    "  ]\n"
    "}\n\n"
    "判定原则（按优先级排序）：\n"
    "- 最优先：涉及问责、追责、处分的安全事故和公共事件；"
    "官员落马、免职、违纪通报；维权、群体性事件；"
    "企业丑闻、造假、数据泄漏；环境污染和公共健康事件；"
    "司法争议案件（冤案、改判、争议量刑）；"
    "涉及审查、删帖、封号的舆论事件；强拆征地纠纷。\n"
    "- 次优先：国际制裁、冲突、争议性外交事件。\n"
    "- 不记录：正面宣传稿、政策例行发布（除非涉及争议）、"
    "科技突破（除非涉及造假或争议）、经济数据例行公布、"
    "娱乐绯闻、营销话题、体育花絮、网红热搜。\n"
    "- 核心判断标准：**如果这条新闻在三个月后可能已被删除或无法找到，"
    "那它就值得记录。如果三个月后它仍会完好存在于各大新闻网站，"
    "则不需要我们来存档。**\n\n"
    "- 同一事件如被多个来源报道，合并为一条记录，把所有相关 URL 都放进 citations。\n"
    "- 必须有 ≥2 个独立来源；只有单一来源时直接不要纳入。\n"
    "- 不要编造搜索结果中没出现的内容；如果今天没有符合标准的事件，"
    "返回 {\"events\": []}。\n"
    "- 只输出 JSON 对象，不要 Markdown 或多余文字。"
)


@dataclass
class DiscoverReport:
    queries: int = 0
    search_results_pooled: int = 0
    events_proposed: int = 0
    promoted: int = 0
    rejected_low_citations: int = 0
    skipped_invalid: int = 0
    promoted_ids: list[uuid.UUID] = field(default_factory=list)


def _format_results_for_prompt(results: Sequence[SearchResult]) -> str:
    lines = [f"## 搜索结果（共 {len(results)} 条）"]
    for i, r in enumerate(results, 1):
        lines.append(f"### 结果 {i}")
        lines.append(f"标题: {r.title}")
        lines.append(f"URL: {r.url}")
        if r.source:
            lines.append(f"来源: {r.source}")
        if r.published_at is not None:
            lines.append(f"发布时间: {r.published_at.isoformat()}")
        if r.snippet:
            lines.append(f"摘要: {r.snippet[:400]}")
        lines.append("")
    lines.append("请按上文规范输出 JSON。")
    return "\n".join(lines)


def _pool_searches_dedup(
    results: Sequence[SearchResult],
) -> tuple[list[SearchResult], dict[str, SearchResult]]:
    """Order-preserving URL dedupe + a lookup table by URL."""
    seen: dict[str, SearchResult] = {}
    pooled: list[SearchResult] = []
    for r in results:
        if not r.url or r.url in seen:
            continue
        seen[r.url] = r
        pooled.append(r)
    return pooled, seen


def _validate_event(
    event: dict[str, Any], by_url: dict[str, SearchResult]
) -> tuple[list[str], list[SearchResult]] | None:
    title = str(event.get("title", "")).strip()
    cls = str(event.get("classification", "")).strip().lower()
    if not title or cls not in VALID_CLASSIFICATIONS:
        return None
    cites = [c for c in (event.get("citations") or []) if isinstance(c, str)]
    real = list(dict.fromkeys(c for c in cites if c in by_url))
    if len(real) < MIN_CITATIONS:
        return None
    return real, [by_url[u] for u in real]


def _primary_source_from_url(url: str) -> str:
    try:
        host = urlparse(url).netloc
    except ValueError:
        host = ""
    return host or "discover"


async def _promote_event(
    session: AsyncSession,
    *,
    event: dict[str, Any],
    citation_urls: list[str],
    citation_hits: list[SearchResult],
    signing_key: SigningKey,
    curator: str,
    fetched_at: datetime,
) -> uuid.UUID:
    primary_url = citation_urls[0]
    title = str(event.get("title", "")).strip()
    summary = str(event.get("summary", "")).strip()
    why = str(event.get("why_matters", "")).strip()
    cls = str(event.get("classification", "")).strip().lower()

    news_id = uuid.uuid4()
    item = NewsItem(
        id=news_id,
        source=_primary_source_from_url(primary_url),
        source_url=primary_url,
        source_id=None,
        title=title,
        raw_text=summary,
        lang="zh",
        fetched_at=fetched_at,
        classification=cls,
        summary=summary,
        why_matters=why,
        citations=[
            {
                "source": hit.source or _primary_source_from_url(hit.url),
                "source_url": hit.url,
                "source_id": "",
                "title": hit.title,
            }
            for hit in citation_hits
        ],
        curator=curator,
    )
    session.add(item)
    await session.flush()

    payload = to_canonical_payload(item)
    await append_news_signed(
        session=session,
        news_id=news_id,
        payload=payload,
        signer_id=f"discover:{curator}",
        signing_key=signing_key,
    )
    return news_id


async def discover_once(
    session: AsyncSession,
    *,
    llm_client: LLMClient,
    search_client: SearchClient,
    signing_key: SigningKey,
    queries: Sequence[str] | None = None,
    per_query_limit: int = 10,
    lookback_hours: int = 24,
) -> DiscoverReport:
    queries = list(queries) if queries else list(DEFAULT_QUERIES)
    report = DiscoverReport(queries=len(queries))

    after = datetime.now(UTC) - timedelta(hours=lookback_hours)
    raw: list[SearchResult] = []
    for q in queries:
        try:
            hits = await search_client.search(q, limit=per_query_limit, after=after)
        except SearchError as e:
            logger.warning("discover: search %r failed: %s", q, e)
            continue
        raw.extend(hits)

    pool, by_url = _pool_searches_dedup(raw)
    report.search_results_pooled = len(pool)
    if not pool:
        return report

    try:
        response = await llm_client.complete_json(
            system=SYSTEM_PROMPT,
            user=_format_results_for_prompt(pool),
            max_tokens=4096,
        )
    except LLMError as e:
        logger.warning("discover: LLM call failed: %s", e)
        return report

    events = response.get("events") if isinstance(response, dict) else None
    if not isinstance(events, list):
        return report

    now = datetime.now(UTC)
    curator = f"discover:{getattr(llm_client, 'model', 'unknown')}"
    report.events_proposed = len(events)

    for event in events:
        if not isinstance(event, dict):
            report.skipped_invalid += 1
            continue
        validated = _validate_event(event, by_url)
        if validated is None:
            report.rejected_low_citations += 1
            continue
        urls, hits = validated
        news_id = await _promote_event(
            session=session,
            event=event,
            citation_urls=urls,
            citation_hits=hits,
            signing_key=signing_key,
            curator=curator,
            fetched_at=now,
        )
        report.promoted += 1
        report.promoted_ids.append(news_id)

    await session.commit()
    return report
