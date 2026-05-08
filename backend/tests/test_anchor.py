from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from nacl.signing import SigningKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.anchor import anchor_log
from app.db.models import MerkleAnchor
from app.ingest.base import NewsItemDraft
from app.ingest.pipeline import ingest_drafts


def _draft(source_id: str) -> NewsItemDraft:
    return NewsItemDraft(
        source="zhihu_hot",
        source_url=f"https://example.com/{source_id}",
        source_id=source_id,
        title=f"标题{source_id}",
        raw_text="正文",
        lang="zh",
        hot_rank=1,
        fetched_at=datetime(2026, 5, 8, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_anchor_log_writes_row_and_ots_file(
    session: AsyncSession, tmp_path: Path
) -> None:
    key = SigningKey.generate()
    await ingest_drafts(session, [_draft("a"), _draft("b"), _draft("c")], "service:v1", key)

    seen_root: list[bytes] = []

    async def fake_stamp(root_file: Path) -> Path:
        seen_root.append(root_file.read_bytes())
        ots = root_file.with_suffix(root_file.suffix + ".ots")
        ots.write_bytes(b"FAKE_OTS_PROOF")
        return ots

    anchor = await anchor_log(session, ots_dir=tmp_path / "ots", stamp_fn=fake_stamp)

    assert anchor.leaf_count == 3
    assert len(seen_root) == 1
    assert seen_root[0] == anchor.root_hash
    assert anchor.ots_proof_uri is not None
    assert anchor.ots_proof_uri.endswith(".ots")
    assert Path(anchor.ots_proof_uri).read_bytes() == b"FAKE_OTS_PROOF"

    rows = (await session.execute(select(MerkleAnchor))).scalars().all()
    assert len(rows) == 1
    assert rows[0].root_hash == anchor.root_hash


@pytest.mark.asyncio
async def test_anchor_log_refuses_empty(session: AsyncSession, tmp_path: Path) -> None:
    async def fake_stamp(root_file: Path) -> Path:  # pragma: no cover - not reached
        raise AssertionError("should not be called")

    with pytest.raises(RuntimeError, match="empty"):
        await anchor_log(session, ots_dir=tmp_path / "ots", stamp_fn=fake_stamp)
