#!/usr/bin/env bash
# A decomposed plan must reach the agent whole, or say that it did not.
#
# THE DEFECT: load_queue_tasks capped at `tasks[:3]`, applied SEPARATELY to
# in-progress.json and pending.json. A release doc decomposed into 5 tasks
# silently lost 2 from each file. The agent received a partial plan and was
# never told it was partial, so it would confidently build the wrong subset.
# This sits directly under the founder-facing case "hand it a release doc".
#
# WHY A COUNT WAS THE WRONG BOUND: one rich PRD task (300-char description plus
# acceptance criteria plus a user story) can outweigh ten legacy one-liners. The
# real constraint is prompt budget, so the bound is characters.
#
# WHAT IS LOAD-BEARING: truncation must be DISCLOSED. Silently dropping work is
# the same defect class as a gate that reports a pass without scanning. And at
# any budget, at least one task must survive.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-queue-tasks-not-truncated"

if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 unavailable: the queue loader was NOT exercised (unmeasured)"
    echo "  $PASS passed, $FAIL failed"; exit 1
fi

WORK="$(mktemp -d)"
trap 'rmdir "$WORK/.loki/queue" 2>/dev/null; rmdir "$WORK/.loki" 2>/dev/null; true' EXIT

# Extract the embedded python rather than re-implementing it, so this tests the
# SHIPPED script and not a copy that can drift.
python3 - "$REPO_ROOT/autonomy/run.sh" "$WORK/extract.py" <<'EXTRACT'
import io, sys
s = io.open(sys.argv[1], encoding="utf-8").read()
i = s.index("local extract_script='")
j = s.index("'", i + 25)
io.open(sys.argv[2], "w", encoding="utf-8").write(s[i + 22:j])
EXTRACT

if [ ! -s "$WORK/extract.py" ]; then
    fail "could not extract the queue script: NOTHING was measured"
    echo "  $PASS passed, $FAIL failed"; exit 1
fi

mkdir -p "$WORK/.loki/queue"
_mk() { python3 -c "
import json, sys
n = int(sys.argv[1]); desc = 'x' * int(sys.argv[2])
tasks = [{'id': 'prd-%d' % i, 'source': 'prd', 'title': 'Task %d' % i,
          'description': desc} for i in range(1, n + 1)]
json.dump({'tasks': tasks}, open(sys.argv[3], 'w'))
" "$1" "$2" "$WORK/.loki/queue/pending.json"; }

# 1. THE DEFECT ITSELF: five tasks must yield five, not three.
_mk 5 20
N="$( (cd "$WORK" && python3 extract.py 2>/dev/null) | grep -cE '^PENDING\[' | tr -d ' ')"
if [ "${N:-0}" -eq 5 ]; then
    pass "a 5-task queue reaches the prompt whole (was capped at 3)"
else
    fail "a 5-task queue yielded ${N:-0} tasks"
fi

# 2. The old hardcoded cap must be gone from the CODE.
#    Comments are stripped first: the comment explaining this very fix mentions
#    `tasks[:3]`, so a naive grep fails on correct code. That trap is on record
#    in this repo and it fired here on the first run of this suite.
STRIPPED="$WORK/stripped.sh"
sed 's/#.*//' autonomy/run.sh > "$STRIPPED"
if grep -q 'tasks\[:3\]' "$STRIPPED"; then
    fail "the tasks[:3] cap is back"
else
    pass "no hardcoded 3-task cap in the code"
fi

# 3. A tight budget must still yield at least one task, never an empty plan.
_mk 20 250
N1="$( (cd "$WORK" && LOKI_QUEUE_TASK_CHARS=10 python3 extract.py 2>/dev/null) | grep -cE '^PENDING\[' | tr -d ' ')"
if [ "${N1:-0}" -ge 1 ]; then
    pass "a tight budget still yields at least one task ($N1)"
else
    fail "a tight budget produced an empty plan"
fi

# 4. TRUNCATION MUST BE DISCLOSED. This separates a bound from a silent drop.
if (cd "$WORK" && LOKI_QUEUE_TASK_CHARS=10 python3 extract.py 2>/dev/null) | grep -q 'more task(s) not shown'; then
    pass "truncation is disclosed in the prompt, not hidden"
else
    fail "tasks were dropped with no disclosure to the agent"
fi

# 5. NO false disclosure when nothing was dropped.
_mk 4 20
if (cd "$WORK" && python3 extract.py 2>/dev/null) | grep -q 'more task(s) not shown'; then
    fail "claims truncation when all tasks fit"
else
    pass "no truncation notice when everything fits"
fi

# 6. GUARD AGAINST VACUITY: the extracted script must really be the loader.
if grep -q 'extract_tasks' "$WORK/extract.py"; then
    pass "the extracted script is the real queue loader"
else
    fail "extracted script is not the loader; assertions are vacuous"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
