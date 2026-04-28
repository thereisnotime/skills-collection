"""Load `.env` values into `os.environ` for benchmark runners.

Mirrors the search logic of `tools/env-reader.py` (repo root, cwd, and
`projects/pentest/.env`) so `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.
work without the user having to `export` them first.

Existing environment variables always win over file contents — the `.env`
only fills in gaps.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _search_paths() -> list[Path]:
    return [
        _REPO_ROOT / ".env",
        Path.cwd() / ".env",
        _REPO_ROOT / "projects" / "pentest" / ".env",
    ]


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        if key:
            values[key] = val
    return values


def load_dotenv_into_environ() -> None:
    """Populate `os.environ` with keys from `.env` (without overwriting)."""
    for path in _search_paths():
        if not path.is_file():
            continue
        for key, val in _parse_env_file(path).items():
            os.environ.setdefault(key, val)


def resolve_openai_key(cli_override: Optional[str] = None) -> Optional[str]:
    """Return the OpenAI/Codex key, preferring CLI, then env/.env."""
    if cli_override:
        return cli_override
    load_dotenv_into_environ()
    return os.environ.get("OPENAI_API_KEY") or os.environ.get("CODEX_API_KEY")


def resolve_anthropic_key(cli_override: Optional[str] = None) -> Optional[str]:
    """Return the Anthropic key, preferring CLI, then env/.env."""
    if cli_override:
        return cli_override
    load_dotenv_into_environ()
    return os.environ.get("ANTHROPIC_API_KEY")
