"""Anonymous usage telemetry for Loki Mode dashboard.

Collection is OPT-IN and OFF by default. Nothing is sent unless the user
explicitly opts in, so a default install (including air-gapped, GDPR, and
FedRAMP deployments) never phones home.

Opt-in (one required): LOKI_TELEMETRY=on  OR  ~/.loki/config: TELEMETRY_ENABLED=true
Opt-out (always wins): LOKI_TELEMETRY=off / LOKI_TELEMETRY_DISABLED=true /
                       DO_NOT_TRACK=1 / ~/.loki/config: TELEMETRY_DISABLED=true

All calls are fire-and-forget, silent on failure, non-blocking.
"""

import json
import os
import platform
import threading
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

_POSTHOG_HOST = os.environ.get(
    "LOKI_TELEMETRY_ENDPOINT", "https://us.i.posthog.com"
)
_POSTHOG_KEY = "phc_ya0vGBru41AJWtGNfZZ8H9W4yjoZy4KON0nnayS7s87"


def _is_enabled():
    # Unified OPT-IN gate. Collection is OFF by default; enabled ONLY when the
    # user has opted in AND has not also opted out. This precedence MUST mirror
    # loki_collection_enabled in autonomy/crash.sh and _loki_telemetry_enabled
    # in autonomy/telemetry.sh so one model gates BOTH PostHog usage telemetry
    # and crash reporting.
    #
    # Precedence:
    #   1. Any opt-out flag present  -> False (hard kill, always wins)
    #   2. Else any opt-in flag present -> True
    #   3. Else (default)            -> False (no egress)
    telem = os.environ.get("LOKI_TELEMETRY", "").lower()

    # --- 1. Opt-out always wins ---
    if telem == "off":
        return False
    if os.environ.get("LOKI_TELEMETRY_DISABLED") == "true":
        return False
    if os.environ.get("DO_NOT_TRACK") == "1":
        return False
    # Persistent opt-out in ~/.loki/config (matches the bash grep prefix
    # semantics: any line beginning with TELEMETRY_DISABLED=true).
    config_enabled = False
    try:
        config_path = Path.home() / ".loki" / "config"
        if config_path.is_file():
            for line in config_path.read_text().splitlines():
                if line.startswith("TELEMETRY_DISABLED=true"):
                    return False
                if line.startswith("TELEMETRY_ENABLED=true"):
                    config_enabled = True
    except Exception:
        pass

    # --- 2. Opt-in required to enable ---
    if telem == "on":
        return True
    if config_enabled:
        return True

    # --- 3. Default: OFF ---
    return False


def _get_distinct_id():
    id_file = Path.home() / ".loki-telemetry-id"
    try:
        return id_file.read_text().strip()
    except Exception:
        new_id = str(uuid.uuid4())
        try:
            # Create with 0600 permissions (user read/write only)
            fd = os.open(str(id_file), os.O_CREAT | os.O_WRONLY, 0o600)
            os.write(fd, (new_id + "\n").encode())
            os.close(fd)
        except Exception:
            pass
        return new_id


def _detect_channel():
    if Path("/.dockerenv").exists():
        return "docker"
    here = str(Path(__file__).resolve())
    if "/Cellar/" in here or "/homebrew/" in here:
        return "homebrew"
    if "/node_modules/" in here:
        return "npm"
    if "/.claude/skills/" in here:
        return "skill"
    return "source"


def _get_version():
    try:
        from . import __version__
        return __version__
    except Exception:
        return "unknown"


def send_telemetry(event, properties=None):
    """Send anonymous telemetry event. Non-blocking, silent on failure."""
    if not _is_enabled():
        return

    def _send():
        try:
            props = {
                "os": platform.system(),
                "arch": platform.machine(),
                "version": _get_version(),
                "channel": _detect_channel(),
            }
            if properties:
                props.update(properties)
            payload = json.dumps({
                "api_key": _POSTHOG_KEY,
                "event": event,
                "distinct_id": _get_distinct_id(),
                "properties": props,
            }).encode()
            req = Request(
                f"{_POSTHOG_HOST}/capture/",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urlopen(req, timeout=3)
        except Exception:
            pass

    threading.Thread(target=_send, daemon=True).start()
