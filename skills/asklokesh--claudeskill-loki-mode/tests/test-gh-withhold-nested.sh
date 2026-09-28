#!/usr/bin/env bash
# BACKLOG 149 round 4: Rule of Two withhold, nested-run rule.
#
# A run that inherits the withheld sentinel (an agent running `loki start`
# inside its session, or a build started from the run-spawned dashboard) must
# fail CLOSED on every channel inside Loki's own trusted calls: GH_TOKEN stays
# the sentinel, GH_CONFIG_DIR stays scoped, credential.helper stays reset,
# SSH_AUTH_SOCK stays unset, GIT_SSH_COMMAND stays `false`. Before round 4 the
# channels disagreed (HTTPS helper chain and default SSH keys reopened).
# Also guards the inherited-sentinel detection itself: break its match
# pattern and the nested assertions below fail.
#
# The fresh-run leg is the control: the same trusted call there DOES get the
# real (synthetic) values back, so the nested assertions are not vacuous.
# Synthetic values only; no network.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so a mutated copy can be checked without touching the repo.
RUN_SH="${LOKI_TEST_RUN_SH:-$ROOT/autonomy/run.sh}"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loki-withhold-nested.XXXXXX")" || exit 1
trap 'rm -rf "$WORK"' EXIT

# The withhold block: from its state variables through the end of
# _loki_withhold_github_tokens. Extracted, not re-implemented.
awk '
    /^_LOKI_WITHHELD_TOKENS=""$/ { on = 1 }
    on { print }
    on && /^_loki_withhold_github_tokens\(\) \{$/ { last = 1 }
    last && /^}$/ { exit }
' "$RUN_SH" > "$WORK/withhold.sh"
grep -q '^_loki_gh_restore()' "$WORK/withhold.sh" && grep -q '^_loki_withhold_github_tokens()' "$WORK/withhold.sh" \
    || { echo "FAIL: could not extract the withhold block from run.sh"; exit 1; }

# One "run": load the block, withhold, print a trusted call's environment to
# $1, then dump the post-withhold environment to $2 (what a child inherits).
cat > "$WORK/run.sh" <<'EOF'
set -u
log_info() { :; }
. "$WITHHOLD"
_loki_withhold_github_tokens 2>/dev/null
_loki_with_github_tokens env > "$1"
export -p > "$2"
EOF

CANARY_TOKEN="ghp_NESTEDCANARY0000000000000000000"
CANARY_SOCK="/tmp/loki-nested-canary.sock"
CANARY_SSHCMD="ssh -i /tmp/loki-nested-canary-key"

# --- fresh run (control) ----------------------------------------------------
env -i PATH="$PATH" HOME="$WORK" TMPDIR="${TMPDIR:-/tmp}" WITHHOLD="$WORK/withhold.sh" \
    GH_TOKEN="$CANARY_TOKEN" SSH_AUTH_SOCK="$CANARY_SOCK" GIT_SSH_COMMAND="$CANARY_SSHCMD" \
    bash "$WORK/run.sh" "$WORK/fresh.trusted" "$WORK/fresh.exported"

grep -qx "GH_TOKEN=$CANARY_TOKEN" "$WORK/fresh.trusted" \
    && ok "fresh run: trusted call gets the real GH_TOKEN back" \
    || bad "fresh run: trusted call did not get the real GH_TOKEN back"
grep -qx "SSH_AUTH_SOCK=$CANARY_SOCK" "$WORK/fresh.trusted" \
    && ok "fresh run: trusted call gets the real SSH_AUTH_SOCK back" \
    || bad "fresh run: trusted call did not get the real SSH_AUTH_SOCK back"
grep -qx "GIT_SSH_COMMAND=$CANARY_SSHCMD" "$WORK/fresh.trusted" \
    && ok "fresh run: trusted call gets the real GIT_SSH_COMMAND back" \
    || bad "fresh run: trusted call did not get the real GIT_SSH_COMMAND back"
grep -q '^GIT_CONFIG_COUNT=' "$WORK/fresh.trusted" \
    && bad "fresh run: trusted call still carries the credential.helper reset" \
    || ok "fresh run: trusted call has the credential.helper reset removed"
# The exported (inherited) state really is the withheld state.
grep -q "GH_TOKEN=\"ghp_LOKIWITHHELDsentinel" "$WORK/fresh.exported" \
    && ok "fresh run: a child inherits the sentinel, not the real token" \
    || bad "fresh run: exported state does not carry the sentinel"

# --- nested run: start from the fresh run's withheld environment -----------
# (export -p output re-sourced in a clean shell = exactly what a child sees)
env -i PATH="$PATH" HOME="$WORK" TMPDIR="${TMPDIR:-/tmp}" WITHHOLD="$WORK/withhold.sh" \
    bash -c '. "$1"; bash "$2" "$3" "$4"' _ \
    "$WORK/fresh.exported" "$WORK/run.sh" "$WORK/nested.trusted" "$WORK/nested.exported"
[ -s "$WORK/nested.trusted" ] || bad "nested run produced no trusted-call environment"

T="$WORK/nested.trusted"
grep -q '^GH_TOKEN=ghp_LOKIWITHHELDsentinel.*INVALID$' "$T" \
    && ok "nested run: trusted call keeps the GH_TOKEN sentinel" \
    || bad "nested run: trusted call got a non-sentinel GH_TOKEN ($(grep '^GH_TOKEN=' "$T" | cut -c1-40))"
grep -qF "$CANARY_TOKEN" "$T" \
    && bad "nested run: the real token reappeared" || ok "nested run: the real token never reappears"
grep -q '^GH_CONFIG_DIR=.*loki-gh-config' "$T" \
    && ok "nested run: trusted call keeps GH_CONFIG_DIR scoped" \
    || bad "nested run: trusted call has an unscoped GH_CONFIG_DIR ($(grep '^GH_CONFIG_DIR=' "$T" || echo absent))"
n="$(sed -n 's/^GIT_CONFIG_COUNT=//p' "$T")"
if [ -n "$n" ] && grep -qx "GIT_CONFIG_KEY_$((n - 1))=credential.helper" "$T" \
    && grep -qx "GIT_CONFIG_VALUE_$((n - 1))=" "$T"; then
    ok "nested run: trusted call keeps the credential.helper reset"
else
    bad "nested run: trusted call reopened the credential.helper chain (GIT_CONFIG_COUNT=${n:-absent})"
fi
grep -q '^SSH_AUTH_SOCK=' "$T" \
    && bad "nested run: trusted call has an SSH agent socket" \
    || ok "nested run: trusted call keeps SSH_AUTH_SOCK unset"
grep -qx 'GIT_SSH_COMMAND=false' "$T" \
    && ok "nested run: trusted call keeps GIT_SSH_COMMAND=false" \
    || bad "nested run: trusted call reopened ssh (GIT_SSH_COMMAND=$(sed -n 's/^GIT_SSH_COMMAND=//p' "$T" || true), default keys usable)"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
