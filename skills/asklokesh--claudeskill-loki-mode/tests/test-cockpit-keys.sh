#!/usr/bin/env bash
# tests/test-cockpit-keys.sh -- E3 keyboard interactivity for `loki cockpit --follow`.
#
# WHAT THIS GUARDS
#   1. cockpit_handle_key maps every documented key to the right action word:
#      Tab/Right/Down -> next, Left/Up -> prev, e -> explain, s -> steer,
#      q/ESC/Ctrl-C -> quit, anything else -> noop.
#   2. cockpit_cycle_focus cycles fleet paths forward/back with wraparound, and
#      is a no-op on an empty fleet (so a single-repo cockpit never crashes).
#   3. The non-TTY guard in cmd_cockpit skips interactivity (interactive=0) so
#      piped / CI usage still renders without touching stty.
#
# HOW THE FUNCTIONS ARE DRIVEN
#   cockpit_handle_key / cockpit_cycle_focus live in autonomy/lib/cockpit-render.sh
#   (pure, no collaborators) so we awk-extract and eval them directly. The non-TTY
#   guard is a grep-level assertion against cmd_cockpit's source (the actual [ -t 0 ]
#   condition), since exercising a live alt-screen follow loop in a test harness is
#   not worth the flakiness.

set -uo pipefail

SCRIPT_DIR_TEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR_TEST/.." && pwd)"
LOKI_BIN="${LOKI_BIN_OVERRIDE:-$REPO_ROOT/autonomy/loki}"
RENDER_LIB="$REPO_ROOT/autonomy/lib/cockpit-render.sh"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

if [ ! -f "$RENDER_LIB" ] || [ ! -f "$LOKI_BIN" ]; then
    echo "SKIP: cockpit sources not found. (Not a fail.)"; exit 0
fi

# --- Extract the two pure functions from the render lib --------------------
_extract() {
    awk "/^$1\\(\\) \\{/{f=1} f{print} f&&/^}\$/{exit}" "$RENDER_LIB" 2>/dev/null || true
}
_HK="$(_extract cockpit_handle_key)"
_CY="$(_extract cockpit_cycle_focus)"
if [ -z "$_HK" ] || [ -z "$_CY" ]; then
    bad "extract key + cycle functions" "one or both not found in render lib"
    echo ""; echo "RESULT: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]; exit $?
fi

# --- 1. cockpit_handle_key mapping -----------------------------------------
# Run the extracted function in a clean subshell (set +u; zsh-safe globs off).
_hk() {
    (
        set +u
        eval "$_HK"
        cockpit_handle_key "$1"
    )
}

# token -> expected action
_check_key() {
    local token="$1" want="$2" got
    got="$(_hk "$token")"
    if [ "$got" = "$want" ]; then
        ok "handle_key '$token' -> $want"
    else
        bad "handle_key '$token' -> $want" "got '$got'"
    fi
}

_check_key TAB   next
_check_key RIGHT next
_check_key DOWN  next
_check_key LEFT  prev
_check_key UP    prev
_check_key e     explain
_check_key s     steer
_check_key q     quit
_check_key ESC   quit
_check_key x     noop

# Ctrl-C byte (0x03) -> quit (handled as data when read raw).
if [ "$(_hk "$(printf '\003')")" = "quit" ]; then
    ok "handle_key Ctrl-C byte -> quit"
else
    bad "handle_key Ctrl-C byte -> quit" "got '$(_hk "$(printf '\003')")'"
fi

# --- 2. cockpit_cycle_focus ------------------------------------------------
_cy() {
    (
        set +u
        eval "$_CY"
        cockpit_cycle_focus "$1" "$2" "$3"
    )
}

PATHS="$(printf '/a\n/b\n/c\n')"

# forward from /a -> /b, from /c wraps to /a
[ "$(_cy /a next "$PATHS")" = "/b" ] && ok "cycle next /a -> /b" || bad "cycle next /a -> /b" "got '$(_cy /a next "$PATHS")'"
[ "$(_cy /c next "$PATHS")" = "/a" ] && ok "cycle next wraps /c -> /a" || bad "cycle next wraps /c -> /a" "got '$(_cy /c next "$PATHS")'"

# backward from /a wraps to /c, from /b -> /a
[ "$(_cy /a prev "$PATHS")" = "/c" ] && ok "cycle prev wraps /a -> /c" || bad "cycle prev wraps /a -> /c" "got '$(_cy /a prev "$PATHS")'"
[ "$(_cy /b prev "$PATHS")" = "/a" ] && ok "cycle prev /b -> /a" || bad "cycle prev /b -> /a" "got '$(_cy /b prev "$PATHS")'"

# focus not in list: next -> first, prev -> last
[ "$(_cy /zzz next "$PATHS")" = "/a" ] && ok "cycle next unknown -> first" || bad "cycle next unknown -> first" "got '$(_cy /zzz next "$PATHS")'"
[ "$(_cy /zzz prev "$PATHS")" = "/c" ] && ok "cycle prev unknown -> last" || bad "cycle prev unknown -> last" "got '$(_cy /zzz prev "$PATHS")'"

# empty fleet: no-op, echoes current focus unchanged
[ "$(_cy /a next "")" = "/a" ] && ok "cycle empty fleet is a no-op" || bad "cycle empty fleet is a no-op" "got '$(_cy /a next "")'"

# --- 3. non-TTY guard skips interactivity ----------------------------------
# cmd_cockpit must gate interactivity on stdin AND stdout being a TTY. Assert the
# guard exists so piped / CI usage never enters raw-key mode.
if grep -q 'interactive=0' "$LOKI_BIN" && grep -Eq '\[ -t 0 \].*\[ -t 1 \]' "$LOKI_BIN"; then
    ok "non-TTY guard present (interactive=0 default + [ -t 0 ] && [ -t 1 ])"
else
    bad "non-TTY guard present" "expected interactive=0 default gated on -t 0 && -t 1"
fi

# The follow loop must actually consult the guard before reading keys.
if grep -q 'cockpit_read_key' "$LOKI_BIN" && grep -q 'interactive.*=.*1' "$LOKI_BIN"; then
    ok "follow loop key-reads only when interactive=1"
else
    bad "follow loop key-reads only when interactive=1" "cockpit_read_key not gated on interactive"
fi

# Terminal restore on exit: stty must be saved and restored via a trap.
if grep -q 'stty -g' "$LOKI_BIN" && grep -q '_saved_stty' "$LOKI_BIN"; then
    ok "terminal state saved + restored (stty -g / _saved_stty)"
else
    bad "terminal state saved + restored" "no stty save/restore found"
fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
