#!/usr/bin/env python3
"""
migrate-add-fields.py — Add missing `tags` and `compatible-with` to SKILL.md files.

Surgically inserts only the absent fields into raw frontmatter text, preserving
every other byte of the file (including multiline description: | blocks).

Usage:
    python3 scripts/migrate-add-fields.py [--dry-run] [path]

    path       Optional: directory or single SKILL.md file to target.
               Defaults to plugins/ under the repo root.
    --dry-run  Preview changes without writing.

Author: Jeremy Longshore <jeremy@intentsolutions.io>
"""

import argparse
import re
import sys
from pathlib import Path
from typing import Optional

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml required. Install: pip install pyyaml", file=sys.stderr)
    sys.exit(1)


# === CONSTANTS ===

RE_FRONTMATTER = re.compile(r"^(---\s*\n)(.*?)(\n---)([ \t]*\n?)(.*)", re.DOTALL)

EXCLUDED_DIRS = {
    "archive", "backups", "backup", ".git", "node_modules",
    "__pycache__", ".venv", "010-archive", "000-docs", "002-workspaces",
}

# Map category directory name → primary category tag
CATEGORY_TAGS: dict[str, str] = {
    "ai-agency": "ai-agent",
    "ai-ml": "ai",
    "api-development": "api",
    "automation": "automation",
    "business-tools": "business",
    "community": "community",
    "crypto": "crypto",
    "database": "database",
    "design": "design",
    "devops": "devops",
    "examples": "example",
    "finance": "finance",
    "jeremy-google-adk": "google-adk",
    "jeremy-vertex-ai": "vertex-ai",
    "mcp": "mcp",
    "packages": "packages",
    "performance": "performance",
    "productivity": "productivity",
    "saas-packs": "saas",
    "security": "security",
    "skill-enhancers": "skill-development",
    "testing": "testing",
}

# Map description keywords → tags.  Keys are lowercased substrings to search.
KEYWORD_TAGS: dict[str, str] = {
    "deploy": "deployment",
    "docker": "docker",
    "kubernetes": "kubernetes",
    "terraform": "terraform",
    " aws ": "aws",
    "amazon web": "aws",
    " gcp ": "gcp",
    "google cloud": "gcp",
    " azure ": "azure",
    " api ": "api",
    "rest api": "api",
    "graphql": "graphql",
    "database": "database",
    "postgres": "postgresql",
    "mysql": "mysql",
    "mongodb": "mongodb",
    "redis": "redis",
    " test": "testing",
    "security": "security",
    "monitor": "monitoring",
    "observ": "observability",
    "ci/cd": "ci-cd",
    "github actions": "ci-cd",
    " git ": "git",
    "react": "react",
    "python": "python",
    "typescript": "typescript",
    " node": "nodejs",
    " rust ": "rust",
    " golang": "golang",
    " go ": "golang",
    "machine learning": "ml",
    " ml ": "ml",
    " nlp ": "nlp",
    " llm ": "llm",
    "large language": "llm",
    "debug": "debugging",
    "performance": "performance",
    "migrat": "migration",
    " auth": "authentication",
    "webhook": "webhooks",
    "scal": "scaling",
    "lambda": "serverless",
    "serverless": "serverless",
    "microservice": "microservices",
    "voice": "voice-ai",
    "speech": "voice-ai",
    "transcri": "transcription",
    "embeddings": "embeddings",
    "vector": "vector-db",
    "workflow": "workflow",
    "data pipeline": "data-pipeline",
    "etl": "etl",
    "analytics": "analytics",
    "dashboard": "dashboard",
    "logging": "logging",
    "tracing": "tracing",
    "incident": "incident-response",
    "backup": "backup",
    "disaster recovery": "disaster-recovery",
    "compliance": "compliance",
    "audit": "audit",
    "cost": "cost-optimization",
    "rbac": "rbac",
    "iam": "iam",
}

# Known SaaS company names extracted from pack directory names.
# Maps pack-name suffix (without "-pack") → tag to emit.
SAAS_COMPANY_TAGS: dict[str, str] = {
    "apollo": "apollo",
    "clay": "clay",
    "clerk": "clerk",
    "coderabbit": "coderabbit",
    "cursor": "cursor",
    "customerio": "customer-io",
    "databricks": "databricks",
    "deepgram": "deepgram",
    "documenso": "documenso",
    "evernote": "evernote",
    "exa": "exa",
    "firecrawl": "firecrawl",
    "fireflies": "fireflies",
    "gamma": "gamma",
    "granola": "granola",
    "groq": "groq",
    "guidewire": "guidewire",
    "ideogram": "ideogram",
    "instantly": "instantly",
    "juicebox": "juicebox",
    "klingai": "kling-ai",
    "langchain": "langchain",
    "langfuse": "langfuse",
    "lindy": "lindy",
    "linear": "linear",
    "lokalise": "lokalise",
    "maintainx": "maintainx",
    "mistral": "mistral",
    "obsidian": "obsidian",
    "openevidence": "open-evidence",
    "openrouter": "openrouter",
    "perplexity": "perplexity",
    "posthog": "posthog",
    "replit": "replit",
    "retellai": "retellai",
    "sentry": "sentry",
    "speak": "speak",
    "supabase": "supabase",
    "twinmind": "twinmind",
    "vastai": "vast-ai",
    "vercel": "vercel",
    "windsurf": "windsurf",
}

DEFAULT_COMPATIBLE_WITH = "claude-code"


# === FILE DISCOVERY ===

def find_skill_files(root: Path) -> list[Path]:
    """Find all SKILL.md files, mirroring the validator's find_skill_files() logic."""
    results: list[Path] = []

    def _collect(search_root: Path, pattern: str) -> None:
        for p in search_root.rglob(pattern):
            if not p.is_file():
                continue
            parts = p.relative_to(root).parts
            if any(part in EXCLUDED_DIRS for part in parts):
                continue
            if any(part.startswith("skills-backup-") for part in parts):
                continue
            results.append(p)

    plugins_dir = root / "plugins"
    if plugins_dir.exists():
        _collect(plugins_dir, "skills/*/SKILL.md")

    skills_dir = root / "skills"
    if skills_dir.exists():
        _collect(skills_dir, "*/SKILL.md")

    nixtla_skills = root / "003-skills"
    if nixtla_skills.exists():
        _collect(nixtla_skills, "*/SKILL.md")

    return sorted(results)


def resolve_targets(target_path: Optional[Path], repo_root: Path) -> list[Path]:
    """Return the list of SKILL.md files to process for the given target."""
    if target_path is None:
        return find_skill_files(repo_root)

    if target_path.is_file() and target_path.name == "SKILL.md":
        return [target_path]

    # It's a directory: collect skills under it, applying the same exclusions
    results: list[Path] = []
    for p in sorted(target_path.rglob("**/SKILL.md")):
        if not p.is_file():
            continue
        parts = p.parts
        if any(part in EXCLUDED_DIRS for part in parts):
            continue
        if any(part.startswith("skills-backup-") for part in parts):
            continue
        results.append(p)
    return results


# === TAG INFERENCE ===

def _dedupe_ordered(seq: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in seq:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def infer_tags(skill_path: Path, frontmatter: dict) -> list[str]:
    """
    Infer 2-5 tags from directory structure, skill name, and description.

    Priority:
    1. Category tag from top-level category directory
    2. SaaS company tag (if inside saas-packs/)
    3. Keyword tags from description (up to 3 meaningful ones)
    4. Skill-name derived tag (last resort / enrichment)

    Returns a deduplicated list of lowercase kebab-case tags, capped at 5.
    """
    tags: list[str] = []
    parts = skill_path.parts

    # --- 1. Top-level plugin category ---
    # Path shape: .../plugins/<category>/[<pack>/]<plugin>/skills/<skill>/SKILL.md
    try:
        plugins_idx = [i for i, p in enumerate(parts) if p == "plugins"][-1]
        category = parts[plugins_idx + 1]  # e.g. "ai-ml", "saas-packs"
        category_tag = CATEGORY_TAGS.get(category, category)
        tags.append(category_tag)
    except (ValueError, IndexError):
        category = ""
        category_tag = ""

    # --- 2. SaaS company tag ---
    if category == "saas-packs":
        # Path: .../saas-packs/<company>-pack/<plugin>/skills/<skill>/SKILL.md
        try:
            pack_dir = parts[plugins_idx + 2]  # e.g. "retellai-pack"
            company_key = pack_dir.removesuffix("-pack")
            company_tag = SAAS_COMPANY_TAGS.get(company_key, company_key)
            tags.append(company_tag)
        except IndexError:
            pass  # No company directory in path — skip SaaS tag

    # --- 3. Description keyword tags ---
    description = str(frontmatter.get("description", "")).lower()
    skill_name = str(frontmatter.get("name", "")).lower()

    keyword_hits: list[str] = []
    for keyword, tag in KEYWORD_TAGS.items():
        if keyword in description and tag not in tags:
            keyword_hits.append(tag)
    # Limit keyword-derived tags so total stays ≤ 5
    tags.extend(keyword_hits[:3])

    # --- 4. Skill-name enrichment (if still under 3 tags) ---
    if len(_dedupe_ordered(tags)) < 3 and skill_name:
        # Remove common stop words and split on hyphens
        stop_words = {
            "a", "an", "the", "and", "or", "for", "of", "in", "to",
            "with", "using", "via", "skill", "creating", "building",
            "implementing", "configuring", "managing", "generating",
            "running", "setting", "up", "your",
        }
        parts_of_name = [w for w in skill_name.replace("-", " ").split() if w not in stop_words]
        if parts_of_name:
            # Use the first meaningful word compound as an enrichment tag
            enrichment = "-".join(parts_of_name[:2])
            if enrichment not in tags and enrichment != category_tag:
                tags.append(enrichment)

    result = _dedupe_ordered(tags)
    return result[:5]


# === FRONTMATTER MANIPULATION ===

def parse_frontmatter_raw(content: str) -> tuple[str, str, str, str, str]:
    """
    Split file into 5 parts: open_fence, yaml_block, close_fence, trailing_ws, body.

    Returns (open_fence, yaml_block, close_fence, trailing_ws, body) or raises ValueError.
    """
    m = RE_FRONTMATTER.match(content)
    if not m:
        raise ValueError("No valid frontmatter delimiters found")
    return m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)


def has_field(raw_yaml: str, field_name: str) -> bool:
    """Check whether a top-level YAML key exists in the raw frontmatter string."""
    # Match key at start of line (handles both quoted and unquoted keys)
    pattern = re.compile(r"^" + re.escape(field_name) + r"\s*:", re.MULTILINE)
    return bool(pattern.search(raw_yaml))


def add_fields_to_frontmatter(raw_yaml: str, fields_to_add: dict) -> str:
    """
    Insert missing fields into raw YAML text without reformatting anything.

    Appends new fields at the end of the YAML block (before the closing ---).
    Lists are serialised as inline YAML flow sequences: [a, b, c].
    Strings are written as bare scalars.
    """
    lines = raw_yaml.rstrip("\n").split("\n")
    new_lines: list[str] = []
    for key, value in fields_to_add.items():
        if isinstance(value, list):
            new_lines.append(f"{key}: [{', '.join(str(v) for v in value)}]")
        else:
            new_lines.append(f"{key}: {value}")
    return "\n".join(lines + new_lines)


def build_updated_content(
    open_fence: str,
    updated_yaml: str,
    close_fence: str,
    trailing_ws: str,
    body: str,
) -> str:
    """Reassemble the file from its five parts."""
    # Ensure there is exactly one newline before the closing ---
    return f"{open_fence}{updated_yaml}\n{close_fence}{trailing_ws}{body}"


# === MAIN PROCESSING ===

def process_file(
    skill_path: Path,
    dry_run: bool,
    repo_root: Path,
) -> tuple[str, list[str]]:
    """
    Process a single SKILL.md file.

    Returns:
        status: "updated" | "compliant" | "error"
        changes: list of human-readable change descriptions
    """
    try:
        content = skill_path.read_text(encoding="utf-8")
    except OSError as exc:
        return "error", [f"Cannot read: {exc}"]

    try:
        open_fence, raw_yaml, close_fence, trailing_ws, body = parse_frontmatter_raw(content)
    except ValueError as exc:
        return "error", [str(exc)]

    try:
        frontmatter = yaml.safe_load(raw_yaml) or {}
    except yaml.YAMLError as exc:
        return "error", [f"YAML parse error: {exc}"]

    if not isinstance(frontmatter, dict):
        return "error", ["Frontmatter is not a YAML mapping"]

    fields_to_add: dict = {}
    changes: list[str] = []

    # --- compatible-with ---
    if not has_field(raw_yaml, "compatible-with"):
        fields_to_add["compatible-with"] = DEFAULT_COMPATIBLE_WITH
        changes.append(f"  + compatible-with: {DEFAULT_COMPATIBLE_WITH}")

    # --- tags ---
    if not has_field(raw_yaml, "tags"):
        tags = infer_tags(skill_path, frontmatter)
        fields_to_add["tags"] = tags
        changes.append(f"  + tags: [{', '.join(tags)}]")

    if not fields_to_add:
        return "compliant", []

    updated_yaml = add_fields_to_frontmatter(raw_yaml, fields_to_add)
    updated_content = build_updated_content(
        open_fence, updated_yaml, close_fence, trailing_ws, body
    )

    # Sanity check: body must be preserved byte-for-byte
    if updated_content[updated_content.index(close_fence) + len(close_fence) + len(trailing_ws):] != body:
        return "error", ["Body preservation check failed — skipping"]

    if not dry_run:
        try:
            skill_path.write_text(updated_content, encoding="utf-8")
        except OSError as exc:
            return "error", [f"Cannot write: {exc}"]

    return "updated", changes


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Add missing tags and compatible-with to SKILL.md files."
    )
    parser.add_argument(
        "path",
        nargs="?",
        help="Directory or single SKILL.md to process (default: plugins/ under repo root)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing files",
    )
    args = parser.parse_args()

    # Repo root = parent of scripts/
    repo_root = Path(__file__).resolve().parent.parent

    target_path: Optional[Path] = None
    if args.path:
        target_path = Path(args.path).resolve()
        if not target_path.exists():
            print(f"ERROR: path does not exist: {target_path}", file=sys.stderr)
            return 1

    skill_files = resolve_targets(target_path, repo_root)

    if not skill_files:
        print("No SKILL.md files found.")
        return 0

    if args.dry_run:
        print(f"DRY RUN — {len(skill_files)} file(s) to inspect\n")
    else:
        print(f"Processing {len(skill_files)} SKILL.md file(s)...\n")

    updated = 0
    compliant = 0
    errors = 0

    for skill_path in skill_files:
        status, changes = process_file(skill_path, args.dry_run, repo_root)

        if status == "updated":
            rel = skill_path.relative_to(repo_root) if repo_root in skill_path.parents else skill_path
            verb = "Would update" if args.dry_run else "Updated"
            print(f"{verb}: {rel}")
            for change in changes:
                print(change)
            updated += 1

        elif status == "error":
            rel = skill_path.relative_to(repo_root) if repo_root in skill_path.parents else skill_path
            print(f"ERROR: {rel}", file=sys.stderr)
            for msg in changes:
                print(f"  {msg}", file=sys.stderr)
            errors += 1

        else:
            compliant += 1

    print()
    print("=" * 60)
    if args.dry_run:
        print(f"DRY RUN complete ({len(skill_files)} files inspected)")
        print(f"  Would update : {updated}")
    else:
        print(f"Migration complete ({len(skill_files)} files processed)")
        print(f"  Updated      : {updated}")
    print(f"  Already compliant: {compliant}")
    print(f"  Errors       : {errors}")

    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
