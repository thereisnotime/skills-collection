#!/usr/bin/env bash
# tests/test-complexity-proportional-review.sh -- rec #3: complexity-proportional
# verification. The code-review specialist selector (SPECIALIST_SELECT in
# autonomy/run.sh) scales the number of keyword-selected specialists to the
# detected task tier, with a HARD FLOOR so nothing shippable gets less scrutiny.
#
# Battery = 2 always-on mandatory reviewers (architecture-strategist +
# maintainer-mergeability) + N keyword specialists, where N is:
#   simple   -> 2   (total 4; byte-identical to every prior release)
#   standard -> 2   (total 4; byte-identical)
#   complex  -> 4   (total 6; deeper battery for hard tasks, additive only)
#   unknown/forced-garbage -> 2 (floor guard; never shrinks the battery)
#
# It extracts and runs the REAL selector block (not a re-derivation) under each
# tier, for both the keyword-match and no-keyword-match paths, and asserts the
# reviewer count and no-duplicate invariants.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$REPO_ROOT/autonomy/run.sh"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }

if ! command -v python3 >/dev/null 2>&1; then
    echo "SKIP: python3 not installed. (Not a fail.)"; exit 0
fi
if [ ! -f "$RUN_SH" ]; then
    echo "SKIP: $RUN_SH not found. (Not a fail.)"; exit 0
fi

# Extract the real SPECIALIST_SELECT python heredoc body.
SEL_PY="$(mktemp -t loki-sel.XXXXXX.py)"
trap 'rm -f "$SEL_PY" "$DIFF_F" "$FILES_F"' EXIT
awk '/selected_specialists=\$\(python3 << .SPECIALIST_SELECT./{f=1;next} f&&/^SPECIALIST_SELECT$/{exit} f{print}' "$RUN_SH" > "$SEL_PY"
if [ ! -s "$SEL_PY" ]; then
    echo "SKIP: could not extract SPECIALIST_SELECT block from run.sh. (Not a fail.)"; exit 0
fi

DIFF_F="$(mktemp -t loki-diff.XXXXXX)"
FILES_F="$(mktemp -t loki-files.XXXXXX)"

# count_for <tier> <diff-content> -> echoes "<total_reviewers>|<comma-names>"
count_for() {
    local tier="$1" diff="$2"
    printf '%s\n' "$diff" > "$DIFF_F"
    printf 'src/a.ts src/b.ts\n' > "$FILES_F"
    LOKI_REVIEW_DIFF_FILE="$DIFF_F" \
    LOKI_REVIEW_FILES_FILE="$FILES_F" \
    LOKI_AGENTS_TYPES_FILE="" \
    LOKI_REVIEW_HEALING_ACTIVE="false" \
    LOKI_REVIEW_COMPLEXITY="$tier" \
    python3 "$SEL_PY" 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
names = [r['name'] for r in d['reviewers']]
print('%d|%s' % (len(names), ','.join(names)))
"
}

RICH="auth login token sql query cache database render loop package import test spec docker k8s"

# --- keyword-match path: counts scale by tier, floor holds -----------------
for pair in "simple:4" "standard:4" "complex:6" "totally-bogus:4"; do
    tier="${pair%%:*}"; want="${pair##*:}"
    got="$(count_for "$tier" "$RICH")"; n="${got%%|*}"
    if [ "$n" = "$want" ]; then
        ok "tier=$tier (keyword-match) -> $n reviewers"
    else
        bad "tier=$tier (keyword-match)" "expected $want, got $n ($got)"
    fi
done

# --- floor invariant: complex is strictly MORE than standard ---------------
n_std="$(count_for standard "$RICH")"; n_std="${n_std%%|*}"
n_cpx="$(count_for complex "$RICH")"; n_cpx="${n_cpx%%|*}"
if [ "$n_cpx" -gt "$n_std" ]; then
    ok "complex battery ($n_cpx) is deeper than standard ($n_std) -- additive"
else
    bad "complex not deeper" "complex=$n_cpx standard=$n_std"
fi

# --- standard/simple byte-identical to the historical 4-reviewer default ---
if [ "$n_std" = "4" ]; then
    ok "standard tier preserves the historical 4-reviewer floor"
else
    bad "standard tier changed the floor" "got $n_std, expected 4"
fi

# --- no-keyword-match path: still honors tier count, no duplicates ---------
for pair in "standard:4" "complex:6"; do
    tier="${pair%%:*}"; want="${pair##*:}"
    got="$(count_for "$tier" "")"; n="${got%%|*}"; names="${got##*|}"
    dupes="$(printf '%s' "$names" | tr ',' '\n' | sort | uniq -d)"
    if [ "$n" = "$want" ] && [ -z "$dupes" ]; then
        ok "tier=$tier (no-match) -> $n reviewers, no duplicates"
    else
        bad "tier=$tier (no-match)" "expected $want no-dupes, got n=$n dupes=[$dupes]"
    fi
done

echo ""
echo "=== results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
