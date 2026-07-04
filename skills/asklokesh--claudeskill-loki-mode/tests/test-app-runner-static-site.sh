#!/usr/bin/env bash
# test-app-runner-static-site.sh
#
# Regression: a static site (a web root with index.html and no server-app
# signal -- no dev/start script, no Flask/Django/etc) MUST be detected as a
# serveable "static" app (python3 -m http.server), NOT fall through to "none".
# Founder feedback: a hero/pricing/waitlist landing page showed "This app has
# no live server" -> no preview, no health check, no screenshot. A genuine CLI
# / library (no index.html) MUST still honestly read "none".
#
# We drive the real detection cascade by sourcing app-runner.sh with the loki
# harness stubbed, then assert the written detection.json type.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# Minimal harness stubs so app-runner.sh sources cleanly.
log_info() { :; }
log_warn() { :; }
log_error() { :; }
log_step() { :; }
register_pid() { :; }
APP_RUNNER_ENABLED="true"

# shellcheck disable=SC1090
source "$REPO_ROOT/autonomy/app-runner.sh" 2>/dev/null || {
  echo "FAIL: could not source app-runner.sh"; exit 1; }

# Read the "type" field from a detection.json.
_det_type() {
  grep -o '"type": *"[^"]*"' "$1" 2>/dev/null | sed -E 's/.*"type": *"([^"]*)".*/\1/'
}

run_case() {
  local name="$1"; shift
  local dir; dir="$(mktemp -d)"
  # caller populates the dir via the passed commands
  ( cd "$dir" && eval "$1" )
  export TARGET_DIR="$dir"
  _app_runner_dir 2>/dev/null || true
  # app_runner_init runs the detection cascade and writes detection.json
  app_runner_init >/dev/null 2>&1 || true
  local det="$_APP_RUNNER_DIR/detection.json"
  local got="none"
  [ -f "$det" ] && got="$(_det_type "$det")"
  echo "$got"
  rm -rf "$dir"
}

# 1. Landing page: package.json (no dev/start/build) + index.html -> static
t=$(run_case "landing" 'printf "{\"name\":\"lp\",\"scripts\":{\"test\":\"echo ok\"}}" > package.json; printf "<h1>Hero</h1>" > index.html')
[ "$t" = "static" ] && pass "landing page (index.html) -> static (serveable)" \
  || fail "landing page -> expected static, got '$t'"

# 2. Bare index.html, no package.json -> static
t=$(run_case "bare-static" 'printf "<h1>Hi</h1>" > index.html')
[ "$t" = "static" ] && pass "bare index.html -> static" \
  || fail "bare index.html -> expected static, got '$t'"

# 3. public/index.html -> static
t=$(run_case "public-static" 'mkdir -p public; printf "<h1>Hi</h1>" > public/index.html')
[ "$t" = "static" ] && pass "public/index.html -> static" \
  || fail "public/index.html -> expected static, got '$t'"

# 4. Genuine CLI: package.json (no dev/start) + index.js, NO index.html -> none
t=$(run_case "cli" 'printf "{\"name\":\"cli\",\"scripts\":{\"test\":\"node --test\"}}" > package.json; printf "console.log(1)" > index.js')
[ "$t" = "none" ] && pass "CLI without index.html -> none (honest no-server preserved)" \
  || fail "CLI -> expected none, got '$t'"

# 5. A real server (npm start) still wins over static (order preserved)
t=$(run_case "server" 'printf "{\"name\":\"s\",\"scripts\":{\"start\":\"node server.js\"}}" > package.json; printf "<h1>x</h1>" > index.html')
[ "$t" = "npm-start" ] && pass "npm start beats static when both present (order preserved)" \
  || fail "server+index.html -> expected npm-start, got '$t'"

echo "----------------------------------------"
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
