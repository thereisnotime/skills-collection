"""Purple Lab secrets encryption -- Fernet symmetric encryption.

When PURPLE_LAB_SECRET_KEY is set, secret values are encrypted at rest
using Fernet (AES-128-CBC with HMAC-SHA256). In local dev mode without
the env var, secrets are stored in plaintext.
"""
import base64
import hashlib
import logging
import os

logger = logging.getLogger("purple-lab.crypto")

try:
    from cryptography.fernet import Fernet, InvalidToken
    _HAS_FERNET = True
except ImportError:
    _HAS_FERNET = False
    InvalidToken = Exception  # type: ignore[assignment,misc]
    logger.warning(
        "cryptography package not installed -- secret encryption disabled. "
        "Install with: pip install cryptography"
    )


def _get_secret_key() -> str | None:
    """Return PURPLE_LAB_SECRET_KEY if explicitly set, else None."""
    return os.environ.get("PURPLE_LAB_SECRET_KEY") or None


def _derive_fernet_key(secret: str) -> bytes:
    """Derive a Fernet-compatible key from an arbitrary secret string.

    Fernet requires a 32-byte URL-safe base64-encoded key.  We derive it
    deterministically from the secret using SHA-256.
    """
    raw = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(raw)


def encryption_available() -> bool:
    """Return True if encryption is both available and configured."""
    return _HAS_FERNET and _get_secret_key() is not None


def encrypt_value(plaintext: str) -> str:
    """Encrypt a string value using Fernet.

    Returns the ciphertext as a UTF-8 string.  If encryption is not
    available or not configured, returns the plaintext unchanged.
    """
    secret = _get_secret_key()
    if not _HAS_FERNET or secret is None:
        return plaintext
    try:
        f = Fernet(_derive_fernet_key(secret))
        return f.encrypt(plaintext.encode()).decode()
    except Exception:
        logger.exception("Failed to encrypt value -- storing plaintext")
        return plaintext


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a Fernet-encrypted string.

    Returns the plaintext.  If the value was never encrypted (legacy
    plaintext) or decryption fails, returns the original string so that
    existing unencrypted secrets continue to work.
    """
    secret = _get_secret_key()
    if not _HAS_FERNET or secret is None:
        return ciphertext
    try:
        f = Fernet(_derive_fernet_key(secret))
        return f.decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        # Value is likely plaintext from before encryption was enabled.
        # Return as-is so existing secrets keep working.
        logger.debug("Could not decrypt value -- returning as plaintext (likely legacy)")
        return ciphertext
    except Exception:
        logger.exception("Unexpected decryption error -- returning raw value")
        return ciphertext
