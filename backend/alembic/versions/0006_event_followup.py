"""event_followup table for off-chain LLM-derived followup drafts

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-08

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "event_followup",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("event.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_by",
            sa.Uuid(),
            sa.ForeignKey("user_account.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("search_provider", sa.String(32), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_event_followup_event_id", "event_followup", ["event_id"])
    op.create_index("ix_event_followup_requested_by", "event_followup", ["requested_by"])


def downgrade() -> None:
    op.drop_index("ix_event_followup_requested_by", table_name="event_followup")
    op.drop_index("ix_event_followup_event_id", table_name="event_followup")
    op.drop_table("event_followup")
