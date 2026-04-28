"""Classify agent subprocess failures.

Both `claude` and `codex` echo the original prompt to stderr on failure and
then append a short `ERROR:` line. A naive stderr tail captures the prompt
and hides the error, so we extract just the relevant lines and classify
known fatal conditions (usage/rate limit, auth failure) so the runner can
stop the whole sweep instead of burning through 100 benchmarks that will
all fail the same way.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

USAGE_LIMIT_MARKERS = (
    "usage limit",
    "hit your usage",
    "quota exceeded",
    "insufficient_quota",
    "insufficient quota",
    "credit balance",
)

RATE_LIMIT_MARKERS = (
    "rate limit",
    "rate_limit_exceeded",
    "too many requests",
    "429 ",
    " 429,",
)

AUTH_MARKERS = (
    "invalid api key",
    "please run /login",
    "unauthenticated",
    "not authenticated",
    "authentication failed",
    "authentication error",
    "please sign in",
    "401 unauthorized",
)

_ERROR_LINE_RE = re.compile(r"^\s*(ERROR|Error|error:|FATAL|fatal:)\b")


@dataclass
class AgentErrorClass:
    kind: str       # "usage_limit" | "rate_limit" | "auth"
    message: str    # one-line summary for logs
    is_fatal: bool  # if True, caller should abort the remaining run


def extract_error_lines(text: str, max_lines: int = 3, max_chars: int = 400) -> str:
    """Return the last few lines that look like error output, dedup'd."""
    if not text:
        return ""
    hits: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if _ERROR_LINE_RE.match(line) or "error:" in line.lower():
            if line not in hits:
                hits.append(line)
    joined = " | ".join(hits[-max_lines:])
    return joined[:max_chars]


def classify_agent_error(
    stdout: str, stderr: str, returncode: int,
) -> Optional[AgentErrorClass]:
    """Return an error classification if the failure is a known fatal class."""
    if returncode == 0:
        return None
    combined = f"{stdout}\n{stderr}".lower()
    clean = extract_error_lines(stderr) or extract_error_lines(stdout)
    if any(m in combined for m in USAGE_LIMIT_MARKERS):
        return AgentErrorClass("usage_limit", clean or "usage limit hit", True)
    if any(m in combined for m in RATE_LIMIT_MARKERS):
        return AgentErrorClass("rate_limit", clean or "rate limit hit", True)
    if any(m in combined for m in AUTH_MARKERS):
        return AgentErrorClass("auth", clean or "authentication failure", True)
    return None
