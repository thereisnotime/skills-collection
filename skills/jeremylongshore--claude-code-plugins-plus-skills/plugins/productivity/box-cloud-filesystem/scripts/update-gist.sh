#!/usr/bin/env bash
# Regenerate the public gist with:
#   1. One-pager & operator audit (combined)
#   2. CHANGELOG.md
#   3. All plugin source files
#
# Usage: ./scripts/update-gist.sh
# Requires: gh (GitHub CLI), jq

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GIST_ID_FILE="$REPO_ROOT/.gist-id"

if [ ! -f "$GIST_ID_FILE" ]; then
  echo "Error: .gist-id not found. Create the gist first." >&2
  exit 1
fi

GIST_ID=$(cat "$GIST_ID_FILE" | tr -d '[:space:]')
echo "Updating gist $GIST_ID..."

# Build a temp dir with all gist files
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# 1. One-pager + audit (primary file — 0- prefix to sort first)
if [ -f "$REPO_ROOT/000-docs/one-pager-and-operator-audit.md" ]; then
  cp "$REPO_ROOT/000-docs/one-pager-and-operator-audit.md" \
    "$TMPDIR/0-box-cloud-filesystem-one-pager-and-operator-audit.md"
else
  echo "Warning: 000-docs/one-pager-and-operator-audit.md not found, skipping" >&2
fi

# 2. Changelog
if [ -f "$REPO_ROOT/CHANGELOG.md" ]; then
  cp "$REPO_ROOT/CHANGELOG.md" "$TMPDIR/CHANGELOG.md"
fi

# 3. Plugin source files
cp "$REPO_ROOT/.claude-plugin/plugin.json" "$TMPDIR/plugin.json"
cp "$REPO_ROOT/hooks/hooks.json" "$TMPDIR/hooks.json"
cp "$REPO_ROOT/scripts/box-init-workspace.sh" "$TMPDIR/box-init-workspace.sh"
cp "$REPO_ROOT/scripts/box-sync-on-write.sh" "$TMPDIR/box-sync-on-write.sh"
cp "$REPO_ROOT/scripts/box-sync-summary.sh" "$TMPDIR/box-sync-summary.sh"
cp "$REPO_ROOT/skills/box-cloud-filesystem/SKILL.md" "$TMPDIR/SKILL.md"
cp "$REPO_ROOT/skills/box-cloud-filesystem/references/operations-guide.md" "$TMPDIR/operations-guide.md"
cp "$REPO_ROOT/skills/box-cloud-filesystem/references/sync-pattern.md" "$TMPDIR/sync-pattern.md"

# Delete old gist and recreate (gh gist edit can't add/remove files cleanly)
gh gist delete "$GIST_ID" --yes 2>/dev/null || true

NEW_GIST_URL=$(gh gist create "$TMPDIR"/* \
  --public \
  --desc "box-cloud-filesystem — one-pager + operator audit + changelog + full plugin source")

NEW_GIST_ID=$(echo "$NEW_GIST_URL" | grep -oE '[a-f0-9]{32}$')

# Update .gist-id if it changed
if [ "$NEW_GIST_ID" != "$GIST_ID" ]; then
  echo "$NEW_GIST_ID" > "$GIST_ID_FILE"
  echo "Gist ID changed: $GIST_ID -> $NEW_GIST_ID"
fi

echo "Gist updated: $NEW_GIST_URL"
