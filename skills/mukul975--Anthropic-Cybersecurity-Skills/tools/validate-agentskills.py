#!/usr/bin/env python3
"""Validate SKILL.md frontmatter against the strict agentskills.io standard.

Reports, per skill, any deviation from tools/agentskills-skill.schema.json plus
the two constraints JSON Schema can't express (name == parent dir; no angle
brackets in frontmatter). READ-ONLY; never edits files.

Usage:
  python3 tools/validate-agentskills.py            # summary + report
  python3 tools/validate-agentskills.py --json      # machine-readable JSON
  python3 tools/validate-agentskills.py --strict    # exit 1 if any non-compliant
"""
import os, re, sys, json, glob
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from skill_frontmatter import description_of, load_frontmatter, FrontmatterError

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# The agentskills.io standard forbids reserved vendor words in a skill name.
# tools/agentskills-skill.schema.json names this script as the enforcement
# point, but the check was never actually implemented until now.
RESERVED_NAME_WORDS = ("anthropic", "claude")


def validate(path):
    slug = os.path.basename(os.path.dirname(path))
    problems = []

    try:
        fm = load_frontmatter(path)
    except FrontmatterError as exc:
        return slug, [str(exc)], []

    keys = list(fm.keys())

    if "name" not in keys:
        problems.append("missing required key: name")
    if "description" not in keys:
        problems.append("missing required key: description")

    name = str(fm.get("name", "") or "")
    if name:
        if not NAME_RE.match(name):
            problems.append(f"name not lowercase-kebab-case: {name!r}")
        if not (1 <= len(name) <= 64):
            problems.append(f"name length {len(name)} out of 1..64")
        if name != slug:
            problems.append(f"name {name!r} != directory {slug!r}")
        for reserved in RESERVED_NAME_WORDS:
            if reserved in name.lower():
                problems.append(f"name contains reserved word {reserved!r}: {name!r}")

    desc = description_of(fm)
    if desc:
        if not (1 <= len(desc) <= 1024):
            problems.append(f"description length {len(desc)} out of 1..1024")
    elif "description" in keys:
        problems.append("description empty")

    # Angle brackets are an injection risk. Checking the PARSED values (rather
    # than the raw text) means YAML block-scalar indicators like `>-` are never
    # mistaken for content, so no indicator-stripping hack is needed.
    for key, value in fm.items():
        if isinstance(value, str) and ("<" in value or ">" in value):
            problems.append(f"frontmatter value for {key!r} contains angle brackets "
                            "(injection risk / not allowed)")
            break

    # Additional top-level keys are PERMITTED by the standard (name+description
    # are the only required fields). They are reported for information, not
    # counted as compliance failures.
    nonstd = [k for k in keys if k not in ALLOWED]
    return slug, problems, nonstd

def main():
    as_json = "--json" in sys.argv
    strict = "--strict" in sys.argv
    skills = sorted(glob.glob(os.path.join(REPO, "skills", "*", "SKILL.md")))
    results = []
    nonstd_hist = Counter()
    compliant = 0
    for p in skills:
        slug, problems, nonstd = validate(p)
        nonstd_hist.update(nonstd)
        if not problems:
            compliant += 1
        results.append({"skill": slug, "compliant": not problems, "problems": problems})
    noncompliant = [r for r in results if not r["compliant"]]
    summary = {
        "total": len(skills),
        "compliant": compliant,
        "noncompliant": len(noncompliant),
        "nonstandard_key_frequency": dict(nonstd_hist.most_common()),
    }
    if as_json:
        print(json.dumps({"summary": summary, "results": results}, indent=1))
    else:
        print(f"agentskills.io compliance: {compliant}/{len(skills)} compliant, "
              f"{len(noncompliant)} non-compliant")
        print("\nNon-standard top-level keys (count of skills carrying each):")
        for k, n in nonstd_hist.most_common():
            print(f"  {k:20s} {n}")
        # distinct problem types (excluding the per-key nonstd noise)
        other = Counter()
        for r in noncompliant:
            for pr in r["problems"]:
                if not pr.startswith("non-standard top-level key:"):
                    other[re.sub(r':.*$', '', pr)] += 1
        if other:
            print("\nOther (non-key) issues:")
            for k, n in other.most_common():
                print(f"  {k}: {n}")
    if strict and noncompliant:
        sys.exit(1)

if __name__ == "__main__":
    main()
