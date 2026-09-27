"""A rotated API key stops authenticating once its grace period has passed.

BACKLOG 119: dashboard/auth.py validate_token checked `revoked` and
`expires_at` but never `rotation_expires_at`, so the old key of a rotation kept
working forever (cleanup_expired_rotating_keys has no caller). The grace period
is the whole contract of rotate_key: the old key works until then, and not
after.
"""

from datetime import datetime, timedelta, timezone
from unittest import mock

import pytest


@pytest.fixture(autouse=True)
def tmp_token_file(tmp_path):
    token_dir = tmp_path / ".loki" / "dashboard"
    token_dir.mkdir(parents=True)
    token_file = token_dir / "tokens.json"
    with mock.patch("dashboard.auth.TOKEN_DIR", token_dir), \
         mock.patch("dashboard.auth.TOKEN_FILE", token_file):
        yield token_file


def _rotate(grace_hours=24):
    from dashboard import api_keys, auth
    old = auth.generate_token(name="svc", scopes=["read"])
    rotated = api_keys.rotate_key("svc", grace_period_hours=grace_hours)
    return old, rotated


def _set_rotation_expiry(token_id, value):
    from dashboard import auth
    tokens = auth._load_tokens()
    tokens["tokens"][token_id]["rotation_expires_at"] = value
    auth._save_tokens(tokens)


def test_old_key_works_within_grace_period():
    from dashboard import auth
    old, rotated = _rotate(grace_hours=24)
    assert auth.validate_token(old["token"]) is not None
    assert auth.validate_token(rotated["token"]) is not None


def test_old_key_rejected_after_grace_period():
    from dashboard import auth
    old, rotated = _rotate(grace_hours=24)
    _set_rotation_expiry(
        old["id"], (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat())
    assert auth.validate_token(old["token"]) is None
    # The replacement key is untouched by the old key's expiry.
    assert auth.validate_token(rotated["token"]) is not None


@pytest.mark.parametrize("bad", ["not-a-date", "2020-01-01T00:00:00"])
def test_unreadable_or_naive_expiry_fails_closed(bad):
    # An expiry we cannot compare is not a grace period we can honor. A naive
    # timestamp cannot be ordered against an aware "now" (TypeError), so it is
    # rejected rather than raised or ignored.
    from dashboard import auth
    old, _ = _rotate(grace_hours=24)
    _set_rotation_expiry(old["id"], bad)
    assert auth.validate_token(old["token"]) is None
