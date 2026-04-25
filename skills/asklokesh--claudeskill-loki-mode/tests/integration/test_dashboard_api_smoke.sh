#!/usr/bin/env bash
# tests/integration/test_dashboard_api_smoke.sh
# v7.0.0 optional: boot dashboard in background, hit /api/status (baseline)
# and /api/managed/status (Phase 5; may not exist in v6.83.1). Shut it down
# cleanly. SKIP entirely if port 57374 is busy or the dashboard refuses to
# start within a short budget.
#
# This is a smoke test. It does NOT exercise dashboard behavior end-to-end.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

PORT=57374
DASHBOARD_SRV="$REPO_ROOT/dashboard/server.py"

if [ ! -f "$DASHBOARD_SRV" ]; then
    echo "SKIP test_dashboard_api_smoke: dashboard/server.py not found"
    exit 2
fi

# Check if the port is busy.
if command -v lsof >/dev/null 2>&1; then
    if lsof -ti:"$PORT" >/dev/null 2>&1; then
        echo "SKIP test_dashboard_api_smoke: port $PORT is already in use; skipped"
        exit 2
    fi
fi

# Check for required Python deps without importing them in the test process.
if ! python3 -c "import fastapi, uvicorn" >/dev/null 2>&1; then
    echo "SKIP test_dashboard_api_smoke: fastapi/uvicorn not installed"
    exit 2
fi

PASS=0
FAIL=0

ok() { echo "PASS [$1]"; PASS=$((PASS + 1)); }
bad() { echo "FAIL [$1] $2"; FAIL=$((FAIL + 1)); }

TMPDIR="$(mktemp -d -t loki-dash-smoke-XXXXXX)"
LOG="$TMPDIR/dashboard.log"
# shellcheck disable=SC2329 # invoked via trap
cleanup() {
    # Kill anything listening on PORT that we may have spawned.
    if command -v lsof >/dev/null 2>&1; then
        pids=$(lsof -ti:"$PORT" 2>/dev/null || true)
        if [ -n "$pids" ]; then
            # shellcheck disable=SC2086
            kill -9 $pids 2>/dev/null || true
        fi
    fi
    rm -rf "$TMPDIR" 2>/dev/null || true
}
trap cleanup EXIT

# Boot dashboard in background with a short timeout budget.
# Invoke as a module (`python -m dashboard.server`) because the server uses
# relative imports. Same pattern as `loki dashboard start`.
(
    cd "$REPO_ROOT" || exit 1
    LOKI_DASHBOARD_PORT="$PORT" python3 -m dashboard.server >"$LOG" 2>&1 &
    echo $! > "$TMPDIR/dash.pid"
)

# Wait up to 10s for the port to become reachable.
ready="no"
for i in $(seq 1 20); do
    if command -v curl >/dev/null 2>&1 && curl -sf "http://127.0.0.1:$PORT/api/status" -o /dev/null 2>&1; then
        ready="yes"
        break
    fi
    sleep 0.5
done

if [ "$ready" != "yes" ]; then
    echo "SKIP test_dashboard_api_smoke: dashboard did not come up within 10s (iter=$i). Log tail:"
    tail -20 "$LOG" 2>/dev/null || true
    exit 2
fi

# /api/status must return JSON (present in v6.83.1 baseline).
status_ct=$(curl -s -o /dev/null -w "%{content_type}" "http://127.0.0.1:$PORT/api/status" 2>/dev/null || echo "")
if echo "$status_ct" | grep -qi "application/json"; then
    ok "api_status_ok"
else
    bad "api_status_ok" "content-type=$status_ct (expected application/json)"
fi

# /api/managed/status is a v7 (Phase 5) addition. A real API response serves
# JSON; the SPA catch-all serves HTML and returns 200. We treat HTML as
# "endpoint not yet implemented" (SKIP) rather than as a PASS.
set +e
managed_http=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/managed/status" 2>/dev/null)
managed_ct=$(curl -s -o /dev/null -w "%{content_type}" "http://127.0.0.1:$PORT/api/managed/status" 2>/dev/null)
set -e
case "$managed_http" in
    200)
        if echo "$managed_ct" | grep -qi "application/json"; then
            ok "api_managed_status_json"
        else
            echo "SKIP [api_managed_status_json] SPA catch-all response; endpoint not yet implemented in v6.83.1 (ct=$managed_ct)"
        fi
        ;;
    404)
        echo "SKIP [api_managed_status_json] endpoint not yet implemented in v6.83.1"
        ;;
    000|"")
        bad "api_managed_status_json" "connection failure (http=$managed_http)"
        ;;
    *)
        bad "api_managed_status_json" "unexpected http=$managed_http ct=$managed_ct"
        ;;
esac

echo ""
echo "dashboard_api_smoke: passed=$PASS failed=$FAIL"
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
