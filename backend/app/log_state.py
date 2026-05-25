"""Read the current state of the Merkle log from the DB and answer proofs."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.merkle import inclusion_proof, merkle_root
from app.db.models import MerkleLeaf


@dataclass
class LogState:
    leaves: list[bytes] = field(default_factory=list)
    seq_to_index: dict[int, int] = field(default_factory=dict)

    @property
    def size(self) -> int:
        return len(self.leaves)

    def root(self) -> bytes | None:
        if not self.leaves:
            return None
        return merkle_root(self.leaves)

    def proof_for_seq(self, seq: int) -> tuple[int, list[bytes]]:
        idx = self.seq_to_index[seq]
        return idx, inclusion_proof(idx, self.leaves)


async def load_log_state(session: AsyncSession) -> LogState:
    rows = (
        await session.execute(
            select(MerkleLeaf.seq, MerkleLeaf.leaf_hash).order_by(MerkleLeaf.seq)
        )
    ).all()
    state = LogState()
    for seq, leaf_hash in rows:
        state.seq_to_index[seq] = len(state.leaves)
        state.leaves.append(leaf_hash)
    return state
