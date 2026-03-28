"""
Database setup for Loki Mode Dashboard.

Uses SQLAlchemy 2.0 with async support and SQLite.
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

logger = logging.getLogger(__name__)

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .models import Base

# Database URL - uses SQLite with aiosqlite for async support
DATABASE_DIR = os.environ.get("LOKI_DATA_DIR", os.path.expanduser("~/.loki"))
DATABASE_PATH = os.path.join(DATABASE_DIR, "dashboard.db")
DATABASE_URL = f"sqlite+aiosqlite:///{DATABASE_PATH}"

# Create async engine
engine = create_async_engine(
    DATABASE_URL,
    echo=os.environ.get("LOKI_DEBUG", "").lower() == "true",
    future=True,
)

# Create async session factory
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def init_db() -> None:
    """Initialize the database, creating all tables."""
    os.makedirs(DATABASE_DIR, exist_ok=True)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database initialized at %s", DATABASE_PATH)
    except Exception as exc:
        logger.error("Database initialization failed: %s", exc, exc_info=True)
        raise


async def close_db() -> None:
    """Close database connections."""
    await engine.dispose()


async def check_db_health() -> bool:
    """Check if the database is accessible."""
    try:
        async with async_session_factory() as session:
            from sqlalchemy import text
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Get an async database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for FastAPI to get database session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
