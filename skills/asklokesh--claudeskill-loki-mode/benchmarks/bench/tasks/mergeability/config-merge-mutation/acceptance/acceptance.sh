#!/bin/sh
# Held-out BLOCKER gate for the R2 runner's boolean `success`. Exits 0 IFF the
# blocker check (fail_to_pass: base not mutated) passed. Pure stdlib python.
set -eu

PY="${PYTHON:-python3}"
OUT="$("$PY" rubric.py 2>/dev/null || true)"

printf '%s' "$OUT" | "$PY" -c '
import json, sys
try:
    obj = json.loads(sys.stdin.read() or "{}")
    checks = obj.get("checks", {}) if isinstance(obj, dict) else {}
except Exception:
    checks = {}
sys.exit(0 if checks.get("fail_to_pass") is True else 1)
'
