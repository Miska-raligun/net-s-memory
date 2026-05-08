"""Daily public-chain anchoring of the Merkle log root.

Default backend is OpenTimestamps, which submits the root to public
calendars that aggregate into Bitcoin (free, well established). The
``stamp_fn`` parameter is injectable so tests can run without network or
the ``ots`` binary, and so a future Polygon contract anchor can be added
alongside without disturbing this code.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MerkleAnchor
from app.log_state import load_log_state

StampFn = Callable[[Path], Awaitable[Path]]


async def ots_stamp(root_file: Path) -> Path:
    proc = await asyncio.create_subprocess_exec(
        "ots",
        "stamp",
        str(root_file),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"ots stamp failed (rc={proc.returncode}): {stderr.decode(errors='replace')}"
        )
    ots_path = Path(str(root_file) + ".ots")
    if not ots_path.exists():
        raise RuntimeError(f"ots did not produce {ots_path}")
    return ots_path


async def anchor_log(
    session: AsyncSession,
    ots_dir: Path,
    stamp_fn: StampFn = ots_stamp,
) -> MerkleAnchor:
    state = await load_log_state(session)
    if state.size == 0:
        raise RuntimeError("merkle log is empty; nothing to anchor")
    root = state.root()
    assert root is not None

    ots_dir.mkdir(parents=True, exist_ok=True)
    root_file = ots_dir / f"root-{state.size:08d}-{root.hex()[:16]}.bin"
    root_file.write_bytes(root)

    ots_file = await stamp_fn(root_file)

    anchor = MerkleAnchor(
        root_hash=root,
        leaf_count=state.size,
        ots_proof_uri=str(ots_file),
    )
    session.add(anchor)
    await session.commit()
    await session.refresh(anchor)
    return anchor
