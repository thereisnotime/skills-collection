"""Integration tests for Purple Lab v2 end-to-end flows.

Uses httpx.AsyncClient with ASGITransport to test the FastAPI app
without starting a real server.
"""
import sys
from pathlib import Path

import pytest

WEB_APP_DIR = Path(__file__).resolve().parent.parent.parent
if str(WEB_APP_DIR) not in sys.path:
    sys.path.insert(0, str(WEB_APP_DIR))


# ============================================================================
# Session Flow
# ============================================================================


class TestSessionFlow:
    """Test the full session lifecycle."""

    @pytest.mark.asyncio
    async def test_health_endpoint(self, client):
        """Health endpoint returns 200 with correct structure."""
        res = await client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["service"] == "purple-lab"

    @pytest.mark.asyncio
    async def test_session_status(self, client):
        """Session status endpoint returns expected fields."""
        res = await client.get("/api/session/status")
        assert res.status_code == 200
        data = res.json()
        assert "running" in data
        assert "phase" in data
        assert "provider" in data
        assert isinstance(data["running"], bool)

    @pytest.mark.asyncio
    async def test_sessions_history(self, client):
        """Sessions history returns a list."""
        res = await client.get("/api/sessions/history")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_templates_list(self, client):
        """Templates endpoint returns populated list."""
        res = await client.get("/api/templates")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert "name" in data[0]
        assert "filename" in data[0]
        assert "category" in data[0]

    @pytest.mark.asyncio
    async def test_provider_current(self, client):
        """Provider endpoint returns provider info."""
        res = await client.get("/api/provider/current")
        assert res.status_code == 200
        data = res.json()
        assert "provider" in data


# ============================================================================
# Auth Flow
# ============================================================================


class TestAuthFlow:
    """Test authentication flows."""

    @pytest.mark.asyncio
    async def test_local_mode_no_auth_required(self, client):
        """In local mode, API works without tokens."""
        res = await client.get("/health")
        assert res.status_code == 200

    @pytest.mark.asyncio
    async def test_auth_me_local_mode(self, client):
        """GET /api/auth/me returns local_mode=true when no DB configured."""
        res = await client.get("/api/auth/me")
        assert res.status_code == 200
        data = res.json()
        assert data["local_mode"] is True
        assert data["authenticated"] is False

    @pytest.mark.asyncio
    async def test_github_auth_url_not_configured(self, client):
        """GitHub OAuth URL returns 501 when not configured."""
        res = await client.get("/api/auth/github/url")
        # When GITHUB_CLIENT_ID is not set, should return 501
        assert res.status_code == 501

    @pytest.mark.asyncio
    async def test_google_auth_url_not_configured(self, client):
        """Google OAuth URL returns 501 when not configured."""
        res = await client.get("/api/auth/google/url")
        assert res.status_code == 501


# ============================================================================
# Dev Server Flow
# ============================================================================


class TestDevServerFlow:
    """Test dev server management."""

    @pytest.mark.asyncio
    async def test_status_when_no_server(self, client):
        """Status returns not running when no server started."""
        # Use a dummy session ID -- devserver/status should return stopped
        res = await client.get("/api/sessions/test-session-123/devserver/status")
        assert res.status_code == 200
        data = res.json()
        assert data["running"] is False
        assert data["status"] == "stopped"


# ============================================================================
# Secrets Flow
# ============================================================================


class TestSecretsFlow:
    """Test secrets CRUD via integration."""

    @pytest.mark.asyncio
    async def test_secrets_roundtrip(self, client):
        """Create, read, and delete a secret."""
        key = "INT_TEST_SECRET"
        # Create
        res = await client.post("/api/secrets", json={"key": key, "value": "test123"})
        assert res.status_code == 200
        assert res.json()["set"] is True

        # Read (should be masked)
        res = await client.get("/api/secrets")
        assert res.status_code == 200
        assert res.json()[key] == "***"

        # Delete
        res = await client.delete(f"/api/secrets/{key}")
        assert res.status_code == 200
        assert res.json()["deleted"] is True

    @pytest.mark.asyncio
    async def test_invalid_secret_key(self, client):
        """Invalid key format is rejected."""
        res = await client.post("/api/secrets", json={"key": "bad key!", "value": "x"})
        assert res.status_code == 400


# ============================================================================
# Chat Streaming Flow
# ============================================================================


class TestChatStreaming:
    """Test chat with SSE streaming."""

    @pytest.mark.asyncio
    async def test_stream_endpoint_not_found_task(self, client):
        """SSE stream for non-existent task returns error event."""
        res = await client.get(
            "/api/sessions/test-session/chat/nonexistent-task/stream"
        )
        assert res.status_code == 200
        content_type = res.headers.get("content-type", "")
        assert "text/event-stream" in content_type
        # Body should contain an error event
        body = res.text
        assert "event: error" in body
