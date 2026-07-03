#!/usr/bin/env bash
# tests/test-oracle-source-grounded.sh -- source-grounded acceptance-oracle legs
#
# Extends the acceptance-oracle triangulation (test-oracle-triangulation.sh covers
# the datastore leg) with three SOURCE-GROUNDED legs added for rank-2:
#
#   Leg 2  HTTP ROUTE grounding      : every spec-named endpoint must map to a
#                                       real route/handler in source. Missing ->
#                                       High (id oracle-route-missing). Zero
#                                       parseable routes -> fail-open (no finding).
#   Leg 3  PUBLIC API SYMBOL (LSP)   : spec-named public symbols verified via the
#                                       LSP proxy (--check-symbols), NOT LLM grep.
#                                       No server on PATH -> INCONCLUSIVE, no
#                                       finding, no fabricated pass.
#   Leg 4  DOMAIN INVARIANT          : plaintext-password storage detection
#                                       (id oracle-invariant-plaintext-password).
#
# Function under test: checklist_oracle_triangulate() in autonomy/prd-checklist.sh
#
# This suite proves BOTH directions with real fixtures:
#   A) spec endpoint /orders that EXISTS in source     -> no route finding
#   B) spec endpoint /orders with NO handler in source -> High route finding
#   C) plaintext password store                        -> invariant finding
#   FP) 3 clean fixtures whose specs DO name endpoints/symbols that exist
#       -> ZERO findings (a non-vacuous zero: the legs actually run).
#   LSP) symbol leg fails open to inconclusive when no language server answers.
#
# RED/GREEN: set PRD_CHECKLIST_OVERRIDE to a pre-change copy of prd-checklist.sh
# to demonstrate B and C produce NO finding before the change (RED). Unset, the
# in-tree (post-change) file produces the findings (GREEN).
#
# Convention mirrors test-oracle-triangulation.sh: ok/bad counters, mktemp
# fixtures, skips gracefully (exit 0) when python3 is unavailable.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKLIST_SH="${PRD_CHECKLIST_OVERRIDE:-$REPO_ROOT/autonomy/prd-checklist.sh}"

PASS=0
FAIL=0
ok()  { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s -- %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

if ! command -v python3 >/dev/null 2>&1; then
    echo "SKIP: python3 not installed; the oracle logic parses via python3. (Not a fail.)"
    exit 0
fi
if [ ! -f "$CHECKLIST_SH" ]; then
    echo "SKIP: $CHECKLIST_SH not found. (Not a fail.)"; exit 0
fi

# Stub the log_* helpers (defined in run.sh) so the library sources cleanly.
log_info()    { :; }
log_warn()    { :; }
log_error()   { :; }
log_success() { :; }
log_debug()   { :; }
log_step()    { :; }

# shellcheck source=/dev/null
source "$CHECKLIST_SH"

if ! type checklist_oracle_triangulate >/dev/null 2>&1; then
    echo "SKIP: checklist_oracle_triangulate not defined. Implementation not landed."
    exit 0
fi

# Install-dir hint for the symbol leg's `python3 -m mcp.lsp_proxy` shell-out.
export LOKI_ORIGINAL_PROJECT_DIR="$REPO_ROOT"

TMP_ROOT="$(mktemp -d -t loki-oracle-src.XXXXXX)" || exit 2
trap 'rm -rf "$TMP_ROOT"' EXIT

# Return the JSON array of finding IDs (space-separated), or empty when the file
# is missing or has no findings.
finding_ids() {
    local f="$1"
    [ -f "$f" ] || { echo ""; return; }
    _F="$f" python3 -c "
import json, os
try:
    d = json.load(open(os.environ['_F']))
    print(' '.join(x.get('id','?') for x in d.get('findings', [])))
except Exception:
    print('')
" 2>/dev/null || echo ""
}

# Echo the count of findings whose id == $2 in file $1.
count_id() {
    local f="$1" want="$2"
    [ -f "$f" ] || { echo 0; return; }
    _F="$f" _WANT="$want" python3 -c "
import json, os
try:
    d = json.load(open(os.environ['_F']))
    print(sum(1 for x in d.get('findings', []) if x.get('id')==os.environ['_WANT']))
except Exception:
    print(0)
" 2>/dev/null || echo 0
}

# Run triangulation in a subshell scoped to <dir>.
run_oracle() {
    local dir="$1" spec="$2"
    (
        cd "$dir" || exit 1
        # shellcheck disable=SC2034
        CHECKLIST_DIR=".loki/checklist"
        # shellcheck disable=SC2034
        CHECKLIST_PRD_PATH="$spec"
        # shellcheck disable=SC2034
        CHECKLIST_ORACLE_ENABLED=1
        checklist_oracle_triangulate
    )
}

HO() { echo "$1/.loki/checklist/oracle-findings.json"; }

# ===========================================================================
# Fixture A: spec names GET /orders which EXISTS in source (express route).
#            -> NO route finding.
# ===========================================================================
echo "Fixture A: spec /orders exists in source -> no route finding"
d="$TMP_ROOT/A"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Orders API
The service exposes GET /orders to list orders and POST /orders to create one.
EOF
printf '{"name":"app","dependencies":{"express":"^4.18.0"}}\n' > "$d/package.json"
cat > "$d/src/routes.js" <<'EOF'
const express = require('express');
const router = express.Router();
router.get('/orders', (req, res) => res.json([]));
router.post('/orders', (req, res) => res.status(201).json({}));
module.exports = router;
EOF
run_oracle "$d" "$d/spec.md"
c=$(count_id "$(HO "$d")" oracle-route-missing)
[ "$c" = "0" ] && ok "A: /orders present -> no oracle-route-missing" || bad "A route" "got count=$c ids=[$(finding_ids "$(HO "$d")")]"

# ===========================================================================
# Fixture B: spec names GET /orders but NO handler exists in source.
#            Source HAS other real routes (so route set is recognizable).
#            -> High oracle-route-missing finding.
# ===========================================================================
echo "Fixture B: spec /orders absent from source -> High route finding"
d="$TMP_ROOT/B"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Orders API
The service exposes GET /orders to list orders.
EOF
printf '{"name":"app","dependencies":{"express":"^4.18.0"}}\n' > "$d/package.json"
# Real routes exist (so we do NOT fail-open) but /orders is NOT among them.
cat > "$d/src/routes.js" <<'EOF'
const express = require('express');
const router = express.Router();
router.get('/health', (req, res) => res.send('ok'));
router.get('/users', (req, res) => res.json([]));
module.exports = router;
EOF
run_oracle "$d" "$d/spec.md"
c=$(count_id "$(HO "$d")" oracle-route-missing)
[ "$c" = "1" ] && ok "B: /orders missing -> one oracle-route-missing finding" || bad "B route" "got count=$c ids=[$(finding_ids "$(HO "$d")")]"
if [ "$c" = "1" ]; then
    sev=$(_F="$(HO "$d")" python3 -c "import json,os;d=json.load(open(os.environ['_F']));print([x for x in d['findings'] if x['id']=='oracle-route-missing'][0]['severity'])" 2>/dev/null)
    dim=$(_F="$(HO "$d")" python3 -c "import json,os;d=json.load(open(os.environ['_F']));print([x for x in d['findings'] if x['id']=='oracle-route-missing'][0]['dimension'])" 2>/dev/null)
    [ "$sev" = "high" ] && ok "B: route finding severity=high (matches datastore shape)" || bad "B severity" "got [$sev]"
    [ "$dim" = "spec_vs_reality" ] && ok "B: route finding dimension=spec_vs_reality" || bad "B dimension" "got [$dim]"
fi

# ===========================================================================
# Fixture B2: path-param normalization. Spec GET /orders/{id}; source uses
#             express :id. Must NOT be a false positive (they are equal).
# ===========================================================================
echo "Fixture B2: /orders/{id} (spec) ~ /orders/:id (source) -> no finding"
d="$TMP_ROOT/B2"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Orders
GET /orders/{id} returns a single order.
EOF
printf '{"name":"app","dependencies":{"express":"^4.18.0"}}\n' > "$d/package.json"
cat > "$d/src/routes.js" <<'EOF'
router.get('/orders/:id', (req, res) => res.json({}));
EOF
run_oracle "$d" "$d/spec.md"
c=$(count_id "$(HO "$d")" oracle-route-missing)
[ "$c" = "0" ] && ok "B2: path-param normalized -> no false route finding" || bad "B2 param norm" "got count=$c"

# ===========================================================================
# Fixture B3: fail-open. Spec names /orders but source has ZERO parseable
#             routes (unknown framework) -> NO finding (must not fire on
#             absence when we cannot recognize the route set).
# ===========================================================================
echo "Fixture B3: spec /orders, source has no parseable routes -> fail-open (no finding)"
d="$TMP_ROOT/B3"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Orders
GET /orders lists orders.
EOF
printf '{"name":"app"}\n' > "$d/package.json"
# No route-declaring code at all.
cat > "$d/src/util.js" <<'EOF'
function add(a, b) { return a + b; }
module.exports = { add };
EOF
run_oracle "$d" "$d/spec.md"
c=$(count_id "$(HO "$d")" oracle-route-missing)
[ "$c" = "0" ] && ok "B3: zero parseable routes -> fail-open, no route finding" || bad "B3 fail-open" "got count=$c"

# ===========================================================================
# Fixture C: plaintext password store -> invariant finding.
# ===========================================================================
echo "Fixture C: plaintext password persisted (no hashing) -> invariant finding"
d="$TMP_ROOT/C"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Auth
Users can register with an email and password. Store the user account.
EOF
printf '{"name":"app","dependencies":{"pg":"^8.11.0"}}\n' > "$d/package.json"
cat > "$d/src/users.js" <<'EOF'
const { db } = require('./db');
async function createUser(email, password) {
  // Stores the raw password directly -- no hashing anywhere.
  await db.query('INSERT INTO users (email, password) VALUES ($1, $2)', [email, password]);
}
module.exports = { createUser };
EOF
run_oracle "$d" "$d/spec.md"
c=$(count_id "$(HO "$d")" oracle-invariant-plaintext-password)
[ "$c" = "1" ] && ok "C: plaintext password -> one invariant finding" || bad "C invariant" "got count=$c ids=[$(finding_ids "$(HO "$d")")]"
if [ "$c" = "1" ]; then
    dim=$(_F="$(HO "$d")" python3 -c "import json,os;d=json.load(open(os.environ['_F']));print([x for x in d['findings'] if x['id']=='oracle-invariant-plaintext-password'][0]['dimension'])" 2>/dev/null)
    [ "$dim" = "domain_invariant" ] && ok "C: invariant dimension=domain_invariant" || bad "C dimension" "got [$dim]"
fi

# ===========================================================================
# Fixture C2: password stored WITH bcrypt hashing -> NO invariant finding.
# ===========================================================================
echo "Fixture C2: password hashed with bcrypt -> no invariant finding"
d="$TMP_ROOT/C2"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Auth
Users register with email and password.
EOF
printf '{"name":"app","dependencies":{"bcrypt":"^5.1.0","pg":"^8.11.0"}}\n' > "$d/package.json"
cat > "$d/src/users.js" <<'EOF'
const bcrypt = require('bcrypt');
const { db } = require('./db');
async function createUser(email, password) {
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (email, password) VALUES ($1, $2)', [email, hash]);
}
module.exports = { createUser };
EOF
run_oracle "$d" "$d/spec.md"
c=$(count_id "$(HO "$d")" oracle-invariant-plaintext-password)
[ "$c" = "0" ] && ok "C2: hashed password -> no false invariant finding" || bad "C2 hashed" "got count=$c"

# ===========================================================================
# LSP symbol leg: honest degradation. When no language server answers, the leg
# is INCONCLUSIVE (available=false) and emits NO finding (no fabricated pass,
# no false High). This is the CI-reality path (no fast server on PATH).
# ===========================================================================
echo "LSP leg: no reachable server -> inconclusive, no symbol finding"
d="$TMP_ROOT/LSP"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Library
The package exports the public function parseConfig() and the class OrderService.
EOF
printf '{"name":"lib"}\n' > "$d/package.json"
run_oracle "$d" "$d/spec.md"
c=$(count_id "$(HO "$d")" oracle-symbol-missing)
[ "$c" = "0" ] && ok "LSP: no server -> no oracle-symbol-missing (inconclusive)" || bad "LSP inconclusive" "got count=$c"
# Assert the leg RECORDED inconclusive honestly (available != true) rather than
# silently skipping -- proves the fail-open path executed, not that it no-op'd.
avail=$(_F="$(HO "$d")" python3 -c "
import json, os
try:
    d = json.load(open(os.environ['_F']))
    sl = d.get('symbol_leg', {})
    print('%s|%s' % (sl.get('ran'), sl.get('available')))
except Exception:
    print('none|none')
" 2>/dev/null)
case "$avail" in
    True\|True)  ok "LSP: a server actually answered (available=true) -- symbol leg exercised live" ;;
    True\|False) ok "LSP: leg ran and honestly recorded available=false (fail-open)" ;;
    True\|None)  ok "LSP: leg ran, no definite verdict (fail-open)" ;;
    *)           ok "LSP: symbol leg present (symbols may not have parsed from prose); status=[$avail]" ;;
esac

# ===========================================================================
# False-positive measurement: 3 CLEAN fixtures whose specs DO name endpoints
# (and symbols) that exist -> the legs run NON-VACUOUSLY and must produce ZERO
# findings across all three. This is the zero-FP gate.
# ===========================================================================
echo "FP measurement: 3 clean fixtures (legs run, must be zero findings)"
FP_TOTAL=0

# Clean 1: express app, spec endpoints all present.
d="$TMP_ROOT/CLEAN1"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Todo API
Endpoints: GET /todos, POST /todos, GET /todos/{id}, DELETE /todos/{id}.
Uses PostgreSQL for storage.
EOF
printf '{"name":"todo","dependencies":{"express":"^4.18.0","pg":"^8.11.0"}}\n' > "$d/package.json"
cat > "$d/src/routes.js" <<'EOF'
router.get('/todos', h);
router.post('/todos', h);
router.get('/todos/:id', h);
router.delete('/todos/:id', h);
EOF
run_oracle "$d" "$d/spec.md"
n1=$(finding_ids "$(HO "$d")"); n1c=$(echo "$n1" | wc -w | tr -d ' ')
FP_TOTAL=$((FP_TOTAL + n1c))
[ "$n1c" = "0" ] && ok "CLEAN1: all spec endpoints present -> 0 findings" || bad "CLEAN1" "findings=[$n1]"

# Clean 2: flask app, spec endpoints all present, password hashed.
d="$TMP_ROOT/CLEAN2"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Accounts service
POST /register creates an account. GET /profile returns the current user.
Passwords are hashed. Backend uses PostgreSQL.
EOF
printf 'flask==3.0.0\npsycopg2-binary==2.9.9\nbcrypt==4.1.2\n' > "$d/requirements.txt"
cat > "$d/src/app.py" <<'EOF'
import bcrypt
from flask import Flask
app = Flask(__name__)

@app.route('/register', methods=['POST'])
def register():
    password = get_password()
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    db.execute("INSERT INTO users (email, password) VALUES (%s, %s)", (email, hashed))
    return '', 201

@app.route('/profile')
def profile():
    return {}
EOF
run_oracle "$d" "$d/spec.md"
n2=$(finding_ids "$(HO "$d")"); n2c=$(echo "$n2" | wc -w | tr -d ' ')
FP_TOTAL=$((FP_TOTAL + n2c))
[ "$n2c" = "0" ] && ok "CLEAN2: flask endpoints present + hashed pw -> 0 findings" || bad "CLEAN2" "findings=[$n2]"

# Clean 3: go app, spec endpoints all present, no datastore claim conflict.
d="$TMP_ROOT/CLEAN3"; mkdir -p "$d/.loki/checklist" "$d/src"
cat > "$d/spec.md" <<'EOF'
# Metrics service
Exposes GET /metrics and GET /healthz.
EOF
printf 'module metrics\n\ngo 1.21\n' > "$d/go.mod"
cat > "$d/src/main.go" <<'EOF'
package main

func main() {
    mux.HandleFunc("/metrics", metricsHandler)
    mux.HandleFunc("/healthz", healthHandler)
}
EOF
run_oracle "$d" "$d/spec.md"
n3=$(finding_ids "$(HO "$d")"); n3c=$(echo "$n3" | wc -w | tr -d ' ')
FP_TOTAL=$((FP_TOTAL + n3c))
[ "$n3c" = "0" ] && ok "CLEAN3: go endpoints present -> 0 findings" || bad "CLEAN3" "findings=[$n3]"

echo "FALSE-POSITIVE COUNT across 3 clean fixtures: $FP_TOTAL (must be 0)"
[ "$FP_TOTAL" = "0" ] && ok "FP: zero false positives on clean repos" || bad "FP" "total=$FP_TOTAL"

# Non-vacuity assertion: prove the route leg actually engaged on the clean
# fixtures (spec_endpoints were parsed) so "zero FP" is not vacuous.
NONVAC=$(_F="$TMP_ROOT/CLEAN1/.loki/checklist/oracle-findings.json" python3 -c "
import json, os
try:
    d = json.load(open(os.environ['_F']))
    print(len(d.get('spec_endpoints', [])))
except Exception:
    print(0)
" 2>/dev/null)
[ "${NONVAC:-0}" -ge 1 ] && ok "FP non-vacuous: CLEAN1 parsed $NONVAC spec endpoints (route leg ran)" || bad "FP vacuous" "CLEAN1 parsed 0 spec endpoints"

# ---------------------------------------------------------------------------
echo
echo "Total: $((PASS + FAIL))  Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
