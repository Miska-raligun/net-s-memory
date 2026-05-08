"""LLM-based fact consistency check.

Given a target article and a set of corroborating reports, ask the LLM
to score consistency, list contradictions, and flag unverifiable claims.
The LLM **never** sets the final credibility — it contributes one signal
among four. The output is also surfaced in the UI for transparency.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.llm.base import LLMClient, LLMError

SYSTEM_PROMPT = (
    "你是新闻事实一致性核查助手。\n"
    "你的任务是判断目标新闻与其他报道之间的一致性，"
    "以及目标内容中是否存在内部矛盾或难以核实的断言。\n\n"
    "只输出一个 JSON 对象，包含以下字段：\n"
    "- score: 0-100 的整数。完全多源一致、信息明确给 80-100；"
    "存在矛盾或仅单一来源给 30-60；明显造谣给 0-30。\n"
    "- consistency: 取值 \"consistent\" / \"mixed\" / \"contradictory\" / \"unknown\" 之一。\n"
    "- contradictions: 字符串数组，列出报道间或文本内的关键矛盾。\n"
    "- unverifiable_claims: 字符串数组，列出无法用提供的报道核实的具体断言。\n"
    "- summary: 一句话总结评估理由。\n\n"
    "请勿输出 Markdown、解释或 JSON 之外的任何文字。"
)


@dataclass(frozen=True)
class LLMCheckInput:
    target_source: str
    target_title: str
    target_text: str
    corroborating: list[tuple[str, str, str]]
    """List of (source, title, raw_text) for other reports of the same event."""


@dataclass(frozen=True)
class LLMCheckOutput:
    score: int
    consistency: str
    contradictions: list[str]
    unverifiable_claims: list[str]
    summary: str
    raw: dict[str, Any]


def _format_user_prompt(payload: LLMCheckInput) -> str:
    parts = [
        "## 目标新闻",
        f"来源: {payload.target_source}",
        f"标题: {payload.target_title}",
        f"正文: {payload.target_text or '（无正文）'}",
        "",
        "## 同主题的其他报道",
    ]
    if not payload.corroborating:
        parts.append("（暂无其他报道）")
    else:
        for i, (src, title, text) in enumerate(payload.corroborating, 1):
            parts.append(f"### 报道 {i}")
            parts.append(f"来源: {src}")
            parts.append(f"标题: {title}")
            if text:
                snippet = text[:500]
                parts.append(f"摘要: {snippet}")
            parts.append("")
    parts.append("请输出 JSON。")
    return "\n".join(parts)


def parse_output(raw: dict[str, Any]) -> LLMCheckOutput:
    try:
        score = int(raw.get("score", 50))
    except (TypeError, ValueError) as e:
        raise LLMError(f"score is not an int: {raw!r}") from e
    score = max(0, min(100, score))

    consistency = str(raw.get("consistency", "unknown"))
    if consistency not in {"consistent", "mixed", "contradictory", "unknown"}:
        consistency = "unknown"

    contradictions = [str(x) for x in (raw.get("contradictions") or [])]
    unverifiable = [str(x) for x in (raw.get("unverifiable_claims") or [])]
    summary = str(raw.get("summary", ""))

    return LLMCheckOutput(
        score=score,
        consistency=consistency,
        contradictions=contradictions,
        unverifiable_claims=unverifiable,
        summary=summary,
        raw=raw,
    )


async def llm_check(client: LLMClient, payload: LLMCheckInput) -> LLMCheckOutput:
    user_prompt = _format_user_prompt(payload)
    raw = await client.complete_json(system=SYSTEM_PROMPT, user=user_prompt)
    return parse_output(raw)
