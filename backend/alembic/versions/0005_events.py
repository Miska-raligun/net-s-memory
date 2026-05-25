"""event + event_news tables

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-08

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "event",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="ongoing"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "event_news",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("event.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "news_id",
            sa.Uuid(),
            sa.ForeignKey("news_item.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False, server_default="update"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("event_id", "news_id", name="uq_event_news_pair"),
    )
    op.create_index("ix_event_news_event_id", "event_news", ["event_id"])
    op.create_index("ix_event_news_news_id", "event_news", ["news_id"])


def downgrade() -> None:
    op.drop_index("ix_event_news_news_id", table_name="event_news")
    op.drop_index("ix_event_news_event_id", table_name="event_news")
    op.drop_table("event_news")
    op.drop_table("event")
