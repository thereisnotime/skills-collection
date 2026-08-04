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

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

def top_level_keys_and_scalars(fm):
    """Minimal YAML: top-level keys (col 0) + scalar values for name/description."""
    keys = []
    scalars = {}
    lines = fm.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^([A-Za-z0-9_-]+):(.*)$", line)
        if not m:
            continue
        key, rest = m.group(1), m.group(2)
        keys.append(key)
        val = rest.strip()
        if val and val[0] in "|>":  # block scalar -> gather following indented lines
            buf = []
            for nxt in lines[i + 1:]:
                if re.match(r"^\s+\S", nxt):
                    buf.append(nxt.strip())
                elif nxt.strip() == "":
                    buf.append("")
                else:
                    break
            val = " ".join(x for x in buf if x != "").strip()
        elif not val:
            # could be a folded plain scalar wrapped onto continuation lines
            buf = []
            for nxt in lines[i + 1:]:
                if re.match(r"^\s+-\s", nxt) or re.match(r"^[A-Za-z0-9_-]+:", nxt):
                    break
                if re.match(r"^\s+\S", nxt):
                    buf.append(nxt.strip())
                else:
                    break
            val = " ".join(buf).strip()
        scalars[key] = val.strip().strip("\"'")
    return keys, scalars

def validate(path):
    slug = os.path.basename(os.path.dirname(path))
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    problems = []
    if not m:
        return slug, ["no YAML frontmatter block"], []
    fm = m.group(1)
    keys, scalars = top_level_keys_and_scalars(fm)

    if "name" not in keys:
        problems.append("missing required key: name")
    if "description" not in keys:
        problems.append("missing required key: description")

    name = scalars.get("name", "")
    if name:
        if not NAME_RE.match(name):
            problems.append(f"name not lowercase-kebab-case: {name!r}")
        if not (1 <= len(name) <= 64):
            problems.append(f"name length {len(name)} out of 1..64")
        if name != slug:
            problems.append(f"name {name!r} != directory {slug!r}")

    desc = scalars.get("description", "")
    if desc:
        if not (1 <= len(desc) <= 1024):
            problems.append(f"description length {len(desc)} out of 1..1024")
    elif "description" in keys:
        problems.append("description empty")

    # Ignore YAML block-scalar indicators (`key: >`, `key: >-`, `key: |`, ...);
    # only genuine `<...>`/`>` content in values is an injection concern.
    fm_no_ind = re.sub(r":[ \t]*[|>][+-]?[ \t]*(?=\n|$)", ":", fm)
    if "<" in fm_no_ind or ">" in fm_no_ind:
        problems.append("frontmatter contains angle brackets (injection risk / not allowed)")

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
