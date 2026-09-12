#!/usr/bin/env bash
# The completion council must report how long it took.
#
# THE DEFECT: fifteen build stages emit a `stage_complete` record carrying
# duration_s, and the completion council -- measured at 142s on a one-function
# build, the largest single cost in the run -- emitted none. Its cost could
# therefore only be INFERRED from artifact mtimes.
#
# That inference is invalid, and this suite exists because I made it and was
# wrong: an mtime says WHEN a file was written, not how long the step that wrote
# it took. Reading a 58s gap between two mtimes as "wiki generation costs 58s"
# produced a confident, retracted claim; measured directly, that generator runs
# in 0.09s. A profile assembled from mtimes is archaeology, not measurement.
#
# WHAT IS LOAD-BEARING: the record must be ADDITIVE. The council decides whether
# a build stops; an observability record that could change that verdict, alter an
# exit code, or abort the run would be far worse than the missing number it
# replaces. These assertions check the timing is emitted AND that emitting it
# cannot affect the decision.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
WORK="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-council-stage-timing"

if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 unavailable: council timing was not measured (unmeasured, not clean)"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

# 1. The council call site must be bracketed by a timing emit. Asserted on the
#    stage NAME at an emit_stage_complete call, not on a comment mentioning it.
if grep -q 'emit_stage_complete "completion_council"' autonomy/run.sh; then
    pass "the completion council emits a stage_complete record"
else
    fail "no completion_council stage_complete; the largest cost stays unattributed"
fi

# 2. The start timestamp must be captured BEFORE the council runs, or the
#    duration measures nothing. Assert ordering, not mere presence.
COUNCIL_ORDER="$(awk '
    /_council_t0=\$\(date/           { t0 = NR }
    /council_should_stop/            { if (t0 && !call) call = NR }
    /emit_stage_complete "completion_council"/ { if (t0 && call) { print "OK"; exit } }
' autonomy/run.sh)"
if [ "$COUNCIL_ORDER" = "OK" ]; then
    pass "t0 is captured before the council call and emitted after it"
else
    fail "the timing bracket is out of order; duration_s would be meaningless"
fi

# 3. ADDITIVE: the emit must not be able to change the completion decision. The
#    council's verdict lives in _loki_completion_ready; the emit must only READ
#    it. A mutation here would silently flip builds between complete and not.
# The window must cover BOTH sides of the emit. A first version of this check
# only looked FORWARD from the emit line, so an assignment placed just BEFORE it
# -- which silently marks every build complete -- passed the test. Caught by
# mutation: injecting `_loki_completion_ready=0` above the emit stayed green.
# Guarded region: the lines BETWEEN the council's if/elif/fi block and the emit.
# The council's own `_loki_completion_ready=0` lines live INSIDE that block and
# are the legitimate verdict, so they must not be flagged; anything assigning to
# the verdict outside it, on either side of the emit, must be.
#
# Two mutations shaped this check, and both had to fail before it was trusted: a
# forward-only window missed an assignment placed just BEFORE the emit, and a
# whole-block window flagged the council's own verdict lines on clean code.
if awk '
    /_council_t0=\$\(date/                   { armed = 1; next }
    armed && /^[[:space:]]*fi[[:space:]]*$/    { closed = 1; next }
    armed && closed                            { block = block "\n" $0 }
    # Keep collecting PAST the emit, up to the next real statement, so an
    # assignment placed on either side of it is inside the guarded region.
    /"\$_council_t0" 2>\/dev\/null \|\| true/  { if (armed && closed) past = 1; next }
    past && /^[[:space:]]*if \[/ {
        exit (block ~ /_loki_completion_ready=/) ? 1 : 0
    }
' autonomy/run.sh; then
    pass "the emit reads the verdict without assigning to it"
else
    fail "the timing emit assigns to _loki_completion_ready; it can change the build verdict"
fi

# 4. NEVER FATAL. Driven directly against the real helper rather than asserted
#    from the source text: a failing emitter must not propagate a non-zero exit
#    into the post-iteration path, which runs under set -e in places.
HELP="$WORK/helpers.sh"
awk '/^emit_event_json\(\) \{/,/^\}/'     autonomy/run.sh  > "$HELP"
awk '/^emit_stage_complete\(\) \{/,/^\}/' autonomy/run.sh >> "$HELP"
mkdir -p "$WORK/drive" && cd "$WORK/drive" || exit 1
# shellcheck disable=SC1090
. "$HELP"
( emit_event_json() { return 7; }
  emit_stage_complete "completion_council" "pass" "$(date +%s)" ) >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then
    pass "a failing emitter does not fail the caller"
else
    fail "emit_stage_complete returned $rc when the emitter failed; it could abort a run"
fi

# 5. The record must carry a usable duration. Driven with a known elapsed time so
#    a record that emits duration_s=0 for real work is caught.
emit_stage_complete "completion_council" "pass" "$(( $(date +%s) - 7 ))"
if [ -f .loki/events.jsonl ] && python3 -c "
import json,sys
rec=[json.loads(l) for l in open('.loki/events.jsonl') if l.strip()]
m=[r for r in rec if r.get('type')=='stage_complete'
   and r.get('data',{}).get('stage')=='completion_council']
if not m: sys.exit(1)
d=m[-1]['data']
sys.exit(0 if isinstance(d.get('duration_s'), int) and d['duration_s'] >= 7
           and d.get('status') in ('pass','fail','not_run') else 1)
" 2>/dev/null; then
    pass "the record carries a real duration_s and a valid status"
else
    fail "the council record is missing duration_s or carries a bad status: $(cat .loki/events.jsonl 2>/dev/null | head -c 200)"
fi

cd "$REPO_ROOT" || exit 1

# 6. GUARD AGAINST VACUITY. These assertions are only worth anything while the
#    other stages are instrumented too -- if that convention were removed, this
#    suite would still pass while the profile it protects had disappeared.
NSTAGES="$(grep -c 'emit_stage_complete "' autonomy/run.sh | tr -d ' ')"
if [ "${NSTAGES:-0}" -ge 10 ]; then
    pass "$NSTAGES stages emit timing records"
else
    fail "only ${NSTAGES:-0} stage timing emits found; the profile is too thin to mean anything"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
