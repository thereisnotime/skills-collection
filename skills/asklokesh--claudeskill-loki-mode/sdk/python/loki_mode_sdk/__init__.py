"""Loki Mode SDK - Python client for the Loki Mode autonomous development platform."""

__version__ = "0.1.0"

from .client import AutonomiClient, AutonomiError, AuthenticationError, ForbiddenError, NotFoundError
from .types import (
    ApiKey,
    AuditEntry,
    Project,
    Run,
    RunEvent,
    Task,
    Tenant,
)
from .auth import TokenAuth
from .sessions import SessionManager
from .tasks import TaskManager
from .events import EventStream

# Convenience alias
Client = AutonomiClient

__all__ = [
    "__version__",
    "Client",
    "AutonomiClient",
    "AutonomiError",
    "AuthenticationError",
    "ForbiddenError",
    "NotFoundError",
    "TokenAuth",
    "SessionManager",
    "TaskManager",
    "EventStream",
    "ApiKey",
    "AuditEntry",
    "Project",
    "Run",
    "RunEvent",
    "Task",
    "Tenant",
]
