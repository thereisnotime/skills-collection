#!/usr/bin/env bash
# tests/test-cockpit-cmd.sh -- regression guard for `loki cockpit` (v7.126.0).
#
# WHAT THIS GUARDS
#   1. `cmd_cockpit --help` prints usage, mentions the fallback + dashboard, and
#      explicitly distinguishes itself from `loki watch` (CLI-INVARIANT: watch
#      must stay the PRD watcher; cockpit must never be confused with it).
#   2. On a terminal with NO inline-image support (TERM=dumb, no override), a
#      single `--once` render falls back HONESTLY: it must NOT emit any terminal
#      image escape (no OSC 1337, no APC _G) and MUST point at `loki dashboard`.
#   3. `loki cockpit` is wired in the main dispatch case.
#
# HOW cmd_cockpit IS DRIVEN
#   We awk-extract cmd_cockpit (and its sibling helpers _cockpit_text_summary /
#   cockpit_gather_state via the sourced render lib) and eval it with the real
#   render library sourced, but force the fallback branch by exporting an
#   unsupported TERM and clearing every graphics signal. The render lib's
#   cockpit_render shells out to bun; if bun is absent it returns 2 (bun
#   unavailable) which ALSO takes the fallback branch -- either way the test
#   asserts the honest no-image text path.

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

# --- 1. dispatch wiring is present -----------------------------------------
if grep -q '^        cockpit)$' "$LOKI_BIN"; then
    ok "cockpit) case wired in main dispatch"
else
    bad "cockpit) case wired in main dispatch" "no 'cockpit)' case found"
fi

# --- Extract cmd_cockpit for isolated execution ----------------------------
_fn="$(awk '/^cmd_cockpit\(\) \{/{f=1} f{print} f&&/^}$/{exit}' "$LOKI_BIN" 2>/dev/null || true)"
if [ -z "$_fn" ]; then
    bad "extract cmd_cockpit" "function not found"
    echo ""; echo "RESULT: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]; exit $?
fi

# Color vars + SCRIPT_DIR the function references. Stub the render lib path so
# the real cockpit-render.sh is sourced (state gather + render dispatch).
_run_cockpit() {
    # Each invocation runs in its own subshell with a clean environment for the
    # graphics signals, so detection is deterministic.
    (
        set +u
        RED=''; GREEN=''; CYAN=''; BOLD=''; DIM=''; NC=''
        _LOKI_SCRIPT_DIR="$REPO_ROOT/autonomy"
        SKILL_DIR="$REPO_ROOT"
        # Force NO graphics terminal, clear every signal, no override.
        export TERM=dumb
        unset TERM_PROGRAM KITTY_WINDOW_ID LOKI_COCKPIT_PROTOCOL 2>/dev/null || true
        eval "$_fn"
        cmd_cockpit "$@"
    )
}

# --- 2. --help ------------------------------------------------------------
help_out="$(_run_cockpit --help 2>&1)"
if printf '%s' "$help_out" | grep -qi "loki cockpit"; then
    ok "--help prints usage header"
else
    bad "--help prints usage header" "missing 'loki cockpit'"
fi
if printf '%s' "$help_out" | grep -qi "loki watch"; then
    ok "--help distinguishes itself from loki watch"
else
    bad "--help distinguishes itself from loki watch" "no mention of watch distinction"
fi
if printf '%s' "$help_out" | grep -qi "dashboard"; then
    ok "--help mentions the dashboard fallback"
else
    bad "--help mentions the dashboard fallback" "no 'dashboard' in help"
fi

# --- 3. honest fallback on a non-graphics terminal -------------------------
# Capture BOTH stdout and stderr; the image escape (if wrongly emitted) would
# be on stdout. We assert NONE of the inline-image escapes appear.
once_out="$(_run_cockpit --once 2>&1)"

# OSC 1337 iTerm2 marker or Kitty APC _G marker -> would mean a lie.
if printf '%s' "$once_out" | grep -q $'\x1b]1337'; then
    bad "no iTerm2 image escape on dumb terminal" "OSC 1337 leaked to output"
elif printf '%s' "$once_out" | grep -q $'\x1b_G'; then
    bad "no Kitty image escape on dumb terminal" "APC _G leaked to output"
else
    ok "no inline-image escape emitted on dumb terminal (honest fallback)"
fi

if printf '%s' "$once_out" | grep -qi "loki dashboard"; then
    ok "fallback points at 'loki dashboard'"
else
    bad "fallback points at 'loki dashboard'" "output: $once_out"
fi

if printf '%s' "$once_out" | grep -qi "text fallback"; then
    ok "fallback is labeled as a text fallback (never claims 'rendered image')"
else
    bad "fallback labeled as text fallback" "output: $once_out"
fi

# Guard against the specific lie: the fallback must never say it rendered an image.
if printf '%s' "$once_out" | grep -qi "rendered image"; then
    bad "fallback never claims 'rendered image'" "found the phrase in fallback output"
else
    ok "fallback never claims 'rendered image'"
fi

# --- 4. E5: huge-fleet text summary caps with a "+N more" line -------------
# A 171-run registry must never flood the text fallback. We drive the real
# _cockpit_text_summary with a stubbed cockpit_gather_state that emits a big
# fleet, and assert it renders a bounded list plus an honest overflow line.
# _cockpit_text_summary lives in autonomy/loki (not the render lib); extract it.
_txtfn="$(awk '/^_cockpit_text_summary\(\) \{/{f=1} f{print} f&&/^}$/{exit}' "$LOKI_BIN" 2>/dev/null || true)"
_run_text_summary_bigfleet() {
    (
        set +u
        _LOKI_SCRIPT_DIR="$REPO_ROOT/autonomy"
        eval "$_txtfn"
        # Override the gather step with a synthetic 171-run fleet.
        cockpit_gather_state() {
            python3 - <<'PYBIG'
import json
fleet = [{"name": f"run-{i}", "phase": "impl", "iteration": i,
          "running": i == 0} for i in range(171)]
print(json.dumps({"run": "big", "iteration": 1, "phase": "impl",
                  "tier": "opus", "provider": "claude", "verdict": "working",
                  "budgetUsd": 0.0, "gates": [], "council": [], "fleet": fleet}))
PYBIG
        }
        _cockpit_text_summary "$REPO_ROOT" ""
    )
}
if command -v python3 >/dev/null 2>&1; then
    big_out="$(_run_text_summary_bigfleet 2>/dev/null)"
    # Header must show the true total (in either "N active / 171" or
    # "171 total, none active" honest form) ...
    if printf '%s' "$big_out" | grep -qE "Fleet \([0-9]+ active / 171 total\)|Fleet \(171 total, none active\)"; then
        ok "text summary reports the true fleet total (171)"
    else
        bad "text summary reports true fleet total" "output: $big_out"
    fi
    # ... but the rendered rows are capped, with a "+ N more" overflow line.
    rows="$(printf '%s\n' "$big_out" | grep -cE '^\s+[* ] run-')"
    if [ "$rows" -le 8 ] && [ "$rows" -gt 0 ]; then
        ok "text summary caps rendered fleet rows (<= 8, got $rows)"
    else
        bad "text summary caps rendered fleet rows" "rendered $rows rows"
    fi
    if printf '%s' "$big_out" | grep -qE '\+ [0-9]+ more'; then
        ok "text summary prints an honest '+ N more' overflow line"
    else
        bad "text summary prints '+ N more' overflow line" "output: $big_out"
    fi
else
    ok "SKIP big-fleet text cap (python3 absent)"
    ok "SKIP big-fleet row cap (python3 absent)"
    ok "SKIP big-fleet overflow line (python3 absent)"
fi

# --- 5. E5: loki doctor prints the Cockpit capability section --------------
# End-to-end: run the real doctor with a forced protocol and assert the
# section reports the detected protocol and the render path honestly.
if [ -x "$LOKI_BIN" ] || bash -n "$LOKI_BIN" 2>/dev/null; then
    doc_out="$(LOKI_COCKPIT_PROTOCOL=iterm2 bash "$LOKI_BIN" doctor 2>/dev/null || true)"
    if printf '%s' "$doc_out" | grep -qi "Cockpit:"; then
        ok "doctor prints a Cockpit: section"
    else
        bad "doctor prints a Cockpit: section" "no 'Cockpit:' heading in doctor output"
    fi
    # Protocol line present (forced iterm2 should surface).
    if printf '%s' "$doc_out" | grep -qi "Inline-image protocol"; then
        ok "doctor cockpit section reports the inline-image protocol"
    else
        bad "doctor reports inline-image protocol" "missing protocol line"
    fi
    # Render path line present (image vs text+dashboard).
    if printf '%s' "$doc_out" | grep -qi "Render path"; then
        ok "doctor cockpit section reports the render path"
    else
        bad "doctor reports render path" "missing render path line"
    fi
else
    ok "SKIP doctor cockpit section (loki not runnable)"
    ok "SKIP doctor protocol line (loki not runnable)"
    ok "SKIP doctor render path line (loki not runnable)"
fi

# --- 6. E5: no-bun render path returns the honest fallback -----------------
# With bun hidden from PATH, cockpit_render must return 2 (bun unavailable) and
# the command must take the text fallback -- never emit an image escape.
_run_cockpit_nobun() {
    (
        set +u
        RED=''; GREEN=''; CYAN=''; BOLD=''; DIM=''; NC=''
        _LOKI_SCRIPT_DIR="$REPO_ROOT/autonomy"
        SKILL_DIR="$REPO_ROOT"
        export TERM=dumb
        unset TERM_PROGRAM KITTY_WINDOW_ID LOKI_COCKPIT_PROTOCOL 2>/dev/null || true
        # Hide bun: a PATH that cannot resolve it. Keep python3/sed/etc via a
        # command override so the rest of the fallback still works.
        command() {
            if [ "$1" = "-v" ] && [ "$2" = "bun" ]; then return 1; fi
            builtin command "$@"
        }
        eval "$_fn"
        cmd_cockpit --once
    )
}
nobun_out="$(_run_cockpit_nobun 2>&1)"
if printf '%s' "$nobun_out" | grep -q $'\x1b]1337' || printf '%s' "$nobun_out" | grep -q $'\x1b_G'; then
    bad "no-bun path emits no image escape" "an inline-image escape leaked"
else
    ok "no-bun path emits no image escape (honest fallback)"
fi
if printf '%s' "$nobun_out" | grep -qi "loki dashboard"; then
    ok "no-bun path points at the browser dashboard"
else
    bad "no-bun path points at dashboard" "output: $nobun_out"
fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
