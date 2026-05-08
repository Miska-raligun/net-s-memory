"""user_account table

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-08

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_account",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("pubkey_ed25519", sa.LargeBinary(32), nullable=False),
        sa.Column("encrypted_privkey", sa.LargeBinary(), nullable=True),
        sa.Column("reputation", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_user_account_email", "user_account", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_user_account_email", table_name="user_account")
    op.drop_table("user_account")
