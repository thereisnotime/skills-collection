#!/usr/bin/env python3
"""Lint SKILL.md descriptions for the qualities that drive agent routing.

The description is the ONLY signal an agent sees at discovery time, so it must
say what the skill does, when to fire, and -- critically -- when NOT to fire.
Skills whose descriptions overlap without a distinguishing negative trigger get
misrouted ("skill collision").

Rules
-----
  name-matches-folder        frontmatter name == directory name
  desc-max-length            description <= 1024 chars (agentskills.io limit)
  desc-ends-punctuation      ends in . ! ? ) " '  -- a truncation canary
  desc-has-use-when          carries an explicit trigger clause
  desc-has-negative-trigger  says what it is NOT for
  body-max-lines             SKILL.md <= 500 lines (Anthropic guidance)

Grandfathering
--------------
Known pre-existing failures live in tools/lint-baseline.json so CI can go green
today while the debt is paid down. A baselined skill that starts passing is
reported as a stale entry -- run --update-baseline to shrink the file. The
baseline can only ever shrink in review, never silently grow: any NEW failure
is a hard error.

Usage:
    python tools/lint-descriptions.py --all
    python tools/lint-descriptions.py --all --stats
    python tools/lint-descriptions.py --update-baseline
    python tools/lint-descriptions.py skills/<slug>
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from skill_frontmatter import description_of, iter_skill_dirs, load_frontmatter, FrontmatterError

BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lint-baseline.json")

DESCRIPTION_MAX_CHARS = 1024
BODY_MAX_LINES = 500
SENTENCE_ENDINGS = ".!?)\"'"

# "Use when ...", "Use this skill when ...", "Use for ...", "Use during ..."
USE_WHEN_RE = re.compile(
    r"\buse\s+(?:this\s+)?(?:skill\s+)?(?:when|whenever|for|during|after|before)\b",
    re.IGNORECASE,
)

# "Do not use for X", "Don't use when Y", "Not for Z"
NEGATIVE_TRIGGER_RE = re.compile(
    r"\b(?:do\s+not\s+use|don'?t\s+use|not\s+for\b|avoid\s+(?:this\s+)?(?:skill\s+)?for)\b",
    re.IGNORECASE,
)

RULES = (
    "name-matches-folder",
    "desc-max-length",
    "desc-ends-punctuation",
    "desc-has-use-when",
    "desc-has-negative-trigger",
    "body-max-lines",
)

RED, GREEN, YELLOW, DIM, RESET = "\033[91m", "\033[92m", "\033[93m", "\033[2m", "\033[0m"


def check_skill(slug: str, skill_dir: str) -> dict[str, str]:
    """Return {rule_id: human message} for every rule this skill violates."""
    skill_md = os.path.join(skill_dir, "SKILL.md")
    violations: dict[str, str] = {}

    try:
        frontmatter = load_frontmatter(skill_md)
    except FrontmatterError as exc:
        return {"name-matches-folder": f"unparseable frontmatter: {exc}"}

    name = str(frontmatter.get("name", "") or "")
    if name != slug:
        violations["name-matches-folder"] = f"name {name!r} != folder {slug!r}"

    description = description_of(frontmatter)

    if len(description) > DESCRIPTION_MAX_CHARS:
        violations["desc-max-length"] = (
            f"{len(description)} chars, max {DESCRIPTION_MAX_CHARS}")

    if description and description[-1] not in SENTENCE_ENDINGS:
        violations["desc-ends-punctuation"] = f"ends with {description[-40:]!r}"

    if not USE_WHEN_RE.search(description):
        violations["desc-has-use-when"] = "no trigger clause (add 'Use when ...')"

    if not NEGATIVE_TRIGGER_RE.search(description):
        violations["desc-has-negative-trigger"] = (
            "no negative trigger (add 'Do not use for X - use <other-skill>.')")

    with open(skill_md, encoding="utf-8") as handle:
        line_count = sum(1 for _ in handle)
    if line_count > BODY_MAX_LINES:
        violations["body-max-lines"] = f"{line_count} lines, max {BODY_MAX_LINES}"

    return violations


def collect(skills_dir: str = "skills") -> dict[str, dict[str, str]]:
    return {slug: v for slug, d in iter_skill_dirs(skills_dir)
            if (v := check_skill(slug, d))}


def load_baseline() -> dict[str, list[str]]:
    if not os.path.isfile(BASELINE_PATH):
        return {}
    with open(BASELINE_PATH, encoding="utf-8") as handle:
        return {k: v for k, v in json.load(handle).items() if not k.startswith("_")}


def write_baseline(violations: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    baseline = {rule: sorted(s for s, v in violations.items() if rule in v)
                for rule in RULES}
    baseline = {rule: slugs for rule, slugs in baseline.items() if slugs}
    payload = {
        "_comment": (
            "Pre-existing lint failures, grandfathered so CI can gate new work today. "
            "This file may only shrink. Never add a slug by hand -- fix the skill, then "
            "run: python tools/lint-descriptions.py --update-baseline"
        ),
        "_total_grandfathered": sum(len(s) for s in baseline.values()),
        **baseline,
    }
    with open(BASELINE_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    return baseline


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", nargs="?", help="a single skills/<slug> directory")
    parser.add_argument("--all", action="store_true", help="lint every skill")
    parser.add_argument("--stats", action="store_true", help="show per-rule totals")
    parser.add_argument("--update-baseline", action="store_true",
                        help="rewrite lint-baseline.json from current state")
    parser.add_argument("--skills-dir", default="skills")
    args = parser.parse_args()

    if not os.path.isdir(args.skills_dir):
        print(f"ERROR: '{args.skills_dir}' not found. Run from the repository root.")
        return 1

    single_skill = bool(args.target) and not (args.all or args.update_baseline)
    if single_skill:
        slug = os.path.basename(args.target.rstrip("/\\"))
        violations = {slug: v} if (v := check_skill(slug, args.target.rstrip("/\\"))) else {}
    else:
        violations = collect(args.skills_dir)

    if args.update_baseline:
        baseline = write_baseline(violations)
        total = sum(len(s) for s in baseline.values())
        print(f"Baseline written: {total} grandfathered violation(s) across "
              f"{len(baseline)} rule(s) -> {os.path.relpath(BASELINE_PATH)}")
        for rule in RULES:
            if baseline.get(rule):
                print(f"  {rule:26s} {len(baseline[rule])}")
        return 0

    baseline = load_baseline()

    new_failures: list[tuple[str, str, str]] = []
    grandfathered = 0
    for slug, rule_map in sorted(violations.items()):
        for rule, message in sorted(rule_map.items()):
            if slug in baseline.get(rule, []):
                grandfathered += 1
            else:
                new_failures.append((slug, rule, message))

    # Only meaningful over the whole tree: linting one skill says nothing about
    # whether the other 816 baselined violations still stand.
    stale = [] if single_skill else [
        (rule, slug) for rule, slugs in baseline.items() for slug in slugs
        if rule not in violations.get(slug, {})
    ]

    if args.stats:
        print("Violations by rule (grandfathered + new):")
        for rule in RULES:
            count = sum(1 for v in violations.values() if rule in v)
            remaining = len(baseline.get(rule, []))
            print(f"  {rule:26s} {count:4d}   baselined {remaining:4d}")
        print()

    for slug, rule, message in new_failures:
        print(f"{RED}FAIL{RESET} {slug}: {YELLOW}{rule}{RESET} - {message}")

    if stale:
        print(f"\n{GREEN}{len(stale)} baselined violation(s) now pass.{RESET} "
              f"Shrink the baseline: python tools/lint-descriptions.py --update-baseline")
        for rule, slug in stale[:10]:
            print(f"  {DIM}fixed{RESET} {slug}: {rule}")

    print(f"\n{'=' * 60}")
    checked = 1 if single_skill else sum(1 for _ in iter_skill_dirs(args.skills_dir))
    print(f"Skills: {checked}   "
          f"{RED}New failures: {len(new_failures)}{RESET}   "
          f"{YELLOW}Grandfathered: {grandfathered}{RESET}")

    return 1 if new_failures else 0


if __name__ == "__main__":
    sys.exit(main())
