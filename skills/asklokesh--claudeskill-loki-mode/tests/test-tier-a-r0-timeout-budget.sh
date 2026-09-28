#!/usr/bin/env bash
# Regression test (S-96 rework): the "Run selected suites" step in
# tier-a.yml must never carry an explicit timeout-minutes tighter than the
# job's own timeout-minutes.
#
# THE BUG. S-96 added `timeout-minutes: 20` to that step, where the R0 path
# (a broad-blast-radius diff) runs the full, unsharded, serial
# tests/run-all-tests.sh. This repo's own measured data (test.yml,
# local-ci.sh, CLAUDE.md) converges on ~24-27 minutes for that exact script
# run serially -- longer than the 20-minute cap and even longer than the
# job's 25-minute ceiling. The commit's stated intent ("give R0 its own
# explicit budget") was therefore backwards: the new step cap was TIGHTER
# than the existing job-level one, not a looser purpose-built ceiling, and
# was never checked against a real R0 --run. See the S-96 review (reworks
# scratchpad) and docs/v10/METRICS.md.
#
# Fix: no step-level timeout-minutes on that step; the job-level
# timeout-minutes remains the only cap, matching the "generous rather than
# tight" job timeout the file's own header comment already documents.
#
# This test extracts both values via a real YAML parser (never a text grep,
# which a comment mentioning "timeout-minutes" could satisfy) and fails if
# the step timeout is present and numerically less than the job timeout.
set -u
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKFLOW="$REPO_ROOT/.github/workflows/tier-a.yml"
PY=$(command -v python3.12 || command -v python3)

[ -f "$WORKFLOW" ] || { echo "FAIL: $WORKFLOW missing"; exit 1; }
[ -n "$PY" ] || { echo "SKIPPED: no python3 (cannot parse YAML)"; echo "RESULT: 0 passed, 0 failed"; exit 0; }

RESULT=$("$PY" - "$WORKFLOW" <<'PYEOF'
import sys
import yaml

with open(sys.argv[1]) as f:
    doc = yaml.safe_load(f)

job = doc.get("jobs", {}).get("select-and-run", {})
job_timeout = job.get("timeout-minutes")
if job_timeout is None:
    print("ERROR job has no timeout-minutes")
    sys.exit(1)

steps = job.get("steps", [])
run_steps = [s for s in steps if s.get("name") == "Run selected suites"]
if len(run_steps) != 1:
    print(f"ERROR expected exactly 1 step named 'Run selected suites', found {len(run_steps)}")
    sys.exit(1)

step_timeout = run_steps[0].get("timeout-minutes")
print(f"job_timeout={job_timeout}")
print(f"step_timeout={step_timeout}")
PYEOF
)
PYRC=$?
echo "$RESULT"
if [ $PYRC -ne 0 ]; then
    bad "could not isolate tier-a.yml job/step timeouts via YAML parse"
    echo ""
    echo "RESULT: $PASS passed, $FAIL failed"
    exit 1
fi
ok "isolated tier-a.yml select-and-run job timeout and 'Run selected suites' step timeout via YAML parse"

JOB_TIMEOUT=$(echo "$RESULT" | sed -n 's/^job_timeout=//p')
STEP_TIMEOUT=$(echo "$RESULT" | sed -n 's/^step_timeout=//p')

if [ "$STEP_TIMEOUT" = "None" ]; then
    ok "'Run selected suites' step has no step-level timeout-minutes; job-level ${JOB_TIMEOUT}m is the only cap"
elif [ "$STEP_TIMEOUT" -lt "$JOB_TIMEOUT" ] 2>/dev/null; then
    bad "'Run selected suites' step timeout-minutes ($STEP_TIMEOUT) is tighter than the job timeout-minutes ($JOB_TIMEOUT) -- caps the R0 full-suite run (~24-27min measured) below even the job's own ceiling"
else
    ok "'Run selected suites' step timeout-minutes ($STEP_TIMEOUT) is not tighter than the job timeout-minutes ($JOB_TIMEOUT)"
fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
