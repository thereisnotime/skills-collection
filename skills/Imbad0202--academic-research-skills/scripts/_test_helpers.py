"""Shared helpers for script unit tests.

Avoid duplicating subprocess.run boilerplate across multiple test files.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def run_script(
    script_path: Path,
    *args: str,
    cwd: Path | None = None,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Invoke a script via subprocess, capturing stdout/stderr as text.

    extra_env values are merged into os.environ (not replaced).
    """
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, str(script_path), *args],
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
    )


def run_skill_linter(script_path: Path, root: Path) -> subprocess.CompletedProcess[str]:
    """Invoke a SKILL.md linter (--path arg + PYTHONPATH=scripts/)."""
    return run_script(
        script_path,
        "--path",
        str(root),
        extra_env={"PYTHONPATH": str(script_path.parent)},
    )
