#!/bin/sh
# Held-out BLOCKER gate for the R2 runner's boolean `success`.
#
# Runs the mergeability rubric grader and exits 0 IFF the blocker check
# (fail_to_pass) passed. This makes the existing runner.grade() boolean success
# mean "mergeable at all" (no blocker failed). The SCORED weighted result is
# computed separately by benchmarks/bench/mergeability_score.py from the same
# grader's per-check JSON.
#
# Pure stdlib python; no network, no install: CI-safe + deterministic.
set -eu

PY="${PYTHON:-python3}"
OUT="$("$PY" rubric.py 2>/dev/null || true)"

# Extract checks.fail_to_pass without a JSON dependency in the shell: let python
# read its own output back (stdin), so we never parse JSON in sh.
printf '%s' "$OUT" | "$PY" -c '
import json, sys
try:
    obj = json.loads(sys.stdin.read() or "{}")
    checks = obj.get("checks", {}) if isinstance(obj, dict) else {}
except Exception:
    checks = {}
sys.exit(0 if checks.get("fail_to_pass") is True else 1)
'
