#!/usr/bin/env bash
#
# dependency-snapshot.sh
#
# Produce a one-shot reproducibility record of the resolved dependency tree
# for the current repository. Writes:
#
#   .loki/tracking/dependency-snapshot-<YYYY-MM-DD>.json
#
# Format: JSON object with two top-level keys:
#   "npm" : output of `npm ls --json --all` from the repo root
#   "bun" : output of `bun pm ls --json` (if bun is on PATH; otherwise null)
#
# Uses set -euo pipefail. Tolerates `npm ls` peer-dep warnings (npm exits
# non-zero when peers are missing even though the JSON is valid).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/.loki/tracking"
DATE_STAMP="$(date +%Y-%m-%d)"
OUT_FILE="${OUT_DIR}/dependency-snapshot-${DATE_STAMP}.json"

mkdir -p "$OUT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required but not found on PATH" >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required but not found on PATH" >&2
  exit 2
fi

cd "$REPO_ROOT"

# `npm ls --json --all` exits non-zero on peer-dep / extraneous warnings
# but still emits valid JSON on stdout. Capture both and ignore the exit code.
NPM_JSON="$(npm ls --json --all 2>/dev/null || true)"
if [[ -z "$NPM_JSON" ]]; then
  NPM_JSON='{}'
fi

# v7.4.10: capture SHA-512 integrity hashes for every transitive package.
# Pre-v7.4.10 the snapshot was version+URL only -- vulnerable to
# dependency-confusion since a swapped tarball wouldn't be detected.
# We materialize a package-lock.json (npm install --package-lock-only writes
# integrity + resolved fields) and embed it alongside the npm tree.
LOCKFILE_JSON="null"
TMPLOCK_DIR="$(mktemp -d -t loki-lock-XXXXXX)"
trap 'rm -rf "$TMPLOCK_DIR"' EXIT
cp package.json "$TMPLOCK_DIR/" 2>/dev/null || true
if (cd "$TMPLOCK_DIR" && npm install --package-lock-only --no-audit --no-fund \
  --silent >/dev/null 2>&1); then
  if [[ -f "$TMPLOCK_DIR/package-lock.json" ]]; then
    LOCKFILE_JSON="$(cat "$TMPLOCK_DIR/package-lock.json")"
  fi
fi

# Optional: bun pm ls --json. bun emits the listing in human-readable text
# unless --json is supported; capture whatever it gives back, fall back to
# null if bun is unavailable or the command fails.
BUN_JSON="null"
if command -v bun >/dev/null 2>&1; then
  if BUN_OUT="$(bun pm ls --json 2>/dev/null)" && [[ -n "$BUN_OUT" ]]; then
    # Validate it's parseable JSON; if not, store the raw text as a string.
    if echo "$BUN_OUT" | python3 -c "import json,sys; json.load(sys.stdin)" >/dev/null 2>&1; then
      BUN_JSON="$BUN_OUT"
    else
      # Store the raw text so the snapshot still records what bun reported.
      BUN_JSON="$(printf '%s' "$BUN_OUT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")"
    fi
  fi
fi

# Compose the final snapshot file with python3 to guarantee well-formed JSON.
NPM_JSON="$NPM_JSON" BUN_JSON="$BUN_JSON" LOCKFILE_JSON="$LOCKFILE_JSON" \
  DATE_STAMP="$DATE_STAMP" \
  python3 - "$OUT_FILE" <<'PY'
import json, os, sys

out_path = sys.argv[1]
npm_raw = os.environ.get("NPM_JSON", "{}")
bun_raw = os.environ.get("BUN_JSON", "null")
lock_raw = os.environ.get("LOCKFILE_JSON", "null")
date_stamp = os.environ.get("DATE_STAMP", "")

try:
    npm_obj = json.loads(npm_raw)
except Exception as e:
    npm_obj = {"_parse_error": str(e), "_raw": npm_raw}

try:
    bun_obj = json.loads(bun_raw)
except Exception as e:
    bun_obj = {"_parse_error": str(e), "_raw": bun_raw}

try:
    lock_obj = json.loads(lock_raw)
except Exception as e:
    lock_obj = {"_parse_error": str(e), "_raw": lock_raw}

# Count integrity hashes captured (sanity signal -- if zero, snapshot is
# vulnerable to dependency-confusion).
integrity_count = 0
if isinstance(lock_obj, dict):
    pkgs = lock_obj.get("packages", {})
    if isinstance(pkgs, dict):
        for meta in pkgs.values():
            if isinstance(meta, dict) and meta.get("integrity"):
                integrity_count += 1

snapshot = {
    "snapshot_date": date_stamp,
    "npm": npm_obj,
    "bun": bun_obj,
    "lockfile": lock_obj,
    "integrity_hash_count": integrity_count,
}

with open(out_path, "w") as f:
    json.dump(snapshot, f, indent=2, sort_keys=True)
print(f"  integrity_hash_count = {integrity_count}", file=sys.stderr)
PY

echo "Wrote dependency snapshot: $OUT_FILE"
echo "Size: $(wc -c <"$OUT_FILE" | tr -d ' ') bytes"
