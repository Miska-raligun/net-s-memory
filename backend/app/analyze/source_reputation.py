"""Seed source-reputation table.

Reputation is a weight in [0, 1]. The label bucket is purely for UI
display. Values are conservative starting points and should later be
revised against community-vote feedback.
"""

from __future__ import annotations

DEFAULT_WEIGHT = 0.5

REPUTATION: dict[str, float] = {
    # Authoritative outlets (官方/权威)
    "people_cn": 0.9,
    "xinhua": 0.9,
    "cctv": 0.85,
    "caixin": 0.85,
    "thepaper": 0.8,
    "scmp": 0.8,
    # Mainstream platforms (主流平台)
    "ifeng": 0.6,
    "sohu": 0.55,
    "zhihu_hot": 0.5,
    "toutiao_hot": 0.4,
    "weibo_hot": 0.4,
    "baidu_hot": 0.4,
}


def lookup(source: str) -> tuple[str, float]:
    """Return ``(label, weight)`` for ``source``.

    Unknown sources fall back to the neutral ``DEFAULT_WEIGHT`` and label
    ``"unknown"`` so they don't silently boost or punish credibility.
    """
    if source not in REPUTATION:
        return "unknown", DEFAULT_WEIGHT
    weight = REPUTATION[source]
    if weight >= 0.8:
        label = "high"
    elif weight >= 0.5:
        label = "medium"
    else:
        label = "low"
    return label, weight
