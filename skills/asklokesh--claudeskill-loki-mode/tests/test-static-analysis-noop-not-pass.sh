#!/usr/bin/env bash
# A gate that scanned nothing must not report a pass.
#
# SCOPE NOTE: this suite has outgrown its filename. It began as the guard for
# the static_analysis no-op (below) and now guards every receipt-integrity fix
# from the same audit: static_analysis (v9.37.0), unit_tests (v9.37.0),
# phantom council reviewers (v9.38.0), and disabled_phases (v9.38.0). They
# share one suite because they share ONE defect shape -- a receipt field that
# degrades to a value indistinguishable from success -- and splitting them
# would let a reader fix one while believing the shape was handled.
# If you are looking for a receipt-honesty guard by name, it is here.
#
# THE DEFECT, found by a receipt-integrity audit and confirmed on a real
# artifact: enforce_static_analysis used to `touch static-analysis.pass` and
# return 0 when there were no changed files to check. The receipt reader
# promotes a bare .pass marker straight to status "passed"
# (proof-generator.py:352-353), so a gate that examined ZERO files rendered
# identically to one that examined everything and found it clean.
#
# WHY IT IS NOT COSMETIC. static_analysis is typically the ONLY exogenous
# (agent-independent) gate in a receipt, and `any_verified`
# (proof-generator.py:1694-1707) is satisfied by a single passed exogenous gate.
# So this no-op pass was the one term standing between the honest headline
# "NOT VERIFIED" and "VERIFIED WITH GAPS". Measured, both directions:
#
#   static_analysis=passed        -> VERIFIED WITH GAPS
#   static_analysis=inconclusive  -> NOT VERIFIED
#
# Observed on a real run in a NON-GIT directory: file discovery is git-based, so
# changed_files was empty, the gate examined none of the three files the run had
# just created, and the receipt still reported a passing exogenous gate. On disk
# that run left static-analysis.pass at 0 bytes with static-analysis.json ABSENT
# -- a combination only the no-changed-files early return can produce.
#
# INCONCLUSIVE, NOT FAILED, is load-bearing. Having nothing to scan is not a
# defect in the delivered code. Reporting it as a failure would trade one
# dishonesty for another, and would also block runs that legitimately changed
# nothing. The gate still returns 0; only the CLAIM changes.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
WORK="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-static-analysis-noop-not-pass"

if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 unavailable: the no-op gate claim was not measured (unmeasured, not clean)"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

# 1. The writer must NOT create the pass marker on the empty-input path. The
#    marker is what the reader checks FIRST, so writing an honest JSON while
#    leaving the marker in place would keep the lie.
# Match EXECUTABLE lines only. A first version of this check matched the comment
# that explains the fix ("This used to `touch static-analysis.pass`") and failed
# on correct code -- the same text-guard-fires-on-its-own-docs trap this repo has
# hit before. Strip comments before testing.
if awk '
    /if \[ -z "\$changed_files" \]; then/ { inblock = 1 }
    inblock {
        line = $0
        sub(/[[:space:]]*#.*$/, "", line)
        if (line ~ /touch[[:space:]]+.*static-analysis\.pass/) found = 1
    }
    inblock && /^    fi$/ { exit }
    END { exit found ? 1 : 0 }
' autonomy/run.sh; then
    pass "the no-changed-files path does not touch the pass marker"
else
    fail "the empty-input path still touches static-analysis.pass; a no-op scan reports passed"
fi

# 2. It must record the scan honestly instead: zero files, inconclusive.
if awk '
    /if \[ -z "\$changed_files" \]; then/ { inblock = 1 }
    inblock && /"files_checked":0/ && /"status":"inconclusive"/ { found = 1 }
    inblock && /^    fi$/ { exit }
    END { exit found ? 0 : 1 }
' autonomy/run.sh; then
    pass "the no-changed-files path records files_checked:0 status:inconclusive"
else
    fail "no honest zero-scan record is written; the gate's outcome is simply absent"
fi

# 3. BEHAVIOUR, driven through the real reader: an inconclusive zero-file scan
#    must NOT count as a passed exogenous gate. This is the assertion that
#    actually protects the headline.
cat > "$WORK/probe.py" <<'PYEOF'
import importlib.util, json, os, sys, tempfile
spec = importlib.util.spec_from_file_location("pg", "autonomy/lib/proof-generator.py")
m = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(m)
except SystemExit:
    pass

def collect(write_marker, result_json):
    d = tempfile.mkdtemp()
    q = os.path.join(d, "quality")
    os.makedirs(q)
    if write_marker:
        open(os.path.join(q, "static-analysis.pass"), "w").close()
    if result_json is not None:
        json.dump(result_json, open(os.path.join(q, "static-analysis.json"), "w"))
    return m._collect_quality_gates(d)

honest = {"timestamp": "t", "files_checked": 0, "findings": 0,
          "summary": "nothing scanned", "status": "inconclusive",
          "reason": "no_changed_files"}

new = collect(False, honest)
old = collect(True, None)

new_sa = [g for g in (new.get("gates") or []) if g["name"] == "static_analysis"]
old_sa = [g for g in (old.get("gates") or []) if g["name"] == "static_analysis"]

checks = {
    "old_was_passed": bool(old_sa) and old_sa[0]["status"] == "passed",
    "new_is_inconclusive": bool(new_sa) and new_sa[0]["status"] == "inconclusive",
    "new_exogenous_passed_zero": new.get("exogenous", {}).get("passed") == 0,
    "old_exogenous_passed_one": old.get("exogenous", {}).get("passed") == 1,
}
print(json.dumps(checks))
sys.exit(0 if all(checks.values()) else 1)
PYEOF
if OUT="$(python3 "$WORK/probe.py" 2>&1)"; then
    pass "an inconclusive zero-file scan yields exogenous passed=0 (was 1)"
else
    fail "the reader still counts a zero-file scan as a passed exogenous gate: $OUT"
fi

# 4. THE HEADLINE, which is the whole point. A receipt whose only exogenous gate
#    scanned nothing must read NOT VERIFIED, not VERIFIED WITH GAPS.
cat > "$WORK/headline.py" <<'PYEOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("pg", "autonomy/lib/proof-generator.py")
m = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(m)
except SystemExit:
    pass

def headline(sa_status):
    facts = {
        "quality_gates": [
            {"name": "static_analysis", "status": sa_status, "provenance": "exogenous"},
            {"name": "unit_tests", "status": "passed", "provenance": "advisory"},
        ],
        "tests": {"status": "not_run"},
        "build": {"status": "not_run"},
        "git": {"diff": {"count": 0}},
        "execution": {"status": "complete", "exit_code": 0},
    }
    degraded = [{"item": "tests", "status": "not_run"}]
    return m._compute_headline(facts, degraded)

before = headline("passed")
after = headline("inconclusive")
print("passed->%s inconclusive->%s" % (before, after))
# The mechanism must hold in BOTH directions, or the guard proves nothing:
# a passed exogenous gate still earns VERIFIED WITH GAPS (no over-correction),
# and an inconclusive one does not.
sys.exit(0 if before == "VERIFIED WITH GAPS" and after == "NOT VERIFIED" else 1)
PYEOF
if OUT="$(python3 "$WORK/headline.py" 2>&1)"; then
    pass "headline: a zero-file scan yields NOT VERIFIED ($OUT)"
else
    fail "the headline did not respond correctly to gate status: $OUT"
fi

# 5. The gate must still RETURN 0. Nothing to scan is not a build failure, and
#    making it one would block every run that legitimately changed nothing.
if awk '
    /if \[ -z "\$changed_files" \]; then/ { inblock = 1 }
    inblock && /^        return 0$/ { found = 1 }
    inblock && /^    fi$/ { exit }
    END { exit found ? 0 : 1 }
' autonomy/run.sh; then
    pass "the gate still returns 0; only the claim changed, not the control flow"
else
    fail "the empty-input path no longer returns 0; a no-op scan could now block a run"
fi

# 6. THE SAME DEFECT IN unit_tests. The no-test-runner branch wrote an honest
#    JSON ({"runner":"none","status":"not_run"}) and ALSO touched
#    unit-tests.pass. The reader checks the marker FIRST, so the honest record
#    was never read and the receipt claimed a passing gate for a project with no
#    tests -- contradicting honesty.degraded in the same document.
#
#    The comment that kept the touch alive asserted "unit-tests.pass is only read
#    for the status-line display". That premise was FALSE:
#    proof-generator.py:346 reads it into the receipt. Measured, not argued.
cat > "$WORK/ut.py" <<'PYEOF'
import importlib.util, json, os, sys, tempfile
spec = importlib.util.spec_from_file_location("pg", "autonomy/lib/proof-generator.py")
m = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(m)
except SystemExit:
    pass

def probe(marker, js):
    d = tempfile.mkdtemp()
    q = os.path.join(d, "quality")
    os.makedirs(q)
    if marker:
        open(os.path.join(q, "unit-tests.pass"), "w").close()
    if js:
        json.dump(js, open(os.path.join(q, "unit-tests.json"), "w"))
    g = m._collect_quality_gates(d)
    ut = [x for x in (g.get("gates") or []) if x["name"] == "unit_tests"]
    return (ut[0]["status"] if ut else "ABSENT"), g.get("advisory", {}).get("passed")

# All three outcomes must stay DISTINCT. Fixing the no-runner case must not
# break the two legitimate ones.
real_pass = probe(True, None)
no_runner = probe(False, {"runner": "none", "status": "not_run"})
real_fail = probe(False, {"runner": "jest", "pass": False})

checks = {
    "real_pass_still_passed": real_pass[0] == "passed",
    "no_runner_not_passed": no_runner[0] != "passed",
    "real_fail_still_failed": real_fail[0] == "failed",
}
print(json.dumps({"real_pass": real_pass, "no_runner": no_runner, "real_fail": real_fail}))
sys.exit(0 if all(checks.values()) else 1)
PYEOF
if OUT="$(python3 "$WORK/ut.py" 2>&1)"; then
    pass "unit_tests: no-runner is not a pass, while real pass/fail are unchanged"
else
    fail "unit_tests gate states are wrong: $OUT"
fi

# 7. The writer must not re-introduce the touch on the no-runner path.
#    THIS is the assertion that catches a writer regression. Assertion 6 drives
#    the READER with synthetic fixtures, so it verifies the reader's semantics
#    but stays green if the writer starts touching the marker again. Verified by
#    mutation: restoring the touch leaves 6 green and turns 7 red. Both are kept
#    -- 6 proves the three gate states stay distinct, 7 proves the writer is
#    honest -- but only 7 guards the defect that actually shipped.
if awk '
    /_vgap_summary="No test runner detected"/ { inblock = 1 }
    inblock {
        line = $0
        sub(/[[:space:]]*#.*$/, "", line)
        if (line ~ /touch[[:space:]]+.*unit-tests\.pass/) found = 1
    }
    inblock && /^    fi$/ { exit }
    END { exit found ? 1 : 0 }
' autonomy/run.sh; then
    pass "the no-test-runner path does not touch unit-tests.pass"
else
    fail "the no-runner path touches unit-tests.pass again; a testless project reports a passing gate"
fi

# 8. PHANTOM REVIEWERS. The council block is the receipt's central trust signal,
#    so a padded roster overstates how much independent review happened. The
#    nested vote path already refused a row with a blank role AND blank vote
#    ("noise, not a reviewer"); the FLAT path did not, so any council/*.json that
#    is not a verdict file rendered as an empty reviewer. Observed on a real run:
#    evidence-gate-details.json and state.json inflated a genuine 3-voter council.
cat > "$WORK/council.py" <<'PYEOF'
import importlib.util, json, os, sys, tempfile
spec = importlib.util.spec_from_file_location("pg", "autonomy/lib/proof-generator.py")
m = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(m)
except SystemExit:
    pass

# Reproduce the real shape: three genuine verdict files plus two non-reviewer
# files that live in the same directory and match the same glob.
# Mirrors the REAL layout: _collect_council reads council/votes/, where a
# round file carries nested per-member votes and a devil's-advocate RESULT file
# (issues_found/override/details -- no role, no vote) sits beside it. That DA
# file is what rendered as a phantom reviewer on the observed run.
d = tempfile.mkdtemp()
vdir = os.path.join(d, "council", "votes")
os.makedirs(vdir)
json.dump({
    "round": 1, "threshold": 2, "total_members": 3, "expected_members": 3,
    "complete_votes": 3, "continue_votes": 0, "verdict": "COMPLETE",
    "votes": [
        {"role": "convergence-voter", "vote": "COMPLETE", "reason": "ok"},
        {"role": "requirements-verifier", "vote": "COMPLETE", "reason": "ok"},
        {"role": "test-auditor", "vote": "COMPLETE", "reason": "ok"},
    ],
}, open(os.path.join(vdir, "round-1.json"), "w"))
json.dump({"round": 1, "issues_found": 0, "override": False, "details": "none"},
          open(os.path.join(vdir, "devils-advocate-round-1.json"), "w"))

c = m._collect_council(d)
rs = c.get("reviewers") or []
roles = sorted(r.get("role") or "" for r in rs)
print(json.dumps({"count": len(rs), "roles": roles}))
# Every rendered reviewer must carry a role or a vote; the three real voters
# must all survive (a guard that dropped real reviewers would be worse).
blank = [r for r in rs if not (r.get("role") or r.get("vote"))]
sys.exit(0 if not blank and len(rs) == 3 else 1)
PYEOF
if OUT="$(python3 "$WORK/council.py" 2>&1)"; then
    pass "the council roster carries only real reviewers ($OUT)"
else
    fail "phantom or missing reviewers in the council roster: $OUT"
fi

# 9. DISABLED PHASES MUST BE VISIBLE. The receipt derives disabled_phases by
#    scanning the environment for LOKI_PHASE_* set to false, so a phase that is
#    disabled but never EXPORTED is invisible to it. loki_apply_build_profile
#    exported only the phases it leaves ON, so a narrowed run reported
#    disabled_phases [] / all_phases_enabled true while six phases were off --
#    defeating the field's stated purpose, that a receipt must be able to say
#    what was NOT checked.
for _ph in API_TESTS INTEGRATION PERFORMANCE REGRESSION UAT WEB_RESEARCH; do
    if awk -v want="LOKI_PHASE_$_ph" '
        /^loki_apply_build_profile\(\)/ { inf = 1 }
        inf && /^[[:space:]]*export / { if (index($0, want)) { found = 1 } }
        inf && /^\}$/ { exit }
        END { exit found ? 0 : 1 }
    ' autonomy/run.sh; then
        :
    else
        fail "LOKI_PHASE_$_ph is disabled by the build profile but never exported; the receipt cannot report it"
        _ph_bad=1
    fi
done
[ -z "${_ph_bad:-}" ] && pass "every phase the build profile disables is exported so the receipt can report it"

# 10. BEHAVIOUR: the reader must surface them. Guards against the export being
#     present but the field still empty (e.g. a renamed prefix).
cat > "$WORK/phases.py" <<'PYEOF'
import importlib.util, json, os, sys, tempfile
spec = importlib.util.spec_from_file_location("pg", "autonomy/lib/proof-generator.py")
m = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(m)
except SystemExit:
    pass
d = tempfile.mkdtemp()
os.makedirs(os.path.join(d, "quality"))
for k in ("API_TESTS", "INTEGRATION", "PERFORMANCE", "REGRESSION", "UAT", "WEB_RESEARCH"):
    os.environ["LOKI_PHASE_" + k] = "false"
g = m._collect_quality_gates(d)
dp = g.get("disabled_phases") or []
print(json.dumps({"disabled_phases": dp, "all_phases_enabled": g.get("all_phases_enabled")}))
sys.exit(0 if len(dp) == 6 and g.get("all_phases_enabled") is False else 1)
PYEOF
if OUT="$(python3 "$WORK/phases.py" 2>&1)"; then
    pass "the receipt reports every disabled phase ($OUT)"
else
    fail "disabled phases are not surfaced in the receipt: $OUT"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
