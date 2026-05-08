"""Append-only log writes: sign payload, hash leaf, persist signature + leaf row.

Each leaf type has a domain tag prefixed before the canonical payload. This
binds the leaf hash to its type so that two leaves of different types can
never collide even if their payload bytes happen to coincide.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from nacl.signing import SigningKey
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto.canonical import encode
from app.crypto.merkle import leaf_hash
from app.db.models import Analysis, MerkleLeaf, NewsSignature, Vote

DOMAIN_TAGS: dict[str, bytes] = {
    "news": b"net-s-memory:news:v1\n",
    "analysis": b"net-s-memory:analysis:v1\n",
    "vote": b"net-s-memory:vote:v1\n",
    "merge_proposal": b"net-s-memory:merge_proposal:v1\n",
    "rotate": b"net-s-memory:rotate:v1\n",
}


def compute_leaf_bytes(leaf_type: str, canonical: bytes, signature: bytes) -> bytes:
    if leaf_type not in DOMAIN_TAGS:
        raise ValueError(f"unknown leaf_type {leaf_type!r}")
    return DOMAIN_TAGS[leaf_type] + canonical + signature


async def append_news_signed(
    session: AsyncSession,
    news_id: uuid.UUID,
    payload: dict[str, Any],
    signer_id: str,
    signing_key: SigningKey,
) -> tuple[int, bytes]:
    """Sign ``payload``, persist a NewsSignature row, append a MerkleLeaf.

    Returns ``(seq, leaf_hash)``.
    """
    canonical = encode(payload)
    sig = signing_key.sign(canonical).signature
    pubkey = bytes(signing_key.verify_key)

    leaf_bytes = compute_leaf_bytes("news", canonical, sig)
    h = leaf_hash(leaf_bytes)
    payload_digest = hashlib.sha256(canonical).digest()

    session.add(
        NewsSignature(
            news_id=news_id,
            signer=signer_id,
            alg="ed25519",
            pubkey=pubkey,
            sig=sig,
            canonical_bytes=canonical,
        )
    )
    leaf = MerkleLeaf(
        leaf_hash=h,
        leaf_type="news",
        ref_id=news_id,
        payload_digest=payload_digest,
    )
    session.add(leaf)
    await session.flush()

    return leaf.seq, h


async def append_analysis_signed(
    session: AsyncSession,
    analysis: Analysis,
    payload: dict[str, Any],
    signer_id: str,
    signing_key: SigningKey,
) -> tuple[int, bytes]:
    """Sign ``payload``, embed sig+canonical on the Analysis row, append a leaf.

    Unlike news (which has its own signature table), analyses are
    one-per-news so we keep the signature inline. Returns ``(seq, leaf_hash)``.
    """
    canonical = encode(payload)
    sig = signing_key.sign(canonical).signature
    pubkey = bytes(signing_key.verify_key)

    leaf_bytes = compute_leaf_bytes("analysis", canonical, sig)
    h = leaf_hash(leaf_bytes)
    payload_digest = hashlib.sha256(canonical).digest()

    analysis.signer = signer_id
    analysis.alg = "ed25519"
    analysis.pubkey = pubkey
    analysis.sig = sig
    analysis.canonical_bytes = canonical

    leaf = MerkleLeaf(
        leaf_hash=h,
        leaf_type="analysis",
        ref_id=analysis.id,
        payload_digest=payload_digest,
    )
    session.add(leaf)
    await session.flush()

    return leaf.seq, h


async def append_vote(session: AsyncSession, vote: Vote) -> tuple[int, bytes]:
    """Append a Merkle leaf for an already-signed vote.

    Unlike news/analysis we don't sign here — the vote is signed by the
    user's client-side Ed25519 key before it reaches us. The server only
    verifies the signature (in the API handler) and persists.
    """
    leaf_bytes = compute_leaf_bytes("vote", vote.canonical_bytes, vote.sig)
    h = leaf_hash(leaf_bytes)
    payload_digest = hashlib.sha256(vote.canonical_bytes).digest()
    leaf = MerkleLeaf(
        leaf_hash=h,
        leaf_type="vote",
        ref_id=vote.id,
        payload_digest=payload_digest,
    )
    session.add(leaf)
    await session.flush()
    return leaf.seq, h
