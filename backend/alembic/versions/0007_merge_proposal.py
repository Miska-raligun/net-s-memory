"""event_merge_proposal + merge_proposal_vote

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-08

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "event_merge_proposal",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("event.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "followup_id",
            sa.Uuid(),
            sa.ForeignKey("event_followup.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "proposed_by",
            sa.Uuid(),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("selected_developments", sa.JSON(), nullable=False),
        sa.Column(
            "proposed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("canonical_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("sig", sa.LargeBinary(64), nullable=False),
        sa.Column("pubkey", sa.LargeBinary(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="voting"),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_event_merge_proposal_event_id", "event_merge_proposal", ["event_id"])
    op.create_index(
        "ix_event_merge_proposal_followup_id", "event_merge_proposal", ["followup_id"]
    )

    op.create_table(
        "merge_proposal_vote",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "proposal_id",
            sa.Uuid(),
            sa.ForeignKey("event_merge_proposal.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("canonical_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("sig", sa.LargeBinary(64), nullable=False),
        sa.Column(
            "voted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "proposal_id", "user_id", name="uq_merge_proposal_vote_unique"
        ),
    )
    op.create_index(
        "ix_merge_proposal_vote_proposal_id", "merge_proposal_vote", ["proposal_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_merge_proposal_vote_proposal_id", table_name="merge_proposal_vote")
    op.drop_table("merge_proposal_vote")
    op.drop_index(
        "ix_event_merge_proposal_followup_id", table_name="event_merge_proposal"
    )
    op.drop_index("ix_event_merge_proposal_event_id", table_name="event_merge_proposal")
    op.drop_table("event_merge_proposal")
