#!/usr/bin/env python3
"""Analyze locally cloned skill repos and generate per-repo stats.

Outputs analysis.json with detailed metrics per repo based on actual file contents.
Designed to run after sync, before readme generation.

Usage: python3 analysis.py
"""

import json
import os
import re
from pathlib import Path

SKILLS_DIR = Path(__file__).parent / "skills"
INVENTORY_PATH = Path(__file__).parent / "inventory.json"
ANALYSIS_PATH = Path(__file__).parent / "analysis.json"
SKILLS_LIST_PATH = Path(__file__).parent / "skills-list.json"


def analyze_skill_file(path):
    """Extract metadata from a single SKILL.md file."""
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None

    lines = content.split("\n")
    line_count = len(lines)

    # Parse frontmatter
    has_frontmatter = lines[0].strip() == "---"
    frontmatter_keys = []
    name = ""
    description = ""
    version = ""
    license_info = ""
    if has_frontmatter:
        for line in lines[1:]:
            if line.strip() == "---":
                break
            match = re.match(r"^(\w[\w-]*):\s*(.*)", line)
            if match:
                key, val = match.group(1), match.group(2).strip()
                frontmatter_keys.append(key)
                if key == "name":
                    name = val
                elif key == "description":
                    description = val
                elif key == "version":
                    version = val
                elif key == "license":
                    license_info = val

    # Count code blocks
    code_blocks = content.count("```")
    code_block_count = code_blocks // 2

    # Count headings
    headings = sum(1 for l in lines if l.startswith("#"))

    # Word count (rough)
    word_count = len(content.split())

    # Detect languages in code blocks
    languages = set()
    for match in re.finditer(r"```(\w+)", content):
        languages.add(match.group(1).lower())

    return {
        "path": str(path.relative_to(SKILLS_DIR)),
        "name": name,
        "description": description[:200],
        "version": version,
        "license": license_info,
        "lines": line_count,
        "words": word_count,
        "headings": headings,
        "code_blocks": code_block_count,
        "has_frontmatter": has_frontmatter,
        "frontmatter_keys": frontmatter_keys,
        "languages": sorted(languages),
    }


def analyze_repo(repo_dir, description=""):
    """Analyze all files in a repo directory."""
    repo_path = SKILLS_DIR / repo_dir
    if not repo_path.exists():
        return None

    # Find all SKILL.md files
    skill_files = list(repo_path.rglob("SKILL.md"))
    skills = []
    for sf in skill_files:
        info = analyze_skill_file(sf)
        if info:
            skills.append(info)

    if not skills:
        skill_lines = []
    else:
        skill_lines = [s["lines"] for s in skills]

    # Count all files by type
    file_types = {}
    total_files = 0
    total_size_bytes = 0
    for f in repo_path.rglob("*"):
        if f.is_file() and ".git" not in f.parts:
            total_files += 1
            total_size_bytes += f.stat().st_size
            ext = f.suffix.lower().lstrip(".")
            if ext:
                file_types[ext] = file_types.get(ext, 0) + 1

    # Count reference/knowledge files
    reference_files = len(list(repo_path.rglob("references/*.md")))

    # Has evals?
    eval_files = len(list(repo_path.rglob("evals/*")))

    # Has tests?
    test_files = 0
    for pattern in ["*test*", "*spec*", "*Test*", "*Spec*"]:
        test_files += len(list(repo_path.rglob(pattern)))

    # Has license?
    has_license = any(repo_path.glob("LICENSE*"))

    # Has README?
    has_readme = any(repo_path.glob("README*"))

    # Has CLAUDE.md?
    has_claude_md = (repo_path / "CLAUDE.md").exists()

    # Collect all unique frontmatter keys across skills
    all_fm_keys = set()
    for s in skills:
        all_fm_keys.update(s["frontmatter_keys"])

    # Collect all code languages
    all_languages = set()
    for s in skills:
        all_languages.update(s["languages"])

    # Aggregate skill stats
    total_skill_lines = sum(skill_lines) if skill_lines else 0
    total_skill_words = sum(s["words"] for s in skills) if skills else 0
    total_code_blocks = sum(s["code_blocks"] for s in skills) if skills else 0

    # Build skills list for skills-list.json
    skills_list = []
    for s in skills:
        if s["name"]:
            remote_path = "/".join(s["path"].split("/")[1:])
            entry = {
                "name": s["name"],
                "description": s["description"],
                "path": s["path"],
                "remote_path": remote_path,
                "lines": s["lines"],
                "words": s["words"],
                "code_blocks": s["code_blocks"],
                "languages": s["languages"],
            }
            if s["version"]:
                entry["version"] = s["version"]
            if s["license"]:
                entry["license"] = s["license"]
            skills_list.append(entry)

    return {
        "description": description,
        "skill_count": len(skills),
        "skill_lines_total": total_skill_lines,
        "skill_lines_avg": round(total_skill_lines / len(skills)) if skills else 0,
        "skill_lines_min": min(skill_lines) if skill_lines else 0,
        "skill_lines_max": max(skill_lines) if skill_lines else 0,
        "skill_lines_median": sorted(skill_lines)[len(skill_lines) // 2] if skill_lines else 0,
        "skill_words_total": total_skill_words,
        "skill_words_avg": round(total_skill_words / len(skills)) if skills else 0,
        "code_blocks_total": total_code_blocks,
        "code_blocks_avg": round(total_code_blocks / len(skills), 1) if skills else 0,
        "code_languages": sorted(all_languages),
        "frontmatter_keys": sorted(all_fm_keys),
        "reference_files": reference_files,
        "eval_files": eval_files,
        "test_files": test_files,
        "total_files": total_files,
        "total_size_mb": round(total_size_bytes / (1024 * 1024), 2),
        "file_types": dict(sorted(file_types.items(), key=lambda x: -x[1])[:10]),
        "has_license": has_license,
        "has_readme": has_readme,
        "has_claude_md": has_claude_md,
        "skills_list": skills_list,
    }


def main():
    inventory = json.loads(INVENTORY_PATH.read_text())
    results = {}

    for repo in inventory:
        dir_name = repo["dir"]
        print(f"  Analyzing {dir_name}...")
        analysis = analyze_repo(dir_name, repo.get("description", ""))
        if analysis:
            results[dir_name] = analysis

    # Separate skills_list from analysis (keep analysis.json lean)
    skills_list = {}
    for dir_name, data in results.items():
        skills_list[dir_name] = data.pop("skills_list", [])

    ANALYSIS_PATH.write_text(json.dumps(results, indent=2) + "\n")
    SKILLS_LIST_PATH.write_text(json.dumps(skills_list, indent=2) + "\n")

    # Print summary
    total_skills = sum(r["skill_count"] for r in results.values())
    total_named = sum(len(sl) for sl in skills_list.values())
    total_lines = sum(r["skill_lines_total"] for r in results.values())
    repos_with_evals = sum(1 for r in results.values() if r["eval_files"] > 0)
    repos_with_tests = sum(1 for r in results.values() if r["test_files"] > 0)
    repos_with_claude = sum(1 for r in results.values() if r["has_claude_md"])

    print(f"\n  Analysis complete: {len(results)} repos")
    print(f"  Total skills: {total_skills}, named skills: {total_named}, total lines: {total_lines:,}")
    print(f"  Repos with evals: {repos_with_evals}, tests: {repos_with_tests}, CLAUDE.md: {repos_with_claude}")


if __name__ == "__main__":
    main()
