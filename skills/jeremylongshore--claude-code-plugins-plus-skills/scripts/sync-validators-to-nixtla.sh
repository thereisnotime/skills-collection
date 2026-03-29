#!/usr/bin/env bash
set -e

SRC="$(dirname "$0")/validate-skills-schema.py"
DEST="/home/jeremy/000-projects/nixtla/004-scripts/validate_skills_v2.py"

if [ ! -f "$SRC" ]; then
  echo "ERROR: Source file not found: $SRC"
  exit 1
fi

DEST_DIR="$(dirname "$DEST")"
if [ ! -d "$DEST_DIR" ]; then
  echo "ERROR: Destination directory not found: $DEST_DIR"
  exit 1
fi

cp "$SRC" "$DEST"
echo "Synced validator: $SRC -> $DEST"
