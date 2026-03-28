"""Purple Lab database models.

Provides SQLAlchemy models for multi-user cloud deployment.
When no DATABASE_URL is configured, the system falls back to
file-based storage (local development mode).
"""
import os
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255))
    avatar_url = Column(String(500))
    provider = Column(String(50))  # "github", "google", "email"
    provider_id = Column(String(255))  # External provider user ID
    password_hash = Column(String(255), nullable=True)  # For email/password auth
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime)
    is_active = Column(Boolean, default=True)

    sessions = relationship("Session", back_populates="user")
    projects = relationship("Project", back_populates="user")


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    project_dir = Column(String(500), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="projects")
    sessions = relationship("Session", back_populates="project")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    prd_content = Column(Text)
    provider = Column(String(50), default="claude")
    mode = Column(String(50), default="standard")
    status = Column(String(50), default="created")  # created, running, paused, completed, failed
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    metadata_json = Column(JSON, default=dict)

    user = relationship("User", back_populates="sessions")
    project = relationship("Project", back_populates="sessions")


class Secret(Base):
    __tablename__ = "secrets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    key = Column(String(255), nullable=False)
    encrypted_value = Column(Text, nullable=False)  # Fernet encrypted
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action = Column(String(100), nullable=False)  # "session.start", "file.save", etc.
    resource_type = Column(String(50))  # "session", "file", "secret"
    resource_id = Column(String(255))
    details = Column(JSON, default=dict)
    ip_address = Column(String(45))
    created_at = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Database connection state
# ---------------------------------------------------------------------------

DATABASE_URL: str | None = None
engine = None
async_session_factory: async_sessionmaker | None = None


async def init_db(database_url: str | None = None) -> bool:
    """Initialize database connection. Returns False if no URL configured (file-based fallback)."""
    global DATABASE_URL, engine, async_session_factory

    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        return False  # No database configured, use file-based fallback

    DATABASE_URL = url
    engine = create_async_engine(url, echo=False)
    async_session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    return True


async def get_db():
    """Get database session. Yields None if no database configured."""
    if async_session_factory is None:
        yield None
        return
    async with async_session_factory() as session:
        yield session
