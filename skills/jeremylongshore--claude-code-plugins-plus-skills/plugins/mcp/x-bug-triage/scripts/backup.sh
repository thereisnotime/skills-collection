#!/usr/bin/env bash
# Backup SQLite database with SHA-256 checksum verification
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_ROOT/data/triage.db"
BACKUP_DIR="$PROJECT_ROOT/data/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/triage_${TIMESTAMP}.db"

if [[ ! -f "$DB_PATH" ]]; then
  echo "ERROR: Database not found at $DB_PATH"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Use SQLite backup API for consistency
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# Generate checksum
CHECKSUM=$(sha256sum "$BACKUP_FILE" | awk '{print $1}')
echo "$CHECKSUM  $(basename "$BACKUP_FILE")" > "$BACKUP_FILE.sha256"

echo "Backup created: $BACKUP_FILE"
echo "Checksum: $CHECKSUM"
echo "Verify with: sha256sum -c $BACKUP_FILE.sha256"
