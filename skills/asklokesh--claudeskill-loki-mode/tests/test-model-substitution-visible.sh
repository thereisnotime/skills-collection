#!/usr/bin/env bash
# A model substitution must be visible, attributable, and non-fatal.
#
# THE DEFECT: when an operator pins a model and the runner dispatches a
# different one, the receipt shows only the dispatched model. Nothing records
# that a pin existed, what it was, or why it was not honored. The substitution
# itself may be entirely correct -- `fable` collapses to `opus` because Claude
# Fable 5 was reported unavailable at the Claude API -- but a SILENT correct
# substitution is indistinguishable from a silent wrong one, and neither can be
# audited or refuted.
#
# WHAT IS NOT ASSERTED HERE, deliberately: whether fable->opus is the RIGHT
# mapping. That premise is transport-specific (the CLI accepts the alias under
# subscription auth; the comment cites an error from the raw API) and settling it
# needs a real API key. This suite asserts only that whatever the runner
# substitutes, it SAYS SO. That holds regardless of which way the premise falls,
# which is exactly why it is the part worth shipping now.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
WORK="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-model-substitution-visible"

if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 unavailable: substitution visibility was not measured (unmeasured, not clean)"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

# Extract the helpers into a sourceable file so the unit can be DRIVEN DIRECTLY.
# Driving the unit is what makes a failure attributable: the collapse also has a
# static-fallback path and an estimator path, so a test that only ran a whole
# iteration could stay green because some other path produced the same model.
HELP="$WORK/helpers.sh"
awk '/^emit_event_json\(\) \{/,/^\}/' autonomy/run.sh  > "$HELP"
awk '/^emit_model_substituted\(\) \{/,/^\}/' autonomy/run.sh >> "$HELP"

if grep -q '^emit_model_substituted()' "$HELP"; then
    pass "emit_model_substituted is defined in run.sh"
else
    fail "emit_model_substituted not found; substitutions are silent again"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

log_warn() { :; }
# shellcheck disable=SC1090
. "$HELP"

# 1. A substitution is RECORDED, with every field needed to audit it. Asserted
#    field-by-field rather than "an event exists": a record missing `pinned` or
#    `reason` cannot be audited and would pass a mere existence check.
mkdir -p "$WORK/sub" && cd "$WORK/sub" || exit 1
emit_model_substituted "fable" "opus" "fable_unavailable_at_api" "run.sh:dispatch_backstop"
if [ -f .loki/events.jsonl ] && python3 -c "
import json,sys
rec=[json.loads(l) for l in open('.loki/events.jsonl') if l.strip()]
m=[r for r in rec if r.get('type')=='model_substituted']
if not m: sys.exit(1)
d=m[0].get('data',{})
sys.exit(0 if d.get('pinned')=='fable' and d.get('dispatched')=='opus'
           and d.get('reason') and d.get('site') else 1)
" 2>/dev/null; then
    pass "a substitution records pinned, dispatched, reason and site"
else
    fail "the substitution record is missing or incomplete: $(cat .loki/events.jsonl 2>/dev/null | head -c 200)"
fi

# 2. An HONORED pin must stay silent. Without this the event becomes noise on
#    every ordinary iteration and stops meaning anything.
mkdir -p "$WORK/nosub" && cd "$WORK/nosub" || exit 1
emit_model_substituted "opus" "opus" "n/a" "test"
if [ -f .loki/events.jsonl ]; then
    fail "emitted a substitution record when the pin was honored"
else
    pass "an honored pin emits nothing"
fi

# 3. NEVER FATAL. An observability record that can kill a run would be worse
#    than the silence it replaces. Driven with a deliberately broken emitter.
mkdir -p "$WORK/broken" && cd "$WORK/broken" || exit 1
( emit_event_json() { return 7; }
  emit_model_substituted "fable" "opus" "r" "s" ) >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then
    pass "a failing emitter does not fail the caller"
else
    fail "emit_model_substituted returned $rc when the emitter failed; it could abort a run"
fi

cd "$REPO_ROOT" || exit 1

# 4. The real dispatch chokepoint must call it. Asserted on the call adjacent to
#    the collapse, not on the mere presence of the function: a helper nothing
#    invokes is exactly the "built but zero callers" pattern this repo keeps
#    finding.
if awk '/tier_param="opus"/{found=1} found && /emit_model_substituted/{print; exit}' autonomy/run.sh | grep -q emit_model_substituted; then
    pass "the dispatch backstop reports its substitution"
else
    fail "the fable->opus collapse at the dispatch backstop is still silent"
fi

# 5. GUARD AGAINST VACUITY: the collapse must still exist for the guard above to
#    be guarding anything. If the mapping is ever legitimately changed, this test
#    should be revisited deliberately rather than passing over an absent branch.
if grep -q 'tier_param" = "fable"' autonomy/run.sh; then
    pass "the collapse the record describes is still present"
else
    fail "no fable collapse found; this suite may now be asserting over nothing"
fi

# 6. THE READER PATH. An event no reader consumes is theatre: it would sit in
#    events.jsonl and never reach the tamper-evident audit chain the receipt is
#    built from. Producer -> storage -> reader must all agree on the type name.
if node -e "
var s = require('fs').readFileSync('src/audit/subscriber.js','utf8');
process.exit(/'model_substituted'\s*:\s*\{/.test(s) ? 0 : 1);
" 2>/dev/null; then
    pass "the audit subscriber maps model_substituted into the chain"
else
    fail "model_substituted has no audit mapping; the record never reaches the receipt"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
