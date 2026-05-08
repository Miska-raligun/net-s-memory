from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MerkleAnchor
from app.db.session import get_session
from app.log_state import load_log_state

router = APIRouter(prefix="/api/transparency", tags=["transparency"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("")
async def transparency(session: SessionDep) -> dict:
    state = await load_log_state(session)
    anchors = (
        (
            await session.execute(
                select(MerkleAnchor).order_by(MerkleAnchor.anchored_at.desc()).limit(100)
            )
        )
        .scalars()
        .all()
    )
    root = state.root()
    return {
        "tree_size": state.size,
        "root_hash": root.hex() if root is not None else None,
        "anchors": [
            {
                "root_hash": a.root_hash.hex(),
                "leaf_count": a.leaf_count,
                "anchored_at": a.anchored_at.isoformat(),
                "ots_proof_uri": a.ots_proof_uri,
                "btc_block_height": a.btc_block_height,
                "polygon_tx_hash": a.polygon_tx_hash,
            }
            for a in anchors
        ],
    }
