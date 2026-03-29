#!/usr/bin/env bash
# Retention-based data cleanup per config/retention-policy.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_ROOT/data/triage.db"

if [[ ! -f "$DB_PATH" ]]; then
  echo "ERROR: Database not found at $DB_PATH"
  exit 1
fi

echo "Running retention cleanup on $DB_PATH..."

# Delete candidates with store_redacted policy older than 90 days
sqlite3 "$DB_PATH" "DELETE FROM candidates WHERE raw_text_storage_policy = 'store_redacted' AND timestamp < datetime('now', '-90 days');"
echo "  Purged redacted candidates older than 90 days"

# Delete candidates with store_hash_only policy older than 365 days
sqlite3 "$DB_PATH" "DELETE FROM candidates WHERE raw_text_storage_policy = 'store_hash_only' AND timestamp < datetime('now', '-365 days');"
echo "  Purged hash-only candidates older than 365 days"

# Delete closed clusters older than 365 days
sqlite3 "$DB_PATH" "DELETE FROM clusters WHERE state = 'closed' AND updated_at < datetime('now', '-365 days');"
echo "  Purged closed clusters older than 365 days"

# Delete audit logs older than 365 days
sqlite3 "$DB_PATH" "DELETE FROM audit_log WHERE timestamp < datetime('now', '-365 days');"
echo "  Purged audit logs older than 365 days"

# Clean orphaned cluster_posts
sqlite3 "$DB_PATH" "DELETE FROM cluster_posts WHERE cluster_id NOT IN (SELECT cluster_id FROM clusters) OR post_id NOT IN (SELECT post_id FROM candidates);"
echo "  Cleaned orphaned cluster_posts"

# Vacuum
sqlite3 "$DB_PATH" "VACUUM;"
echo "  Database vacuumed"

echo "Cleanup complete."
