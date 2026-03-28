"""Shared fixtures for integration tests."""
import sys
from pathlib import Path

import pytest
import httpx

WEB_APP_DIR = Path(__file__).resolve().parent.parent.parent
if str(WEB_APP_DIR) not in sys.path:
    sys.path.insert(0, str(WEB_APP_DIR))


@pytest.fixture
async def client():
    """Async HTTP client wired to the FastAPI app via ASGI transport."""
    from server import app
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
