"""Purple Lab authentication -- JWT + OAuth.

When no DATABASE_URL is configured, authentication is completely disabled
and all endpoints are accessible without tokens (local development mode).
"""
import logging
import os
import secrets
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

try:
    from jose import JWTError, jwt
except ImportError:
    jwt = None  # type: ignore[assignment]
    JWTError = Exception  # type: ignore[assignment,misc]

try:
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
except ImportError:
    pwd_context = None  # type: ignore[assignment]

logger = logging.getLogger("purple-lab.auth")

# ---------------------------------------------------------------------------
# Config from environment variables
# ---------------------------------------------------------------------------

SECRET_KEY = os.environ.get("PURPLE_LAB_SECRET_KEY", "")
if not SECRET_KEY:
    SECRET_KEY = secrets.token_hex(32)
    logger.warning(
        "PURPLE_LAB_SECRET_KEY not set -- generated ephemeral key. "
        "Tokens will not survive server restarts. "
        "Set PURPLE_LAB_SECRET_KEY env var for production use."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

# OAuth config
GITHUB_CLIENT_ID = os.environ.get("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.environ.get("GITHUB_CLIENT_SECRET", "")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")

security = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a signed JWT access token."""
    if jwt is None:
        raise RuntimeError("python-jose is not installed. Install with: pip install python-jose[cryptography]")
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    """Verify and decode a JWT token. Returns None if invalid."""
    if jwt is None:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    if pwd_context is None:
        raise RuntimeError("passlib is not installed. Install with: pip install passlib[bcrypt]")
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a bcrypt hash."""
    if pwd_context is None:
        return False
    return pwd_context.verify(plain_password, hashed_password)


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Optional[dict]:
    """Get current user from JWT token. Returns None if no auth configured."""
    # If no database is configured, auth is disabled (local development mode)
    from models import async_session_factory

    if async_session_factory is None:
        return None  # Auth disabled, allow all requests

    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return payload


# ---------------------------------------------------------------------------
# OAuth state (CSRF protection)
# ---------------------------------------------------------------------------

# In-memory store of valid OAuth state tokens.  Each entry maps
# state -> expiry timestamp.  Tokens expire after 10 minutes.
_oauth_states: dict[str, float] = {}
_OAUTH_STATE_TTL = 600  # 10 minutes


def generate_oauth_state() -> str:
    """Generate a cryptographically random state token for OAuth CSRF protection."""
    _purge_expired_states()
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = time.time() + _OAUTH_STATE_TTL
    return state


def validate_oauth_state(state: str | None) -> bool:
    """Validate and consume an OAuth state token.  Returns False if invalid or expired."""
    if not state:
        return False
    _purge_expired_states()
    expiry = _oauth_states.pop(state, None)
    if expiry is None:
        return False
    return time.time() < expiry


def _purge_expired_states() -> None:
    """Remove expired state tokens to prevent memory growth."""
    now = time.time()
    expired = [s for s, exp in _oauth_states.items() if now >= exp]
    for s in expired:
        _oauth_states.pop(s, None)


# ---------------------------------------------------------------------------
# OAuth handlers
# ---------------------------------------------------------------------------

async def github_oauth_callback(code: str) -> dict:
    """Exchange GitHub OAuth code for user info."""
    import httpx

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Exchange code for token
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
            },
            headers={"Accept": "application/json"},
        )
        token_data = token_resp.json()
        access_token = token_data.get("access_token")

        if not access_token:
            error_desc = token_data.get("error_description", "Unknown error")
            logger.warning("GitHub OAuth token exchange failed: %s", error_desc)
            raise HTTPException(status_code=400, detail=f"Failed to get GitHub access token: {error_desc}")

        # Get user info
        user_resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch GitHub user info")
        user_data = user_resp.json()

        # Get primary email
        email_resp = await client.get(
            "https://api.github.com/user/emails",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        emails = email_resp.json() if email_resp.status_code == 200 else []
        primary_email = next(
            (e["email"] for e in emails if isinstance(e, dict) and e.get("primary")), None
        )

        return {
            "email": primary_email or user_data.get("email"),
            "name": user_data.get("name") or user_data.get("login"),
            "avatar_url": user_data.get("avatar_url"),
            "provider": "github",
            "provider_id": str(user_data["id"]),
        }


async def google_oauth_callback(code: str, redirect_uri: str) -> dict:
    """Exchange Google OAuth code for user info."""
    import httpx

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_data = token_resp.json()
        access_token = token_data.get("access_token")

        if not access_token:
            error_desc = token_data.get("error_description", "Unknown error")
            logger.warning("Google OAuth token exchange failed: %s", error_desc)
            raise HTTPException(status_code=400, detail=f"Failed to get Google access token: {error_desc}")

        user_resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch Google user info")
        user_data = user_resp.json()

        if "email" not in user_data:
            raise HTTPException(status_code=400, detail="Google account has no email")

        return {
            "email": user_data["email"],
            "name": user_data.get("name"),
            "avatar_url": user_data.get("picture"),
            "provider": "google",
            "provider_id": str(user_data["id"]),
        }
