#!/usr/bin/env bash
# shellcheck disable=SC2164  # cd in throwaway test subshells; failure is fatal anyway
# tests/test-verify-scope-record.sh - tests for the code-scope / locality record
# (rank 10, advisory-first) in `loki verify` (verify_scope_record, autonomy/verify.sh).
#
# The scope record turns the already-computed VERIFY_DIFF_FILES/INS/DEL into a
# structured {files_changed, net_lines, verdict, thresholds} record. It is
# ADVISORY BY DEFAULT: the verdict is a LABEL only; it never emits a gate row and
# never changes the verify exit code. "block" happens ONLY when an opt-in hard
# cap env (LOKI_SCOPE_MAX_FILES / LOKI_SCOPE_MAX_NET_LINES) is explicitly set and
# exceeded; over a soft threshold with no hard cap -> "warn"; under -> "ok".
#
# Cases:
#   A. small diff (few files, small net)                 -> verdict "ok"
#   B. large diff, hard cap set (LOKI_SCOPE_MAX_FILES=5)  -> verdict "block"
#   C. large diff, NO hard cap set                        -> verdict "warn"
#      (advisory: over the soft threshold but never blocking)
#   D. the scope record appears in evidence.json (files_changed, net_lines,
#      verdict, thresholds) after an end-to-end verify run.
#
# RED (pre-change): verify_scope_record is undefined and evidence.json has no
# "scope" key -> cases fail. GREEN (post-change): all pass.
#
# Exit-code semantics: 0 VERIFIED, 1 CONCERNS, 2 BLOCKED, 3 verifier error.

set -uo pipefail

# Isolate from host global/system git config (mirrors tests/test-verify.sh).
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_SH="$SCRIPT_DIR/../autonomy/verify.sh"

# Source verify.sh so unit cases can call verify_scope_record directly. Safe:
# verify.sh only runs verify_main when executed as $0 (BASH_SOURCE guard), so
# sourcing defines the functions without running a verification.
# shellcheck source=/dev/null
. "$VERIFY_SH"

PASS=0
FAIL=0
TMP_ROOT="$(mktemp -d -t loki-verify-scope-tests.XXXXXX)"

cleanup() { rm -rf "$TMP_ROOT" 2>/dev/null || true; }
trap cleanup EXIT

_ok()   { printf '  PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
_no()   { printf '  FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }
_skip() { printf '  SKIP: %s\n' "$1"; }

# Unit helper: set the diff globals + env, run verify_scope_record, echo verdict.
_scope_verdict_for() {
    # $1 files  $2 ins  $3 del
    VERIFY_DIFF_FILES="$1" VERIFY_DIFF_INS="$2" VERIFY_DIFF_DEL="$3" \
        verify_scope_record 2>/dev/null
    printf '%s' "${VERIFY_SCOPE_VERDICT:-UNSET}"
}

# ---- Case A: small diff -> ok ----
(
    unset LOKI_SCOPE_MAX_FILES LOKI_SCOPE_MAX_NET_LINES
    unset LOKI_SCOPE_SOFT_FILES LOKI_SCOPE_SOFT_NET_LINES
    v="$(_scope_verdict_for 3 40 10)"
    [ "$v" = "ok" ]
) && _ok "A: small diff (3 files, net +30) -> ok" || _no "A: small diff -> ok (got '$(unset LOKI_SCOPE_MAX_FILES LOKI_SCOPE_MAX_NET_LINES LOKI_SCOPE_SOFT_FILES LOKI_SCOPE_SOFT_NET_LINES; _scope_verdict_for 3 40 10)')"

# ---- Case B: large diff, hard cap set -> block ----
(
    export LOKI_SCOPE_MAX_FILES=5
    unset LOKI_SCOPE_MAX_NET_LINES LOKI_SCOPE_SOFT_FILES LOKI_SCOPE_SOFT_NET_LINES
    v="$(_scope_verdict_for 40 900 100)"
    [ "$v" = "block" ]
) && _ok "B: 40 files with LOKI_SCOPE_MAX_FILES=5 -> block" || _no "B: hard-cap exceeded -> block"

# ---- Case C: large diff, NO hard cap -> warn (advisory, never block) ----
(
    unset LOKI_SCOPE_MAX_FILES LOKI_SCOPE_MAX_NET_LINES
    unset LOKI_SCOPE_SOFT_FILES LOKI_SCOPE_SOFT_NET_LINES
    v="$(_scope_verdict_for 40 900 100)"
    [ "$v" = "warn" ]
) && _ok "C: 40 files, no hard cap -> warn (advisory)" || _no "C: over soft, no cap -> warn"

# ---- Case D: scope record appears in evidence.json after a real verify run ----
run_scope_e2e() {
    local repo out
    repo="$TMP_ROOT/repo-e2e"
    out="$TMP_ROOT/out-e2e"
    mkdir -p "$repo"
    (
        cd "$repo"
        git init -q
        git config user.email t@t.t
        git config user.name t
        git config commit.gpgsign false
        printf 'base\n' > README.md
        git add README.md
        git commit -q -m base
        # A small committed change vs main so the diff resolves.
        printf 'line1\nline2\n' > feature.txt
        git add feature.txt
        git commit -q -m feat
    )
    # base is "main"; the repo default branch may be master/main -> point base
    # at the first commit's branch name explicitly.
    local base
    base="$(cd "$repo" && git rev-parse --abbrev-ref HEAD)"
    ( cd "$repo" && LOKI_RUNTIME_GATE=0 bash "$VERIFY_SH" "$base" --out "$out" >/dev/null 2>&1 || true )
    printf '%s' "$out/evidence.json"
}

if command -v git >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    EV="$(run_scope_e2e)"
    if [ -f "$EV" ]; then
        has_scope="$(python3 - "$EV" <<'PYEOF' 2>/dev/null || echo NO
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("NO"); sys.exit(0)
s = d.get("scope")
if not isinstance(s, dict):
    print("NO"); sys.exit(0)
need = ("files_changed", "net_lines", "verdict", "thresholds")
ok = all(k in s for k in need) and isinstance(s.get("thresholds"), dict)
print("YES" if ok else "NO")
PYEOF
)"
        [ "$has_scope" = "YES" ] && _ok "D: evidence.json has scope{files_changed,net_lines,verdict,thresholds}" \
            || _no "D: evidence.json scope record missing/incomplete"
    else
        _no "D: evidence.json not produced ($EV)"
    fi
else
    _skip "D: git or python3 absent"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
