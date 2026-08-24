#!/usr/bin/env python3
"""Single source of truth for reading SKILL.md YAML frontmatter.

Every tool in this repository MUST read frontmatter through this module.

Why this exists
---------------
This repo previously carried three independent hand-rolled "YAML-ish" parsers
(the index generator, validate-skill.py, validate-agentskills.py). Each handled
a different subset of YAML scalar styles, and all of them silently truncated
multi-line descriptions to their first line.

A census of the 817 skills shows why that was fatal:

    block scalar   (description: >-)    43
    single-quoted multiline            278
    plain unquoted multiline           496
    single-line                          0

Only the 43 block-scalar files parsed correctly; 774 (94.7%) used a style the
hand-rolled parsers mishandled, and 604 descriptions shipped truncated in
index.json with no error and no warning.

PyYAML handles every scalar style, quoting form and escape correctly. Do not
reintroduce a regex-based frontmatter parser -- CI greps for that.
"""
from __future__ import annotations

import os
import re
from typing import Dict, Iterator, Tuple

import yaml

# Frontmatter is the block between the opening '---' and the next '---' that
# sits alone on its own line. Tolerates CRLF and a leading UTF-8 BOM.
_FRONTMATTER_RE = re.compile(r"\A﻿?---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.DOTALL)

BACKUP_SUFFIX = ".bak"


class FrontmatterError(ValueError):
    """Raised when a SKILL.md has missing or unparseable frontmatter."""


def extract_block(text: str) -> str:
    """Return the raw YAML frontmatter block from a SKILL.md's text."""
    match = _FRONTMATTER_RE.match(text)
    if not match:
        raise FrontmatterError("no YAML frontmatter block (file must start with '---')")
    return match.group(1)


def parse(text: str) -> dict:
    """Parse a SKILL.md's full text into a frontmatter dict."""
    try:
        data = yaml.safe_load(extract_block(text))
    except yaml.YAMLError as exc:
        raise FrontmatterError(f"invalid YAML in frontmatter: {exc}") from exc

    if data is None:
        return {}
    if not isinstance(data, dict):
        raise FrontmatterError(f"frontmatter must be a mapping, got {type(data).__name__}")
    return data


def load_frontmatter(skill_md_path: str) -> dict:
    """Read one SKILL.md and return its frontmatter as a dict."""
    try:
        with open(skill_md_path, encoding="utf-8") as handle:
            text = handle.read()
    except UnicodeDecodeError as exc:
        raise FrontmatterError(f"not valid UTF-8: {exc}") from exc
    return parse(text)


def description_of(frontmatter: dict) -> str:
    """Return the description as a single normalized line.

    YAML preserves the newlines of a literal ('|') scalar and folds a folded
    ('>') one; collapsing whitespace here gives every style the same shape,
    which is what index.json and the linters want to compare.
    """
    return " ".join(str(frontmatter.get("description", "")).split())


def iter_skill_dirs(skills_dir: str = "skills") -> Iterator[Tuple[str, str]]:
    """Yield (slug, skill_dir) for every real skill, in sorted order.

    Skips '*.bak' backup directories and any directory lacking a SKILL.md.
    """
    for slug in sorted(os.listdir(skills_dir)):
        if slug.endswith(BACKUP_SUFFIX):
            continue
        skill_dir = os.path.join(skills_dir, slug)
        if not os.path.isdir(skill_dir):
            continue
        if not os.path.isfile(os.path.join(skill_dir, "SKILL.md")):
            continue
        yield slug, skill_dir


def load_all(skills_dir: str = "skills") -> Tuple[Dict[str, dict], Dict[str, str]]:
    """Load frontmatter for every skill.

    Returns (frontmatter_by_slug, errors_by_slug). Callers decide whether a
    parse failure is fatal; nothing is silently dropped.
    """
    loaded: Dict[str, dict] = {}
    errors: Dict[str, str] = {}

    for slug, skill_dir in iter_skill_dirs(skills_dir):
        try:
            loaded[slug] = load_frontmatter(os.path.join(skill_dir, "SKILL.md"))
        except FrontmatterError as exc:
            errors[slug] = str(exc)

    return loaded, errors
