#!/usr/bin/env bash
# A policy file that exists must never be silently unenforced.
#
# THE DEFECT: check_policy returned 0 (allow) when node was missing, even though
# reaching that line means a policy file EXISTS and the operator has expressed
# intent to enforce. The run proceeded exactly as if every action were permitted,
# and nothing was logged. That is the worst shape a security control can take:
# the operator believes it is on.
#
# check.js already fails CLOSED on a corrupt policy file
# (tests/test-policy-failclosed.sh), so the missing-runtime path was the one
# remaining silent bypass on this branch.
#
# The no-policy-file case must STILL allow. That is not a bypass, it is the
# absence of any policy to apply, and turning it into a refusal would break
# every user who has never written one.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1
WORK="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "test-policy-node-failclosed"

summarize_and_exit() {
    echo "  $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]
    exit $?
}

# Drive the REAL check_policy by extracting it from run.sh rather than copying
# it: a second implementation is how the two drift apart silently.
python3 - <<'PY' > "$WORK/check_policy.sh" 2>/dev/null
import io
s = io.open('autonomy/run.sh', encoding='utf-8').read()
rest = s[s.index('check_policy() {'):]
end = rest.index('\n}\n') + len('\n}\n')
print(rest[:end])
PY

if [ ! -s "$WORK/check_policy.sh" ]; then
    fail "could not extract check_policy from run.sh (unmeasured, not clean)"
    summarize_and_exit
fi
pass "extracted the real check_policy from run.sh"

# Minimal stubs for what the function logs and records.
cat > "$WORK/harness.sh" <<'HARNESS'
log_error() { echo "ERROR: $*"; }
log_warn()  { echo "WARN: $*"; }
audit_agent_action() { echo "AUDIT: $1"; }
emit_event_json() { echo "EVENT: $1"; }
HARNESS

# A PATH carrying the usual tools but deliberately WITHOUT node.
NODELESS="$WORK/nodeless"
mkdir -p "$NODELESS"
for b in sh bash cat grep sed awk pwd python3 dirname basename; do
    src="$(command -v "$b" 2>/dev/null)" && ln -sf "$src" "$NODELESS/$b" 2>/dev/null
done

# $1 = dir to run in, $2 = extra env assignment ("" for none)
run_case() {
    ( cd "$1" || exit 99
      SCRIPT_DIR="$REPO_ROOT/autonomy"
      # shellcheck disable=SC1090
      . "$WORK/harness.sh"
      # shellcheck disable=SC1090
      . "$WORK/check_policy.sh"
      if [ -n "$2" ]; then
          export "${2?}"
      fi
      PATH="$NODELESS" check_policy "pre_execution" '{}'
      echo "RC=$?"
    ) 2>&1
}

# 1. NO policy file + no node -> ALLOW. Absence of policy is not a bypass.
mkdir -p "$WORK/nopolicy/.loki"
out="$(run_case "$WORK/nopolicy" "")"
if printf '%s' "$out" | grep -q 'RC=0'; then
    pass "no policy file: allowed (absence of a policy is not a refusal)"
else
    fail "no policy file should allow, got: $(printf '%s' "$out" | tr '\n' ' ')"
fi

# 2. THE DEFECT: policy file present + no node -> must REFUSE.
mkdir -p "$WORK/haspolicy/.loki"
echo '{"rules":[]}' > "$WORK/haspolicy/.loki/policies.json"
out="$(run_case "$WORK/haspolicy" "")"
if printf '%s' "$out" | grep -q 'RC=1'; then
    pass "policy present + no node: refused (fail-closed)"
else
    fail "policy present + no node must refuse, got: $(printf '%s' "$out" | tr '\n' ' ')"
fi

# 3. The refusal must be RECORDED, and distinguishable from a rule DENY. A block
#    that leaves no trace is indistinguishable from a run that was never gated,
#    and the receipt must be able to say WHY the action did not happen.
if printf '%s' "$out" | grep -q 'AUDIT: policy_unevaluable'; then
    pass "the refusal is recorded as policy_unevaluable, not as a rule denial"
else
    fail "the fail-closed refusal was not recorded: $(printf '%s' "$out" | tr '\n' ' ')"
fi

# 4. The escape hatch must work, and must SAY it is running unenforced.
hatch="$(run_case "$WORK/haspolicy" "LOKI_POLICY_REQUIRE_NODE=0")"
if printf '%s' "$hatch" | grep -q 'RC=0' && printf '%s' "$hatch" | grep -q 'SKIPPED'; then
    pass "LOKI_POLICY_REQUIRE_NODE=0 allows, and says enforcement was skipped"
else
    fail "escape hatch did not allow-with-warning: $(printf '%s' "$hatch" | tr '\n' ' ')"
fi

# 4b. GLOBAL policy fallback. The dashboard writes ~/.loki/policies.json
#     (api_v2.py:75,105) while the engine read only project-local, so the one
#     existing writer fed a file the reader never opened. Both the run.sh gate
#     and engine.js:_init must now consult the global file, and they must agree:
#     if only one of them does, enforcement short-circuits before the other is
#     reached. LOKI_DATA_DIR redirects the global dir, which is what makes this
#     testable without touching the real ~/.loki.
mkdir -p "$WORK/globalpol" "$WORK/projnopol/.loki"
echo '{"rules":[]}' > "$WORK/globalpol/policies.json"
gout="$( cd "$WORK/projnopol" || exit 99
    SCRIPT_DIR="$REPO_ROOT/autonomy"
    # shellcheck disable=SC1090
    . "$WORK/harness.sh"
    # shellcheck disable=SC1090
    . "$WORK/check_policy.sh"
    export LOKI_DATA_DIR="$WORK/globalpol"
    PATH="$NODELESS" check_policy "pre_execution" '{}'
    echo "RC=$?" ) 2>&1"
if printf '%s' "$gout" | grep -q 'RC=1'; then
    pass "a GLOBAL policy is honoured when the project defines none"
else
    fail "global policy was ignored (the dashboard's only writer stays unread): $(printf '%s' "$gout" | tr '\n' ' ')"
fi

# 4c. And a project with no policy anywhere still allows: the fallback must not
#     turn "no policy at all" into a refusal for every existing user.
nout="$( cd "$WORK/projnopol" || exit 99
    SCRIPT_DIR="$REPO_ROOT/autonomy"
    # shellcheck disable=SC1090
    . "$WORK/harness.sh"
    # shellcheck disable=SC1090
    . "$WORK/check_policy.sh"
    export LOKI_DATA_DIR="$WORK/definitely-empty-$$"
    PATH="$NODELESS" check_policy "pre_execution" '{}'
    echo "RC=$?" ) 2>&1"
if printf '%s' "$nout" | grep -q 'RC=0'; then
    pass "no policy project-local AND none global: still allowed"
else
    fail "absence of any policy must allow: $(printf '%s' "$nout" | tr '\n' ' ')"
fi

# 4d. ENGINE side, with REAL node. Cases 4b/4c drive check_policy on a nodeless
#     PATH, which proves the run.sh gate consults the global file but cannot
#     prove engine.js:_init loads it. Assert on the engine's REASON, not its
#     exit code: an empty global policy and no policy at all both exit 0, so an
#     exit-code assertion here would be vacuous. The reasons differ, and that
#     difference is the evidence the file was actually read.
if ! command -v node >/dev/null 2>&1; then
    fail "node unavailable: the engine-side global fallback was not measured (unmeasured, not clean)"
else
    mkdir -p "$WORK/eng/proj/.loki" "$WORK/eng/global"
    printf '%s\n' '{"pre_execution":[{"id":"t","action":"allow","match":{}}]}' \
        > "$WORK/eng/global/policies.json"

    with_global="$( cd "$WORK/eng/proj" && LOKI_DATA_DIR="$WORK/eng/global" \
        LOKI_PROJECT_DIR="$WORK/eng/proj" \
        node "$REPO_ROOT/src/policies/check.js" pre_execution '{}' 2>&1 )"
    without_any="$( cd "$WORK/eng/proj" && LOKI_DATA_DIR="$WORK/eng/absent" \
        LOKI_PROJECT_DIR="$WORK/eng/proj" \
        node "$REPO_ROOT/src/policies/check.js" pre_execution '{}' 2>&1 )"

    if printf '%s' "$with_global" | grep -q 'All policies passed'; then
        pass "engine.js loads the GLOBAL policy when the project defines none"
    else
        fail "engine did not load the global policy: $(printf '%s' "$with_global" | head -c 160)"
    fi

    if printf '%s' "$without_any" | grep -q 'No policies configured'; then
        pass "engine reports no policies configured when none exist anywhere"
    else
        fail "engine misreported the no-policy case: $(printf '%s' "$without_any" | head -c 160)"
    fi
fi

# 5. The subscriber must map the new event, or it never reaches the audit chain
#    and the receipt cannot show the refusal at all.
if ! command -v node >/dev/null 2>&1; then
    fail "node unavailable: could not verify the subscriber mapping (unmeasured, not clean)"
elif node -e 'process.exit(require(process.argv[1]).EVENT_TO_AUDIT["policy_unevaluable"] ? 0 : 1)' \
        "$REPO_ROOT/src/audit/subscriber.js" 2>/dev/null; then
    pass "policy_unevaluable is mapped by the audit subscriber"
else
    fail "policy_unevaluable is not mapped; the refusal never reaches the audit chain"
fi

summarize_and_exit
