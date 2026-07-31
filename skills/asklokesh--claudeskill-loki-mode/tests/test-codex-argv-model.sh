#!/usr/bin/env bash
# provider_invoke_argv must not send an effort level as a model name.
#
# THE BUG THIS GUARDS. For Codex, provider_get_tier_param returns an EFFORT
# LEVEL (xhigh/high/low), not a model name -- the BUG-PROV-012 note in
# providers/codex.sh says so explicitly. provider_invoke_argv passed it to
# --model anyway, so every argv-based invocation sent `--model high` and the API
# rejected it outright:
#   400 invalid_request_error: The 'high' model is not supported when using
#   Codex with a ChatGPT account.
#
# WHY IT MATTERED MORE THAN A NORMAL BUG. provider_invoke() was fine, so the
# BROKEN path was the argv seam -- which exists precisely so a call can be
# wrapped in `timeout` (a shell function cannot be exec'd by timeout). A hung
# provider therefore could not be bounded without also breaking the invocation,
# and the failure was silent: five measured trials produced no artifact while
# looking like slow runs (96s/6s/5s/4s/5s).
#
# Runs offline. It inspects the constructed argv rather than invoking codex, so
# it needs no auth and cannot rot the way a login-dependent test would.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0; FAIL=0
ok()  { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

_argv() {  # $1 = tier
  PROVIDER_NAME=codex bash -c "
    source '$REPO_ROOT/providers/loader.sh' >/dev/null 2>&1 || true
    load_provider codex >/dev/null 2>&1 || true
    provider_invoke_argv '$1' 'do a thing'
    printf '%s\n' \"\${_LOKI_INVOKE_ARGV[*]}\"
    printf 'EFFORT=%s\n' \"\${CODEX_MODEL_REASONING_EFFORT:-}\"
  " 2>/dev/null
}

echo "T1 -- an effort level never reaches --model"
for tier in planning development fast; do
  out=$(_argv "$tier")
  argv=$(printf '%s' "$out" | head -1)
  # The exact shape of the bug: `--model high`, `--model xhigh`, `--model low`.
  if printf '%s' "$argv" | grep -qE -- "--model (xhigh|high|low)\b"; then
    bad "tier=$tier sends an effort level as --model: $argv"
  else
    ok "tier=$tier does not pass an effort level to --model"
  fi
done

echo
echo "T2 -- effort travels in the environment instead"
# It must be EXPORTED, or it is lost across `timeout "\${_LOKI_INVOKE_ARGV[@]}"`,
# which is the only reason this seam exists.
out=$(_argv development)
printf '%s' "$out" | grep -q "EFFORT=high" \
  && ok "development tier exports CODEX_MODEL_REASONING_EFFORT=high" \
  || bad "effort not exported: $(printf '%s' "$out" | tail -1)"
out=$(_argv fast)
printf '%s' "$out" | grep -q "EFFORT=low" \
  && ok "fast tier exports effort=low" \
  || bad "fast tier effort wrong: $(printf '%s' "$out" | tail -1)"

echo
echo "T3 -- an empty model omits the flag rather than sending an empty string"
# CODEX_DEFAULT_MODEL is deliberately empty so codex uses its own current
# default instead of a pinned name that rots. `--model ""` would be a hard error.
argv=$(_argv development | head -1)
if printf '%s' "$argv" | grep -qE -- "--model( |$)" && ! printf '%s' "$argv" | grep -qE -- "--model [^ ]"; then
  bad "argv contains --model with an empty value: $argv"
else
  ok "no empty --model in argv"
fi

# Non-vacuity: the argv must still be a usable codex command, or every
# assertion above passes against an empty array.
printf '%s' "$argv" | grep -q "^codex exec" \
  && ok "non-vacuity: argv is a real codex exec command" \
  || bad "argv is not a codex command: $argv"

echo
echo "==============================================================="
echo "Results: $PASS passed, $FAIL failed, $((PASS + FAIL)) total"
[ "$FAIL" -eq 0 ]
