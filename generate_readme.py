#!/usr/bin/env python3
"""Generates a README.md with stats about all skills repos in the skills/ folder."""

import os
import shutil
import subprocess
import json
import time
from datetime import datetime, timezone
from pathlib import Path

SKILLS_DIR = Path(__file__).parent / "skills"
README_PATH = Path(__file__).parent / "README.md"
STATS_PATH = Path(__file__).parent / "stats.json"

REPOS = [
    {
        "url": "https://github.com/slavingia/skills",
        "dir": "skills",
        "description": "Claude Code skills by Sahil Lavingia",
    },
    {
        "url": "https://github.com/zarazhangrui/codebase-to-course",
        "dir": "codebase-to-course",
        "description": "Turn any codebase into a structured course",
    },
    {
        "url": "https://github.com/samber/cc-skills-golang",
        "dir": "cc-skills-golang",
        "description": "Claude Code skills for Go development",
    },
]


def run(cmd, cwd=None):
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, timeout=60)
    return result.stdout.strip()


def get_latest_commit(repo_path):
    if not repo_path.exists():
        return None, None, None
    sha = run(["git", "log", "-1", "--format=%H"], cwd=repo_path)
    date = run(["git", "log", "-1", "--format=%aI"], cwd=repo_path)
    msg = run(["git", "log", "-1", "--format=%s"], cwd=repo_path)
    return sha[:10] if sha else "n/a", date or "n/a", msg or "n/a"


def count_skill_files(repo_path):
    """Count .md files that look like skill definitions."""
    if not repo_path.exists():
        return 0
    count = 0
    for f in repo_path.rglob("*.md"):
        # Skip common non-skill markdown files
        if f.name.lower() in ("readme.md", "license.md", "changelog.md", "contributing.md"):
            continue
        count += 1
    return count


def get_dir_size_mb(repo_path):
    """Get directory size in MB, excluding .git."""
    if not repo_path.exists():
        return 0.0
    total = 0
    for f in repo_path.rglob("*"):
        if f.is_file() and ".git" not in f.parts:
            total += f.stat().st_size
    return round(total / (1024 * 1024), 1)


def get_star_count(url):
    """Try to get star count via gh CLI."""
    repo_slug = url.replace("https://github.com/", "")
    try:
        out = run(["gh", "repo", "view", repo_slug, "--json", "stargazerCount"])
        if out:
            data = json.loads(out)
            return data.get("stargazerCount", "?")
    except Exception:
        pass
    return "?"


def load_previous_stats():
    """Load stats from the previous run."""
    if STATS_PATH.exists():
        try:
            return json.loads(STATS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_stats(stats):
    """Persist current stats for next run's diff."""
    STATS_PATH.write_text(json.dumps(stats, indent=2) + "\n")


def format_diff(current, previous):
    """Format a value with +/- diff from previous run."""
    if previous is None or previous == "?" or current == "?":
        return str(current)
    diff = current - previous
    if diff > 0:
        return f"{current} (+{diff})"
    elif diff < 0:
        return f"{current} ({diff})"
    return str(current)


def sync_repos():
    """Clone or pull all repos. Removes nested .git dirs afterward so files
    can be committed to the parent repo without submodule issues."""
    SKILLS_DIR.mkdir(exist_ok=True)
    for repo in REPOS:
        repo_path = SKILLS_DIR / repo["dir"]
        if repo_path.exists() and (repo_path / ".git").exists():
            print(f"Pulling {repo['dir']}...")
            run(["git", "pull", "--ff-only"], cwd=repo_path)
        else:
            # Remove stale dir (no .git = previous stripped clone) and re-clone
            if repo_path.exists():
                shutil.rmtree(repo_path)
            print(f"Cloning {repo['url']}...")
            run(["git", "clone", repo["url"], str(repo_path)])


def generate_readme(sync_duration="n/a"):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    previous = load_previous_stats()
    current_stats = {}
    total_skills = 0
    total_size = 0.0
    rows = []

    for repo in REPOS:
        repo_path = SKILLS_DIR / repo["dir"]
        sha, date, msg = get_latest_commit(repo_path)
        skills_count = count_skill_files(repo_path)
        stars = get_star_count(repo["url"])
        size_mb = get_dir_size_mb(repo_path)
        total_skills += skills_count
        total_size += size_mb

        prev = previous.get(repo["dir"], {})
        skills_display = format_diff(skills_count, prev.get("skills"))
        stars_display = format_diff(stars, prev.get("stars"))

        current_stats[repo["dir"]] = {"skills": skills_count, "stars": stars}

        if date and date != "n/a":
            try:
                dt = datetime.fromisoformat(date)
                date = dt.strftime("%Y-%m-%d")
            except ValueError:
                pass

        rows.append(
            f"| [{repo['dir']}]({repo['url']}) | {repo['description']} "
            f"| {skills_display} | {stars_display} | {size_mb} MB | `{sha}` | {date} | {msg} |"
        )

    save_stats(current_stats)
    table = "\n".join(rows)

    prev_total = sum(r.get("skills", 0) for r in previous.values())
    total_display = format_diff(total_skills, prev_total if previous else None)
    total_size = round(total_size, 1)

    readme = f"""\
# Skills Collection

[![Sync Skills](https://github.com/thereisnotime/skills-collection/actions/workflows/sync-skills.yml/badge.svg)](https://github.com/thereisnotime/skills-collection/actions/workflows/sync-skills.yml)

A curated collection of Claude Code skills repos, automatically synced every 2 days.

## Stats

| Metric | Value |
|--------|-------|
| **Total repos** | {len(REPOS)} |
| **Total skill files** | {total_display} |
| **Total size** | {total_size} MB |
| **Last synced** | {now} |
| **Sync time** | {sync_duration} |

## Repos

| Repo | Description | Skills | Stars | Size | Latest Commit | Date | Message |
|------|-------------|--------|-------|------|---------------|------|---------|
{table}

## How it works

A GitHub Actions workflow runs every 2 days to:

1. Clone or pull all skill repos into `skills/`
2. Run `generate_readme.py` to regenerate this README with fresh stats
3. Commit and push any changes

---

*Auto-generated by `generate_readme.py` on {now}*
"""

    README_PATH.write_text(readme)
    print(f"README.md generated ({total_skills} skill files across {len(REPOS)} repos)")


def strip_nested_git():
    """Remove .git dirs from cloned repos so they're plain directories
    that the parent repo can track without submodule confusion."""
    for repo in REPOS:
        git_dir = SKILLS_DIR / repo["dir"] / ".git"
        if git_dir.exists():
            shutil.rmtree(git_dir)
            print(f"Stripped .git from {repo['dir']}")


if __name__ == "__main__":
    start = time.monotonic()
    sync_repos()
    elapsed = time.monotonic() - start
    minutes, seconds = divmod(int(elapsed), 60)
    sync_duration = f"{minutes}m {seconds}s" if minutes else f"{seconds}s"
    generate_readme(sync_duration)
    strip_nested_git()
