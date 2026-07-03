#!/usr/bin/env bash
# shellcheck disable=SC2164  # cd in throwaway test subshells; failure is fatal anyway
# tests/test-verify-setup-recipe.sh - tests for the setup-recipe WRITER (rank 7)
# in `loki verify` (_verify_write_setup_recipe, autonomy/verify.sh).
#
# After a VERIFIED runtime boot, verify writes .loki/setup-recipe.json capturing
# the deterministic steps to reach a runnable state: {install, seed, env_keys,
# start, health_path, port}. The existing CONSUMER (_verify_runtime_detect) reads
# "start"/"port" on later runs. env_keys are env var NAMES ONLY -- SECRET VALUES
# ARE NEVER PERSISTED.
#
# Cases:
#   A. writer runs against a repo with a start command + .env.example -> a recipe
#      is written with the required keys.
#   B. SECURITY: env_keys contains the NAME (e.g. API_TOKEN) but the recipe file
#      contains ZERO secret VALUES (grep for the planted secret value returns
#      nothing anywhere in the file).
#   C. the recipe's "start" + "port" round-trip to the consumer
#      (_verify_runtime_detect reads them back on a later run).
#
# RED (pre-change): _verify_write_setup_recipe is undefined -> no recipe written
# -> cases fail. GREEN (post-change): all pass.
#
# Exit-code semantics: 0 VERIFIED, 1 CONCERNS, 2 BLOCKED, 3 verifier error.

set -uo pipefail

export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_SH="$SCRIPT_DIR/../autonomy/verify.sh"

# shellcheck source=/dev/null
. "$VERIFY_SH"

PASS=0
FAIL=0
TMP_ROOT="$(mktemp -d -t loki-verify-recipe-tests.XXXXXX)"

cleanup() { rm -rf "$TMP_ROOT" 2>/dev/null || true; }
trap cleanup EXIT

_ok()   { printf '  PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
_no()   { printf '  FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }
_skip() { printf '  SKIP: %s\n' "$1"; }

if ! command -v python3 >/dev/null 2>&1; then
    _skip "python3 absent; setup-recipe writer requires it"
    printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
    exit 0
fi

# The planted secret VALUE that must NEVER appear in the recipe.
SECRET_VALUE="sk-live-DEADBEEF-NEVER-PERSIST-abc123"

# Build a fixture repo: a node web app with a .env.example that carries a NAME
# and a secret VALUE.
REPO="$TMP_ROOT/app"
mkdir -p "$REPO"
cat > "$REPO/package.json" <<'JSON'
{ "name": "fixture", "scripts": { "start": "node server.js", "seed": "node seed.js" } }
JSON
printf 'require("http").createServer(()=>{}).listen(process.env.PORT||3000)\n' > "$REPO/server.js"
# .env.example: NAME=VALUE with a secret value that must be stripped.
cat > "$REPO/.env.example" <<EOF
# comment line, ignored
API_TOKEN=${SECRET_VALUE}
export DATABASE_URL=postgres://user:pw@localhost/db
PORT=3000
EOF

# Simulate a VERIFIED boot by calling the writer directly (unit-style), exactly
# as the pass branch does: tree, start command, probe port, health path.
_verify_write_setup_recipe "$REPO" "npm start" "3000" "/health" || true

RECIPE="$REPO/.loki/setup-recipe.json"

# ---- Case A: recipe written with required keys ----
if [ -f "$RECIPE" ]; then
    keys_ok="$(python3 - "$RECIPE" <<'PYEOF' 2>/dev/null || echo NO
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("NO"); sys.exit(0)
need = ("install", "seed", "env_keys", "start", "health_path")
print("YES" if all(k in d for k in need) and isinstance(d.get("env_keys"), list) else "NO")
PYEOF
)"
    [ "$keys_ok" = "YES" ] && _ok "A: recipe written with {install,seed,env_keys,start,health_path}" \
        || _no "A: recipe missing required keys"
else
    _no "A: setup-recipe.json not written after simulated verified boot"
fi

# ---- Case B: SECURITY - env_keys has NAMES, file has ZERO secret VALUES ----
if [ -f "$RECIPE" ]; then
    # (i) the NAME is present in env_keys
    name_present="$(python3 - "$RECIPE" <<'PYEOF' 2>/dev/null || echo NO
import json, sys
d = json.load(open(sys.argv[1]))
ek = d.get("env_keys") or []
print("YES" if ("API_TOKEN" in ek and "DATABASE_URL" in ek) else "NO")
PYEOF
)"
    # (ii) the secret VALUE appears NOWHERE in the file
    if grep -qF "$SECRET_VALUE" "$RECIPE" 2>/dev/null; then
        value_absent="NO"
    else
        value_absent="YES"
    fi
    if [ "$name_present" = "YES" ] && [ "$value_absent" = "YES" ]; then
        _ok "B: env_keys has NAMES (API_TOKEN, DATABASE_URL); secret VALUE absent from recipe"
    else
        _no "B: name_present=$name_present value_absent=$value_absent (secret leak or missing name)"
    fi
else
    _no "B: recipe not written (cannot check secret redaction)"
fi

# ---- Case C: start + port round-trip to the consumer ----
# The consumer (_verify_runtime_detect) reads .loki/setup-recipe.json first and
# echoes "method<TAB>port". Clear operator overrides so the recipe path is taken.
if [ -f "$RECIPE" ]; then
    detected="$(
        unset LOKI_APP_COMMAND LOKI_APP_PORT
        _verify_runtime_detect "$REPO" 2>/dev/null
    )"
    got_method="$(printf '%s' "$detected" | cut -f1)"
    got_port="$(printf '%s' "$detected" | cut -f2)"
    if [ "$got_method" = "npm start" ] && [ "$got_port" = "3000" ]; then
        _ok "C: consumer reads recipe back -> method='npm start' port=3000"
    else
        _no "C: recipe round-trip failed (method='$got_method' port='$got_port')"
    fi
else
    _no "C: recipe not written (cannot check round-trip)"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
