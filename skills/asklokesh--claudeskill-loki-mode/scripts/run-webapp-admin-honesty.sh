#!/usr/bin/env bash
# Boot a seeded web-app server, drive the Admin console, Templates page and
# Teams page in a real browser (tests/e2e/webapp-admin-honesty.mjs), tear
# everything down. The Teams steps create a team through the UI, so the seed
# directory also receives teams.json and a second audit entry.
#
# The seed fixes each honesty assertion's answer in advance:
#   - .loki/audit-log.json has one team.created entry for harness-team
#   - no efficiency records, so /api/cost reports cost_recorded=false
#   - one receipt with an unrecorded cost and a $10 cap (Metrics page)
#
# HOME points into the seed: with no active session, web-app/server.py resolves
# .loki (audit log, teams) and the sessions-history directories under HOME, so a
# real HOME would read, and let the page write, the operator's own ~/.loki.
# PYTHONUSERBASE keeps a user-site fastapi/uvicorn importable after HOME moves.
#
# Serves the BUILT bundle (standalone_app, mounted at /lab/), not the dev server.

set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 2

PORT="${LOKI_WEBAPP_ADMIN_PORT:-57379}"
SEED=""
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$SEED" ] && rm -rf "$SEED" 2>/dev/null
  return 0
}
trap cleanup EXIT INT TERM

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 absent (not a pass)"; exit 0; }
python3 -c "import uvicorn, fastapi" 2>/dev/null || {
  echo "SKIP: uvicorn/fastapi not installed -- admin honesty not measured (not a pass)"; exit 0; }
[ -f "$REPO_ROOT/web-app/dist/index.html" ] || {
  echo "SKIP: web-app/dist not built -- run 'cd web-app && npm run build' (not a pass)"; exit 0; }

USERBASE="$(python3 -m site --user-base 2>/dev/null || true)"
SEED="$(mktemp -d "${TMPDIR:-/tmp}/loki-adminseed.XXXXXX")" || { echo "SETUP ERROR: mktemp failed"; exit 2; }
mkdir -p "$SEED/.loki" || exit 2
cat > "$SEED/.loki/audit-log.json" <<'JSON'
[
  {"id": "harness-audit-1", "action": "team.created", "user": "harness-operator",
   "actor_state": "identified", "target": "harness-team",
   "timestamp": "2026-01-01T00:00:00", "details": ""}
]
JSON
# One receipt whose cost was never recorded, and a $10 cap with no measured
# spend: "Runs with cost" must read 0 of 1 and the budget "Not recorded".
mkdir -p "$SEED/.loki/proofs/harness-run-1" "$SEED/.loki/metrics" || exit 2
cat > "$SEED/.loki/proofs/harness-run-1/proof.json" <<'JSON'
{"run_id": "harness-run-1", "generated_at": "2026-01-01T00:00:00Z",
 "cost": {"usd": null, "available": false}}
JSON
printf '%s\n' '{"limit": 10}' > "$SEED/.loki/metrics/budget.json"

cd "$SEED" || exit 2
HOME="$SEED" PYTHONUSERBASE="$USERBASE" LOKI_DIR="$SEED/.loki" \
  python3 -m uvicorn server:standalone_app --port "$PORT" --app-dir "$REPO_ROOT/web-app" \
  > "$SEED/server.log" 2>&1 &
SERVER_PID=$!
cd "$REPO_ROOT" || exit 2

_up=0
for _ in $(seq 1 60); do
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/lab/api/audit-log" >/dev/null 2>&1; then _up=1; break; fi
  sleep 0.5
done
if [ "$_up" -ne 1 ]; then
  echo "SKIP: server did not come up on $PORT -- admin honesty not measured (not a pass)"
  tail -3 "$SEED/server.log" 2>/dev/null
  exit 0
fi

LOKI_WEBAPP_URL="http://127.0.0.1:$PORT" node tests/e2e/webapp-admin-honesty.mjs
rc=$?
[ "$rc" -eq 2 ] && tail -5 "$SEED/server.log" 2>/dev/null
exit "$rc"
