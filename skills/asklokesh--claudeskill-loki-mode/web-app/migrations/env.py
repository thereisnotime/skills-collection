"""Alembic environment configuration for Purple Lab.

Supports both sync and async migration modes. Reads the database URL
from the DATABASE_URL environment variable at runtime, overriding any
value in alembic.ini.
"""
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text
from sqlalchemy.engine import Connection

# Ensure the web-app package root is importable so we can reference models.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Base  # noqa: E402

# Alembic Config object -- provides access to alembic.ini values.
config = context.config

# Set up Python logging from the ini file.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Target metadata for autogenerate support.
target_metadata = Base.metadata


def get_url() -> str:
    """Return the database URL from the environment.

    Falls back to the value in alembic.ini if DATABASE_URL is not set,
    which will intentionally fail so that migrations are never run against
    an unconfigured placeholder.
    """
    url = os.environ.get("DATABASE_URL")
    if url:
        # asyncpg:// -> postgresql+asyncpg:// normalisation
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url
    return config.get_main_option("sqlalchemy.url", "")


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Generates SQL scripts without connecting to the database.
    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Shared helper that configures the context and runs migrations."""
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using a sync connection.

    For async drivers (asyncpg), Alembic still uses a synchronous
    connection under the hood via ``run_sync``. If the URL contains
    ``+asyncpg``, we swap to the sync ``psycopg2`` driver for the
    migration connection so that plain ``engine_from_config`` works.
    """
    url = get_url()

    # For migration purposes, use a sync driver so Alembic's default
    # engine_from_config works without needing the async runner.
    sync_url = url.replace("+asyncpg", "+psycopg2") if "+asyncpg" in url else url

    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = sync_url

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        do_run_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
