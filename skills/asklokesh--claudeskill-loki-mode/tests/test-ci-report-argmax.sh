#!/usr/bin/env bash
# Test: `loki ci --report --github-comment` on a large diff (BACKLOG item 25).
#
# The comment body that `--github-comment` posts is derived from the diff: a
# bigger diff produces more findings, and enough findings make the rendered
# report body itself exceed ARG_MAX. The old code passed that body as a
# literal argv element (`gh pr comment ... --body "$comment_body"`), so a
# large enough report crashed with "argument list too long" (bash exit 126).
# The fix pipes the body through stdin (`gh pr comment ... --body-file -`).
#
# RED reproduces the crash directly: the OLD invocation pattern, replayed
# byte-for-byte against a synthetic string sized past this host's real
# ARG_MAX, must exit 126.
#
# GREEN executes the ACTUAL fixed line, extracted verbatim from
# autonomy/loki by content match (so a future edit to that line re-verifies
# itself rather than silently testing stale copied text), against the same
# oversized payload, and must exit 0 with the payload delivered intact via
# stdin. This is a targeted unit test of the one fixed line rather than a
# full `cmd_ci` run: driving the real scanner to produce a report large
# enough to clear ARG_MAX requires tens of thousands of findings, and
# cmd_ci's findings array is walked several times (tally, then once per
# severity when rendering), which makes that path minutes slow. The targeted
# form is what actually exercises the argv-vs-stdin behavior; the full-report
# path is covered functionally by tests/test-ci-command.sh.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOKI="$SCRIPT_DIR/../autonomy/loki"

PASS=0
FAIL=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1 -- $2"; FAIL=$((FAIL + 1)); }

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/loki-ci-argmax.XXXXXX")
cleanup() { [ -n "${LOKI_TEST_KEEP_WORKDIR:-}" ] || rm -rf "$WORK_DIR"; }
trap cleanup EXIT

# Build a payload safely over ARG_MAX on any platform (getconf ARG_MAX is
# usually 1-2 MB; 6 MB clears it with margin without assuming a specific
# value). One long line, no newlines, so it stresses argv size specifically
# rather than line count.
PAYLOAD_FILE="$WORK_DIR/payload.txt"
python3 -c "import sys; sys.stdout.write('A' * (6 * 1024 * 1024))" >"$PAYLOAD_FILE"
PAYLOAD_SIZE=$(wc -c <"$PAYLOAD_FILE" | tr -d ' ')

ARG_MAX="$(getconf ARG_MAX 2>/dev/null || echo 0)"
case "$ARG_MAX" in '' | *[!0-9]*) ARG_MAX=0 ;; esac
if [ "$ARG_MAX" -gt 0 ] && [ "$PAYLOAD_SIZE" -le "$ARG_MAX" ]; then
    log_fail "payload construction" "payload ($PAYLOAD_SIZE bytes) does not exceed ARG_MAX ($ARG_MAX bytes)"
fi

# --- RED: the OLD pattern (body as a literal argv element) crashes ---
# Uses bash explicitly (not the invoking shell) because the exit-126 mapping
# for "argument list too long" is a bash behavior; the fix must hold there
# regardless of the interactive shell running this test file.
old_exit=0
bash -c '
huge="$(cat "$1")"
/usr/bin/env true "$huge" >/dev/null 2>/dev/null
' _ "$PAYLOAD_FILE" || old_exit=$?

if [ "$old_exit" -eq 126 ]; then
    log_pass "RED: old argv-element pattern crashes with exit 126 on an oversized body"
else
    log_fail "RED: old argv-element pattern crashes with exit 126 on an oversized body" "got exit $old_exit (expected 126; environment may not enforce ARG_MAX the same way)"
fi

# --- GREEN: the ACTUAL fixed line in autonomy/loki succeeds on the same payload ---
FIXED_LINE=$(grep -m1 'gh pr comment "\$ci_pr_number"' "$LOKI")
# Strip the trailing line-continuation (this line is the head of a multi-line
# `cmd && \` / `|| \` statement in cmd_ci); only the command itself is under
# test here; its continuation (an echo on success/failure) is not.
FIXED_LINE="${FIXED_LINE%%&& \\}"
FIXED_LINE="${FIXED_LINE%"${FIXED_LINE##*[![:space:]]}"}"
if [ -z "$FIXED_LINE" ]; then
    log_fail "GREEN: setup" "could not find the gh pr comment invocation in autonomy/loki -- has it moved or been renamed?"
else
    case "$FIXED_LINE" in
        *'--body-file -'*)
            log_pass "GREEN: the gh pr comment line uses --body-file - (stdin), not --body (argv)"
            ;;
        *)
            log_fail "GREEN: the gh pr comment line uses --body-file - (stdin), not --body (argv)" "found: $FIXED_LINE"
            ;;
    esac

    # Stub `gh` on PATH: `gh pr comment` records how it received the body --
    # proving the fix uses stdin, not argv, and that the payload arrives
    # intact -- without invoking the network or a real PR.
    STUB_BIN_DIR="$WORK_DIR/bin"
    mkdir -p "$STUB_BIN_DIR"
    RECEIVED_FILE="$WORK_DIR/received_body.txt"
    RECEIVED_ARGV_FILE="$WORK_DIR/received_argv.txt"

    cat >"$STUB_BIN_DIR/gh" <<'STUB_GH'
#!/usr/bin/env bash
# Test stub for `gh`, driven by env vars set by the test harness.
if [ "$1 $2" = "pr comment" ]; then
    : >"$STUB_RECEIVED_ARGV_FILE"
    body_file=""
    shift 2
    while [ $# -gt 0 ]; do
        case "$1" in
            --body)
                # Old-style flag: whatever landed in argv, recorded so the
                # test can tell the difference if this path is ever hit.
                printf '%s' "$2" >"$STUB_RECEIVED_ARGV_FILE"
                shift 2
                ;;
            --body-file)
                body_file="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
    if [ "$body_file" = "-" ]; then
        cat >"$STUB_RECEIVED_FILE"
    elif [ -n "$body_file" ]; then
        cat "$body_file" >"$STUB_RECEIVED_FILE"
    fi
fi
STUB_GH
    chmod +x "$STUB_BIN_DIR/gh"

    # Execute the real line: assign ci_pr_number and comment_body exactly as
    # cmd_ci does, then eval the grep-extracted statement unmodified.
    green_exit=0
    PATH="$STUB_BIN_DIR:$PATH" \
        STUB_RECEIVED_FILE="$RECEIVED_FILE" \
        STUB_RECEIVED_ARGV_FILE="$RECEIVED_ARGV_FILE" \
        bash -c '
            ci_pr_number=999
            comment_body="$(cat "$1")"
            eval "$2"
        ' _ "$PAYLOAD_FILE" "$FIXED_LINE" || green_exit=$?

    if [ "$green_exit" -eq 0 ]; then
        log_pass "GREEN: the fixed line exits 0 on a payload sized past ARG_MAX"
    else
        log_fail "GREEN: the fixed line exits 0 on a payload sized past ARG_MAX" "got exit $green_exit"
    fi

    if [ -s "$RECEIVED_ARGV_FILE" ]; then
        log_fail "GREEN: body is never passed via --body argv" "stub gh received --body with $(wc -c <"$RECEIVED_ARGV_FILE" | tr -d ' ') bytes as an argv element"
    else
        log_pass "GREEN: body is never passed via --body argv"
    fi

    if [ -s "$RECEIVED_FILE" ]; then
        received_size=$(wc -c <"$RECEIVED_FILE" | tr -d ' ')
        if cmp -s "$PAYLOAD_FILE" "$RECEIVED_FILE"; then
            log_pass "GREEN: full payload ($received_size bytes) arrived via stdin intact"
        else
            log_fail "GREEN: full payload arrived via stdin intact" "received $received_size bytes, does not match the $PAYLOAD_SIZE-byte payload"
        fi
    else
        log_fail "GREEN: full payload arrived via stdin intact" "stub gh received no body on stdin"
    fi
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -gt 0 ] && exit 1
exit 0
