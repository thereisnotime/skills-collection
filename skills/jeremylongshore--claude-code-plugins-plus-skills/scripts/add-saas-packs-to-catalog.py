#!/usr/bin/env python3
"""
Add missing SaaS pack plugins to marketplace.extended.json.

Reads each pack's plugin.json, checks for duplicates against the catalog,
and inserts new entries sorted alphabetically by name among saas-pack entries.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path("/home/jeremy/000-projects/claude-code-plugins")
CATALOG_PATH = REPO_ROOT / ".claude-plugin" / "marketplace.extended.json"
SAAS_PACKS_DIR = REPO_ROOT / "plugins" / "saas-packs"

# ---------------------------------------------------------------------------
# Category mapping: best-effort based on vendor domain
# (mirrors what existing catalog entries use)
# ---------------------------------------------------------------------------

CATEGORY_MAP: dict[str, str] = {
    # ai-ml
    "abridge-pack": "ai-ml",
    "adobe-pack": "ai-ml",
    "alchemy-pack": "ai-ml",
    "anima-pack": "ai-ml",
    "anthropic-pack": "ai-ml",
    "apify-pack": "ai-ml",
    "assemblyai-pack": "ai-ml",
    "brightdata-pack": "ai-ml",
    "canva-pack": "ai-ml",
    "castai-pack": "ai-ml",
    "cohere-pack": "ai-ml",
    "coreweave-pack": "ai-ml",
    "cursor-pack": "ai-ml",
    "deepgram-pack": "ai-ml",
    "elevenlabs-pack": "ai-ml",
    "exa-pack": "ai-ml",
    "firecrawl-pack": "ai-ml",
    "framer-pack": "ai-ml",
    "gamma-pack": "ai-ml",
    "glean-pack": "ai-ml",
    "grammarly-pack": "ai-ml",
    "groq-pack": "ai-ml",
    "ideogram-pack": "ai-ml",
    "klingai-pack": "ai-ml",
    "langchain-pack": "ai-ml",
    "langfuse-pack": "ai-ml",
    "lindy-pack": "ai-ml",
    "mistral-pack": "ai-ml",
    "openrouter-pack": "ai-ml",
    "perplexity-pack": "ai-ml",
    "quicknode-pack": "ai-ml",
    "retellai-pack": "ai-ml",
    "runway-pack": "ai-ml",
    "serpapi-pack": "ai-ml",
    "speak-pack": "ai-ml",
    "stackblitz-pack": "ai-ml",
    "techsmith-pack": "ai-ml",
    "together-pack": "ai-ml",
    "twinmind-pack": "ai-ml",
    "vastai-pack": "ai-ml",
    "wispr-pack": "ai-ml",
    # business-tools
    "apollo-pack": "business-tools",
    "attio-pack": "business-tools",
    "bamboohr-pack": "business-tools",
    "clari-pack": "business-tools",
    "clay-pack": "business-tools",
    "clickup-pack": "business-tools",
    "customerio-pack": "business-tools",
    "fireflies-pack": "business-tools",
    "flexport-pack": "business-tools",
    "fondo-pack": "business-tools",
    "granola-pack": "business-tools",
    "hootsuite-pack": "business-tools",
    "hubspot-pack": "business-tools",
    "instantly-pack": "business-tools",
    "intercom-pack": "business-tools",
    "juicebox-pack": "business-tools",
    "klaviyo-pack": "business-tools",
    "linktree-pack": "business-tools",
    "lucidchart-pack": "business-tools",
    "maintainx-pack": "business-tools",
    "mindtickle-pack": "business-tools",
    "miro-pack": "business-tools",
    "navan-pack": "business-tools",
    "openevidence-pack": "business-tools",
    "persona-pack": "business-tools",
    "podium-pack": "business-tools",
    "procore-pack": "business-tools",
    "ramp-pack": "business-tools",
    "remofirst-pack": "business-tools",
    "salesforce-pack": "business-tools",
    "salesloft-pack": "business-tools",
    "shopify-pack": "business-tools",
    "veeva-pack": "business-tools",
    "webflow-pack": "business-tools",
    "workhuman-pack": "business-tools",
    # database
    "clickhouse-pack": "database",
    "databricks-pack": "database",
    "snowflake-pack": "database",
    "supabase-pack": "database",
    # devops
    "coderabbit-pack": "devops",
    "flyio-pack": "devops",
    "oraclecloud-pack": "devops",
    "posthog-pack": "devops",
    "replit-pack": "devops",
    "sentry-pack": "devops",
    "vercel-pack": "devops",
    "windsurf-pack": "devops",
    # productivity
    "appfolio-pack": "productivity",
    "apple-notes-pack": "productivity",
    "documenso-pack": "productivity",
    "evernote-pack": "productivity",
    "fathom-pack": "productivity",
    "figma-pack": "productivity",
    "finta-pack": "productivity",
    "guidewire-pack": "productivity",
    "hex-pack": "productivity",
    "lokalise-pack": "productivity",
    "notion-pack": "productivity",
    "obsidian-pack": "productivity",
    "onenote-pack": "productivity",
    "palantir-pack": "productivity",
    "replit-pack": "devops",
}

# Default fallback
DEFAULT_CATEGORY = "business-tools"


def deduplicate_keywords(keywords: list[str]) -> list[str]:
    """Remove duplicates while preserving order."""
    seen: set[str] = set()
    result: list[str] = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            result.append(kw)
    return result


def count_skills(pack_dir: Path) -> int:
    """Count skill subdirectories under skills/."""
    skills_dir = pack_dir / "skills"
    if not skills_dir.exists():
        return 0
    return sum(1 for d in skills_dir.iterdir() if d.is_dir())


def extract_skill_count_from_description(description: str) -> int:
    """Extract skill count from descriptions like 'skill pack for X (18 skills)'."""
    m = re.search(r"\((\d+) skills?\)", description)
    return int(m.group(1)) if m else 0


def build_entry(pack_name: str, plugin_json: dict, pack_dir: Path) -> dict:
    """Construct a catalog entry from plugin.json data."""
    version = plugin_json.get("version", "1.0.0")
    description = plugin_json.get("description", f"Claude Code skill pack for {pack_name}")
    raw_keywords: list[str] = plugin_json.get("keywords", [])
    keywords = deduplicate_keywords(raw_keywords)

    # Determine skill count: prefer filesystem count, fall back to description
    fs_count = count_skills(pack_dir)
    desc_count = extract_skill_count_from_description(description)
    skill_count = fs_count if fs_count > 0 else desc_count

    category = CATEGORY_MAP.get(pack_name, DEFAULT_CATEGORY)

    entry: dict = {
        "name": pack_name,
        "source": f"./plugins/saas-packs/{pack_name}",
        "description": description,
        "version": version,
        "category": category,
        "keywords": keywords,
        "author": {
            "name": "Jeremy Longshore",
            "email": "jeremy@intentsolutions.io",
            "url": "https://github.com/jeremylongshore",
        },
    }

    if skill_count > 0:
        entry["components"] = {"skills": skill_count}

    entry["verification"] = {
        "score": 79,
        "grade": "C",
        "badge": "silver",
        "lastValidated": "2026-03-21T00:00:00.000Z",
    }

    return entry


def main() -> int:
    catalog_text = CATALOG_PATH.read_text(encoding="utf-8")
    catalog: dict = json.loads(catalog_text)

    plugins: list[dict] = catalog["plugins"]

    # Collect existing names for duplicate detection
    existing_names: set[str] = {p["name"] for p in plugins}

    # Collect existing saas-pack entry names (for sorting reference)
    existing_saas_names: set[str] = {
        p["name"]
        for p in plugins
        if "saas-packs" in p.get("source", "")
    }

    # Find the index range of existing saas-pack entries
    saas_indices = [
        i for i, p in enumerate(plugins)
        if "saas-packs" in p.get("source", "")
    ]
    if not saas_indices:
        print("ERROR: No existing saas-pack entries found to use as anchor.", file=sys.stderr)
        return 1

    last_saas_idx = max(saas_indices)
    insertion_point = last_saas_idx + 1  # insert after the last saas entry

    # Discover all pack directories
    pack_dirs = sorted(
        d for d in SAAS_PACKS_DIR.iterdir()
        if d.is_dir() and d.name.endswith("-pack")
    )

    new_entries: list[dict] = []
    skipped: list[str] = []
    missing_json: list[str] = []

    for pack_dir in pack_dirs:
        pack_name = pack_dir.name
        plugin_json_path = pack_dir / ".claude-plugin" / "plugin.json"

        if not plugin_json_path.exists():
            missing_json.append(pack_name)
            continue

        if pack_name in existing_names:
            skipped.append(pack_name)
            continue

        plugin_json = json.loads(plugin_json_path.read_text(encoding="utf-8"))
        entry = build_entry(pack_name, plugin_json, pack_dir)
        new_entries.append(entry)

    if not new_entries:
        print("No new entries to add — all packs are already in the catalog.")
        print(f"Skipped (already present): {len(skipped)}")
        return 0

    # Sort new entries alphabetically by name
    new_entries.sort(key=lambda e: e["name"])

    # Insert at position (after last existing saas entry)
    for i, entry in enumerate(new_entries):
        plugins.insert(insertion_point + i, entry)

    # Write back with 2-space indent to match existing format
    updated_text = json.dumps(catalog, indent=2, ensure_ascii=False) + "\n"
    CATALOG_PATH.write_text(updated_text, encoding="utf-8")

    # Report
    print(f"Added {len(new_entries)} new saas-pack entries:")
    for e in new_entries:
        skill_info = ""
        if "components" in e:
            skill_info = f" ({e['components']['skills']} skills)"
        print(f"  + {e['name']}{skill_info} [{e['category']}]")

    if skipped:
        print(f"\nSkipped {len(skipped)} already-present packs:")
        for s in skipped:
            print(f"  = {s}")

    if missing_json:
        print(f"\nWARNING: {len(missing_json)} packs missing plugin.json:")
        for m in missing_json:
            print(f"  ! {m}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
