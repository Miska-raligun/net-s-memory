"""vote table

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-08

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vote",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "news_id",
            sa.Uuid(),
            sa.ForeignKey("news_item.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("sig", sa.LargeBinary(64), nullable=False),
        sa.Column("canonical_bytes", sa.LargeBinary(), nullable=False),
        sa.Column(
            "voted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("news_id", "user_id", name="uq_vote_news_user"),
    )
    op.create_index("ix_vote_news_id", "vote", ["news_id"])
    op.create_index("ix_vote_user_id", "vote", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_vote_user_id", table_name="vote")
    op.drop_index("ix_vote_news_id", table_name="vote")
    op.drop_table("vote")
