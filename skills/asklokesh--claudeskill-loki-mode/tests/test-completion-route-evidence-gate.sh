#!/usr/bin/env bash
# tests/test-completion-route-evidence-gate.sh -- the verified-completion
# evidence gate must guard the DEFAULT completion-promise route, not only the
# interval-gated council path (W3 council REJECT, v7.19.1).
#
# The bug Reviewer 1 found: council_evidence_gate was wired only into
# council_evaluate (reached via council_should_stop, which only runs every
# COUNCIL_CHECK_INTERVAL iterations). The default completion path -
# check_completion_promise (run.sh) honoring a loki_complete_task signal or the
# completion-promise text - exited as completion_promise_fulfilled WITHOUT the
# gate. So an agent could self-assert "done" with an empty diff + red tests and
# bypass the very gate that exists to stop fabricated completion.
#
# The fix adds an `elif check_completion_promise && council_evidence_gate
# blocks -> reject claim, keep iterating` branch in run.sh, mirroring the B-17
# code_review block. This test replicates that exact branch decision against the
# REAL council_evidence_gate and asserts:
#   - claim + empty diff  -> completion REJECTED (gate blocks)
#   - claim + real diff + green tests -> completion HONORED (gate passes)
#   - claim + LOKI_EVIDENCE_GATE=0 -> completion HONORED (opt-out)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COUNCIL_SCRIPT="$SCRIPT_DIR/../autonomy/completion-council.sh"

PASS=0; FAIL=0
ok()  { echo "ok: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# Minimal log stubs (run.sh provides these at runtime).
log_warn() { echo "[WARN] $*"; }
log_warning() { log_warn "$@"; }
log_info() { :; }
log_error() { echo "[ERROR] $*"; }
log_step() { :; }
log_header() { echo "[HEADER] $*"; }
log_success() { :; }

# Source the real council script (its top-level init is harmless here).
# shellcheck source=/dev/null
source "$COUNCIL_SCRIPT" 2>/dev/null || true

if ! type council_evidence_gate >/dev/null 2>&1; then
    echo "FATAL: council_evidence_gate not defined after sourcing $COUNCIL_SCRIPT"
    exit 2
fi

# Stubbed completion-claim detector: the agent always claims "done".
check_completion_promise() { return 0; }

# This function reproduces the EXACT run.sh branch order (the relevant slice):
#   if code_review blocked ...
#   elif check_completion_promise && type gate && ! gate  -> REJECT claim
#   elif check_completion_promise                         -> HONOR completion
# We return: "REJECTED" or "HONORED".
decide_completion() {
    local iter_output="$1"
    if check_completion_promise "$iter_output" && type council_evidence_gate &>/dev/null && ! council_evidence_gate; then
        log_warn "Completion claim rejected: evidence gate found no proof of completion."
        echo "REJECTED"
        return 0
    elif check_completion_promise "$iter_output"; then
        log_header "TASK COMPLETION CLAIMED"
        echo "HONORED"
        return 0
    fi
    echo "NO_CLAIM"
}

new_repo() {
    local d; d="$(mktemp -d -t loki-comp-route.XXXXXX)"
    (
        cd "$d" || exit 1
        export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
        git init -q
        git config user.email t@t.t; git config user.name t; git config commit.gpgsign false
        printf '.loki/\n' > .gitignore
        echo v1 > app.txt
        git add .gitignore app.txt
        git commit -q --no-gpg-sign -m baseline
    ) || return 1
    printf '%s' "$d"
}

write_results() {  # repo runner passbool
    mkdir -p "$1/.loki/quality"
    printf '{"timestamp":"2026-06-07T00:00:00Z","runner":"%s","pass":%s,"summary":"fixture"}\n' "$2" "$3" > "$1/.loki/quality/test-results.json"
}

base_of() { ( cd "$1" && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git rev-parse HEAD ); }

# --- Case 1: completion claim + EMPTY diff -> REJECTED -----------------------
repo="$(new_repo)"; base="$(base_of "$repo")"
write_results "$repo" jest true   # tests green, but nothing shipped
(
    cd "$repo"
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
    export COUNCIL_STATE_DIR="$repo/.loki/council"
    export _LOKI_RUN_START_SHA="$base"
    export ITERATION_COUNT=4
    v="$(decide_completion /dev/null | tail -1)"
    [ "$v" = "REJECTED" ] && exit 0 || exit 1
) && ok "claim + empty diff -> completion REJECTED" || bad "claim + empty diff -> completion REJECTED (gate did not block default route)"
rm -rf "$repo"

# --- Case 2: completion claim + REAL diff + GREEN tests -> HONORED -----------
repo="$(new_repo)"; base="$(base_of "$repo")"
( cd "$repo" || exit 1; export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null; echo v2-feature > app.txt; git add app.txt; git commit -q --no-gpg-sign -m feature )
write_results "$repo" jest true
(
    cd "$repo"
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
    export COUNCIL_STATE_DIR="$repo/.loki/council"
    export _LOKI_RUN_START_SHA="$base"
    export ITERATION_COUNT=4
    v="$(decide_completion /dev/null | tail -1)"
    [ "$v" = "HONORED" ] && exit 0 || exit 1
) && ok "claim + real diff + green tests -> completion HONORED" || bad "claim + real diff + green -> HONORED (gate false-blocked legit completion)"
rm -rf "$repo"

# --- Case 3: completion claim + RED tests (real diff) -> REJECTED ------------
repo="$(new_repo)"; base="$(base_of "$repo")"
( cd "$repo" || exit 1; export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null; echo v2-feature > app.txt; git add app.txt; git commit -q --no-gpg-sign -m feature )
write_results "$repo" jest false   # red
(
    cd "$repo"
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
    export COUNCIL_STATE_DIR="$repo/.loki/council"
    export _LOKI_RUN_START_SHA="$base"
    export ITERATION_COUNT=4
    v="$(decide_completion /dev/null | tail -1)"
    [ "$v" = "REJECTED" ] && exit 0 || exit 1
) && ok "claim + red tests -> completion REJECTED" || bad "claim + red tests -> REJECTED (gate let fabricated completion through)"
rm -rf "$repo"

# --- Case 4: LOKI_EVIDENCE_GATE=0 opt-out -> HONORED even with empty diff ----
repo="$(new_repo)"; base="$(base_of "$repo")"
write_results "$repo" jest true
(
    cd "$repo"
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
    export COUNCIL_STATE_DIR="$repo/.loki/council"
    export _LOKI_RUN_START_SHA="$base"
    export ITERATION_COUNT=4
    export LOKI_EVIDENCE_GATE=0
    v="$(decide_completion /dev/null | tail -1)"
    [ "$v" = "HONORED" ] && exit 0 || exit 1
) && ok "LOKI_EVIDENCE_GATE=0 -> completion HONORED (opt-out works)" || bad "opt-out -> HONORED (gate ignored opt-out on default route)"
rm -rf "$repo"

echo ""
echo "===================================="
echo "Completion-route evidence gate: PASS=$PASS FAIL=$FAIL"
echo "===================================="
[ "$FAIL" -eq 0 ]
