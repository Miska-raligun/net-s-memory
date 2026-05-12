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
    "今日 重大事故 伤亡 问责",
    "今日 官员 免职 问责 处分",
    "今日 维权 上访 群体事件",
    "今日 企业 丑闻 曝光 处罚",
    "今日 环境污染 事故 泄漏",
    "今日 食品安全 药品安全 事件",
    "今日 国际争议 制裁 冲突",
    "今日 司法 冤案 改判 死刑",
    "今日 删帖 封号 审查 舆论",
    "今日 强拆 征地 补偿纠纷",
]
