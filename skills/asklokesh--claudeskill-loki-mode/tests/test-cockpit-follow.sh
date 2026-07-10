#!/usr/bin/env bash
# tests/test-cockpit-follow.sh -- regression guard for E1: flicker-free,
# event-driven `loki cockpit --follow`.
#
# WHAT THIS GUARDS
#   1. SOURCE-LEVEL: the --follow image loop uses the alternate screen buffer
#      (ESC[?1049h / ESC[?1049l) AND restores the cursor (ESC[?25h), AND installs
#      a cleanup trap (INT TERM EXIT) so the terminal is restored on any exit.
#      This is what makes the redraw flicker-free and non-destructive.
#   2. BEHAVIOR: the loop is EVENT-DRIVEN. With cockpit_render stubbed to always
#      emit an "image" (rc 0 -> the loop runs), a redraw fires when a watched
#      state file's mtime advances, and does NOT fire on an idle tick before the
#      max-idle bound. We drive the real cmd_cockpit --follow with stubbed
#      collaborators (sleep bumps the file / breaks the loop; cockpit_render
#      records each frame) and count frames.
#   3. BEHAVIOR: --once still renders EXACTLY ONE frame (CLI-INVARIANT).
#
# HOW cmd_cockpit IS DRIVEN
#   We awk-extract cmd_cockpit and eval it in a subshell with:
#     - RED/GREEN/... color vars + _LOKI_SCRIPT_DIR/SKILL_DIR set,
#     - the real cockpit-render.sh sourced, then cockpit_render + sleep +
#       _cockpit_text_summary OVERRIDDEN so no bun/python/terminal is needed,
#     - set +u because the extracted function references optional globals.
#   The Bash tool runs under zsh here, so we guard unmatched globs and always
#   run the eval in bash explicitly.

set -uo pipefail

SCRIPT_DIR_TEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR_TEST/.." && pwd)"
LOKI_BIN="${LOKI_BIN_OVERRIDE:-$REPO_ROOT/autonomy/loki}"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

if [ ! -f "$LOKI_BIN" ]; then
    echo "SKIP: $LOKI_BIN not found. (Not a fail.)"; exit 0
fi

# --- Extract cmd_cockpit ----------------------------------------------------
_fn="$(awk '/^cmd_cockpit\(\) \{/{f=1} f{print} f&&/^}$/{exit}' "$LOKI_BIN" 2>/dev/null || true)"
if [ -z "$_fn" ]; then
    bad "extract cmd_cockpit" "function not found"
    echo ""; echo "RESULT: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]; exit $?
fi

# --- 1. SOURCE-LEVEL guards on the follow loop ------------------------------
# Restrict to the extracted function so we only assert the cockpit loop.
if printf '%s' "$_fn" | grep -q '1049h' && printf '%s' "$_fn" | grep -q '1049l'; then
    ok "follow loop enters/leaves the alternate screen buffer (ESC[?1049h/l)"
else
    bad "follow loop uses the alternate screen buffer" "no ESC[?1049h/l in cmd_cockpit"
fi

if printf '%s' "$_fn" | grep -q '?25h'; then
    ok "follow loop restores the cursor on exit (ESC[?25h)"
else
    bad "follow loop restores the cursor" "no ESC[?25h in cmd_cockpit"
fi

# A trap that covers INT, TERM and EXIT so the terminal is restored on any exit.
if printf '%s' "$_fn" | grep -Eq "trap[^']*'[^']*'[[:space:]]+INT[[:space:]]+TERM" \
   && printf '%s' "$_fn" | grep -Eq "trap[^']*'[^']*'[[:space:]]+EXIT"; then
    ok "follow loop installs INT/TERM + EXIT cleanup traps"
else
    bad "follow loop installs cleanup traps" "missing INT/TERM or EXIT trap"
fi

if printf '%s' "$_fn" | grep -q '_cockpit_mtime'; then
    ok "follow loop watches state mtime (_cockpit_mtime present)"
else
    bad "follow loop is event-driven" "no _cockpit_mtime helper"
fi

# --- Behavior harness -------------------------------------------------------
# A scratch repo whose .loki/autonomy-state.json we can bump. Everything the
# render would touch is stubbed, so no bun/python/terminal is exercised.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/loki-cockpit-follow.XXXXXX")"
trap 'rm -rf "$TMP" 2>/dev/null || true' EXIT
mkdir -p "$TMP/repo/.loki"
printf '{"phase":"impl","iterationCount":1}\n' > "$TMP/repo/.loki/autonomy-state.json"

# cmd_cockpit sources "$_LOKI_SCRIPT_DIR/lib/cockpit-render.sh" at runtime, which
# would clobber any stub we defined before calling it. So we point
# _LOKI_SCRIPT_DIR at a fake autonomy dir whose render lib IS our stub: it
# defines cockpit_render to record one frame per call (rc 0 -> the image loop
# runs) with no bun/python/terminal involved.
mkdir -p "$TMP/fake-autonomy/lib"
cat > "$TMP/fake-autonomy/lib/cockpit-render.sh" <<'STUBLIB'
cockpit_render() { printf 'frame\n' >>"$LOKI_TEST_FRAMES"; return 0; }
_cockpit_text_summary() { :; }
cockpit_gather_state() { printf '{}\n'; }
STUBLIB

# Driver: written to a file with __REPO_ROOT__ spliced in, then run under bash.
# cockpit_render is stubbed to append one line per frame to $LOKI_TEST_FRAMES
# (rc 0 => the image loop runs). sleep is our clock: it bumps the state file
# mtime on tick 2 in "change" mode and breaks the loop after tick 4 so the test
# terminates. We assert the redraw count reflects the mtime bump.
_run_driver() {
    local mode="$1" frames_file="$2"
    local dscript="$TMP/driver.sh"
    cat > "$dscript" <<'DRIVER'
set +u
RED=''; GREEN=''; CYAN=''; BOLD=''; DIM=''; NC=''
# Point at the FAKE autonomy dir so cmd_cockpit's internal `source` loads our
# stub render lib (defines cockpit_render) instead of the real one.
_LOKI_SCRIPT_DIR="$LOKI_TEST_FAKE_AUTONOMY"
SKILL_DIR="$LOKI_TEST_REPO"
eval "$LOKI_FN"

# sleep is the loop's clock; override it AFTER defining cmd_cockpit.
__TICK=0
sleep() {
    __TICK=$((__TICK + 1))
    if [ "$LOKI_TEST_MODE" = "change" ] && [ "$__TICK" = "2" ]; then
        touch -t "$(date -v+2M '+%Y%m%d%H%M.%S' 2>/dev/null \
                   || date -d '+2 min' '+%Y%m%d%H%M.%S' 2>/dev/null \
                   || echo 209901010000.00)" \
            "$LOKI_TEST_REPO/.loki/autonomy-state.json" 2>/dev/null || true
    fi
    [ "$__TICK" -ge 4 ] && return 1
    return 0
}

if [ "$LOKI_TEST_MODE" = "once" ]; then
    cmd_cockpit --once --repo "$LOKI_TEST_REPO" >/dev/null 2>&1
else
    cmd_cockpit --follow --interval 6 --repo "$LOKI_TEST_REPO" >/dev/null 2>&1
fi
DRIVER
    : > "$frames_file"
    LOKI_TEST_MODE="$mode" LOKI_TEST_FRAMES="$frames_file" \
    LOKI_TEST_REPO="$TMP/repo" LOKI_TEST_FAKE_AUTONOMY="$TMP/fake-autonomy" \
    LOKI_FN="$_fn" \
    bash "$dscript" 2>/dev/null || true
}

# --- 2a. --once renders EXACTLY ONE frame -----------------------------------
FRAMES="$TMP/frames-once.txt"
_run_driver once "$FRAMES"
once_count="$(grep -c 'frame' "$FRAMES" 2>/dev/null || echo 0)"
if [ "$once_count" = "1" ]; then
    ok "--once renders exactly one frame"
else
    bad "--once renders exactly one frame" "got $once_count frames"
fi

# --- Baseline: an IDLE follow run (no mtime change, max_idle=6 > 4 ticks) ----
# The follow path renders TWO entry frames by design: one BEFORE the alt-screen
# (to detect the image-vs-fallback path) and one INSIDE the alt-screen (the
# clean first draw). With no state change inside the window, that is all: no
# extra redraw. This baseline count anchors the event-driven assertion below.
FRAMES="$TMP/frames-idle.txt"
_run_driver idle "$FRAMES"
idle_count="$(grep -c 'frame' "$FRAMES" 2>/dev/null || echo 0)"
if [ "$idle_count" = "2" ]; then
    ok "idle run does not thrash: only the two entry frames within the max-idle window"
else
    bad "idle run does not thrash" "expected 2 entry frames, got $idle_count"
fi

# --- 2b. redraw FIRES on a state mtime bump ---------------------------------
# Same window, but the state file's mtime advances at tick 2 -> the event-driven
# branch must fire an EXTRA redraw beyond the idle baseline.
FRAMES="$TMP/frames-change.txt"
_run_driver change "$FRAMES"
change_count="$(grep -c 'frame' "$FRAMES" 2>/dev/null || echo 0)"
if [ "$change_count" -gt "$idle_count" ] 2>/dev/null; then
    ok "redraw fires on a simulated state mtime bump ($change_count > idle $idle_count)"
else
    bad "redraw fires on a state mtime bump" "expected > idle ($idle_count), got $change_count"
fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
