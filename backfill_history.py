#!/usr/bin/env python3
"""Backfill history.json with ~12 months of star history (1 data point per month).

Uses GitHub's stargazers API with timestamps to reconstruct monthly star
counts. For large repos, samples pages to estimate counts at target dates.

Usage: python3 backfill_history.py
"""

import subprocess
import json
import time
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path

HISTORY_PATH = Path(__file__).parent / "history.json"
INVENTORY_PATH = Path(__file__).parent / "inventory.json"
MONTHS_BACK = 12


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return result.stdout.strip()


def get_first_date_on_page(slug, page, per_page=100):
    """Get the first stargazer date on a given page."""
    try:
        out = run([
            "gh", "api", f"repos/{slug}/stargazers?per_page={per_page}&page={page}",
            "-H", "Accept: application/vnd.github.star+json",
            "--jq", ".[0].starred_at"
        ])
        return out.strip() if out else None
    except Exception:
        return None


def binary_search_page_for_date(slug, target_date, total_pages, per_page=100):
    """Binary search to find which page contains stars from around target_date.
    Returns the cumulative star count at that date."""
    lo, hi = 1, total_pages

    while lo < hi:
        mid = (lo + hi) // 2
        date = get_first_date_on_page(slug, mid, per_page)
        time.sleep(0.05)
        if not date:
            hi = mid
            continue
        if date[:10] < target_date:
            lo = mid + 1
        else:
            hi = mid

    # Star count at this page = (lo - 1) * per_page
    return (lo - 1) * per_page


def get_monthly_star_counts(slug, current_stars):
    """Get star counts at monthly intervals for the last MONTHS_BACK months.
    Returns dict of {date_str: star_count}."""
    if not current_stars or current_stars == "?" or current_stars == 0:
        return {}

    per_page = 100
    total_pages = math.ceil(current_stars / per_page)
    today = datetime.now(timezone.utc)
    timeline = {today.strftime("%Y-%m-%d"): current_stars}

    if total_pages <= 2:
        # Tiny repo — just use current count for all months
        return timeline

    # Generate target dates (1st of each month going back)
    target_dates = []
    for months_ago in range(1, MONTHS_BACK + 1):
        year = today.year
        month = today.month - months_ago
        while month <= 0:
            month += 12
            year -= 1
        target_dates.append(f"{year:04d}-{month:02d}-01")

    # Binary search for star count at each target date
    for target_date in target_dates:
        count = binary_search_page_for_date(slug, target_date, total_pages, per_page)
        if count > 0:
            timeline[target_date] = count
        time.sleep(0.05)

    return timeline


def backfill():
    inventory = json.loads(INVENTORY_PATH.read_text())

    # Load existing history
    if HISTORY_PATH.exists():
        history = json.loads(HISTORY_PATH.read_text())
    else:
        history = []

    existing_dates = {h["date"] for h in history}

    # Get current star counts via GraphQL
    print("Fetching current star counts...")
    star_counts = {}
    for chunk_start in range(0, len(inventory), 50):
        chunk = inventory[chunk_start:chunk_start + 50]
        query_parts = []
        for i, repo in enumerate(chunk):
            slug = repo["url"].replace("https://github.com/", "")
            owner, name = slug.split("/", 1)
            alias = f"r{chunk_start + i}"
            query_parts.append(f'{alias}: repository(owner: "{owner}", name: "{name}") {{ stargazerCount }}')
        query = "query { " + " ".join(query_parts) + " }"
        out = run(["gh", "api", "graphql", "-f", f"query={query}"])
        if out:
            data = json.loads(out).get("data", {})
            for i, repo in enumerate(chunk):
                alias = f"r{chunk_start + i}"
                node = data.get(alias)
                if node:
                    star_counts[repo["dir"]] = node.get("stargazerCount", 0)

    print(f"Got star counts for {len(star_counts)} repos\n")

    # Backfill each repo
    all_timelines = {}
    for repo in inventory:
        slug = repo["url"].replace("https://github.com/", "")
        stars = star_counts.get(repo["dir"], 0)
        if stars == 0:
            continue
        print(f"  {repo['dir']} ({stars:,} stars)...")
        timeline = get_monthly_star_counts(slug, stars)
        if timeline:
            all_timelines[repo["dir"]] = timeline

    # Build monthly history entries
    today = datetime.now(timezone.utc)
    target_dates = [today.strftime("%Y-%m-%d")]
    for months_ago in range(1, MONTHS_BACK + 1):
        year = today.year
        month = today.month - months_ago
        while month <= 0:
            month += 12
            year -= 1
        target_dates.append(f"{year:04d}-{month:02d}-01")

    target_dates.sort()
    new_entries = []

    for date in target_dates:
        if date in existing_dates:
            continue

        stars_on_date = {}
        for repo_dir, timeline in all_timelines.items():
            # Find closest date <= target
            closest_val = None
            for d in sorted(timeline.keys()):
                if d <= date:
                    closest_val = timeline[d]
                else:
                    break
            if closest_val is not None:
                stars_on_date[repo_dir] = closest_val

        if stars_on_date:
            new_entries.append({"date": date, "stars": stars_on_date})

    # Merge with existing
    history.extend(new_entries)
    history.sort(key=lambda h: h["date"])

    # Deduplicate
    seen = {}
    for h in history:
        seen[h["date"]] = h
    history = [seen[d] for d in sorted(seen.keys())]

    HISTORY_PATH.write_text(json.dumps(history, indent=2) + "\n")
    print(f"\nHistory: {len(history)} entries from {history[0]['date']} to {history[-1]['date']}")


if __name__ == "__main__":
    backfill()
