"""RSSHub-backed news source.

RSSHub aggregates Chinese hot lists (Weibo, Zhihu, Baidu, Toutiao, etc.) into
RSS 2.0 XML which is dramatically easier and more compliant to consume than
direct scraping. We parse only the small subset of RSS we actually need.
"""

from __future__ import annotations

from datetime import UTC, datetime
from xml.etree import ElementTree as ET

import httpx

from app.ingest.base import NewsItemDraft


class RsshubSource:
    def __init__(self, name: str, url: str, lang: str = "zh") -> None:
        self.name = name
        self.url = url
        self.lang = lang

    async def fetch(self) -> list[NewsItemDraft]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(self.url)
            resp.raise_for_status()
        return self._parse(resp.text, fetched_at=datetime.now(UTC))

    def _parse(self, xml: str, fetched_at: datetime) -> list[NewsItemDraft]:
        root = ET.fromstring(xml)
        drafts: list[NewsItemDraft] = []
        for i, item in enumerate(root.findall(".//item")):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            description = (item.findtext("description") or "").strip()
            guid = (item.findtext("guid") or "").strip() or link
            if not title or not link:
                continue
            drafts.append(
                NewsItemDraft(
                    source=self.name,
                    source_url=link,
                    source_id=guid or None,
                    title=title,
                    raw_text=description,
                    lang=self.lang,
                    hot_rank=i + 1,
                    fetched_at=fetched_at,
                )
            )
        return drafts
