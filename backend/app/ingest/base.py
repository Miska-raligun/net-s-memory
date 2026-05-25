from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass
class NewsItemDraft:
    source: str
    source_url: str
    title: str
    raw_text: str
    fetched_at: datetime
    source_id: str | None = None
    lang: str = "zh"
    hot_rank: int | None = None


class Source(Protocol):
    name: str

    async def fetch(self) -> list[NewsItemDraft]: ...
