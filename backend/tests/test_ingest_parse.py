from datetime import UTC, datetime

from app.ingest.sources.rsshub import RsshubSource

SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>知乎热榜</title>
  <item>
    <title>事件A</title>
    <link>https://example.com/a</link>
    <description>详情A</description>
    <guid>guid-a</guid>
  </item>
  <item>
    <title>事件B</title>
    <link>https://example.com/b</link>
    <description>详情B</description>
    <guid>guid-b</guid>
  </item>
  <item>
    <title></title>
    <link>https://example.com/c</link>
    <description>missing title</description>
    <guid>guid-c</guid>
  </item>
</channel>
</rss>
"""


def test_rsshub_parse_returns_drafts_in_order() -> None:
    src = RsshubSource(name="zhihu_hot", url="http://example/feed")
    drafts = src._parse(SAMPLE_RSS, fetched_at=datetime(2026, 5, 8, tzinfo=UTC))
    assert [d.title for d in drafts] == ["事件A", "事件B"]
    assert drafts[0].source == "zhihu_hot"
    assert drafts[0].source_url == "https://example.com/a"
    assert drafts[0].source_id == "guid-a"
    assert drafts[0].hot_rank == 1
    assert drafts[1].hot_rank == 2


def test_rsshub_parse_skips_items_without_title_or_link() -> None:
    src = RsshubSource(name="zhihu_hot", url="http://example/feed")
    drafts = src._parse(SAMPLE_RSS, fetched_at=datetime.now(UTC))
    assert all(d.title and d.source_url for d in drafts)
    assert len(drafts) == 2
