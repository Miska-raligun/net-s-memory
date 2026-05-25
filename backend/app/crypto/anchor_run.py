"""CLI: ``python -m app.crypto.anchor_run`` — anchor current log root via OTS."""

from __future__ import annotations

import asyncio
from pathlib import Path

from app.crypto.anchor import anchor_log
from app.db.session import SessionLocal


async def main() -> None:
    async with SessionLocal() as session:
        anchor = await anchor_log(session, ots_dir=Path("./data/ots"))
    print(f"anchored leaf_count={anchor.leaf_count}")
    print(f"root_hash={anchor.root_hash.hex()}")
    print(f"ots_proof={anchor.ots_proof_uri}")


if __name__ == "__main__":
    asyncio.run(main())
