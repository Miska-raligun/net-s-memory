from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# SQLite only autoincrements INTEGER PRIMARY KEY columns; BIGINT primary keys
# silently break inserts. Use this variant so production (Postgres) still gets
# BIGSERIAL while tests against sqlite get a working INTEGER PRIMARY KEY.
_AutoBigInt = BigInteger().with_variant(Integer, "sqlite")


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class NewsItem(Base):
    __tablename__ = "news_item"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    lang: Mapped[str] = mapped_column(String(8), nullable=False, default="zh")
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    hot_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snapshot_uri: Mapped[str | None] = mapped_column(Text, nullable=True)

    signatures: Mapped[list[NewsSignature]] = relationship(
        back_populates="news",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("source", "source_id", name="uq_news_item_source_source_id"),
    )


class NewsSignature(Base):
    __tablename__ = "news_signature"

    id: Mapped[int] = mapped_column(_AutoBigInt, primary_key=True, autoincrement=True)
    news_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("news_item.id", ondelete="CASCADE"), nullable=False, index=True
    )
    signer: Mapped[str] = mapped_column(String(64), nullable=False)
    alg: Mapped[str] = mapped_column(String(32), nullable=False, default="ed25519")
    pubkey: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    sig: Mapped[bytes] = mapped_column(LargeBinary(64), nullable=False)
    canonical_bytes: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    signed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    news: Mapped[NewsItem] = relationship(back_populates="signatures")


class MerkleLeaf(Base):
    __tablename__ = "merkle_leaf"

    seq: Mapped[int] = mapped_column(_AutoBigInt, primary_key=True, autoincrement=True)
    leaf_hash: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False, unique=True)
    leaf_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    ref_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(), nullable=True, index=True)
    payload_digest: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class MerkleAnchor(Base):
    __tablename__ = "merkle_anchor"

    id: Mapped[int] = mapped_column(_AutoBigInt, primary_key=True, autoincrement=True)
    root_hash: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    leaf_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    anchored_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    ots_proof_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    btc_block_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    polygon_tx_hash: Mapped[str | None] = mapped_column(String(66), nullable=True)
