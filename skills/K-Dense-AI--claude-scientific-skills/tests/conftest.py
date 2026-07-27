"""Session guard for the repo-wide test tree.

Every skill's `scripts/` directory is self-contained and owns plain top-level
module names -- 32 skills ship a `scripts/_common.py`, and names like
`cluster.py` or `validate_manifest.py` are shared too. Tests import those
scripts by putting the skill's `scripts/` directory on `sys.path`, so two
skills collected into one interpreter would resolve `_common` to whichever
skill was imported first and silently test the wrong files.

Each skill therefore gets its own process:

    pytest tests/<skill>          # one skill
    python tests/run_all.py       # every skill, one process each
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Several suites assert that a skill directory ships no .pyc files. Importing
# and subprocessing the skill's scripts is what creates them, so keep the
# interpreter -- and any child it spawns -- from writing bytecode at all.
sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

TESTS_DIR = Path(__file__).resolve().parent


def _skill_dirs(config: pytest.Config) -> set[str]:
    """Return the names of the skill directories this session would collect."""
    everything = {
        path.name
        for path in TESTS_DIR.iterdir()
        if path.is_dir() and not path.name.startswith((".", "__"))
    }
    selected: set[str] = set()
    for argument in config.args:
        path = Path(str(argument).split("::")[0])
        if not path.is_absolute():
            path = Path(config.invocation_params.dir) / path
        try:
            relative = path.resolve().relative_to(TESTS_DIR)
        except ValueError:
            continue
        if relative.parts:
            selected.add(relative.parts[0])
        else:
            selected |= everything
    return selected & everything


def pytest_sessionstart(session: pytest.Session) -> None:
    skills = _skill_dirs(session.config)
    if len(skills) > 1:
        raise pytest.UsageError(
            f"cannot collect {len(skills)} skills in one process: their scripts/ "
            "directories share module names (_common.py and friends), so imports "
            "would resolve to the wrong skill. Run one skill at a time with "
            "`pytest tests/<skill>`, or the whole tree with "
            "`python tests/run_all.py`."
        )
