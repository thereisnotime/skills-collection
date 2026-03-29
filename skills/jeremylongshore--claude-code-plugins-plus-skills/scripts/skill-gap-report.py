#!/usr/bin/env python3
"""
Skill Gap Report Generator v1.0

Produces a detailed JSON report of ALL skills with their specific compliance gaps.
Used to prioritize and batch-fix skills systematically.

Output format:
{
  "summary": { ... },
  "skills": [
    {
      "path": "plugins/saas-packs/sentry-pack/skills/sentry-policy-guardrails/SKILL.md",
      "compliance": "warnings",  // "compliant", "warnings", "errors"
      "gaps": ["missing_section:Prerequisites", "description_missing:use_when", ...],
      "gap_count": 5,
      "priority": "high",  // based on gap count and category
      "category": "saas-packs",
      "fixable_auto": ["description_missing:use_when", "description_missing:trigger_with"],
      "fixable_manual": ["missing_section:Prerequisites", "missing_section:Instructions"]
    },
    ...
  ]
}

Usage:
    python scripts/skill-gap-report.py [--output FILE] [--format json|csv] [--verbose]

Author: Jeremy Longshore <jeremy@intentsolutions.io>
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml required. Install: pip install pyyaml", file=sys.stderr)
    sys.exit(1)


# === CONSTANTS (from validate-skills-schema.py) ===

VALID_TOOLS = {
    'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
    'WebFetch', 'WebSearch', 'Task', 'TodoWrite',
    'NotebookEdit', 'AskUserQuestion', 'Skill'
}

ANTHROPIC_REQUIRED = {'name', 'description'}
ENTERPRISE_REQUIRED = {'allowed-tools', 'version', 'author', 'license'}
REQUIRED_FIELDS = ANTHROPIC_REQUIRED | ENTERPRISE_REQUIRED

REQUIRED_SECTIONS = [
    "## Overview",
    "## Prerequisites",
    "## Instructions",
    "## Output",
    "## Error Handling",
    "## Examples",
    "## Resources",
]

RE_FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)
RE_DESCRIPTION_USE_WHEN = re.compile(r"\bUse when\b", re.IGNORECASE)
RE_DESCRIPTION_TRIGGER_WITH = re.compile(r"\bTrigger with\b", re.IGNORECASE)
CODE_FENCE_PATTERN = re.compile(r"^\s*(```|~~~)")

# Gap categories
GAP_AUTO_FIXABLE = {
    "description_missing:use_when",
    "description_missing:trigger_with",
    "frontmatter_missing:author",
    "frontmatter_missing:license",
    "unscoped_tool:Bash",
}

GAP_MANUAL_REVIEW = {
    "missing_section:Overview",
    "missing_section:Prerequisites",
    "missing_section:Instructions",
    "missing_section:Output",
    "missing_section:Error Handling",
    "missing_section:Examples",
    "missing_section:Resources",
    "empty_section:Instructions",
    "empty_section:Output",
    "empty_section:Error Handling",
    "empty_section:Examples",
    "empty_section:Resources",
    "description_missing:action_verbs",
}


# === UTILITY FUNCTIONS ===

def find_skill_files(root: Path) -> List[Path]:
    """Find all SKILL.md files in plugins/ and skills/ directories."""
    excluded_dirs = {
        "archive", "backups", "backup", ".git", "node_modules",
        "__pycache__", ".venv", "010-archive", "000-docs", "002-workspaces",
    }
    results = []

    plugins_dir = root / "plugins"
    if plugins_dir.exists():
        for p in plugins_dir.rglob("skills/*/SKILL.md"):
            if p.is_file():
                parts = p.relative_to(root).parts
                if any(part in excluded_dirs for part in parts):
                    continue
                if any(part.startswith("skills-backup-") for part in parts):
                    continue
                results.append(p)

    skills_dir = root / "skills"
    if skills_dir.exists():
        for p in skills_dir.rglob("*/SKILL.md"):
            if p.is_file():
                parts = p.relative_to(root).parts
                if any(part in excluded_dirs for part in parts):
                    continue
                results.append(p)

    return results


def parse_frontmatter(content: str) -> Tuple[dict, str]:
    """Parse YAML frontmatter from SKILL.md content."""
    m = RE_FRONTMATTER.match(content)
    if not m:
        raise ValueError("Invalid or absent YAML frontmatter")
    front_str, body = m.groups()
    try:
        data = yaml.safe_load(front_str) or {}
    except yaml.YAMLError as e:
        raise ValueError(f"YAML parse error: {e}")
    if not isinstance(data, dict):
        raise ValueError("Frontmatter is not a YAML mapping")
    return data, body


def parse_allowed_tools(tools_value: Any) -> List[str]:
    """Parse allowed-tools as a CSV string."""
    if isinstance(tools_value, str):
        return [t.strip() for t in tools_value.split(',') if t.strip()]
    return []


def get_category(path: Path, root: Path) -> str:
    """Extract category from skill path."""
    rel = path.relative_to(root)
    parts = rel.parts

    if len(parts) >= 2 and parts[0] == "plugins":
        return parts[1]  # e.g., "saas-packs", "community", "mcp"
    elif len(parts) >= 1 and parts[0] == "skills":
        return "standalone"
    return "unknown"


def iter_non_code_lines(text: str):
    """Yield lines outside of fenced code blocks."""
    in_code_block = False
    for raw in text.splitlines():
        if CODE_FENCE_PATTERN.match(raw):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
        yield raw


def has_heading_line(text: str, heading: str) -> bool:
    """Check if a heading exists outside code blocks."""
    target = heading.strip().lower()
    for raw in iter_non_code_lines(text):
        if raw.strip().lower() == target:
            return True
    return False


def section_body(body: str, section_heading: str) -> str:
    """Extract content between heading and next same-level heading."""
    m_heading = re.match(r"^(#+)\s+", section_heading.strip())
    if not m_heading:
        return ""
    level = len(m_heading.group(1))
    target = section_heading.strip().lower()

    found = False
    collected: List[str] = []

    in_code = False
    for raw in body.splitlines():
        if CODE_FENCE_PATTERN.match(raw):
            in_code = not in_code
            continue
        if in_code:
            continue

        if not found:
            if raw.strip().lower() == target:
                found = True
            continue

        m_next = re.match(r"^\s*(#{1,6})\s+", raw)
        if m_next:
            next_level = len(m_next.group(1))
            if next_level <= level:
                break

        collected.append(raw)

    return "\n".join(collected).strip()


# === GAP DETECTION ===

def detect_gaps(path: Path, root: Path) -> Dict[str, Any]:
    """
    Detect all gaps in a SKILL.md file.
    Returns detailed gap information.
    """
    result = {
        "path": str(path.relative_to(root)),
        "compliance": "compliant",
        "gaps": [],
        "gap_count": 0,
        "priority": "low",
        "category": get_category(path, root),
        "fixable_auto": [],
        "fixable_manual": [],
        "metadata": {}
    }

    try:
        content = path.read_text(encoding='utf-8')
    except Exception as e:
        result["compliance"] = "errors"
        result["gaps"].append(f"fatal:cannot_read:{e}")
        result["gap_count"] = 1
        result["priority"] = "critical"
        return result

    try:
        fm, body = parse_frontmatter(content)
    except Exception as e:
        result["compliance"] = "errors"
        result["gaps"].append(f"fatal:invalid_frontmatter:{e}")
        result["gap_count"] = 1
        result["priority"] = "critical"
        return result

    gaps = []
    errors = []

    # Store metadata for context
    result["metadata"]["name"] = fm.get("name", "")
    result["metadata"]["version"] = fm.get("version", "")

    # === FRONTMATTER GAPS ===

    # Required fields
    for field in REQUIRED_FIELDS:
        if field not in fm:
            gap = f"frontmatter_missing:{field}"
            if field in ENTERPRISE_REQUIRED:
                gaps.append(gap)
            else:
                errors.append(gap)

    # Description quality
    if 'description' in fm:
        desc = str(fm['description']).strip()

        if len(desc) < 20:
            gaps.append("description:too_short")

        if not RE_DESCRIPTION_USE_WHEN.search(desc):
            gaps.append("description_missing:use_when")

        if not RE_DESCRIPTION_TRIGGER_WITH.search(desc):
            gaps.append("description_missing:trigger_with")

        # Action verbs check
        imperative_starts = [
            'analyze', 'audit', 'build', 'compare', 'configure', 'convert', 'create',
            'debug', 'deploy', 'detect', 'extract', 'fix', 'forecast', 'generate',
            'implement', 'log', 'manage', 'migrate', 'monitor', 'optimize',
            'process', 'review', 'route', 'scan', 'set up', 'setup', 'test',
            'track', 'transform', 'validate',
        ]
        desc_lower = desc.lower()
        if not any(v in desc_lower for v in imperative_starts):
            gaps.append("description_missing:action_verbs")

    # Allowed-tools validation
    if 'allowed-tools' in fm:
        raw_tools = fm['allowed-tools']
        if isinstance(raw_tools, list):
            errors.append("allowed_tools:wrong_type_array")
        elif isinstance(raw_tools, str):
            tools = parse_allowed_tools(raw_tools)
            if 'Bash' in tools:
                gaps.append("unscoped_tool:Bash")
        else:
            errors.append("allowed_tools:wrong_type")

    # Author email check
    if 'author' in fm:
        author = str(fm['author']).strip()
        if '@' not in author:
            gaps.append("author_missing:email")

    # === BODY GAPS ===

    # Required sections
    for sec in REQUIRED_SECTIONS:
        if not has_heading_line(body, sec):
            section_name = sec.replace("## ", "")
            gaps.append(f"missing_section:{section_name}")

    # Empty sections check
    section_min_chars = {
        "## Instructions": 40,
        "## Output": 20,
        "## Error Handling": 20,
        "## Examples": 20,
        "## Resources": 20,
    }

    for section, min_chars in section_min_chars.items():
        content_text = section_body(body, section)
        content_no_code = re.sub(r"```.*?```", "", content_text, flags=re.DOTALL).strip()
        if has_heading_line(body, section) and len(content_no_code) < min_chars:
            section_name = section.replace("## ", "")
            gaps.append(f"empty_section:{section_name}")

    # Instructions step-by-step check
    instructions = section_body(body, "## Instructions")
    if instructions:
        has_numbered = bool(re.search(r"(?m)^\s*1\.\s+\S+", instructions))
        has_step_heading = bool(re.search(r"(?mi)^\s*#{2,6}\s*step\s*\d+", instructions))
        has_step_label = bool(re.search(r"(?mi)^\s*step\s*\d+[:\-]", instructions))
        if not (has_numbered or has_step_heading or has_step_label):
            gaps.append("instructions:not_step_by_step")

    # === CLASSIFY GAPS ===

    all_gaps = errors + gaps
    result["gaps"] = all_gaps
    result["gap_count"] = len(all_gaps)

    # Classify fixability
    for gap in all_gaps:
        if gap in GAP_AUTO_FIXABLE or gap.startswith("frontmatter_missing:author") or gap.startswith("frontmatter_missing:license"):
            result["fixable_auto"].append(gap)
        elif gap in GAP_MANUAL_REVIEW or gap.startswith("missing_section:") or gap.startswith("empty_section:"):
            result["fixable_manual"].append(gap)

    # Determine compliance level
    if errors:
        result["compliance"] = "errors"
    elif gaps:
        result["compliance"] = "warnings"
    else:
        result["compliance"] = "compliant"

    # Determine priority
    gap_count = len(all_gaps)
    category = result["category"]

    # SaaS packs are always higher priority
    is_saas = category == "saas-packs"

    if errors:
        result["priority"] = "critical"
    elif gap_count == 0:
        result["priority"] = "none"
    elif gap_count <= 2:
        result["priority"] = "high" if is_saas else "medium"  # Quick wins
    elif gap_count <= 4:
        result["priority"] = "high" if is_saas else "medium"
    elif gap_count <= 6:
        result["priority"] = "medium" if is_saas else "low"
    else:
        result["priority"] = "low"  # May need rewrite

    return result


# === MAIN ===

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate skill gap report for compliance improvement"
    )
    parser.add_argument(
        "--output", "-o",
        help="Output file (default: stdout)"
    )
    parser.add_argument(
        "--format", "-f",
        choices=["json", "csv", "summary"],
        default="json",
        help="Output format (default: json)"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Include compliant skills in output"
    )
    parser.add_argument(
        "--category",
        help="Filter by category (e.g., saas-packs, community)"
    )
    parser.add_argument(
        "--priority",
        choices=["critical", "high", "medium", "low"],
        help="Filter by minimum priority"
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    skills = find_skill_files(repo_root)

    if not skills:
        print("No SKILL.md files found.", file=sys.stderr)
        return 1

    print(f"Analyzing {len(skills)} skills...", file=sys.stderr)

    results = []
    for skill in skills:
        result = detect_gaps(skill, repo_root)
        results.append(result)

    # Apply filters
    if args.category:
        results = [r for r in results if r["category"] == args.category]

    if args.priority:
        priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
        min_priority = priority_order.get(args.priority, 3)
        results = [r for r in results if priority_order.get(r["priority"], 4) <= min_priority]

    if not args.verbose:
        results = [r for r in results if r["compliance"] != "compliant"]

    # Sort by priority, then gap count
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
    results.sort(key=lambda x: (priority_order.get(x["priority"], 4), -x["gap_count"]))

    # Calculate summary
    total = len(skills)
    compliant = sum(1 for r in results if r["compliance"] == "compliant") if args.verbose else \
                total - len(results)
    warnings_only = sum(1 for r in results if r["compliance"] == "warnings")
    with_errors = sum(1 for r in results if r["compliance"] == "errors")

    # Gap frequency analysis
    gap_frequency: Dict[str, int] = {}
    for r in results:
        for gap in r["gaps"]:
            gap_frequency[gap] = gap_frequency.get(gap, 0) + 1

    top_gaps = sorted(gap_frequency.items(), key=lambda x: -x[1])[:20]

    # Category breakdown
    category_stats: Dict[str, Dict[str, int]] = {}
    for r in results:
        cat = r["category"]
        if cat not in category_stats:
            category_stats[cat] = {"total": 0, "compliant": 0, "warnings": 0, "errors": 0}
        category_stats[cat]["total"] += 1
        category_stats[cat][r["compliance"]] += 1

    summary = {
        "total_skills": total,
        "compliant": compliant,
        "compliant_pct": round(compliant / total * 100, 1) if total else 0,
        "warnings_only": warnings_only,
        "with_errors": with_errors,
        "target_80pct": int(total * 0.8),
        "gap_to_80pct": max(0, int(total * 0.8) - compliant),
        "top_gaps": top_gaps,
        "by_category": category_stats,
        "auto_fixable_count": sum(len(r["fixable_auto"]) for r in results),
        "manual_review_count": sum(len(r["fixable_manual"]) for r in results),
    }

    # Output
    output = {
        "summary": summary,
        "skills": results
    }

    if args.format == "json":
        output_text = json.dumps(output, indent=2)
    elif args.format == "csv":
        # CSV output for spreadsheet analysis
        import io
        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)
        writer.writerow([
            "path", "compliance", "priority", "category",
            "gap_count", "auto_fixable", "manual_review", "gaps"
        ])
        for r in results:
            writer.writerow([
                r["path"],
                r["compliance"],
                r["priority"],
                r["category"],
                r["gap_count"],
                len(r["fixable_auto"]),
                len(r["fixable_manual"]),
                "; ".join(r["gaps"])
            ])
        output_text = csv_buffer.getvalue()
    else:  # summary
        lines = [
            "=" * 70,
            "SKILL GAP REPORT SUMMARY",
            "=" * 70,
            f"Total Skills: {total}",
            f"Compliant: {compliant} ({summary['compliant_pct']}%)",
            f"Warnings Only: {warnings_only}",
            f"With Errors: {with_errors}",
            "",
            f"Target (80%): {summary['target_80pct']} skills",
            f"Gap to 80%: {summary['gap_to_80pct']} skills need fixing",
            "",
            "TOP 10 MOST COMMON GAPS:",
            "-" * 40,
        ]
        for gap, count in top_gaps[:10]:
            lines.append(f"  {gap}: {count}")

        lines.extend([
            "",
            "BY CATEGORY:",
            "-" * 40,
        ])
        for cat, stats in sorted(category_stats.items()):
            pct = round(stats.get("compliant", 0) / stats["total"] * 100, 1) if stats["total"] else 0
            lines.append(f"  {cat}: {stats['total']} total, {stats.get('compliant', 0)} compliant ({pct}%)")

        lines.extend([
            "",
            f"Auto-fixable gaps: {summary['auto_fixable_count']}",
            f"Manual review needed: {summary['manual_review_count']}",
            "=" * 70,
        ])
        output_text = "\n".join(lines)

    if args.output:
        Path(args.output).write_text(output_text, encoding='utf-8')
        print(f"Report written to: {args.output}", file=sys.stderr)
    else:
        print(output_text)

    # Print summary to stderr
    print(f"\nSummary: {compliant}/{total} compliant ({summary['compliant_pct']}%)", file=sys.stderr)
    print(f"Gap to 80%: {summary['gap_to_80pct']} skills need fixing", file=sys.stderr)

    return 0


if __name__ == '__main__':
    sys.exit(main())
