"""CLI: ``python -m app.reputation.run`` — recompute every user's reputation.

Intended to be wired up as a periodic job (e.g., daily cron, or after
each batch of analyses lands). Idempotent.
"""

from __future__ import annotations

import asyncio

from app.db.session import SessionLocal
from app.reputation.compute import recompute_all


async def _main() -> None:
    async with SessionLocal() as session:
        n = await recompute_all(session)
        print(f"recomputed reputation for {n} users")


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
