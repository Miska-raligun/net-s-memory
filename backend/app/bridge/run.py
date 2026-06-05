"""CLI: ``python -m app.bridge.run`` — republish signed analyses to Nostr.

Optional cold-start bridge for the decentralized browser extension: takes the
most recent signed credibility analyses and publishes them as Nostr
attestation events from the bridge's own identity, so a fresh extension user
sees seed data instead of an empty network.

Requires NOSTR_BRIDGE_SECKEY (32-byte secp256k1 hex). No-op without it. This
is the *only* part of the decentralized feature that touches the backend, and
it is entirely opt-in — it just adds one more (reputable) signer to the
public relays.
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select

from app.bridge.nostr import build_event, extract_domain, normalize_url, publish_event
from app.db.models import Analysis, NewsItem
from app.db.session import SessionLocal
from app.settings import settings


def _content(analysis: Analysis, normalized_url: str, domain: str) -> dict:
    return {
        "schema": "nsm-attestation.v1",
        "url": normalized_url,
        "domain": domain,
        "score": analysis.score,
        "reputation": {
            "label": analysis.reputation_label,
            "weight": analysis.reputation_weight,
        },
        "llm": {
            "score": analysis.llm_score,
            "consistency": analysis.llm_consistency or "unknown",
            "model": analysis.llm_model,
        },
        "summary": analysis.llm_summary or "",
    }


async def _main(limit: int) -> None:
    if not settings.nostr_bridge_seckey:
        print("NOSTR_BRIDGE_SECKEY 未配置；桥接是可选的，跳过。")
        return
    relays = [r.strip() for r in settings.nostr_relays.split(",") if r.strip()]
    if not relays:
        print("没有配置 Nostr 中继。")
        return

    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(Analysis, NewsItem)
                .join(NewsItem, Analysis.news_id == NewsItem.id)
                .order_by(Analysis.generated_at.desc())
                .limit(limit)
            )
        ).all()

    attempted = 0
    published = 0
    for analysis, item in rows:
        normalized = normalize_url(item.source_url)
        domain = extract_domain(normalized) or ""
        content = _content(analysis, normalized, domain)
        created_at = int(analysis.generated_at.timestamp())
        event = build_event(settings.nostr_bridge_seckey, normalized, domain, content, created_at)
        attempted += 1
        accepted = await publish_event(relays, event)
        if accepted:
            published += 1
        print(f"  {item.source_url[:60]} → {accepted} 个中继")

    print(f"桥接完成：{published}/{attempted} 条至少发布到一个中继")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="把已签名的可信度 analysis 桥接到 Nostr 作为冷启动种子"
    )
    parser.add_argument("--limit", type=int, default=100, help="最多桥接多少条最新分析")
    args = parser.parse_args()
    asyncio.run(_main(args.limit))


if __name__ == "__main__":
    main()
