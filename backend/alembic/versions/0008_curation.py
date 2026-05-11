"""news_candidate table + curation columns on news_item

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-08

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("news_item") as batch:
        batch.add_column(sa.Column("classification", sa.String(32), nullable=True))
        batch.add_column(sa.Column("summary", sa.Text(), nullable=True))
        batch.add_column(sa.Column("why_matters", sa.Text(), nullable=True))
        batch.add_column(sa.Column("citations", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("curator", sa.String(64), nullable=True))

    op.create_table(
        "news_candidate",
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
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column(
            "news_item_id",
            sa.Uuid(),
            sa.ForeignKey("news_item.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("rejected_reason", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "source", "source_id", name="uq_news_candidate_source_source_id"
        ),
    )
    op.create_index(
        "ix_news_candidate_news_item_id", "news_candidate", ["news_item_id"]
    )
    op.create_index("ix_news_candidate_status", "news_candidate", ["status"])
    op.create_index("ix_news_candidate_fetched_at", "news_candidate", ["fetched_at"])


def downgrade() -> None:
    op.drop_index("ix_news_candidate_fetched_at", table_name="news_candidate")
    op.drop_index("ix_news_candidate_status", table_name="news_candidate")
    op.drop_index("ix_news_candidate_news_item_id", table_name="news_candidate")
    op.drop_table("news_candidate")
    with op.batch_alter_table("news_item") as batch:
        batch.drop_column("curator")
        batch.drop_column("citations")
        batch.drop_column("why_matters")
        batch.drop_column("summary")
        batch.drop_column("classification")
