#!/usr/bin/env python3
"""Sanity-gate the generated security scan report before it is published.

The weekly scan commits its report straight into the repository, so a scan that
malfunctions publishes itself unreviewed. This script is the check that stands
between the two: it exits non-zero when the report makes claims that contradict
the contents of `skills/`, which fails the workflow and blocks the commit.

It deliberately does not judge whether a finding is *correct* — only whether it
is *possible*. A markdown-only skill can genuinely carry a prompt-injection
finding, and nothing here suppresses that. What it rejects are claims that
cannot be true of the package as it exists on disk: exfiltration chains spanning
files in a package that has no executable files, findings anchored to paths that
are not present, and narratives asserting a script count the package does not
have.

Usage:
    python validate_report.py [path/to/security-report.json]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SKILLS_DIR = Path("skills")
DEFAULT_JSON = Path("docs/security-report.json")

# Extensions the scanner treats as executable payload. A package containing none
# of these cannot exhibit behavior that requires running code.
EXECUTABLE_SUFFIXES = {
    ".py", ".pyw", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
    ".js", ".mjs", ".cjs", ".ts", ".rb", ".pl", ".php", ".lua", ".r", ".jl",
}

# Rule-id fragments whose detections require executable code inside the package.
# Kept narrow on purpose: "EXFILTRATION" alone is excluded, because an
# instruction-level exfiltration finding against a SKILL.md is legitimate.
CODE_REQUIRED_MARKERS = ("CROSSFILE", "EXFILTRATION_CHAIN", "ENV_VAR_EXFILTRATION")

# Assertions of a positive script count, e.g. "3 Python files", "6 python scripts".
SCRIPT_COUNT_CLAIM = re.compile(
    r"\b(\d+)\s+(?:Python|python|shell|executable)\s+(?:file|script)s?\b"
)


def disk_inventory(skill_dir: Path) -> dict:
    """Return what is actually in a skill package."""
    files = [f for f in skill_dir.rglob("*") if f.is_file()]
    return {
        "all": files,
        "relative": {str(f.relative_to(skill_dir)) for f in files},
        "executable": [f for f in files if f.suffix.lower() in EXECUTABLE_SUFFIXES],
    }


def normalize_finding_path(raw: str, skill_name: str) -> str | None:
    """Reduce a finding's file_path to a skill-relative path, or None to skip.

    Absolute and home-relative paths are skipped rather than validated: a finding
    may legitimately reference a system path such as ~/.ssh/id_rsa as the target
    of a detected behavior rather than as a file in the package.
    """
    path = raw.strip()
    if not path or path.startswith(("/", "~")):
        return None
    path = path.removeprefix("./")
    for prefix in (f"skills/{skill_name}/", f"{skill_name}/"):
        path = path.removeprefix(prefix)
    return path or None


def check_coverage(data: dict, disk_skills: set[str]) -> list[str]:
    """Every skill on disk must appear in the report, and none may be skipped."""
    problems: list[str] = []
    reported = {s["name"] for s in data.get("skills", [])}

    for name in sorted(disk_skills - reported):
        problems.append(f"{name}: present in {SKILLS_DIR}/ but absent from the report")
    for name in sorted(reported - disk_skills):
        problems.append(f"{name}: reported but has no directory in {SKILLS_DIR}/")

    for skipped in data.get("skills_skipped") or []:
        skill = skipped.get("skill", "<unknown>")
        reason = skipped.get("reason", "<no reason recorded>")
        problems.append(f"{skill}: silently skipped during the scan ({reason})")

    declared = (data.get("totals") or {}).get("skills_scanned")
    if declared is not None and declared != len(disk_skills):
        problems.append(
            f"totals.skills_scanned is {declared} but {len(disk_skills)} skills exist on disk"
        )
    return problems


def check_skill(entry: dict, skill_dir: Path) -> list[str]:
    """Apply the per-skill impossibility checks."""
    problems: list[str] = []
    name = entry["name"]
    inventory = disk_inventory(skill_dir)
    n_exec = len(inventory["executable"])
    n_files = len(inventory["all"])

    for finding in entry.get("findings") or []:
        rule = finding.get("rule_id") or "<no rule id>"

        # Behavior that requires running code, in a package with no code.
        if n_exec == 0 and any(m in rule for m in CODE_REQUIRED_MARKERS):
            problems.append(
                f"{name}: `{rule}` requires executable code, but the package has "
                f"{n_files} file(s) and no executable files"
            )

        # A cross-file chain needs at least two files to span.
        if "CROSSFILE" in rule and n_files < 2:
            problems.append(
                f"{name}: `{rule}` describes a cross-file chain in a {n_files}-file package"
            )

        # Findings must be anchored to a file that exists.
        raw_path = finding.get("file_path")
        if raw_path:
            rel = normalize_finding_path(raw_path, name)
            if rel and rel not in inventory["relative"]:
                problems.append(
                    f"{name}: `{rule}` is anchored to '{raw_path}', which is not in the package"
                )

        # Narratives must not assert scripts that a script-free package lacks.
        if n_exec == 0:
            prose = " ".join(
                filter(None, [finding.get("title"), finding.get("description"),
                              finding.get("remediation")])
            )
            for match in SCRIPT_COUNT_CLAIM.finditer(prose):
                if int(match.group(1)) > 0:
                    problems.append(
                        f"{name}: `{rule}` asserts '{match.group(0)}' but the package "
                        f"contains no executable files"
                    )
                    break

    return problems


def main() -> int:
    json_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_JSON

    if not json_path.exists():
        print(f"FAIL: {json_path} not found — run scan_skills.py first.")
        return 1
    if not SKILLS_DIR.is_dir():
        print(f"FAIL: {SKILLS_DIR}/ not found — run from the repository root.")
        return 1

    data = json.loads(json_path.read_text())
    skill_dirs = {p.parent.name: p.parent for p in SKILLS_DIR.rglob("SKILL.md")}

    problems = check_coverage(data, set(skill_dirs))
    for entry in data.get("skills") or []:
        skill_dir = skill_dirs.get(entry["name"])
        if skill_dir is not None:
            problems.extend(check_skill(entry, skill_dir))

    print(f"Validating {json_path} against {len(skill_dirs)} skills in {SKILLS_DIR}/\n")

    if problems:
        print(f"FAIL: {len(problems)} claim(s) contradict the repository contents:\n")
        for problem in problems:
            print(f"  - {problem}")
        print(
            "\nThe report was NOT published. Each item above is a claim the scan made "
            "that cannot be true of the package as it exists on disk, which means the "
            "scan pipeline is misreporting rather than that the skills are unsafe."
        )
        return 1

    totals = data.get("totals") or {}
    n_findings = totals.get("findings", 0)
    print(
        f"PASS: {totals.get('skills_scanned', '?')} skills scanned, "
        f"{n_findings} finding{'' if n_findings == 1 else 's'}, "
        f"{totals.get('critical', '?')} critical / {totals.get('high', '?')} high. "
        "All findings are anchored to files that exist and are physically possible."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
