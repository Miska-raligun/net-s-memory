"""CLI: ``python -m app.events.run`` — cluster all unassigned news into events."""

from __future__ import annotations

import asyncio

from app.db.session import SessionLocal
from app.events.cluster import cluster_all_unassigned


async def _main() -> None:
    async with SessionLocal() as session:
        stats = await cluster_all_unassigned(session)
        print(f"clustered {stats.get('assigned', 0)} of {stats.get('seen', 0)} unassigned items")


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
