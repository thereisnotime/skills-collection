"""
Secret management utilities for Loki Mode.

Provides:
- API key validation (format checks, not auth checks)
- Credential rotation detection
- Secure environment loading with masking
- Secret file support (Docker/K8s secret mounts)
"""

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Optional

# Known API key patterns for format validation
_KEY_PATTERNS = {
    "ANTHROPIC_API_KEY": re.compile(r"^sk-ant-[a-zA-Z0-9_-]{90,}$"),
    "OPENAI_API_KEY": re.compile(r"^sk-[a-zA-Z0-9_-]{40,}$"),
    "GOOGLE_API_KEY": re.compile(r"^AI[a-zA-Z0-9_-]{30,}$"),
}

# Secret file mount paths (Docker/K8s convention)
_SECRET_MOUNT_PATHS = [
    "/run/secrets",           # Docker secrets
    "/var/run/secrets",       # K8s secrets
]


def validate_api_key(key_name: str, key_value: str) -> dict:
    """Validate an API key format (not authentication).

    Returns dict with: valid (bool), masked (str), warning (str or None)
    """
    if not key_value:
        return {"valid": False, "masked": "", "warning": "Key is empty"}

    masked = key_value[:8] + "..." + key_value[-4:] if len(key_value) > 16 else "***"

    pattern = _KEY_PATTERNS.get(key_name)
    if pattern and not pattern.match(key_value):
        return {
            "valid": False,
            "masked": masked,
            "warning": f"Key format does not match expected pattern for {key_name}",
        }

    return {"valid": True, "masked": masked, "warning": None}


def load_secret_from_file(key_name: str) -> Optional[str]:
    """Load a secret from Docker/K8s secret mount paths.

    Checks /run/secrets/{key_name} and /var/run/secrets/{key_name}.
    Returns the secret value or None.
    """
    lower_name = key_name.lower()
    for mount_path in _SECRET_MOUNT_PATHS:
        secret_file = Path(mount_path) / lower_name
        if secret_file.exists():
            try:
                return secret_file.read_text().strip()
            except (PermissionError, IOError):
                pass
    return None


def load_secrets() -> dict:
    """Load all API keys with secret file fallback.

    Priority: Environment variable > Secret file mount > None
    Returns dict of key_name -> {source, set, masked, valid_format, warning}
    """
    keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"]
    result = {}

    for key_name in keys:
        env_value = os.environ.get(key_name, "")
        file_value = load_secret_from_file(key_name)

        if env_value:
            value = env_value
            source = "environment"
        elif file_value:
            value = file_value
            source = "secret_file"
            # Set in environment for child processes
            os.environ[key_name] = value
        else:
            value = ""
            source = "not_set"

        validation = validate_api_key(key_name, value)
        result[key_name] = {
            "source": source,
            "set": bool(value),
            "masked": validation["masked"],
            "valid_format": validation["valid"],
            "warning": validation["warning"],
        }

    return result


def get_key_fingerprint(key_value: str) -> str:
    """Get a stable fingerprint for a key (for rotation detection).

    Uses first 8 chars of SHA-256 hash. Safe to log/store.
    """
    if not key_value:
        return ""
    return hashlib.sha256(key_value.encode()).hexdigest()[:8]


def check_rotation(state_file: str = ".loki/state/key-fingerprints.json") -> list:
    """Check if any API keys have been rotated since last check.

    Compares current key fingerprints against stored fingerprints.
    Returns list of rotated key names.
    """
    state_path = Path(state_file)

    # Get current fingerprints
    current = {}
    for key_name in ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"]:
        value = os.environ.get(key_name, "")
        if value:
            current[key_name] = get_key_fingerprint(value)

    # Load previous fingerprints
    previous = {}
    if state_path.exists():
        try:
            previous = json.loads(state_path.read_text())
        except Exception:
            pass

    # Detect rotations
    rotated = []
    for key_name, fp in current.items():
        prev_fp = previous.get(key_name)
        if prev_fp and prev_fp != fp:
            rotated.append(key_name)

    # Save current fingerprints
    if current:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(current, indent=2))

    return rotated
