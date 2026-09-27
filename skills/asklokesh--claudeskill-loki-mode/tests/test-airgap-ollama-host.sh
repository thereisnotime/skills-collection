#!/usr/bin/env bash
# doctor --airgap must judge OLLAMA_HOST locality from the actual host, not a
# substring match on the model id.
#
# BACKLOG 42: _loki_airgap_audit (autonomy/loki) matched the model id against
# `ollama|localhost|127.0.0.1|lmstudio` with a bare substring test. A model id
# of "ollama/qwen2.5-coder" always matched "ollama", so a REMOTE
# OLLAMA_HOST=https://remote.example.com (Ollama's own env var for pointing its
# client at a remote server) still read as local and reported airgap_ready.
#
# Part 1 reproduces the OLD substring-only logic standalone and shows it goes
# RED (misreports remote as local) -- proving the bug existed, without needing
# to check out a prior commit. Part 2 runs the CURRENT `loki doctor --airgap`
# and shows GREEN: a remote OLLAMA_HOST is read as required egress, the
# no-override default stays local, and an explicit loopback OLLAMA_HOST stays
# local too.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOKI="$REPO_ROOT/autonomy/loki"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---- Part 1: reproduce the OLD bug in isolation (red) -----------------------
old_check_is_local() {  # <model_id> <ollama_host (unused, that is the bug)>
    printf '%s' "$1" | grep -qiE 'ollama|localhost|127\.0\.0\.1|lmstudio'
}
if old_check_is_local "ollama/qwen2.5-coder" "https://remote.example.com"; then
    ok "RED confirmed: the old substring-only check misreads a remote OLLAMA_HOST as local"
else
    bad "could not reproduce the old bug -- the red case is not testing what it claims"
fi

# ---- Part 2: current behavior (green) ---------------------------------------
airgap_ready_json() {  # env assignments... -> prints airgap_ready / required_egress
    local out="$WORK/out-$$-$RANDOM"
    # This test is a genuine victim, not a source, of BACKLOG 126's class of
    # bug: a saved .loki/state/provider anywhere the CLI can see it beats
    # LOKI_PROVIDER by design (see the CLI's own precedence rule), so a stray
    # file left in the repo checkout by an unrelated, unisolated test running
    # earlier in the same CI shard/local-ci session silently overrides
    # LOKI_PROVIDER=opencode below and misreports locality. Point LOKI_DIR at
    # this test's own isolated scratch dir so nothing outside this test's
    # control can ever be read here, regardless of how many more contamination
    # sources exist elsewhere in the suite.
    env -u OLLAMA_HOST -u OPENAI_BASE_URL -u OPENROUTER_API_KEY \
        LOKI_PROVIDER=opencode LOKI_OPENCODE_MODEL=ollama/qwen2.5-coder \
        LOKI_DIR="$WORK/.loki" \
        "$@" "$LOKI" doctor --airgap --json >"$out" 2>"$out.err"
    python3 - "$out" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print("ready=%s required=%s" % (d["airgap_ready"], d.get("required_egress")))
except Exception as e:
    print("unparseable: %s" % e)
PY
}

remote_result="$(airgap_ready_json OLLAMA_HOST=https://remote.example.com)"
case "$remote_result" in
    "ready=False required=['model_inference']")
        ok "GREEN: remote OLLAMA_HOST reads as required egress (not air-gap ready)" ;;
    *)
        bad "remote OLLAMA_HOST did not read as required egress: $remote_result" ;;
esac

default_result="$(airgap_ready_json)"
case "$default_result" in
    "ready=True required=[]")
        ok "default case (ollama model id, no OLLAMA_HOST override) still reads as local" ;;
    *)
        bad "default case regressed to non-local: $default_result" ;;
esac

loopback_result="$(airgap_ready_json OLLAMA_HOST=http://localhost:11434)"
case "$loopback_result" in
    "ready=True required=[]")
        ok "explicit loopback OLLAMA_HOST (http://localhost:11434) still reads as local" ;;
    *)
        bad "loopback OLLAMA_HOST regressed to non-local: $loopback_result" ;;
esac

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
