#!/usr/bin/env python3
"""Generates a README.md with stats and charts about all skills repos."""

import os
import re as regex
import shutil
import subprocess
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

SKILLS_DIR = Path(__file__).parent / "skills"
README_PATH = Path(__file__).parent / "README.md"
STATS_PATH = Path(__file__).parent / "stats.json"
INVENTORY_PATH = Path(__file__).parent / "inventory.json"
HISTORY_PATH = Path(__file__).parent / "history.json"
COMMITS_PATH = Path(__file__).parent / "commits.json"
REPO_COMMITS_PATH = Path(__file__).parent / "repo-commits.json"
CHARTS_DIR = Path(__file__).parent / "charts"

# -- Chart colors --
PALETTE = [
    "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#3b82f6",
    "#ec4899", "#14b8a6", "#8b5cf6", "#ef4444", "#06b6d4",
]
BG_COLOR = "#0d1117"
TEXT_COLOR = "#c9d1d9"
GRID_COLOR = "#21262d"
ACCENT_GREEN = "#3fb950"
ACCENT_RED = "#f85149"


def load_inventory():
    return json.loads(INVENTORY_PATH.read_text())


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
    if not repo_path.exists():
        return 0
    count = 0
    for f in repo_path.rglob("*.md"):
        if f.name.lower() in ("readme.md", "license.md", "changelog.md", "contributing.md"):
            continue
        count += 1
    return count


def get_dir_size_mb(repo_path):
    if not repo_path.exists():
        return 0.0
    total = 0
    for f in repo_path.rglob("*"):
        if f.is_file() and ".git" not in f.parts:
            total += f.stat().st_size
    return round(total / (1024 * 1024), 1)


def fetch_repo_metadata(repos):
    """Batch-fetch stars, latest commit SHA, and recent commits for all repos via GraphQL.
    Returns dict keyed by dir: {"stars": int, "sha": str, "recent_commits": [...]}."""
    results = {}
    for chunk_start in range(0, len(repos), 20):
        chunk = repos[chunk_start:chunk_start + 20]
        query_parts = []
        for i, repo in enumerate(chunk):
            slug = repo["url"].replace("https://github.com/", "")
            owner, name = slug.split("/", 1)
            alias = f"r{chunk_start + i}"
            query_parts.append(
                f'{alias}: repository(owner: "{owner}", name: "{name}") {{'
                f'  stargazerCount'
                f'  defaultBranchRef {{ target {{ ... on Commit {{'
                f'    oid'
                f'    history(first: 10) {{ nodes {{ oid message committedDate author {{ name }} }} }}'
                f'  }} }} }}'
                f'}}'
            )
        query = "query { " + " ".join(query_parts) + " }"
        try:
            out = run(["gh", "api", "graphql", "-f", f"query={query}"])
            if out:
                data = json.loads(out).get("data", {})
                for i, repo in enumerate(chunk):
                    alias = f"r{chunk_start + i}"
                    node = data.get(alias)
                    if node:
                        sha = None
                        recent_commits = []
                        ref = node.get("defaultBranchRef")
                        if ref and ref.get("target"):
                            target = ref["target"]
                            sha = target.get("oid")
                            for c in target.get("history", {}).get("nodes", []):
                                recent_commits.append({
                                    "sha": c["oid"][:7],
                                    "message": c["message"].split("\n")[0][:120],
                                    "date": c["committedDate"][:10],
                                    "author": c.get("author", {}).get("name", "unknown"),
                                })
                        results[repo["dir"]] = {
                            "stars": node.get("stargazerCount", "?"),
                            "sha": sha,
                            "recent_commits": recent_commits,
                        }
        except Exception as e:
            print(f"  Warning: GraphQL batch failed: {e}")

    # Fetch contributor counts in parallel via REST (not available in GraphQL)
    def _get_contributor_count(repo):
        slug = repo["url"].replace("https://github.com/", "")
        try:
            out = subprocess.run(
                ["gh", "api", "--include", f"repos/{slug}/contributors?per_page=1&anon=true"],
                capture_output=True, text=True, timeout=15
            ).stdout
            # Parse Link header for last page: <...?page=45>; rel="last"
            for line in out.split("\n"):
                if line.lower().startswith("link:"):
                    match = regex.search(r'page=(\d+)>;\s*rel="last"', line)
                    if match:
                        return repo["dir"], int(match.group(1))
            # No Link header = single page, count the JSON body
            body_start = out.find("[")
            if body_start >= 0:
                body = json.loads(out[body_start:])
                return repo["dir"], len(body)
        except Exception:
            pass
        return repo["dir"], 0

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(_get_contributor_count, r) for r in repos]
        for f in as_completed(futures):
            dir_name, count = f.result()
            if dir_name in results:
                results[dir_name]["contributors"] = count
            else:
                results[dir_name] = {"stars": "?", "sha": None, "contributors": count}

    return results


def load_previous_stats():
    if STATS_PATH.exists():
        try:
            return json.loads(STATS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_stats(stats):
    STATS_PATH.write_text(json.dumps(stats, indent=2) + "\n")


def load_history():
    if HISTORY_PATH.exists():
        try:
            return json.loads(HISTORY_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return []


def save_history(history):
    HISTORY_PATH.write_text(json.dumps(history, indent=2) + "\n")


def update_history(repo_stars):
    """Append today's star counts to history (one entry per day max)."""
    history = load_history()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Replace today's entry if it already exists
    history = [h for h in history if h["date"] != today]
    history.append({"date": today, "stars": repo_stars})

    # Keep last 365 days
    history = history[-365:]
    save_history(history)
    return history


def format_diff(current, previous):
    if previous is None or previous == "?" or current == "?":
        return str(current)
    diff = current - previous
    if diff > 0:
        return f"{current} (+{diff})"
    elif diff < 0:
        return f"{current} ({diff})"
    return str(current)


def generate_stars_line_chart(history, repo_stars):
    """Line chart: stars over time for top 10 repos by current stars."""
    CHARTS_DIR.mkdir(exist_ok=True)

    # Get top 10 repos by current star count
    sorted_repos = sorted(repo_stars.items(), key=lambda x: x[1] if isinstance(x[1], int) else 0, reverse=True)[:10]
    top_names = [name for name, _ in sorted_repos]

    if len(history) < 2:
        # Not enough data points yet, create a placeholder with current values
        dates = [datetime.now(timezone.utc).strftime("%Y-%m-%d")]
        fig, ax = plt.subplots(figsize=(10, 5), facecolor=BG_COLOR)
        ax.set_facecolor(BG_COLOR)

        for i, name in enumerate(top_names):
            stars = repo_stars.get(name, 0)
            if isinstance(stars, int):
                color = PALETTE[i % len(PALETTE)]
                ax.bar(i, stars, color=color, label=name, width=0.6)

        ax.set_xticks(range(len(top_names)))
        ax.set_xticklabels(top_names, rotation=35, ha="right", fontsize=8, color=TEXT_COLOR)
        ax.set_ylabel("Stars", color=TEXT_COLOR, fontsize=11)
        ax.set_title("Stars — Top Repos (history builds over time)", color=TEXT_COLOR, fontsize=13, fontweight="bold", pad=15)
        ax.tick_params(colors=TEXT_COLOR)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["bottom"].set_color(GRID_COLOR)
        ax.spines["left"].set_color(GRID_COLOR)
        ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f"{int(x):,}"))
        ax.grid(axis="y", color=GRID_COLOR, linewidth=0.5)
        ax.legend(loc="upper left", fontsize=7, facecolor=BG_COLOR, edgecolor=GRID_COLOR, labelcolor=TEXT_COLOR)

        plt.tight_layout()
        plt.savefig(CHARTS_DIR / "stars-history.png", dpi=150, facecolor=BG_COLOR)
        plt.close()
        return

    # Multiple data points — draw line chart
    dates = [datetime.strptime(h["date"], "%Y-%m-%d") for h in history]

    fig, ax = plt.subplots(figsize=(10, 5), facecolor=BG_COLOR)
    ax.set_facecolor(BG_COLOR)

    for i, name in enumerate(top_names):
        values = []
        for h in history:
            val = h["stars"].get(name, 0)
            values.append(val if isinstance(val, int) else 0)
        color = PALETTE[i % len(PALETTE)]
        ax.plot(dates, values, color=color, label=name, linewidth=2, marker="o", markersize=4)

    ax.set_ylabel("Stars", color=TEXT_COLOR, fontsize=11)
    ax.set_title("Stars Over Time — Top 10 Repos", color=TEXT_COLOR, fontsize=13, fontweight="bold", pad=15)
    ax.tick_params(colors=TEXT_COLOR, labelsize=9)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["bottom"].set_color(GRID_COLOR)
    ax.spines["left"].set_color(GRID_COLOR)
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f"{int(x):,}"))
    ax.grid(color=GRID_COLOR, linewidth=0.5)
    ax.legend(loc="upper left", fontsize=8, facecolor=BG_COLOR, edgecolor=GRID_COLOR, labelcolor=TEXT_COLOR)
    fig.autofmt_xdate()

    plt.tight_layout()
    plt.savefig(CHARTS_DIR / "stars-history.png", dpi=150, facecolor=BG_COLOR)
    plt.close()


def generate_top_bottom_bar_chart(repo_stars):
    """Horizontal bar chart: top 5 and bottom 5 repos by stars."""
    CHARTS_DIR.mkdir(exist_ok=True)

    # Filter out non-int values
    valid = {k: v for k, v in repo_stars.items() if isinstance(v, int)}
    if not valid:
        return

    sorted_repos = sorted(valid.items(), key=lambda x: x[1], reverse=True)

    top5 = sorted_repos[:5]
    bottom5 = sorted_repos[-5:] if len(sorted_repos) > 5 else []

    # If we have <= 5 repos total, just show them all as one chart
    if not bottom5 or top5 == bottom5:
        sections = [("Top Repos by Stars", top5, ACCENT_GREEN)]
    else:
        # Remove overlap (if < 10 repos, top5 and bottom5 may share entries)
        bottom5_names = {name for name, _ in bottom5}
        top5_names = {name for name, _ in top5}
        bottom5 = [(n, s) for n, s in bottom5 if n not in top5_names]
        if not bottom5:
            sections = [("Top Repos by Stars", top5, ACCENT_GREEN)]
        else:
            sections = [
                ("Top 5 by Stars", top5, ACCENT_GREEN),
                ("Bottom 5 by Stars", bottom5, ACCENT_RED),
            ]

    fig, axes = plt.subplots(1, len(sections), figsize=(6 * len(sections), 4), facecolor=BG_COLOR)
    if len(sections) == 1:
        axes = [axes]

    for ax, (title, data, color) in zip(axes, sections):
        ax.set_facecolor(BG_COLOR)
        names = [d[0] for d in reversed(data)]
        values = [d[1] for d in reversed(data)]

        bars = ax.barh(names, values, color=color, height=0.6, alpha=0.85)

        for bar, val in zip(bars, values):
            ax.text(bar.get_width() + max(values) * 0.02, bar.get_y() + bar.get_height() / 2,
                    f"{val:,}", va="center", ha="left", color=TEXT_COLOR, fontsize=9)

        ax.set_title(title, color=TEXT_COLOR, fontsize=12, fontweight="bold", pad=12)
        ax.tick_params(colors=TEXT_COLOR, labelsize=9)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["bottom"].set_color(GRID_COLOR)
        ax.spines["left"].set_color(GRID_COLOR)
        ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f"{int(x):,}"))
        ax.grid(axis="x", color=GRID_COLOR, linewidth=0.5)

    plt.tight_layout()
    plt.savefig(CHARTS_DIR / "top-bottom-stars.png", dpi=150, facecolor=BG_COLOR)
    plt.close()


def generate_skills_bar_chart(repo_skills):
    """Horizontal bar chart: top 15 repos by number of skill files."""
    CHARTS_DIR.mkdir(exist_ok=True)

    valid = {k: v for k, v in repo_skills.items() if v > 0}
    if not valid:
        return

    sorted_repos = sorted(valid.items(), key=lambda x: x[1], reverse=True)[:15]

    fig, ax = plt.subplots(figsize=(10, 6), facecolor=BG_COLOR)
    ax.set_facecolor(BG_COLOR)

    names = [d[0] for d in reversed(sorted_repos)]
    values = [d[1] for d in reversed(sorted_repos)]

    bars = ax.barh(names, values, color=PALETTE[0], height=0.6, alpha=0.85)

    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + max(values) * 0.02, bar.get_y() + bar.get_height() / 2,
                str(val), va="center", ha="left", color=TEXT_COLOR, fontsize=9)

    ax.set_title("Top 15 Repos by Skill Files", color=TEXT_COLOR, fontsize=13, fontweight="bold", pad=15)
    ax.set_xlabel("Skill files", color=TEXT_COLOR, fontsize=11)
    ax.tick_params(colors=TEXT_COLOR, labelsize=8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["bottom"].set_color(GRID_COLOR)
    ax.spines["left"].set_color(GRID_COLOR)
    ax.grid(axis="x", color=GRID_COLOR, linewidth=0.5)

    plt.tight_layout()
    plt.savefig(CHARTS_DIR / "skills-count.png", dpi=150, facecolor=BG_COLOR)
    plt.close()


def generate_contributors_bar_chart(repo_contributors):
    """Horizontal bar chart: top 15 repos by number of contributors."""
    CHARTS_DIR.mkdir(exist_ok=True)

    valid = {k: v for k, v in repo_contributors.items() if v > 0}
    if not valid:
        return

    sorted_repos = sorted(valid.items(), key=lambda x: x[1], reverse=True)[:15]

    fig, ax = plt.subplots(figsize=(10, 6), facecolor=BG_COLOR)
    ax.set_facecolor(BG_COLOR)

    names = [d[0] for d in reversed(sorted_repos)]
    values = [d[1] for d in reversed(sorted_repos)]

    bars = ax.barh(names, values, color=PALETTE[4], height=0.6, alpha=0.85)

    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + max(values) * 0.02, bar.get_y() + bar.get_height() / 2,
                str(val), va="center", ha="left", color=TEXT_COLOR, fontsize=9)

    ax.set_title("Top 15 Repos by Contributors", color=TEXT_COLOR, fontsize=13, fontweight="bold", pad=15)
    ax.set_xlabel("Contributors", color=TEXT_COLOR, fontsize=11)
    ax.tick_params(colors=TEXT_COLOR, labelsize=8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["bottom"].set_color(GRID_COLOR)
    ax.spines["left"].set_color(GRID_COLOR)
    ax.grid(axis="x", color=GRID_COLOR, linewidth=0.5)

    plt.tight_layout()
    plt.savefig(CHARTS_DIR / "contributors.png", dpi=150, facecolor=BG_COLOR)
    plt.close()


def load_commits():
    if COMMITS_PATH.exists():
        try:
            return json.loads(COMMITS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_commits(commits):
    COMMITS_PATH.write_text(json.dumps(commits, indent=2) + "\n")


def sync_repos(repos, metadata):
    """Clone or pull only repos that have new commits."""
    SKILLS_DIR.mkdir(exist_ok=True)
    known_commits = load_commits()
    updated = 0
    skipped = 0

    for repo in repos:
        repo_path = SKILLS_DIR / repo["dir"]
        meta = metadata.get(repo["dir"], {})
        remote_sha = meta.get("sha")
        local_sha = known_commits.get(repo["dir"])
        is_new = not repo_path.exists() or not any(repo_path.iterdir())

        if not is_new and remote_sha and remote_sha == local_sha:
            skipped += 1
            continue

        if repo_path.exists() and (repo_path / ".git").exists():
            print(f"  Pulling {repo['dir']} (changed)...")
            run(["git", "pull", "--ff-only"], cwd=repo_path)
        else:
            if repo_path.exists():
                shutil.rmtree(repo_path)
            print(f"  Cloning {repo['dir']}...")
            run(["git", "clone", "--depth=1", repo["url"], str(repo_path)])

        if remote_sha:
            known_commits[repo["dir"]] = remote_sha
        updated += 1

    save_commits(known_commits)
    print(f"  Sync done: {updated} updated, {skipped} unchanged")


def generate_readme(repos, metadata, sync_duration="n/a"):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    previous = load_previous_stats()
    current_stats = {}
    repo_stars = {}
    repo_skills = {}
    repo_contributors = {}
    total_skills = 0
    total_size = 0.0
    rows = []

    for repo in repos:
        repo_path = SKILLS_DIR / repo["dir"]
        sha, commit_date, msg = get_latest_commit(repo_path)
        skills_count = count_skill_files(repo_path)
        meta = metadata.get(repo["dir"], {})
        stars = meta.get("stars", "?")
        contributors = meta.get("contributors", 0)
        size_mb = get_dir_size_mb(repo_path)
        total_skills += skills_count
        total_size += size_mb

        prev = previous.get(repo["dir"], {})
        skills_display = format_diff(skills_count, prev.get("skills"))
        stars_display = format_diff(stars, prev.get("stars"))

        current_stats[repo["dir"]] = {"skills": skills_count, "stars": stars}
        repo_stars[repo["dir"]] = stars
        repo_skills[repo["dir"]] = skills_count
        repo_contributors[repo["dir"]] = contributors

        last_commit_date = "n/a"
        if commit_date and commit_date != "n/a":
            try:
                dt = datetime.fromisoformat(commit_date)
                last_commit_date = dt.strftime("%Y-%m-%d")
            except ValueError:
                last_commit_date = commit_date

        rows.append(
            f"| [{repo['dir']}]({repo['url']}) | {repo['description']} "
            f"| {skills_display} | {stars_display} | {contributors} | {size_mb} MB "
            f"| `{sha}` | {last_commit_date} | {msg} |"
        )

    save_stats(current_stats)

    # Update history and generate charts
    print("  Generating charts...")
    history = update_history(repo_stars)
    generate_stars_line_chart(history, repo_stars)
    generate_top_bottom_bar_chart(repo_stars)
    generate_skills_bar_chart(repo_skills)
    generate_contributors_bar_chart(repo_contributors)

    table = "\n".join(rows)

    prev_total = sum(r.get("skills", 0) for r in previous.values())
    total_display = format_diff(total_skills, prev_total if previous else None)
    total_size = round(total_size, 1)

    readme = f"""\
# Skills Collection

[![Sync Skills](https://github.com/thereisnotime/skills-collection/actions/workflows/sync-skills.yml/badge.svg)](https://github.com/thereisnotime/skills-collection/actions/workflows/sync-skills.yml)
[![Add Skill Repo](https://github.com/thereisnotime/skills-collection/actions/workflows/add-repo.yml/badge.svg)](https://github.com/thereisnotime/skills-collection/actions/workflows/add-repo.yml)
[![Remove Skill Repo](https://github.com/thereisnotime/skills-collection/actions/workflows/remove-repo.yml/badge.svg)](https://github.com/thereisnotime/skills-collection/actions/workflows/remove-repo.yml)

A curated collection of Claude Code skills repos, automatically synced daily.

## Stats

| Metric | Value |
|--------|-------|
| **Total repos** | {len(repos)} |
| **Total skill files** | {total_display} |
| **Total size** | {total_size} MB |
| **Last synced** | {now} |
| **Sync time** | {sync_duration} |

## Charts

### Stars Over Time

![Stars Over Time](charts/stars-history.png)

### Top Repos by Skill Files

![Skills Count](charts/skills-count.png)

### Top Repos by Contributors

![Contributors](charts/contributors.png)

### Top & Bottom Repos by Stars

![Top & Bottom Repos](charts/top-bottom-stars.png)

## Repos

| Repo | Description | Skills | Stars | Contributors | Size | Last Commit | Last Commit Date | Message |
|------|-------------|--------|-------|--------------|------|-------------|------------------|---------|
{table}

## How it works

A GitHub Actions workflow runs every 2 days to:

1. Clone or pull all skill repos into `skills/`
2. Run `generate_readme.py` to regenerate this README with fresh stats and charts
3. Commit and push any changes

---

*Auto-generated by `generate_readme.py` on {now}*
"""

    README_PATH.write_text(readme)
    print(f"  README.md generated ({total_skills} skill files across {len(repos)} repos)")


def cleanup_stale_dirs(repos):
    """Remove skill dirs that are no longer in the inventory."""
    if not SKILLS_DIR.exists():
        return
    inventory_dirs = {repo["dir"] for repo in repos}
    for child in SKILLS_DIR.iterdir():
        if child.is_dir() and child.name not in inventory_dirs:
            shutil.rmtree(child)
            print(f"  Cleaned up stale dir: {child.name}")


def strip_nested_git(repos):
    for repo in repos:
        git_dir = SKILLS_DIR / repo["dir"] / ".git"
        if git_dir.exists():
            shutil.rmtree(git_dir)
            print(f"  Stripped .git from {repo['dir']}")


if __name__ == "__main__":
    repos = load_inventory()
    cleanup_stale_dirs(repos)

    print("  Fetching metadata from GitHub API...")
    api_start = time.monotonic()
    metadata = fetch_repo_metadata(repos)
    api_elapsed = time.monotonic() - api_start
    print(f"  Metadata fetched for {len(metadata)}/{len(repos)} repos in {api_elapsed:.1f}s")

    # Save repo-commits.json for the site
    repo_commits = {d: m.get("recent_commits", []) for d, m in metadata.items()}
    REPO_COMMITS_PATH.write_text(json.dumps(repo_commits, indent=2) + "\n")
    print(f"  Saved repo-commits.json ({len(repo_commits)} repos)")

    start = time.monotonic()
    sync_repos(repos, metadata)
    elapsed = time.monotonic() - start
    minutes, seconds = divmod(int(elapsed), 60)
    sync_duration = f"{minutes}m {seconds}s" if minutes else f"{seconds}s"
    generate_readme(repos, metadata, sync_duration)
    strip_nested_git(repos)
