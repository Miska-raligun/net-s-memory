"""Default search queries for the discover pipeline.

Each query asks the search backend for one slice of the day's news so
the LLM has both breadth and topical hints when it identifies events
worth recording. Operators can override the list at runtime; the prompt
itself is identical regardless.

We deliberately ask in concrete event-shaped language ("重大事故 今日"
rather than "今日新闻") to coax the search engine toward news pages
instead of opinion / commentary.
"""

from __future__ import annotations

DEFAULT_QUERIES: list[str] = [
    "今日 重大社会事件",
    "今日 国际大事 头条",
    "今日 政策 发布",
    "今日 司法 重大判决",
    "今日 科技 学术 突破",
    "今日 经济 重大事件",
    "今日 重大事故 调查",
]
