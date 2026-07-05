#!/usr/bin/env python3
"""Sync the canonical skills tree and agent instructions to their mirrors.

Source of truth:
    skills/     -> .claude/skills/  and  scientific_writer/.claude/skills/
    CLAUDE.md   -> .claude/WRITER.md  and  scientific_writer/.claude/WRITER.md

Never edit the mirrors directly — edit skills/ or CLAUDE.md and run this script.

Usage:
    python scripts/sync_skills.py          # regenerate the mirrors
    python scripts/sync_skills.py --check  # exit 1 if any mirror is out of sync (CI)
"""

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SKILLS_SOURCE = REPO_ROOT / "skills"
SKILLS_MIRRORS = [
    REPO_ROOT / ".claude" / "skills",
    REPO_ROOT / "scientific_writer" / ".claude" / "skills",
]

INSTRUCTIONS_SOURCE = REPO_ROOT / "CLAUDE.md"
INSTRUCTIONS_MIRRORS = [
    REPO_ROOT / ".claude" / "WRITER.md",
    REPO_ROOT / "scientific_writer" / ".claude" / "WRITER.md",
]

IGNORE_PATTERNS = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")
IGNORE_NAMES = {"__pycache__", ".DS_Store"}


def _iter_files(root: Path):
    """Yield paths relative to root for every file under it, minus ignored names."""
    for path in sorted(root.rglob("*")):
        if path.is_dir():
            continue
        rel = path.relative_to(root)
        if any(part in IGNORE_NAMES for part in rel.parts) or rel.suffix == ".pyc":
            continue
        yield rel


def diff_trees(source: Path, mirror: Path) -> list[str]:
    """Return human-readable drift entries between source and mirror."""
    if not mirror.exists():
        return [f"missing mirror: {mirror}"]
    source_files = set(_iter_files(source))
    mirror_files = set(_iter_files(mirror))
    drift = [f"only in source: {rel}" for rel in sorted(source_files - mirror_files)]
    drift += [f"only in mirror: {rel}" for rel in sorted(mirror_files - source_files)]
    for rel in sorted(source_files & mirror_files):
        if not filecmp.cmp(source / rel, mirror / rel, shallow=False):
            drift.append(f"differs: {rel}")
    return drift


def check() -> int:
    problems = []
    for mirror in SKILLS_MIRRORS:
        for entry in diff_trees(SKILLS_SOURCE, mirror):
            problems.append(f"{mirror.relative_to(REPO_ROOT)}: {entry}")
    for mirror in INSTRUCTIONS_MIRRORS:
        if not mirror.exists():
            problems.append(f"{mirror.relative_to(REPO_ROOT)}: missing")
        elif not filecmp.cmp(INSTRUCTIONS_SOURCE, mirror, shallow=False):
            problems.append(f"{mirror.relative_to(REPO_ROOT)}: differs from CLAUDE.md")
    if problems:
        print("Mirrors are out of sync with their sources:")
        for problem in problems:
            print(f"  {problem}")
        print("\nRun `python scripts/sync_skills.py` to regenerate them.")
        return 1
    print("All mirrors are in sync.")
    return 0


def sync() -> int:
    if not SKILLS_SOURCE.is_dir():
        print(f"Source tree not found: {SKILLS_SOURCE}", file=sys.stderr)
        return 1
    for mirror in SKILLS_MIRRORS:
        if mirror.exists():
            shutil.rmtree(mirror)
        shutil.copytree(SKILLS_SOURCE, mirror, ignore=IGNORE_PATTERNS)
        print(f"Synced skills/ -> {mirror.relative_to(REPO_ROOT)}")
    for mirror in INSTRUCTIONS_MIRRORS:
        mirror.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(INSTRUCTIONS_SOURCE, mirror)
        print(f"Synced CLAUDE.md -> {mirror.relative_to(REPO_ROOT)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify mirrors match their sources without modifying anything",
    )
    args = parser.parse_args()
    return check() if args.check else sync()


if __name__ == "__main__":
    sys.exit(main())
