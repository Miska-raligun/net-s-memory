"""initial schema: news_item, news_signature, merkle_leaf, merkle_anchor

Revision ID: 0001
Revises:
Create Date: 2026-05-08

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "news_item",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_id", sa.String(255), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("lang", sa.String(8), nullable=False, server_default="zh"),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("hot_rank", sa.Integer(), nullable=True),
        sa.Column("snapshot_uri", sa.Text(), nullable=True),
        sa.UniqueConstraint("source", "source_id", name="uq_news_item_source_source_id"),
    )
    op.create_index("ix_news_item_fetched_at", "news_item", ["fetched_at"])

    op.create_table(
        "news_signature",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "news_id",
            sa.Uuid(),
            sa.ForeignKey("news_item.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("signer", sa.String(64), nullable=False),
        sa.Column("alg", sa.String(32), nullable=False, server_default="ed25519"),
        sa.Column("pubkey", sa.LargeBinary(32), nullable=False),
        sa.Column("sig", sa.LargeBinary(64), nullable=False),
        sa.Column("canonical_bytes", sa.LargeBinary(), nullable=False),
        sa.Column(
            "signed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_news_signature_news_id", "news_signature", ["news_id"])

    op.create_table(
        "merkle_leaf",
        sa.Column("seq", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("leaf_hash", sa.LargeBinary(32), nullable=False, unique=True),
        sa.Column("leaf_type", sa.String(32), nullable=False),
        sa.Column("ref_id", sa.Uuid(), nullable=True),
        sa.Column("payload_digest", sa.LargeBinary(32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_merkle_leaf_leaf_type", "merkle_leaf", ["leaf_type"])
    op.create_index("ix_merkle_leaf_ref_id", "merkle_leaf", ["ref_id"])

    op.create_table(
        "merkle_anchor",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("root_hash", sa.LargeBinary(32), nullable=False),
        sa.Column("leaf_count", sa.BigInteger(), nullable=False),
        sa.Column(
            "anchored_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("ots_proof_uri", sa.Text(), nullable=True),
        sa.Column("btc_block_height", sa.Integer(), nullable=True),
        sa.Column("polygon_tx_hash", sa.String(66), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("merkle_anchor")
    op.drop_index("ix_merkle_leaf_ref_id", table_name="merkle_leaf")
    op.drop_index("ix_merkle_leaf_leaf_type", table_name="merkle_leaf")
    op.drop_table("merkle_leaf")
    op.drop_index("ix_news_signature_news_id", table_name="news_signature")
    op.drop_table("news_signature")
    op.drop_index("ix_news_item_fetched_at", table_name="news_item")
    op.drop_table("news_item")
