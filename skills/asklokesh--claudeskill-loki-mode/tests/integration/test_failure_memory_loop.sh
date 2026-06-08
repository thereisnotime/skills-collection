#!/usr/bin/env bash
# tests/integration/test_failure_memory_loop.sh
#
# End-to-end behavioral test for the failure-memory loop (LOKI_FAILURE_MEMORY,
# default on). Implementation: autonomy/run.sh Connector A (auto_capture_episode)
# and Connector B (retrieve_memory_context). Plan: docs/FAILURE-MEMORY-PLAN.md
# section "New tests".
#
# Fidelity: this test SOURCES the real autonomy/run.sh and calls the REAL
# auto_capture_episode and retrieve_memory_context bash functions. It does NOT
# copy the heredoc bodies, so it covers the bash-level parts too: the
# `ls -t .loki/crash/*.json | head -1` crash-file pick, the
# `[ -f .loki/memory/index.json ]` early-return, and the env contract into the
# Python heredocs. Crash files are written via the REAL crash_capture.capture so
# the whitelist/scrub is authentic.
#
# Three harness facts (NOT implementation bugs), discovered while building this:
#   1. run.sh line 760 sets `TARGET_DIR="${LOKI_TARGET_DIR:-$(pwd)}"` at source
#      time, so we MUST set TARGET_DIR (and PROJECT_DIR) AFTER sourcing, or the
#      functions point at the repo root instead of our temp dir.
#   2. The self-copy/exec block (run.sh:179) and `main` (run.sh:13647) are both
#      guarded by `[[ "${BASH_SOURCE[0]}" == "${0}" ]]`, which is FALSE when
#      sourced, so sourcing is safe and skips both.
#   3. We must NOT export LOKI_RUNNING_FROM_TEMP=1. With that var set, run.sh:199
#      installs `trap 'rm -f "${BASH_SOURCE[0]}"' EXIT`, and when sourced
#      `BASH_SOURCE[0]` resolves to THIS test file -> a sourcing subshell would
#      delete the test on exit. Sourcing in the normal (executed-directly-is-
#      false) path skips that trap entirely.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TMPROOT="$(mktemp -d -t loki-failmem-XXXXXX)"
# shellcheck disable=SC2329 # invoked via trap
cleanup() { rm -rf "$TMPROOT" 2>/dev/null || true; }
trap cleanup EXIT

PASS=0
FAIL=0
ok() { echo "PASS [$1]"; PASS=$((PASS + 1)); }
bad() { echo "FAIL [$1] $2"; FAIL=$((FAIL + 1)); }

# Poisoned data used by the privacy assertions. These must never appear in the
# stored ErrorEntry or the rendered PAST FAILURES block.
POISON_PATH="/Users/lokesh/secret-project/handler.py"
POISON_EMAIL="slogansand@gmail.com"
POISON_IP="10.11.12.13"

# init_memory <target> -- create the on-disk memory structure exactly the way
# run.sh does (create_storage + MemoryEngine.initialize), so index.json exists
# (Connector B early-returns without it) and store/list/load all work.
init_memory() {
    local t="$1"
    mkdir -p "$t/.loki/memory"
    PROJECT_DIR="$REPO_ROOT" python3 - "$REPO_ROOT" "$t" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from memory.engine import MemoryEngine, create_storage
t = sys.argv[2]
eng = MemoryEngine(storage=create_storage(f'{t}/.loki/memory'),
                   base_path=f'{t}/.loki/memory')
eng.initialize()
PY
}

# write_crash <target> <error_class> <rarv_phase> -- write an AUTHENTIC scrubbed
# crash file via the real crash_capture.capture. The raw stack/message contain a
# home path, an email, and an IP; crash_redact strips them. We rely on the real
# scrub, not a hand-built JSON, so the test exercises the true input path.
write_crash() {
    local t="$1" eclass="$2" phase="$3"
    PROJECT_DIR="$REPO_ROOT" python3 - "$REPO_ROOT" "$t" "$eclass" "$phase" \
        "$POISON_PATH" "$POISON_EMAIL" "$POISON_IP" <<'PY'
import sys
sys.path.insert(0, sys.argv[1] + '/autonomy/lib')
import crash_capture
repo, t, eclass, phase, ppath, pemail, pip = sys.argv[1:8]
stack = [
    f'  File "{ppath}", line 10, in handle',
    '    parse(data)',
    f'  File "{ppath.replace("handler", "parse")}", line 5, in parse',
    '    return json.loads(s)',
    'json.decoder.JSONDecodeError: Expecting value',
]
crash_capture.capture(
    error_class=eclass,
    message=f'boom contact {pemail} from {pip}',
    stack=stack,
    rarv_phase=phase,
    exit_code=1,
    target_dir=t,
)
PY
}

# run_connector_a <target> <exit_code> <phase> <goal> [knob] -- source run.sh and
# call the REAL auto_capture_episode in a subshell (so each test gets clean
# globals). The episode is persisted to <target>/.loki/memory/episodic.
run_connector_a() {
    local t="$1" ec="$2" phase="$3" goal="$4" knob="${5:-1}"
    (
        export LOKI_MANAGED_AGENTS=false LOKI_MANAGED_MEMORY=false
        export LOKI_FAILURE_MEMORY="$knob"
        # shellcheck disable=SC1091
        source "$REPO_ROOT/autonomy/run.sh" >/dev/null 2>&1
        # MUST be set AFTER source (run.sh:760 resets TARGET_DIR at source time).
        # Consumed by the sourced auto_capture_episode, which reads these as
        # globals; the linter cannot see that cross-file use.
        # shellcheck disable=SC2034
        PROJECT_DIR="$REPO_ROOT"
        # shellcheck disable=SC2034
        TARGET_DIR="$t"
        auto_capture_episode 1 "$ec" "$phase" "$goal" 5 "/dev/null" >/dev/null 2>&1
    )
}

# run_connector_b <target> <goal> <phase> [knob] -- source run.sh and call the
# REAL retrieve_memory_context, echoing its stdout (the memory context block).
run_connector_b() {
    local t="$1" goal="$2" phase="$3" knob="${4:-1}"
    (
        export LOKI_MANAGED_AGENTS=false LOKI_MANAGED_MEMORY=false
        export LOKI_FAILURE_MEMORY="$knob"
        # shellcheck disable=SC1091
        source "$REPO_ROOT/autonomy/run.sh" >/dev/null 2>&1
        # Consumed by the sourced retrieve_memory_context, which reads these as
        # globals; the linter cannot see that cross-file use.
        # shellcheck disable=SC2034
        PROJECT_DIR="$REPO_ROOT"
        # shellcheck disable=SC2034
        TARGET_DIR="$t"
        retrieve_memory_context "$goal" "$phase" 2>/dev/null
    )
}

# episode_json <target> -- dump the contents of all stored episode files.
episode_json() {
    local t="$1"
    find "$t/.loki/memory/episodic" -name 'task-*.json' -exec cat {} \; 2>/dev/null
}

# A goal that shares ZERO tokens with "IterationError" / the stack signature.
# This is the mask the original bug hid behind: if the test only passes when the
# error class is in the goal, the test is wrong.
NONMATCH_GOAL="build a todo REST API"

# =============================================================================
# TEST 1 (PRIMARY) -- end-to-end with a crash file present
# =============================================================================
echo "--- Test 1: end-to-end, telemetry on (real crash file) ---"
T1="$TMPROOT/t1"
init_memory "$T1"
write_crash "$T1" "IterationError" "ACT"
run_connector_a "$T1" 1 ACT "$NONMATCH_GOAL"

EP1="$(episode_json "$T1")"

# 1a. an episode was actually persisted
if [ -n "$(find "$T1/.loki/memory/episodic" -name 'task-*.json' 2>/dev/null)" ]; then
    ok "t1_episode_persisted"
else
    bad "t1_episode_persisted" "no task-*.json under episodic/"
fi

# 1b. outcome is failure
if echo "$EP1" | grep -q '"outcome": "failure"'; then
    ok "t1_outcome_failure"
else
    bad "t1_outcome_failure" "episode outcome not failure; ep=$EP1"
fi

# 1c. ErrorEntry attached with the crash-DERIVED message (signature + fp),
#     NOT the telemetry-off fallback. This proves Connector A read the crash file.
if echo "$EP1" | grep -q '"message": "phase=ACT; signature:' \
   && echo "$EP1" | grep -q 'fp='; then
    ok "t1_errorentry_has_signature_and_fp"
else
    bad "t1_errorentry_has_signature_and_fp" "ErrorEntry message missing signature/fp; ep=$EP1"
fi

# 1d. Connector B surfaces the block with a NON-matching goal, and the block
#     contains the error_type AND the discriminating signature/fp text.
B1="$(run_connector_b "$T1" "$NONMATCH_GOAL" "ACT")"
if echo "$B1" | grep -q "PAST FAILURES TO AVOID:"; then
    ok "t1_block_header_present"
else
    bad "t1_block_header_present" "no PAST FAILURES block; out=$B1"
fi
if echo "$B1" | grep -q "IterationError" \
   && echo "$B1" | grep -q "signature:" \
   && echo "$B1" | grep -q "fp="; then
    ok "t1_block_has_error_type_and_message"
else
    bad "t1_block_has_error_type_and_message" "block missing type/signature/fp; out=$B1"
fi

# =============================================================================
# TEST 2 -- knob off (LOKI_FAILURE_MEMORY=0) is inert
# =============================================================================
echo "--- Test 2: LOKI_FAILURE_MEMORY=0 attaches no ErrorEntry, emits no block ---"
T2="$TMPROOT/t2"
init_memory "$T2"
write_crash "$T2" "IterationError" "ACT"
run_connector_a "$T2" 1 ACT "$NONMATCH_GOAL" 0   # knob off

EP2="$(episode_json "$T2")"
# Episode is still captured (knob only gates the ErrorEntry), but with NO error.
if echo "$EP2" | grep -q '"errors_encountered": \[\]'; then
    ok "t2_no_errorentry_when_off"
else
    bad "t2_no_errorentry_when_off" "errors_encountered not empty with knob off; ep=$EP2"
fi

B2="$(run_connector_b "$T2" "$NONMATCH_GOAL" "ACT" 0)"   # knob off
if echo "$B2" | grep -q "PAST FAILURES TO AVOID:"; then
    bad "t2_no_block_when_off" "block emitted with knob off; out=$B2"
else
    ok "t2_no_block_when_off"
fi

# =============================================================================
# TEST 3 -- telemetry-off fallback (no crash file)
# =============================================================================
echo "--- Test 3: no crash file, knob on -> synthesized ErrorEntry ---"
T3="$TMPROOT/t3"
init_memory "$T3"
# Deliberately do NOT write a crash file (simulates telemetry off). There is no
# .loki/crash dir at all, so Connector A's bash guard sets _crash_json="".
run_connector_a "$T3" 1 VERIFY "$NONMATCH_GOAL"

EP3="$(episode_json "$T3")"
# 3a. synthesized message uses ONLY non-sensitive fields: phase + exit.
if echo "$EP3" | grep -q '"message": "phase=VERIFY; exit=1"'; then
    ok "t3_fallback_message_phase_exit"
else
    bad "t3_fallback_message_phase_exit" "fallback message not phase=VERIFY; exit=1; ep=$EP3"
fi
# 3b. error_type defaults to IterationError
if echo "$EP3" | grep -q '"type": "IterationError"'; then
    ok "t3_fallback_error_type"
else
    bad "t3_fallback_error_type" "fallback error_type not IterationError; ep=$EP3"
fi
# 3c. Connector B still surfaces it
B3="$(run_connector_b "$T3" "$NONMATCH_GOAL" "VERIFY")"
if echo "$B3" | grep -q "PAST FAILURES TO AVOID:" \
   && echo "$B3" | grep -q "phase=VERIFY; exit=1"; then
    ok "t3_fallback_block_surfaced"
else
    bad "t3_fallback_block_surfaced" "fallback block not surfaced; out=$B3"
fi

# =============================================================================
# TEST 4 -- recency order: 3 NEWEST shown, OLD one dropped (validates [:3])
# =============================================================================
echo "--- Test 4: recency order, oldest failure dropped ---"
T4="$TMPROOT/t4"
init_memory "$T4"
# Seed 4 failure episodes with DISTINCT message markers. Three land in TODAY's
# date dir; ONE is backdated to YESTERDAY (still inside the now-24h window
# because list_episodes floors `since` to midnight, but its date dir sorts after
# today's, so the [:3] slice drops it). We backdate by setting the trace
# timestamp before save_episode (storage derives the date dir from
# timestamp[:10]). We assert SET MEMBERSHIP (old marker absent, 3 new present),
# never within-3 ordering, because within a day the file order is by random uuid,
# not wall-clock.
PROJECT_DIR="$REPO_ROOT" python3 - "$REPO_ROOT" "$T4" <<'PY'
import sys
from datetime import datetime, timezone, timedelta
sys.path.insert(0, sys.argv[1])
from memory.engine import MemoryEngine, create_storage
from memory.schemas import EpisodeTrace, ErrorEntry
t = sys.argv[2]
storage = create_storage(f'{t}/.loki/memory')
eng = MemoryEngine(storage=storage, base_path=f'{t}/.loki/memory')
eng.initialize()

def mk(marker, when):
    tr = EpisodeTrace.create(task_id='it', agent='loki-orchestrator',
                             phase='ACT', goal='build a todo REST API')
    tr.outcome = 'failure'
    tr.timestamp = when  # storage uses timestamp[:10] for the date dir
    tr.errors_encountered.append(
        ErrorEntry(error_type='IterationError', message=marker, resolution=''))
    eng.store_episode(tr)

now = datetime.now(timezone.utc)
yesterday = now - timedelta(days=1)
# OLD (yesterday): inside the 24h-floored-to-midnight window, but older date dir.
mk('MARKER_OLD', yesterday)
# Three NEW (today).
mk('MARKER_NEW1', now)
mk('MARKER_NEW2', now)
mk('MARKER_NEW3', now)
PY

B4="$(run_connector_b "$T4" "$NONMATCH_GOAL" "ACT")"
# Exactly 3 lesson lines under the block (cap is 3).
LESSON_LINES=$(echo "$B4" | grep -c "IterationError:")
if [ "$LESSON_LINES" -eq 3 ]; then
    ok "t4_exactly_three_lessons"
else
    bad "t4_exactly_three_lessons" "expected 3 lesson lines, got $LESSON_LINES; out=$B4"
fi
# All 3 NEW markers present.
if echo "$B4" | grep -q "MARKER_NEW1" \
   && echo "$B4" | grep -q "MARKER_NEW2" \
   && echo "$B4" | grep -q "MARKER_NEW3"; then
    ok "t4_all_new_markers_present"
else
    bad "t4_all_new_markers_present" "a new marker is missing; out=$B4"
fi
# OLD marker dropped by the [:3] slice.
if echo "$B4" | grep -q "MARKER_OLD"; then
    bad "t4_old_marker_dropped" "old marker survived the [:3] slice; out=$B4"
else
    ok "t4_old_marker_dropped"
fi

# =============================================================================
# TEST 5 -- privacy: poisoned input in, no leak out
# =============================================================================
echo "--- Test 5: privacy, poisoned crash input never leaks to ErrorEntry/block ---"
T5="$TMPROOT/t5"
init_memory "$T5"
# The crash file is written from a raw stack/message containing a home path, an
# email, and an IP. crash_redact strips them BEFORE the file is written; this
# test guards that the failure-memory loop ADDS no new leak on top.
write_crash "$T5" "IterationError" "ACT"
run_connector_a "$T5" 1 ACT "$NONMATCH_GOAL"

EP5="$(episode_json "$T5")"
B5="$(run_connector_b "$T5" "$NONMATCH_GOAL" "ACT")"
COMBINED5="$EP5
$B5"

leak_found=0
for needle in "$POISON_PATH" "/Users/" "$POISON_EMAIL" "$POISON_IP"; do
    if echo "$COMBINED5" | grep -qF "$needle"; then
        bad "t5_no_leak" "leaked '$needle' into ErrorEntry/block"
        leak_found=1
    fi
done
if [ "$leak_found" -eq 0 ]; then
    ok "t5_no_leak"
fi
# Sanity: the block was actually produced (so the no-leak check has teeth).
if echo "$B5" | grep -q "PAST FAILURES TO AVOID:"; then
    ok "t5_block_actually_rendered"
else
    bad "t5_block_actually_rendered" "no block rendered; the privacy check would be vacuous; out=$B5"
fi

# =============================================================================
# TEST 6 -- within-day recency order (regression for the uuid-order bug)
# =============================================================================
echo "--- Test 6: within-day recency, 3 newest same-day failures retained ---"
T6="$TMPROOT/t6"
init_memory "$T6"
# Regression for the bug Test 4 missed. Connector B used to take list_episodes
# order + [:3]. list_episodes is newest-DAY first, but WITHIN a day the files
# sort by the episode id's random uuid suffix (schemas.py id = date + uuid8), so
# same-day order did NOT follow wall-clock. With >3 same-day failures (the long-
# run scenario) that dropped the most-recent lesson ~2/10 runs.
#
# Here we seed 5 FAILURE episodes ALL DATED TODAY (same date dir) with DISTINCT
# timestamps 4 minutes apart, markers NEW1..NEW5 where NEW5 is the newest. The
# fix carries each episode's timestamp into the tuple and sorts by it (reverse)
# before [:3], so the block must contain the 3 NEWEST (NEW5, NEW4, NEW3) and
# must NOT contain the 2 oldest (NEW1, NEW2). This asserts ORDERING within a
# single day, not just set membership.
#
# Against the OLD code this assertion fails whenever the uuid order happens to
# rank an older same-day episode ahead of NEW5/NEW4/NEW3 (NEW1 or NEW2 surfacing,
# or a newest marker being dropped); against the timestamp-sort fix it is
# deterministic.
PROJECT_DIR="$REPO_ROOT" python3 - "$REPO_ROOT" "$T6" <<'PY'
import sys
from datetime import datetime, timezone, timedelta
sys.path.insert(0, sys.argv[1])
from memory.engine import MemoryEngine, create_storage
from memory.schemas import EpisodeTrace, ErrorEntry
t = sys.argv[2]
storage = create_storage(f'{t}/.loki/memory')
eng = MemoryEngine(storage=storage, base_path=f'{t}/.loki/memory')
eng.initialize()

def mk(marker, when):
    tr = EpisodeTrace.create(task_id='it', agent='loki-orchestrator',
                             phase='ACT', goal='build a todo REST API')
    tr.outcome = 'failure'
    tr.timestamp = when  # all SAME DAY; only the time-of-day differs
    tr.errors_encountered.append(
        ErrorEntry(error_type='IterationError', message=marker, resolution=''))
    eng.store_episode(tr)

# Anchor a few hours into today (UTC) so all 5 share the same date dir even
# after the 4-minute spacing, regardless of when the test runs.
base = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
# NEW1 oldest ... NEW5 newest, 4 minutes apart.
mk('MARKER_NEW1', base + timedelta(minutes=0))
mk('MARKER_NEW2', base + timedelta(minutes=4))
mk('MARKER_NEW3', base + timedelta(minutes=8))
mk('MARKER_NEW4', base + timedelta(minutes=12))
mk('MARKER_NEW5', base + timedelta(minutes=16))
PY

B6="$(run_connector_b "$T6" "$NONMATCH_GOAL" "ACT")"
# Exactly 3 lesson lines (cap is 3).
LESSON_LINES6=$(echo "$B6" | grep -c "IterationError:")
if [ "$LESSON_LINES6" -eq 3 ]; then
    ok "t6_exactly_three_lessons"
else
    bad "t6_exactly_three_lessons" "expected 3 lesson lines, got $LESSON_LINES6; out=$B6"
fi
# The 3 NEWEST same-day failures must be present.
if echo "$B6" | grep -q "MARKER_NEW5" \
   && echo "$B6" | grep -q "MARKER_NEW4" \
   && echo "$B6" | grep -q "MARKER_NEW3"; then
    ok "t6_three_newest_sameday_present"
else
    bad "t6_three_newest_sameday_present" "a newest same-day marker is missing; out=$B6"
fi
# The 2 OLDEST same-day failures must be dropped (this is the within-day
# ordering assertion the old uuid-order [:3] could not guarantee).
if echo "$B6" | grep -q "MARKER_NEW1" || echo "$B6" | grep -q "MARKER_NEW2"; then
    bad "t6_two_oldest_sameday_dropped" "an older same-day marker surfaced (within-day ordering bug); out=$B6"
else
    ok "t6_two_oldest_sameday_dropped"
fi

echo ""
echo "failure_memory_loop: passed=$PASS failed=$FAIL"
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
