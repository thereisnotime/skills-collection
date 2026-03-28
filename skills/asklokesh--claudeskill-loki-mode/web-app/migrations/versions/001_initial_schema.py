"""Initial schema -- users, projects, sessions, secrets, audit_log

Revision ID: 001
Revises: None
Create Date: 2026-03-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- users --
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False, index=True),
        sa.Column("name", sa.String(255)),
        sa.Column("avatar_url", sa.String(500)),
        sa.Column("provider", sa.String(50)),
        sa.Column("provider_id", sa.String(255)),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime),
        sa.Column("last_login", sa.DateTime),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true")),
    )

    # -- projects --
    op.create_table(
        "projects",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("project_dir", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    # -- sessions --
    op.create_table(
        "sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=True,
        ),
        sa.Column("prd_content", sa.Text),
        sa.Column("provider", sa.String(50), server_default="claude"),
        sa.Column("mode", sa.String(50), server_default="standard"),
        sa.Column("status", sa.String(50), server_default="created"),
        sa.Column("started_at", sa.DateTime),
        sa.Column("ended_at", sa.DateTime, nullable=True),
        sa.Column("metadata_json", sa.JSON),
    )

    # -- secrets --
    op.create_table(
        "secrets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("encrypted_value", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )

    # -- audit_log --
    op.create_table(
        "audit_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50)),
        sa.Column("resource_id", sa.String(255)),
        sa.Column("details", sa.JSON),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("created_at", sa.DateTime),
    )


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("secrets")
    op.drop_table("sessions")
    op.drop_table("projects")
    op.drop_table("users")
