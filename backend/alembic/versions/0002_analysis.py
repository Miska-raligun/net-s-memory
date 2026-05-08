"""analysis table for credibility signals

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-08

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "analysis",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "news_id",
            sa.Uuid(),
            sa.ForeignKey("news_item.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("corroboration_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("corroboration_sources", sa.JSON(), nullable=False),
        sa.Column("reputation_label", sa.String(16), nullable=False),
        sa.Column("reputation_weight", sa.Float(), nullable=False),
        sa.Column("llm_score", sa.Integer(), nullable=True),
        sa.Column("llm_consistency", sa.String(16), nullable=True),
        sa.Column("llm_summary", sa.Text(), nullable=True),
        sa.Column("llm_evidence", sa.JSON(), nullable=True),
        sa.Column("llm_model", sa.String(64), nullable=True),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("signer", sa.String(64), nullable=False),
        sa.Column("alg", sa.String(32), nullable=False, server_default="ed25519"),
        sa.Column("pubkey", sa.LargeBinary(32), nullable=False),
        sa.Column("sig", sa.LargeBinary(64), nullable=False),
        sa.Column("canonical_bytes", sa.LargeBinary(), nullable=False),
    )
    op.create_index("ix_analysis_news_id", "analysis", ["news_id"])


def downgrade() -> None:
    op.drop_index("ix_analysis_news_id", table_name="analysis")
    op.drop_table("analysis")
