#!/usr/bin/env python3
"""validate-skills.py - check every skills/*/SKILL.md frontmatter.

Frontmatter must parse as YAML and satisfy the field constraints at
https://agentskills.io/specification.

Usage:
  validate-skills.py [skills-dir]     default: skills
"""

import argparse
import re
import sys
from pathlib import Path

import yaml

FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
NAME = re.compile(r"\A[a-z0-9-]{1,64}\Z")


def frontmatter_problems(text, directory):
    match = FRONTMATTER.match(text)
    if match is None:
        return ["no --- delimited YAML frontmatter at the top of the file"]
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        return [f"frontmatter is not valid YAML: {exc}"]
    if not isinstance(data, dict):
        return ["frontmatter must be a YAML mapping"]

    problems = []

    name = data.get("name")
    if not isinstance(name, str):
        problems.append("name is required and must be a string")
    elif not NAME.match(name) or "--" in name or name.startswith("-") or name.endswith("-"):
        problems.append(f"name {name!r} must be 1-64 characters of a-z, 0-9 and single hyphens")
    elif name != directory:
        problems.append(f"name {name!r} must match its directory {directory!r}")

    description = data.get("description")
    if not isinstance(description, str) or not description.strip():
        problems.append("description is required and must be a non-empty string")
    elif len(description) > 1024:
        problems.append(f"description is {len(description)} characters, the maximum is 1024")

    compatibility = data.get("compatibility")
    if compatibility is not None and (
        not isinstance(compatibility, str)
        or not compatibility.strip()
        or len(compatibility) > 500
    ):
        problems.append("compatibility must be a non-empty string of at most 500 characters")

    metadata = data.get("metadata")
    if metadata is not None:
        if not isinstance(metadata, dict):
            problems.append("metadata must be a mapping of string keys to string values")
        else:
            non_string = sorted(str(key) for key, value in metadata.items() if not isinstance(value, str))
            if non_string:
                problems.append("metadata values must be strings: " + ", ".join(non_string))

    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("skills_dir", nargs="?", default="skills")
    root = Path(parser.parse_args().skills_dir)

    files = sorted(root.glob("*/SKILL.md")) if root.is_dir() else []
    if not files:
        print(f"no SKILL.md files under {root}", file=sys.stderr)
        return 1

    invalid = 0
    for path in files:
        problems = frontmatter_problems(path.read_text(encoding="utf-8"), path.parent.name)
        for problem in problems:
            print(f"{path}: {problem}", file=sys.stderr)
        if problems:
            invalid += 1

    if invalid:
        print(f"invalid: {invalid} of {len(files)} SKILL.md files", file=sys.stderr)
        return 1

    print(f"valid: {len(files)} SKILL.md files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
