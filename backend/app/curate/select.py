"""LLM-driven curator: pending candidates → curated NewsItem (or rejection).

Pipeline:
1. Load pending candidates from the last ``lookback_hours``.
2. Cluster by title similarity (char-trigram Jaccard, same metric as the
   cross-source signal — embeddings are deferred).
3. For each cluster, ask the LLM whether the event is worth long-term
   recording. The LLM is bound by a hard system rule: ignore celebrity
   gossip / marketing / short-lived sentiment, prefer real social or
   international events, policy/judicial decisions, and verifiable
   science / economy news.
4. Promoted clusters become a single NewsItem with classification,
   summary, why_matters, and a citations array spanning every candidate
   in the cluster; the row is signed and a 'news' leaf is appended to
   the Merkle log just like a v1 ingest used to do.
5. Rejected clusters get status='rejected' with the LLM's reason — kept
   for transparency, never enter the chain.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyze.cross_source import char_trigrams, jaccard
from app.crypto.log import append_news_signed
from app.db.models import NewsCandidate, NewsItem
from app.ingest.pipeline import to_canonical_payload
from app.llm.base import LLMClient, LLMError

logger = logging.getLogger(__name__)

DEFAULT_LOOKBACK_HOURS = 48
DEFAULT_SIMILARITY = 0.3

VALID_CLASSIFICATIONS = {
    "social",
    "international",
    "policy",
    "judicial",
    "science",
    "economy",
    "other",
    "excluded",
}

SYSTEM_PROMPT = (
    "你是互联网长期记忆的策展编辑。给定一组在同一时间窗口内、被多家来源报道"
    "的候选条目，请判断它们是否描述了一件**未来仍值得回想**的真实事件，并选择"
    "性地把它纳入长期记录。\n\n"
    "只输出一个 JSON 对象：\n"
    "{\n"
    "  \"worth_recording\": true|false,\n"
    "  \"classification\": "
    "\"social\"|\"international\"|\"policy\"|\"judicial\"|\"science\"|\"economy\""
    "|\"other\"|\"excluded\",\n"
    "  \"title\": \"中文，14-40 字，事件性而非情绪化\",\n"
    "  \"summary\": \"100-200 字事实陈述，必须基于给定候选内容\",\n"
    "  \"why_matters\": \"30-100 字，为何这件事值得长期记住\",\n"
    "  \"primary_citation_url\": \"必须选自下面候选的 URL\",\n"
    "  \"rejected_reason\": \"如 worth_recording=false 则给出简短理由，否则留空\"\n"
    "}\n\n"
    "判定原则：\n"
    "- 值得记录：重大社会事件（事故/案件/制度变迁）、国际大事、政策落地、"
    "司法重大判决、明确的科技/学术突破、经济结构性事件。\n"
    "- 不值得记录：娱乐绯闻、营销话题、体育花絮、网红热搜、未经核实的网络流言、"
    "短期情绪话题。这类内容把 worth_recording 设为 false，classification 设为"
    " \"excluded\"。\n"
    "- 不要编造候选中未提及的内容；如果信息明显不足，宁可标为 excluded。\n"
    "- 只输出 JSON 对象，不要 Markdown、解释或多余文字。"
)


@dataclass(frozen=True)
class CurateDecision:
    worth_recording: bool
    classification: str
    title: str
    summary: str
    why_matters: str
    primary_citation_url: str
    rejected_reason: str
    raw: dict[str, Any]


@dataclass
class CurateReport:
    seen_clusters: int = 0
    promoted: int = 0
    rejected: int = 0
    skipped: int = 0
    promoted_ids: list[uuid.UUID] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.promoted_ids is None:
            self.promoted_ids = []


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def cluster_candidates(
    candidates: Sequence[NewsCandidate],
    *,
    similarity_threshold: float = DEFAULT_SIMILARITY,
) -> list[list[NewsCandidate]]:
    """Greedy single-link clustering by char-trigram Jaccard on titles."""
    grams = [(c, char_trigrams(c.title)) for c in candidates]
    used: set[uuid.UUID] = set()
    clusters: list[list[NewsCandidate]] = []
    for i, (anchor, ag) in enumerate(grams):
        if anchor.id in used:
            continue
        cluster = [anchor]
        used.add(anchor.id)
        for j in range(i + 1, len(grams)):
            other, og = grams[j]
            if other.id in used:
                continue
            if jaccard(ag, og) >= similarity_threshold:
                cluster.append(other)
                used.add(other.id)
        clusters.append(cluster)
    return clusters


def _format_cluster_for_llm(cluster: Sequence[NewsCandidate]) -> str:
    parts = [f"## 候选条目（共 {len(cluster)} 条）"]
    for i, c in enumerate(cluster, 1):
        parts.append(f"### 条目 {i}")
        parts.append(f"来源: {c.source}")
        parts.append(f"URL: {c.source_url}")
        parts.append(f"标题: {c.title}")
        if c.raw_text:
            parts.append(f"摘要: {c.raw_text[:300]}")
        if c.hot_rank is not None:
            parts.append(f"热榜位置: {c.hot_rank}")
        parts.append("")
    parts.append("请输出 JSON。")
    return "\n".join(parts)


def _parse_decision(raw: dict[str, Any]) -> CurateDecision:
    worth = bool(raw.get("worth_recording", False))
    cls = str(raw.get("classification", "excluded")).strip().lower()
    if cls not in VALID_CLASSIFICATIONS:
        cls = "excluded" if not worth else "other"
    title = str(raw.get("title", "")).strip()
    summary = str(raw.get("summary", "")).strip()
    why = str(raw.get("why_matters", "")).strip()
    primary = str(raw.get("primary_citation_url", "")).strip()
    reason = str(raw.get("rejected_reason", "")).strip()
    if not worth and not reason:
        reason = summary or "LLM 标记为 excluded（无原因）"
    return CurateDecision(
        worth_recording=worth,
        classification=cls,
        title=title,
        summary=summary,
        why_matters=why,
        primary_citation_url=primary,
        rejected_reason=reason,
        raw=raw,
    )


async def evaluate_cluster(
    *, cluster: Sequence[NewsCandidate], llm_client: LLMClient
) -> CurateDecision:
    user = _format_cluster_for_llm(cluster)
    raw = await llm_client.complete_json(
        system=SYSTEM_PROMPT, user=user, max_tokens=1024
    )
    return _parse_decision(raw)


async def _promote(
    session: AsyncSession,
    *,
    cluster: Sequence[NewsCandidate],
    decision: CurateDecision,
    signing_key: SigningKey,
    curator: str,
) -> uuid.UUID:
    primary = next(
        (c for c in cluster if c.source_url == decision.primary_citation_url),
        cluster[0],
    )
    cluster_sorted = sorted(cluster, key=lambda c: _aware(c.fetched_at))
    earliest = cluster_sorted[0]

    news_id = uuid.uuid4()
    item = NewsItem(
        id=news_id,
        source=primary.source,
        source_url=primary.source_url,
        source_id=primary.source_id,
        title=decision.title or primary.title,
        raw_text=decision.summary,
        lang=primary.lang,
        hot_rank=primary.hot_rank,
        fetched_at=_aware(earliest.fetched_at),
        classification=decision.classification,
        summary=decision.summary,
        why_matters=decision.why_matters,
        citations=[
            {
                "source": c.source,
                "source_url": c.source_url,
                "source_id": c.source_id or "",
                "title": c.title,
            }
            for c in cluster_sorted
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
        signer_id=f"curator:{curator}",
        signing_key=signing_key,
    )
    return news_id


async def curate_pending(
    session: AsyncSession,
    *,
    llm_client: LLMClient,
    signing_key: SigningKey,
    lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
    similarity_threshold: float = DEFAULT_SIMILARITY,
) -> CurateReport:
    cutoff = datetime.now(UTC) - timedelta(hours=lookback_hours)
    pending = (
        await session.execute(
            select(NewsCandidate)
            .where(NewsCandidate.status == "pending")
            .where(NewsCandidate.fetched_at >= cutoff)
            .order_by(NewsCandidate.fetched_at.asc())
        )
    ).scalars().all()

    if not pending:
        return CurateReport()

    clusters = cluster_candidates(pending, similarity_threshold=similarity_threshold)
    report = CurateReport(seen_clusters=len(clusters))
    now = datetime.now(UTC)
    curator_id = f"llm:{getattr(llm_client, 'model', 'unknown')}"

    for cluster in clusters:
        try:
            decision = await evaluate_cluster(cluster=cluster, llm_client=llm_client)
        except LLMError as e:
            logger.warning("curator LLM failed for cluster of %d: %s", len(cluster), e)
            report.skipped += 1
            continue

        if decision.worth_recording:
            news_id = await _promote(
                session=session,
                cluster=cluster,
                decision=decision,
                signing_key=signing_key,
                curator=curator_id,
            )
            for c in cluster:
                c.status = "curated"
                c.news_item_id = news_id
                c.decided_at = now
            report.promoted += 1
            report.promoted_ids.append(news_id)
        else:
            for c in cluster:
                c.status = "rejected"
                c.rejected_reason = decision.rejected_reason
                c.decided_at = now
            report.rejected += 1

    await session.commit()
    return report
