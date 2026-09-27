#!/usr/bin/env bash
# Case functions are dispatched by name through run_case (SC2329), and the
# embedded sed/python/node programs carry literal dollar signs (SC2016).
# shellcheck disable=SC2329,SC2016
# Moat property P7: no fabricated data.
#
# "Every console panel is backed by a real endpoint. Cost is never shown as $0
# when it is unmeasured." (docs/LOKI-10-BUILD-PROMPT.md, section 2, item 7)
#
# Cases (IDs are permanent):
#   P7.webapp-client-routes-exist     every web-app client path resolves to a
#                                     real route in web-app/server.py
#   P7.dashboard-client-routes-exist  every /api/ path in dashboard-ui source
#                                     resolves to a real route in dashboard/server.py
#   P7.no-sample-data-panels          no production page reaches a panel that
#                                     falls back to hardcoded or generated sample
#                                     data, no Math.random() feeds a metric, and
#                                     no metric prop is fed a hardcoded number
#   P7.unmeasured-cost-never-zero     no cost rendering path turns an unmeasured
#                                     (null/undefined) cost into 0 or "$0.00",
#                                     and the budget, cost-timeline and fleet
#                                     endpoints send null (not 0) for spend
#                                     nobody measured, per run and in totals,
#                                     flag a partly measured run as partial,
#                                     and the context, token-economics,
#                                     learning and gate readers (and the
#                                     web-app session status and memory
#                                     readers) send null or [] until something
#                                     was measured
#
# Contract (tests/moat): one "CASE <ID> PASS|FAIL <text>" stdout line per case,
# diagnostics on stderr, exit 0 whenever the script ran to completion. A missing
# prerequisite is a FAIL, never a skip. Every "nothing found" result is paired
# with a positive control proving the same probe finds the bad case.
#
# The cost case's server leg starts the real dashboard app in-process
# (fastapi TestClient, which needs httpx; requirements-test.txt has both).
#
# SOURCE, NEVER THE BUNDLE. dashboard/static/index.html is the built bundle and
# is never scanned: a bundle scan measures the last build, not the code.
#
# ROUTES ARE MATCHED, NOT GREPPED. Both route cases import the real FastAPI
# app and ask its own router whether each client path reaches a route, the same
# on every FastAPI version; every included router must be proven mounted or the
# case fails naming it (see match-routes.py). Client paths are parsed with the
# TypeScript AST (the typescript package the web-app already depends on), never
# with a line regex.
#
# Prerequisites: python3 with fastapi (the route tables), node, and
# web-app/node_modules/typescript or dashboard-ui/node_modules/typescript
# inside THIS checkout (npm ci in web-app provides it). The two static-scan
# cases need only python3.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
export LOKI_TELEMETRY_DISABLED=true DO_NOT_TRACK=1 LOKI_NO_UPDATE_CHECK=1 CI=true
export LOKI_DELEGATE_PR=0 LOKI_DASHBOARD=false PYTHONDONTWRITEBYTECODE=1

MOAT_TMP="$(mktemp -d)" || { echo "p7: mktemp failed" >&2; exit 1; }
MOAT_TMP="$(cd "$MOAT_TMP" && pwd -P)"
MOAT_MAIN_PID=$$
moat_cleanup() {
    # Only the top-level shell removes the directory, never a subshell.
    [ "${BASHPID:-$$}" = "$MOAT_MAIN_PID" ] || return 0
    rm -rf -- "$MOAT_TMP"
}
trap moat_cleanup EXIT

diag() { printf 'p7: %s\n' "$*" >&2; }

# FastAPI app imports run with HOME inside the run directory, so an import-time
# write can never touch the operator's ~/.loki. PYTHONUSERBASE keeps a user-site
# fastapi importable after HOME moves.
MOAT_USERBASE="$(python3 -m site --user-base 2>/dev/null || true)"
mkdir -p "$MOAT_TMP/home"
py_server() { HOME="$MOAT_TMP/home" PYTHONUSERBASE="$MOAT_USERBASE" python3 "$@"; }

# ---------------------------------------------------------------------------
# Shared helpers written once into the run directory.
# ---------------------------------------------------------------------------

# Strip JS/TS/HTML comments while preserving line numbers. A comment explaining
# a banned pattern must not trip the ban (MetricsPage.tsx mentions Math.random
# in a comment and is a known-good file).
cat > "$MOAT_TMP/moatlib.py" <<'PY'
import os, re

BLOCK = re.compile(r'(?:(?<=^)|(?<=[\s{(;,=]))/\*.*?\*/', re.S | re.M)
LINE = re.compile(r'(^|[\s;{}(),])//[^\n]*', re.M)
HTML = re.compile(r'<!--.*?-->', re.S)

def _blank(m):
    return re.sub(r'[^\n]', ' ', m.group(0))

def strip_comments(src, html=False):
    if html:
        src = HTML.sub(_blank, src)
    src = BLOCK.sub(_blank, src)
    return LINE.sub(lambda m: m.group(1), src)

SKIP = re.compile(r'(\.test\.|\.spec\.|__tests__|\.check\.mjs$|/test/|/tests/)')

def walk(root, exts):
    out = []
    if os.path.isfile(root):
        return [root]
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in ('node_modules', 'dist', 'build')]
        for f in files:
            p = os.path.join(d, f)
            if f.endswith(exts) and not SKIP.search(p):
                out.append(p)
    return sorted(out)

def read(p):
    with open(p, encoding='utf-8', errors='replace') as fh:
        return fh.read()
PY

# ---------------------------------------------------------------------------
# Route contract helpers (AST extractor + route-table matcher).
# ---------------------------------------------------------------------------

# Extract every string, template and "+" chain that contains an /api path.
# Interpolations become {p}; a same-file const is inlined when it resolves to a
# literal (MAGIC_API = `${MOUNT_BASE}/api/magic`). A trailing interpolation glued
# to a segment ("/api/projects${query}") is dropped ONLY when it is provably a
# "?"-prefixed-or-empty query suffix; anything else is UNRESOLVED and fails the
# case -- truncating an unknown suffix could hide the exact drift we hunt.
cat > "$MOAT_TMP/extract-api.mjs" <<'JS'
import fs from 'node:fs';
const [tsPath, ...rest] = process.argv.slice(2);
// `--list FILE` reads one path per line, so paths never pass through word splitting.
const files = rest[0] === '--list' ? fs.readFileSync(rest[1], 'utf8').split('\n').filter(Boolean) : rest;
const ts = (await import(tsPath)).default;
const calls = [], unresolved = [], helpers = [];
const VERB = { _get: 'GET', _post: 'POST', _put: 'PUT', _delete: 'DELETE', _patch: 'PATCH',
  get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH' };
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS
    : file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const inlined = new Set();
  // Lexical lookup: the nearest enclosing block that declares the name wins, a
  // same-named parameter shadows it. `query` is redeclared in many methods, so a
  // file-wide name map would be ambiguous exactly where it matters.
  function lookup(id, wantFn) {
    for (let a = id.parent; a; a = a.parent) {
      if (!wantFn && ts.isFunctionLike(a) && a.parameters
          && a.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === id.text)) return null;
      const stmts = (ts.isBlock(a) || ts.isSourceFile(a) || ts.isModuleBlock(a) || ts.isCaseClause(a)
        || ts.isDefaultClause(a)) ? a.statements : null;
      if (!stmts) continue;
      for (const s of stmts) {
        if (wantFn && ts.isFunctionDeclaration(s) && s.name && s.name.text === id.text) return s;
        if (!wantFn && ts.isVariableStatement(s)) for (const d of s.declarationList.declarations)
          if (ts.isIdentifier(d.name) && d.name.text === id.text) return d.initializer || null;
      }
    }
    return null;
  }
  const constInit = (id) => lookup(id, false);
  const isPlus = (n) => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;
  const hasApi = (parts) => parts.some((p) => p.lit !== undefined && p.lit.includes('/api'));
  function resolve(n, depth) {
    if (ts.isParenthesizedExpression(n)) return resolve(n.expression, depth);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [{ lit: n.text }];
    if (ts.isTemplateExpression(n)) {
      const out = [{ lit: n.head.text }];
      for (const s of n.templateSpans) { out.push(...interp(s.expression, depth)); out.push({ lit: s.literal.text }); }
      return out;
    }
    if (isPlus(n)) return [...resolve(n.left, depth), ...resolve(n.right, depth)];
    return interp(n, depth);
  }
  function interp(e, depth) {
    if (ts.isIdentifier(e) && depth < 3) {
      let init = constInit(e);
      if (init && ts.isBinaryExpression(init) && (init.operatorToken.kind === ts.SyntaxKind.BarBarToken
          || init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) init = init.right;
      if (init) { const r = resolve(init, depth + 1); if (hasApi(r)) { inlined.add(e.text); return r; } }
    }
    return [{ expr: e }];
  }
  function queryish(e) {
    if (ts.isParenthesizedExpression(e)) return queryish(e.expression);
    if (ts.isIdentifier(e)) { const i = constInit(e); return i ? queryish(i) : false; }
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
      // A same-file helper qualifies only when EVERY return is a query suffix.
      const fn = lookup(e.expression, true);
      if (!fn || !fn.body) return false;
      const rets = [];
      (function r(n) { if (ts.isReturnStatement(n)) rets.push(n); if (!ts.isFunctionLike(n)) ts.forEachChild(n, r); })(fn.body);
      return rets.length > 0 && rets.every((s) => s.expression && queryish(s.expression));
    }
    if (!ts.isConditionalExpression(e)) return false;
    const t = resolve(e.whenTrue, 3), f = resolve(e.whenFalse, 3);
    const empty = f.length === 1 && f[0].lit === '';
    return empty && t.length > 0 && t[0].lit !== undefined && t[0].lit.startsWith('?');
  }
  function methodOf(n) {
    let top = n;
    while (top.parent && ts.isParenthesizedExpression(top.parent)) top = top.parent;
    const c = top.parent;
    if (!c || !ts.isCallExpression(c) || c.arguments[0] !== top) return '*';
    const name = ts.isIdentifier(c.expression) ? c.expression.text
      : ts.isPropertyAccessExpression(c.expression) ? c.expression.name.text : '';
    if (VERB[name]) return VERB[name];
    if (name !== 'fetch') return '*';
    const o = c.arguments[1];
    if (!o) return 'GET';
    if (!ts.isObjectLiteralExpression(o)) return '*';
    for (const pr of o.properties) {
      if (ts.isPropertyAssignment(pr) && pr.name.getText(sf) === 'method')
        return (ts.isStringLiteral(pr.initializer) || ts.isNoSubstitutionTemplateLiteral(pr.initializer))
          ? pr.initializer.text.toUpperCase() : '*';
    }
    return 'GET';
  }
  function visit(n) {
    const strish = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || isPlus(n);
    const nested = n.parent && (isPlus(n.parent) || ts.isTemplateSpan(n.parent)
      || (ts.isParenthesizedExpression(n.parent) && n.parent.parent && isPlus(n.parent.parent)));
    if (strish && !nested && !ts.isImportDeclaration(n.parent) && !ts.isExportDeclaration(n.parent)
        && !ts.isLiteralTypeNode(n.parent)) {
      const parts = resolve(n, 0);
      let joined = '', exprAt = [];
      for (const p of parts) { if (p.lit !== undefined) joined += p.lit; else { exprAt.push([joined.length, p.expr]); joined += '{p}'; } }
      const m = /\/api(?=\/|\?|$|\{p\})/.exec(joined);
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      const where = `${file}:${line}`;
      const decl = n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) ? n.parent.name.text : null;
      const declOr = n.parent && ts.isBinaryExpression(n.parent) && n.parent.parent
        && ts.isVariableDeclaration(n.parent.parent) && ts.isIdentifier(n.parent.parent.name) ? n.parent.parent.name.text : null;
      const baseName = decl || declOr;
      if (m) {
        let path = joined.slice(m.index); const offset = m.index;
        const q = path.indexOf('?'); if (q >= 0) path = path.slice(0, q);
        path = path.replace(/\/+$/, '');
        let bad = null, helper = false;
        if (/^\/api(\{p\}|\/\{p\})?$/.test(path)) helper = true;   // generic request helper: `${API_BASE}${path}`
        const trail = /([^/])\{p\}$/.exec(path);
        if (!helper && trail) {
          const pos = offset + path.length - 3;
          const hit = exprAt.find(([at]) => at === pos);
          if (hit && queryish(hit[1])) path = path.slice(0, -3);
          else bad = 'trailing interpolation glued to a segment is not a provable query suffix';
        }
        if (!helper && !bad) for (const seg of path.split('/')) if (seg.includes('{p}') && seg !== '{p}') bad = `segment '${seg}' is partially interpolated`;
        cands.push({ where, path, bad, helper, baseName, raw: joined.slice(0, 120), method: methodOf(n) });
      }
    }
    ts.forEachChild(n, visit);
  }
  const cands = [];
  visit(sf);
  // A const that was inlined into another /api path is a base URL, not a call
  // (MAGIC_API = `${MOUNT_BASE}/api/magic`). A const used directly, e.g.
  // `const url = '/api/status'; fetch(url)`, was never inlined and IS checked.
  for (const c of cands) {
    if (c.baseName && inlined.has(c.baseName)) continue;
    if (c.helper) helpers.push(c.where);
    else if (c.bad) unresolved.push({ where: c.where, raw: c.raw, why: c.bad });
    else calls.push({ where: c.where, path: c.path, method: c.method });
  }
}
console.log(JSON.stringify({ files: files.length, captured: calls.length, calls, unresolved, helpers }));
JS

# Match extracted calls against a FastAPI app with the app's OWN matcher
# (Starlette's public route.matches(scope)), never by walking app.routes as a
# table. app.routes is a framework detail: FastAPI >= 0.141 stores an included
# router as ONE lazy wrapper, so a table walk saw zero /api/v2 routes on a clean
# requirements-test.txt install while every one of them served (BACKLOG 27/29;
# tests/dashboard/test_router_mounts_diagnostic.py). Client {p} segments are
# sent as "1". Method '*' means the extractor could not see the verb (a URL
# built into a variable), so only the path is checked.
#
# Every router the server includes must have MOUNTED: each is imported directly
# and each of its own routes must be reachable, or the matcher refuses (exit 2)
# and names the cause. An optional router that failed to import or mount is a
# named failure, never a smaller route count. ROUTES is counted from top-level
# /api routes plus each router's own routes, so it is the same on every host.
# Extra argv entries (the positive control only) name files defining a
# `router` that must be mounted.
cat > "$MOAT_TMP/match-routes.py" <<'PY'
import importlib, importlib.util, json, os, re, sys
repo, modspec, calls_json, extra = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
sys.path.insert(0, repo)
if modspec == 'dashboard':
    from dashboard import server
    expected = ['dashboard.api_v2', 'dashboard.api_operator']
else:
    sys.path.insert(0, os.path.join(repo, 'web-app'))
    import server
    expected = []
from fastapi import APIRouter
from starlette.routing import Match

# Only /api routes and path-less wrappers (the lazy included router) are asked,
# so the SPA catch-all and the /lab mount can never vouch for an /api path.
cands = [r for r in server.app.routes if getattr(r, 'path', None) is None or r.path.startswith('/api')]

def scope(path, method, kind='http'):
    return {'type': kind, 'path': path, 'root_path': '', 'method': method, 'headers': [], 'query_string': b''}

def reach(path, method):
    """'full', 'partial' (the path exists for other methods only) or None."""
    best = None
    for m in (['GET'] if method == '*' else [method] + (['GET'] if method == 'HEAD' else [])):
        for r in cands:
            got = r.matches(scope(path, m))[0]
            if got == Match.FULL:
                return 'full'
            if got == Match.PARTIAL:
                best = 'partial'
    if any(r.matches(scope(path, 'GET', 'websocket'))[0] == Match.FULL for r in cands):
        return 'full'
    return 'full' if (method == '*' and best) else best

concrete = lambda p: re.sub(r'\{[^}]*\}', '1', p)
key = lambda r: (r.path.rstrip('/') or '/', frozenset(getattr(r, 'methods', None) or {'WS'}))
table = {key(r) for r in server.app.routes if (getattr(r, 'path', None) or '').startswith('/api')}

routers = []
for name in expected:
    try:
        routers.append((name, importlib.import_module(name).router))
    except Exception as exc:
        print(f'FATAL router {name} failed to import ({type(exc).__name__}: {exc}); the server cannot have mounted its routes')
        sys.exit(2)
for f in extra:
    spec = importlib.util.spec_from_file_location('moat_ctl_router', f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    routers.append((f, mod.router))
seen = {id(r) for _, r in routers}
routers += [(f'server.{k}', v) for k, v in sorted(vars(server).items()) if isinstance(v, APIRouter) and id(v) not in seen]
for name, router in routers:
    own = [r for r in router.routes if getattr(r, 'path', None)]
    if not own:
        print(f'FATAL router {name} has no routes; nothing to prove mounted')
        sys.exit(2)
    lost = [r.path for r in own if any(reach(concrete(r.path), m) != 'full' for m in (getattr(r, 'methods', None) or ['GET']))]
    if lost:
        print(f'FATAL router {name}: {len(lost)} of {len(own)} routes are not reachable on the app, so it did not mount (first: {lost[0]})')
        sys.exit(2)
    table |= {key(r) for r in own}
if not table:
    print('FATAL zero /api routes found; the comparison would be vacuous')
    sys.exit(2)

data = json.load(open(calls_json))
drift = []
for call in data['calls']:
    path, method = call['path'], call['method']
    got = reach(concrete(path), method)
    if got is None:
        drift.append(f"{call['where']} {method} {path} -> NO ROUTE")
    elif got == 'partial':
        drift.append(f"{call['where']} {method} {path} -> route exists, but not for {method}")
print(f'ROUTES {len(table)} (routers proven mounted: {len(routers)})')
for d in drift:
    print('DRIFT ' + d)
sys.exit(1 if drift else 0)
PY

# Resolve the typescript module from THIS checkout only (never a sibling tree).
find_typescript() {
    local d
    for d in web-app dashboard-ui; do
        if [ -f "$REPO_ROOT/$d/node_modules/typescript/lib/typescript.js" ]; then
            printf '%s\n' "$REPO_ROOT/$d/node_modules/typescript/lib/typescript.js"
            return 0
        fi
    done
    return 1
}

# Common prerequisite gate for the two route cases. Prints a reason on failure.
route_prereqs() {
    command -v node >/dev/null 2>&1 || { echo "prerequisite missing: node"; return 1; }
    command -v python3 >/dev/null 2>&1 || { echo "prerequisite missing: python3"; return 1; }
    py_server -c 'import fastapi' >/dev/null 2>&1 || { echo "prerequisite missing: python fastapi"; return 1; }
    find_typescript >/dev/null || { echo "prerequisite missing: typescript (npm ci in web-app or dashboard-ui of this checkout)"; return 1; }
    return 0
}

# Run the extractor and matcher; echo "PASS|..." or "FAIL|...". Args:
#   $1 label  $2 server module (dashboard|webapp)  $3 file with one source path per line
extract_and_match() {
    local label="$1" mod="$2" list="$3" ts out rc captured unres nfiles
    nfiles="$(grep -c . "$list")"
    ts="$(find_typescript)"
    out="$MOAT_TMP/$label.calls.json"
    if ! node "$MOAT_TMP/extract-api.mjs" "$ts" --list "$list" > "$out" 2> "$MOAT_TMP/$label.extract.err"; then
        echo "FAIL|extractor crashed: $(head -c 200 "$MOAT_TMP/$label.extract.err" | tr '\n' ' ')"
        return 0
    fi
    captured="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["captured"])' "$out" 2>/dev/null)"
    unres="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d["unresolved"])); [print("  unresolved", u["where"], u["why"], u["raw"], file=sys.stderr) for u in d["unresolved"]]' "$out")"
    diag "$label: captured ${captured:-0} /api calls, ${unres:-?} unresolved"
    case "${captured:-0}" in ''|0) echo "FAIL|zero /api calls captured from $nfiles files; the check would be vacuous"; return 0 ;; esac
    rc=0
    ( cd "$MOAT_TMP" && py_server "$MOAT_TMP/match-routes.py" "$REPO_ROOT" "$mod" "$out" ) \
        > "$MOAT_TMP/$label.match.txt" 2> "$MOAT_TMP/$label.match.err" || rc=$?
    sed 's/^/  /' "$MOAT_TMP/$label.match.txt" >&2
    case "$rc" in
        0) ;;
        1) echo "FAIL|$(grep -c '^DRIFT' "$MOAT_TMP/$label.match.txt") client path(s) have no matching route: $(grep '^DRIFT' "$MOAT_TMP/$label.match.txt" | head -3 | sed 's/^DRIFT //; s#'"$REPO_ROOT"'/##' | tr '\n' ';')"; return 0 ;;
        *) echo "FAIL|route matcher refused (rc=$rc): $(tail -c 200 "$MOAT_TMP/$label.match.err" "$MOAT_TMP/$label.match.txt" | tr '\n' ' ')"; return 0 ;;
    esac
    if [ "${unres:-1}" != "0" ]; then
        echo "FAIL|$unres client path(s) could not be resolved statically (listed on stderr); refusing to under-report"
        return 0
    fi
    echo "PASS|$captured calls resolved"
}

# Positive control shared by both route cases: a known construct set must be
# extracted exactly, an unknown suffix must be UNRESOLVED, a made-up path must
# be flagged and a real path accepted by the SAME matcher.
route_control() {
    local mod="$1" real="$2" ts ctl got
    ts="$(find_typescript)"
    ctl="$MOAT_TMP/ctl-$mod"
    mkdir -p "$ctl"
    cat > "$ctl/good.js" <<'JS'
const API = `${base}/api/magic`;
async function a(api, id, base) {
  await api._get('/api/status');
  await fetch(base + '/api/notifications/' + encodeURIComponent(id) + '/acknowledge', { method: 'POST' });
  await fetch(`${API}/components/${id}/debate`, { method: 'POST' });
  const query = id ? `?status=${id}` : '';
  await api._get(`/api/projects${query}`);
}
JS
    printf '%s\n' 'async function b(api, foo) { await api._get(`/api/x${foo}`); }' > "$ctl/bad.js"
    node "$MOAT_TMP/extract-api.mjs" "$ts" "$ctl/good.js" > "$ctl/good.json" 2>/dev/null || { echo "extractor crashed on the control file"; return 1; }
    got="$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
print(" ".join(sorted(c["method"]+":"+c["path"] for c in d["calls"])), "unresolved=%d" % len(d["unresolved"]))' "$ctl/good.json")"
    if [ "$got" != "GET:/api/projects GET:/api/status POST:/api/magic/components/{p}/debate POST:/api/notifications/{p}/acknowledge unresolved=0" ]; then
        echo "extractor control mismatch: got '$got'"; return 1
    fi
    node "$MOAT_TMP/extract-api.mjs" "$ts" "$ctl/bad.js" > "$ctl/bad.json" 2>/dev/null || { echo "extractor crashed on the bad control"; return 1; }
    got="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["unresolved"]))' "$ctl/bad.json")"
    [ "$got" = "1" ] || { echo "extractor control: an unknown glued suffix was not reported unresolved (got $got)"; return 1; }
    printf '{"calls":[{"where":"ctl:1","path":"%s","method":"GET"}]}' "$real" > "$ctl/real.json"
    printf '{"calls":[{"where":"ctl:2","path":"/api/moat-made-up-route-7f3a","method":"GET"}]}' > "$ctl/fake.json"
    ( cd "$MOAT_TMP" && py_server "$MOAT_TMP/match-routes.py" "$REPO_ROOT" "$mod" "$ctl/real.json" ) > "$ctl/real.out" 2>&1 \
        || { echo "matcher control: real path $real was not accepted: $(grep -m1 -E '^(FATAL|DRIFT)' "$ctl/real.out" || tail -c 160 "$ctl/real.out")"; return 1; }
    local frc=0
    ( cd "$MOAT_TMP" && py_server "$MOAT_TMP/match-routes.py" "$REPO_ROOT" "$mod" "$ctl/fake.json" ) >/dev/null 2>&1 || frc=$?
    [ "$frc" = "1" ] || { echo "matcher control: a made-up path was not flagged (rc=$frc)"; return 1; }
    # A router the app never included must be a named refusal, not a pass.
    printf '%s\n' 'from fastapi import APIRouter' "router = APIRouter(prefix='/api/moat-ctl-unmounted-7f3a')" \
        "router.add_api_route('/x', lambda: {}, methods=['GET'])" > "$ctl/unmounted_router.py"
    frc=0
    ( cd "$MOAT_TMP" && py_server "$MOAT_TMP/match-routes.py" "$REPO_ROOT" "$mod" "$ctl/real.json" "$ctl/unmounted_router.py" ) \
        > "$ctl/unmounted.out" 2>&1 || frc=$?
    { [ "$frc" = "2" ] && grep -q 'did not mount' "$ctl/unmounted.out"; } \
        || { echo "matcher control: an unmounted router was not refused by name (rc=$frc)"; return 1; }
    return 0
}

# ---------------------------------------------------------------------------
# P7.webapp-client-routes-exist
# ---------------------------------------------------------------------------
case_webapp_routes() {
    local why ex mt rc
    why="$(route_prereqs)" || { echo "FAIL|$why"; return 0; }
    why="$(route_control webapp /api/sessions/history)" || { echo "FAIL|positive control failed: $why"; return 0; }

    # Part 1: the existing fetchJSON guard helpers, run in place from the repo.
    # Both helpers resolve their own repo root dynamically (import.meta.url /
    # __file__), so invoking them directly from $REPO_ROOT already measures
    # this tree; no copy or literal-rewrite is needed (or possible, since
    # neither file has a hardcoded root left to rewrite).
    ex="$REPO_ROOT/tests/lib-extract-client-paths.mjs"; mt="$REPO_ROOT/tests/lib-match-client-routes.py"
    [ -f "$ex" ] && [ -f "$mt" ] \
        || { echo "FAIL|prerequisite missing: tests/lib-extract-client-paths.mjs or tests/lib-match-client-routes.py"; return 0; }
    rc=0
    ( cd "$MOAT_TMP" && node "$ex" > "$MOAT_TMP/fetchjson.json" 2> "$MOAT_TMP/fetchjson.err" ) || rc=$?
    [ "$rc" = 0 ] || { echo "FAIL|existing client.ts extractor failed: $(head -c 160 "$MOAT_TMP/fetchjson.err" | tr '\n' ' ')"; return 0; }
    rc=0
    ( cd "$MOAT_TMP" && py_server "$mt" "$MOAT_TMP/fetchjson.json" ) > "$MOAT_TMP/fetchjson.match" 2>&1 || rc=$?
    sed 's/^/  /' "$MOAT_TMP/fetchjson.match" >&2
    grep -aqE 'server /api routes: [1-9]' "$MOAT_TMP/fetchjson.match" \
        || { echo "FAIL|existing matcher read no web-app routes (rc=$rc); the comparison was vacuous"; return 0; }
    case "$rc" in
        0) ;;
        1) echo "FAIL|client.ts fetchJSON paths drifted: $(grep -E '^ +client.ts:' "$MOAT_TMP/fetchjson.match" | head -3 | tr -s ' ' | tr '\n' ';')"; return 0 ;;
        *) echo "FAIL|existing matcher refused (rc=$rc): $(tail -c 160 "$MOAT_TMP/fetchjson.match" | tr '\n' ' ')"; return 0 ;;
    esac

    # Part 2: literal /api paths and raw fetch calls anywhere in web-app/src
    # (MagicPage, the chat stream URL, preview URLs) that fetchJSON never sees.
    python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import moatlib; print("\n".join(moatlib.walk(sys.argv[2], (".ts", ".tsx"))))' \
        "$MOAT_TMP" "$REPO_ROOT/web-app/src" > "$MOAT_TMP/webapp.files"
    extract_and_match webapp-literals webapp "$MOAT_TMP/webapp.files"
}

# ---------------------------------------------------------------------------
# P7.dashboard-client-routes-exist
# ---------------------------------------------------------------------------
case_dashboard_routes() {
    local why
    why="$(route_prereqs)" || { echo "FAIL|$why"; return 0; }
    [ -f "$REPO_ROOT/dashboard-ui/core/loki-api-client.js" ] \
        || { echo "FAIL|dashboard-ui/core/loki-api-client.js missing; nothing to measure"; return 0; }
    why="$(route_control dashboard /api/status)" || { echo "FAIL|positive control failed: $why"; return 0; }
    python3 -c '
import sys; sys.path.insert(0, sys.argv[1]); import moatlib
fs = moatlib.walk(sys.argv[2], (".js", ".mjs")) + moatlib.walk(sys.argv[3], (".js", ".mjs"))
print("\n".join(fs))' "$MOAT_TMP" "$REPO_ROOT/dashboard-ui/core" "$REPO_ROOT/dashboard-ui/components" > "$MOAT_TMP/dashboard.files"
    grep -q 'dashboard-ui/core/loki-api-client.js$' "$MOAT_TMP/dashboard.files" \
        || { echo "FAIL|loki-api-client.js was not in the scanned file list; the check would miss the main client"; return 0; }
    extract_and_match dashboard dashboard "$MOAT_TMP/dashboard.files"
}

# ---------------------------------------------------------------------------
# P7.no-sample-data-panels
# ---------------------------------------------------------------------------
# Five rules, all on comment-stripped source:
#   1. A component with a sample fallback (`x || generateSample*()`,
#      `x || SAMPLE_*`, `x ?? sampleFoo`) must not be reachable from a routed
#      page (web-app/src/pages/*, App.tsx) through the JSX mount graph. Passing a
#      data prop does NOT exempt it: the fallback still renders fake data the
#      moment that prop is empty. Passes once the panel is unmounted or its
#      fallback is deleted (a backed panel renders an empty/unmeasured state).
#   2. No reachable JSX prop is fed a SAMPLE_* constant or sample generator.
#   3. No Math.random() feeds a metric-named field (uses, rating, tokens, cost,
#      count, total, score, ...). Confetti, skeleton widths and ids are fine.
#   4. No reachable JSX prop with a metric name (gatePassRate, testCoverage,
#      qualityScore, totalTokens, linesGenerated, lintErrors, ...) is fed a
#      numeric literal or a ternary of two numeric literals. That is a number
#      nobody measured, rendered as a reading (`gatePassRate={0.8}`,
#      `testCoverage={i > 2 ? 60 : 20}`); an unmeasured value is null and the
#      component says so. Layout props (size, thickness) are not metric names.
#   5. No sample, mock, demo, fake or dummy source is assigned, returned, fed
#      to a JSX prop or used as initial state with no `||`/`??` in front, and no
#      useState starts from a generate*() function. These are the unconditional
#      forms rule 1 cannot see: `this._phases = this._getDemoData()` in a catch
#      block (the old cost waterfall) and `useState(generateOverviewCards)` (the
#      old admin overview). A name counts when a camelCase word is Sample, Mock,
#      Demo, Fake or Dummy (Mockup does not); is/has/should/can/show flags are
#      not data sources. Like rule 3 it applies to every web-app source file,
#      reachable or not: a hook or helper returning demo rows is not a JSX tag,
#      so the mount graph cannot see it.
# Rules 6-9 read the WHOLE file with a bracket matcher, never one line at a
# time: every fabrication they target spans lines. Like rules 3 and 5 they apply
# to every web-app source file and every dashboard-ui file, reachable or not.
#   6. No array of literal rows is passed to a set*() setter or useState()
#      (anywhere in the argument list, not only as the first argument), or
#      appears anywhere in a catch body (`catch {`, `.catch(() => {...})`), or
#      is an operand of `||`/`??`, or is either branch of a ternary whose OTHER
#      branch is not also a literal, or is the right-hand side of `this._x =`
#      or of a local that later flows into a setter/useState/`this.y =` (at
#      declaration, `const/let/var x = [rows]`, OR a later bare reassignment
#      `x = [rows]` after x was already declared), or is
#      the argument of Array.of() or the first argument of Array.from(). A row
#      is literal when every value is a string, number, boolean, null, a
#      `new Date(...)`/`Date.now()` expression, `as const`, or a nested literal
#      array/object. The Teams page seeded every team's Activity tab with four
#      invented rows in a fetch-less effect, and swapped in a sample team and
#      sample audit rows whenever a request failed; this is that shape.
#      `setStats([{ label: 'Stars', value: stars }])` reads a variable and is
#      not literal. A named module-level table (DEFAULT_PERMISSIONS, COLUMNS,
#      GALLERY, TABS, DEFAULT_PROVIDERS) is a negative control even when it
#      seeds useState, and a timer callback (setTimeout/setInterval/etc.) is
#      never treated as a setter. See the ponytail comment above
#      whole_file_findings() for the shapes this rule still cannot see.
#   7. No binding NAMED sample, mock, demo, fake, dummy or placeholder (bare,
#      camelCase or SAMPLE_-style) is bound to an array or object literal. A
#      string placeholder is input-hint copy and is not flagged.
#   8. No invented stats: a `||`/`??` fallback to an object literal whose
#      metric-named key (uses, rating, stars, downloads, count, total, score,
#      ...) holds a number (`TEMPLATE_STATS[f] || { uses: 500, rating: 4.5 }`),
#      and no lookup table of two or more entries whose values are objects made
#      only of metric-named numeric literals (the TEMPLATE_STATS table itself).
#   9. No zero fallback is fed straight into a number formatter:
#      `(x ?? 0).toLocaleString()`, `(x || 0).toFixed(1)`,
#      `x?.toLocaleString() || 0`, `formatPercent(x || 0)`. That renders an
#      unmeasured value as a measured 0; the fix renders "--" for null.
# dashboard-ui web components are all shipped in the bundle, so rules 1, 3 and
# 5-9 apply to every dashboard-ui component file directly.
cat > "$MOAT_TMP/sample-panels.py" <<'PY'
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import moatlib
webapp_src, dash_dirs = sys.argv[1], sys.argv[2:]
FALLBACK = re.compile(r'(?:\|\||\?\?)\s*(?:generate\w*?(?:Sample|Mock|Demo|Fake)\w*\s*\(|(?:SAMPLE|MOCK|DEMO|FAKE)_[A-Z0-9_]+\b|(?:sample|mock|demo|fake)[A-Z]\w*\b)')
PROP = re.compile(r'\w+=\{\s*(?:(?:SAMPLE|MOCK|DEMO|FAKE)_[A-Z0-9_]+|generate\w*?(?:Sample|Mock|Demo|Fake)\w*\s*\()')
METRIC = re.compile(r'\b\w*(?:uses|count|rating|tokens|cost|percent|total|score|requests|views|downloads|stars|spend|revenue)\w*\b\s*(?::|=(?!=))[^;,]*Math\.random', re.I)
NUM = r'-?\d+(?:\.\d+)?'
HARDPROP = re.compile(r'\b(?:\w*(?:Rate|Coverage|Score|Tokens|Cost|Percent|Percentage|Passing|Generated|Modified|Usage|Spend|Confidence|Errors|Complexity)'
                      r'|rate|coverage|score|tokens|cost|percent|percentage|confidence)=\{\s*(?:' + NUM + r'|[^{}?]*\?\s*' + NUM + r'\s*:\s*' + NUM + r')\s*\}')
ID = r'((?:this\.)?[A-Za-z_$][\w$]*)'
ASSIGN = re.compile(r'(?:(?<![=!<>+\-*/%&|^?])=(?![=>])\s*\{?|\breturn\b)\s*(?:\(\s*\)\s*=>\s*)?' + ID)
STATE = re.compile(r'\buseState\s*(?:<[^()]*?>)?\s*\(\s*(?:\(\s*\)\s*=>\s*)?' + ID)
DEMO = re.compile(r'(?:^|[a-z\d_$])(?:Sample|Mock|Demo|Fake|Dummy)(?![a-z])|^_*(?:sample|mock|demo|fake|dummy)(?=[A-Z_\d])|^_*(?:SAMPLE|MOCK|DEMO|FAKE|DUMMY)_')
FLAG = re.compile(r'^_*(?:is|has|should|can|show)[A-Z]')
GEN = re.compile(r'^_*generate[A-Z]')
def demo_lines(s):
    hits = set()
    for rx, gen in ((ASSIGN, False), (STATE, True)):
        for m in rx.finditer(s):
            name = re.sub(r'^this\.', '', m.group(1))
            if not FLAG.search(name) and (DEMO.search(name) or (gen and GEN.search(name))):
                hits.add(s.count('\n', 0, m.start(1)) + 1)
    return sorted(hits)

# --- rules 6-9: whole-file, bracket-matched --------------------------------
OPEN = {'(': ')', '[': ']', '{': '}'}
def skip_quoted(s, i):
    """s[i] is a quote or backtick; return the index of its closing quote."""
    q, j = s[i], i + 1
    while j < len(s):
        c = s[j]
        if c == '\\':
            j += 2; continue
        if c == q:
            return j
        if q == '`' and s.startswith('${', j):
            k = close_of(s, j + 1)
            if k < 0:
                return len(s)
            j = k
        j += 1
    return len(s)
def close_of(s, i):
    """s[i] opens ( [ or {; return the index of its closer, or -1."""
    stack, j = [OPEN[s[i]]], i + 1
    while j < len(s):
        c = s[j]
        if c in '\'"`':
            j = skip_quoted(s, j)
        elif c in OPEN:
            stack.append(OPEN[c])
        elif c in ')]}':
            if stack.pop() != c:
                return -1
            if not stack:
                return j
        j += 1
    return -1
def split_top(s):
    """Split on commas that are not inside brackets or strings."""
    parts, depth, cur, j = [], 0, 0, 0
    while j < len(s):
        c = s[j]
        if c in '\'"`':
            j = skip_quoted(s, j)
        elif c in OPEN:
            depth += 1
        elif c in ')]}':
            depth -= 1
        elif c == ',' and depth == 0:
            parts.append(s[cur:j]); cur = j + 1
        j += 1
    parts.append(s[cur:])
    return [p.strip() for p in parts if p.strip()]
def top_colon(s):
    j = 0
    while j < len(s):
        c = s[j]
        if c in '\'"`':
            j = skip_quoted(s, j)
        elif c in OPEN:
            k = close_of(s, j)
            if k < 0:
                return -1
            j = k
        elif c == ':':
            return j
        j += 1
    return -1
LIT_WORDS = {'new', 'Date', 'now', 'toISOString', 'toString', 'getTime', 'toLocaleString',
             'toLocaleDateString', 'toLocaleTimeString', 'true', 'false', 'null', 'undefined'}
STR = re.compile(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\$])*`")
NUMLIT = re.compile(r'(?<![\w$])\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?')
def is_literal(v):
    """True when v is data typed in by hand: no variable, call or spread in it."""
    v = re.sub(r'\s+as\s+const\s*$', '', v.strip())
    if not v or v.startswith('...'):
        return False
    if v[0] in '[{' and close_of(v, 0) == len(v) - 1:
        parts = split_top(v[1:-1])
        if v[0] == '[':
            return all(is_literal(p) for p in parts)
        for p in parts:
            k = top_colon(p)
            if p.startswith('...') or k < 0 or not is_literal(p[k + 1:]):
                return False
        return True
    t = NUMLIT.sub('0', STR.sub('0', v))
    if re.search(r'[`\[\]{}]|=>', t):
        return False
    return all(w in LIT_WORDS for w in re.findall(r'[A-Za-z_$][\w$]*', t))
def literal_rows(arr):
    """arr is an array literal's text; True when it holds object rows, all literal."""
    parts = split_top(arr[1:-1])
    return any(p.startswith('{') for p in parts) and all(is_literal(p) for p in parts)
line_of = lambda s, i: s.count('\n', 0, i) + 1
SETTER = re.compile(r'\b(set[A-Z]\w*|useState)\s*(?=[(<])')
CATCH = re.compile(r'\bcatch\s*(?:\([^()]*\))?\s*\{|\.catch\s*\(')
ARRAY_CTX = re.compile(r'(?:[=(,:?\[|&]|\breturn)\s*$')
def expr_end(s):
    """Index one past the end of the expression at the start of s: up to the
    first top-level `,`, `;`, or an unmatched closing bracket. Used to isolate
    a ternary's `:` branch, which has no closing delimiter of its own."""
    j = 0
    while j < len(s):
        c = s[j]
        if c in '\'"`':
            j = skip_quoted(s, j)
        elif c in OPEN:
            k = close_of(s, j)
            if k < 0:
                return j
            j = k
        elif c in ')]},;':
            return j
        j += 1
    return j
def ternary_colon_of(s, q):
    """s[q] is a bare `?` (a ternary, never `?.`/`??`). Return the index of its
    matching `:`, scanning forward and skipping quotes and bracket spans, and
    counting nested bare `?` so a nested ternary's `:` is not mistaken for the
    outer one. -1 if the expression ends (`,`/`;`/an unmatched closer) first."""
    depth, j = 0, q + 1
    while j < len(s):
        c = s[j]
        if c in '\'"`':
            j = skip_quoted(s, j)
        elif c in OPEN:
            k = close_of(s, j)
            if k < 0:
                return -1
            j = k
        elif c in ')]},;':
            return -1
        elif c == '?' and s[j:j + 2] not in ('?.', '??'):
            depth += 1
        elif c == ':':
            if depth == 0:
                return j
            depth -= 1
        j += 1
    return -1
# Rule 6 extension. Each targets one specific place a literal row array can
# hide as a fallback or return value, per the round-4 reviewer's fix:
#   FALLBACK_ARR: an operand of `||` or `??` (never `?.`, which these two
#     tokens cannot form).
#   TERNARY: either branch of `a ? x : y`, checked below with ternary_colon_of.
#     A branch is flagged only when it is a literal-rows array AND THE OTHER
#     BRANCH IS NOT ALSO A LITERAL (is_literal, reused as-is): choosing
#     between live data and typed-in rows is the fallback shape rule 6 targets
#     (`entries.length ? entries.filter(...) : [invented rows]`); choosing
#     between two literals (`provider === 'claude' ? [{value:'',label:
#     'Account default'}, ...] : []`) is static UI config the same as a
#     module-level options table, even when one side is the empty-array
#     placeholder.
#   ASSIGN_ARR: `this._x = [rows]` (unconditional: `this.` never occurs at
#     module scope, so every hit is inside a method) or `const/let/var x =
#     [rows]` where x later flows into state: passed to a non-timer set*()/
#     useState(), or assigned to `this.y`. Skipped when the declaration starts
#     at column 0 (the same module-level convention the DEF regex below relies
#     on): a named module-level table (DEFAULT_PROVIDERS, DEFAULT_PERMISSIONS,
#     COLUMNS, GALLERY, TABS) is a negative control even when it seeds
#     useState, matching how the reviewer scoped this arm to "a local".
#   REASSIGN_ARR (BACKLOG 125 B-1): a bare `x = [rows]` occurring AFTER x's own
#     declaration, not only at `const/let/var x = [rows]` (DECL_ARR's site).
#     `let rows = data; if (!rows.length) rows = [invented rows]; setRows(rows);`
#     reassigns rows to a fabricated fallback inside a guard, with no `const/
#     let/var` at that point, so DECL_ARR never fires. Reuses the identical
#     FLOWS_TO_STATE_TMPL flow check DECL_ARR uses, so the sink-detection is not
#     reimplemented, only the "where can the array literal appear" site is
#     widened. Excludes `this.x =`/`obj.x =` (own lookbehind; THIS_ARR already
#     owns `this.`), `==`/`===`/`=>`, and the declaration site itself.
#   ponytail: three structural gaps this arm cannot see, all pre-existing at
#   HEAD: a render-local literal list fed straight to .map() with no setter in
#   between (TABS/filters/severities-style UI config has the same shape); an
#   UNNAMED module-level table that seeds useState (DEFAULT_PROVIDERS is named
#   and column-0, so it is caught by the exemption instead, but a fabricated
#   table would read identically); and a ternary whose OTHER branch is also a
#   literal (`cond ? [rows] : []`, the advisorOpts shape) -- is_literal cannot
#   tell typed-in fabricated rows from a typed-in options list by structure
#   alone, and a content heuristic (flag rows shaped like activity/audit
#   entries) is a keyword list a future case will break. Rules 5 and 7 still
#   catch a sample/mock/demo/fake/placeholder NAME in any of these. Upgrade
#   only if review finds a real instance, not preemptively.
FALLBACK_ARR = re.compile(r'(?:\|\||\?\?)\s*\[')
TIMER_LIKE = re.compile(r'^(?:setTimeout|setInterval|setImmediate|setAttribute|setItem|setProperty)$')
ARRAY_OF = re.compile(r'\bArray\.(of|from)\s*\(')
MODULE_DECL = re.compile(r'^(?:export\s+(?:default\s+)?)?(?:const|let|var)\s', re.M)
DECL_ARR = re.compile(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;{}]*)?=(?![=>])\s*\[')
THIS_ARR = re.compile(r'\bthis\.([A-Za-z_$][\w$]*)\s*(?::[^=;{}]*)?=(?![=>])\s*\[')
# BACKLOG 125 B-1: a bare REASSIGNMENT after declaration (`let rows = data;`
# ... later ... `rows = [...]`), which DECL_ARR cannot see because there is no
# `const/let/var` at that point. `(?<![\w$.])` excludes `obj.rows =`/`this.rows
# =` (THIS_ARR already owns the `this.` case) and a compound assignment
# (`+=`); `=(?![=>])` excludes `==`, `===` and `=>` the same as DECL_ARR.
REASSIGN_ARR = re.compile(r'(?<![\w$.])([A-Za-z_$][\w$]*)\s*=(?![=>])\s*\[')
DECL_KEYWORD = re.compile(r'\b(?:const|let|var)\s*$')
FLOWS_TO_STATE_TMPL = (r'\b(?:set[A-Z]\w*|useState)\s*(?:<[^()]*?>)?\s*\(\s*(?:\(\s*\)\s*=>\s*)?'
                       r'{name}\s*[,)]|\bthis\.\w+\s*=\s*{name}\b')
DEMO_NAME = re.compile(r'(?:\b(?:const|let|var)\s+|\bthis\.)([A-Za-z_$][\w$]*)\s*(?::[^=;]*?)?=(?![=>])\s*([\[{])')
BARE = re.compile(r'^_*(?:sample|mock|demo|fake|dummy|placeholder)s?$|^_*placeholder(?=[A-Z_\d])|^_*PLACEHOLDER_', re.I)
STAT_KEY = re.compile(r'^["\']?(?:uses|usage|rating|ratings|stars|forks|downloads|installs|views|users|builds|runs|count|total|score|percent|tokens|cost|spend|revenue|reviews|likes|confidence|coverage)["\']?$', re.I)
NUMVAL = re.compile(r'^-?\d[\d_]*(?:\.\d+)?$')
ZERO_FMT = re.compile(r'(?:\|\||\?\?)\s*0\s*\)\s*\.\s*(?:toLocaleString|toFixed)\s*\('
                      r'|\.\s*(?:toLocaleString|toFixed)\s*\([^()]*\)\s*\|\|\s*0(?![\w.])'
                      r'|\b_?format\w*\s*\([^(),]*(?:\|\||\?\?)\s*0\s*[,)]')
def obj_pairs(o):
    out = []
    for p in split_top(o[1:-1]):
        k = top_colon(p)
        if k < 0:
            return None
        out.append((p[:k].strip(), p[k + 1:].strip()))
    return out
def whole_file_findings(s):
    """(line, message) for rules 6-9; nested arrays inside a hit are not re-reported."""
    out, spans = [], []
    def add_rows(i, msg):
        j = close_of(s, i)
        if j < 0 or any(a <= i <= b for a, b in spans):
            return
        if literal_rows(s[i:j + 1]):
            spans.append((i, j)); out.append((line_of(s, i), msg))
    def add_rows_call(i, j, msg):
        """Like add_rows, but (i, j) is a paren span already known to be
        closed (Array.of(...)), so it is checked as-is instead of re-deriving
        j from s[i]. literal_rows() strips one char each side regardless of
        bracket kind, so a paren span works the same as a bracket span."""
        if any(a <= i <= b for a, b in spans):
            return
        if literal_rows(s[i:j + 1]):
            spans.append((i, j)); out.append((line_of(s, i), msg))
    for m in SETTER.finditer(s):
        i = m.end()
        if s[i] == '<':
            depth = 0
            while i < len(s):
                depth += {'<': 1, '>': -1}.get(s[i], 0) if s[i - 1:i + 1] != '=>' else 0
                i += 1
                if depth == 0:
                    break
        i = len(s) - len(s[i:].lstrip())
        if i >= len(s) or s[i] != '(':
            continue
        arg = s[i + 1:]
        lazy = re.match(r'\s*\(\s*\)\s*=>\s*', arg)
        k = i + 1 + (lazy.end() if lazy else len(arg) - len(arg.lstrip()))
        if k < len(s) and s[k] == '[':
            add_rows(k, f'literal sample rows passed to {m.group(1)}()')
    for m in CATCH.finditer(s):
        b = m.end() - 1
        e = close_of(s, b)
        if e < 0:
            continue
        for k in range(b + 1, e):
            if s[k] == '[' and ARRAY_CTX.search(s[max(b, k - 40):k]):
                add_rows(k, 'literal sample rows assigned in a catch block')
    for m in DEMO_NAME.finditer(s):
        name = m.group(1)
        if FLAG.search(name) or not (BARE.search(name) or DEMO.search(name)):
            continue
        out.append((line_of(s, m.start(1)), f"'{name}' binds sample/mock/demo/fake/placeholder literal data"))
    for m in re.finditer(r'(?:\|\||\?\?)\s*\{', s):
        i = m.end() - 1
        j = close_of(s, i)
        pairs = obj_pairs(s[i:j + 1]) if j > 0 else None
        if pairs and any(STAT_KEY.match(k) and NUMVAL.match(v) for k, v in pairs):
            out.append((line_of(s, i), 'invented stats: constant metric fallback'))
    for m in re.finditer(r'=\s*\{', s):
        i = m.end() - 1
        j = close_of(s, i)
        pairs = obj_pairs(s[i:j + 1]) if j > 0 else None
        if not pairs or len(pairs) < 2:
            continue
        rows = [obj_pairs(v) if v.startswith('{') and close_of(v, 0) == len(v) - 1 else None for _, v in pairs]
        if all(r and all(STAT_KEY.match(k) and NUMVAL.match(v) for k, v in r) for r in rows):
            out.append((line_of(s, i), 'invented stats lookup table'))
    for m in ZERO_FMT.finditer(s):
        out.append((line_of(s, m.start()), 'unmeasured value rendered as zero (zero fallback fed to a formatter)'))
    # --- rule 6 extension: literal rows anywhere a fallback/assignment/call
    #     argument can hold them, not only at a setter's first argument or in a
    #     catch body. Added after the arms above so their messages and spans
    #     win the dedupe in add_rows() when both match the same array.
    for m in FALLBACK_ARR.finditer(s):
        add_rows(m.end() - 1, 'literal sample rows used as a ||/?? fallback')
    for m in re.finditer(r'(?<!\?)\?(?![.?:])', s):
        c = ternary_colon_of(s, m.start())
        if c < 0:
            continue
        q_raw = s[m.end():c]
        q_branch = q_raw.strip()
        e = m.end() + len(q_raw) - len(q_raw.lstrip())
        colon_raw = s[c + 1:]
        colon_branch_strip = colon_raw.lstrip()
        cstart = c + 1 + (len(colon_raw) - len(colon_branch_strip))
        if e < len(s) and s[e] == '[' and not is_literal(colon_raw[:expr_end(colon_raw)]):
            add_rows(e, 'literal sample rows in a ternary branch')
        if cstart < len(s) and s[cstart] == '[' and not is_literal(q_branch):
            add_rows(cstart, 'literal sample rows in a ternary branch')
    for m in DECL_ARR.finditer(s):
        name = m.group(1)
        line_start = s.rfind('\n', 0, m.start()) + 1
        if MODULE_DECL.match(s, line_start):
            continue  # named module-level table (DEFAULT_PROVIDERS et al.), a negative control
        if re.search(FLOWS_TO_STATE_TMPL.format(name=re.escape(name)), s):
            add_rows(m.end() - 1, 'literal sample rows assigned to ' + name)
    for m in THIS_ARR.finditer(s):
        add_rows(m.end() - 1, 'literal sample rows assigned to this.' + m.group(1))
    for m in REASSIGN_ARR.finditer(s):
        name = m.group(1)
        if DECL_KEYWORD.search(s, 0, m.start(1)):
            continue  # a declaration site: DECL_ARR already owns `const/let/var x = [`
        if re.search(FLOWS_TO_STATE_TMPL.format(name=re.escape(name)), s):
            add_rows(m.end() - 1, 'literal sample rows reassigned to ' + name)
    for m in SETTER.finditer(s):
        i = m.end()
        if i < len(s) and s[i] == '<':
            depth = 0
            while i < len(s):
                depth += {'<': 1, '>': -1}.get(s[i], 0) if s[i - 1:i + 1] != '=>' else 0
                i += 1
                if depth == 0:
                    break
        i = len(s) - len(s[i:].lstrip())
        if i >= len(s) or s[i] != '(' or TIMER_LIKE.match(m.group(1)):
            continue
        j = close_of(s, i)
        if j < 0:
            continue
        for k in range(i + 1, j):
            if s[k] == '[':
                add_rows(k, f'literal sample rows in the {m.group(1)}() argument list')
    for m in ARRAY_OF.finditer(s):
        p = m.end() - 1
        j = close_of(s, p)
        if j < 0:
            continue
        if m.group(1) == 'of':
            add_rows_call(p, j, 'literal sample rows via Array.of()')
        else:
            arg0 = split_top(s[p + 1:j])
            if arg0 and arg0[0].startswith('['):
                add_rows(p + 1 + s[p + 1:j].index('['), 'literal sample rows via Array.from()')
    # --- Array.from({length:N}, generator) fabrication bypass (BACKLOG 125 B-8) -
    # the arm above only sees a literal FIRST argument, so a generator callback
    # that fabricates static string fields per row (`(_, i) => ({ id: i,
    # action: 'Deployed', user: 'Admin' })`) was invisible. Scoped narrowly:
    #   - arg0 must be exactly `{ length: N }` (a real iterable argument, e.g.
    #     `Array.from(items, ...)`, is untouched -- that is real iteration, not
    #     invented rows).
    #   - arg1 must be a concise-body arrow returning an object literal.
    #   - the arrow's own parameters (the index, conventionally `i`) are
    #     substituted with `0` before reusing is_literal, since an index is a
    #     counter, not invented data -- `(_, i) => ({ id: i })` stays GREEN.
    #   - at least one field must still be a literal STRING after that
    #     substitution: the fabrication signal this arm targets (an
    #     index/derived-only row has none and stays GREEN).
    # ponytail: does not see [...Array(n)].map, new Array(n).fill().map,
    # Array.from({length:n}).map((_, i) => ({...})) (the chained form), a
    # typed param list (`(_: unknown, i: number) =>`, since ARROW_HEAD has no
    # `:` in its class), `{ length }` shorthand (obj_pairs returns None with
    # no colon), block-bodied `=> { return {...} }` callbacks, function
    # callbacks, or a templated id (`` `row-${i}` ``, already rejected by
    # is_literal's backtick-`${` check). Upgrade only if review finds a real
    # instance.
    ARROW_HEAD = re.compile(r'^\(?\s*([\w$,\s]*)\s*\)?\s*=>\s*')
    for m in ARRAY_OF.finditer(s):
        if m.group(1) != 'from':
            continue
        p = m.end() - 1
        j = close_of(s, p)
        if j < 0:
            continue
        args = split_top(s[p + 1:j])
        if len(args) != 2:
            continue
        arg0, arg1 = args[0].strip(), args[1].strip()
        pairs0 = obj_pairs(arg0) if arg0.startswith('{') and close_of(arg0, 0) == len(arg0) - 1 else None
        if pairs0 is None or [k for k, _ in pairs0] != ['length']:
            continue
        head = ARROW_HEAD.match(arg1)
        if not head:
            continue
        body = arg1[head.end():].strip()
        if not (body.startswith('(') and close_of(body, 0) == len(body) - 1):
            continue
        inner = body[1:-1].strip()
        if not inner.startswith('{'):
            continue
        params = {pn.strip() for pn in head.group(1).split(',') if pn.strip()}
        subbed = inner
        for pname in params:
            subbed = re.sub(r'(?<![\w$])' + re.escape(pname) + r'(?![\w$])', '0', subbed)
        if not is_literal(subbed):
            continue
        gen_pairs = obj_pairs(inner)
        if not gen_pairs or not any(STR.fullmatch(v.strip()) for _, v in gen_pairs):
            continue
        idx = s.index(inner, p)
        end = idx + len(inner) - 1
        if any(a <= idx <= b for a, b in spans):
            continue
        spans.append((idx, end))
        out.append((line_of(s, idx), 'fabricated static fields via Array.from() generator callback'))
    return sorted(set(out))
DEF = re.compile(r'^(?:export\s+(?:default\s+)?)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*[:=])', re.M)
TAG = re.compile(r'<([A-Z]\w*)[\s/>]')
findings = []
files = moatlib.walk(webapp_src, ('.tsx', '.ts'))
if not files:
    print('FATAL no web-app source files found'); sys.exit(2)
src = {f: moatlib.strip_comments(moatlib.read(f)) for f in files}
defs = {}
for f, s in src.items():
    for m in DEF.finditer(s):
        defs.setdefault(m.group(1) or m.group(2), f)
def lines_matching(s, rx):
    return [i + 1 for i, l in enumerate(s.split('\n')) if rx.search(l)]
pages = [f for f in files if os.sep + 'pages' + os.sep in f or f.endswith(os.sep + 'App.tsx')]
if not pages:
    print('FATAL no routed pages found under ' + webapp_src); sys.exit(2)
reach = {}
queue = list(pages)
for p in pages:
    reach[p] = [os.path.basename(p)]
while queue:
    f = queue.pop(0)
    for name in sorted(set(TAG.findall(src[f]))):
        g = defs.get(name)
        if g and g not in reach:
            reach[g] = reach[f] + [name]
            queue.append(g)
rel = lambda f: os.path.relpath(f, os.path.dirname(webapp_src.rstrip('/')))
for f in sorted(reach):
    for ln in lines_matching(src[f], FALLBACK):
        findings.append(f'{rel(f)}:{ln} sample-data fallback reachable via {" > ".join(reach[f])}')
    for ln in lines_matching(src[f], PROP):
        findings.append(f'{rel(f)}:{ln} JSX prop fed sample data, reachable via {" > ".join(reach[f])}')
    # Whole file, so a ternary split across lines is still one prop (BACKLOG 107).
    for ln in sorted({line_of(src[f], m.start()) for m in HARDPROP.finditer(src[f])}):
        findings.append(f'{rel(f)}:{ln} hardcoded number presented as a measured metric, reachable via {" > ".join(reach[f])}')
for f in files:
    for ln in lines_matching(src[f], METRIC):
        findings.append(f'{rel(f)}:{ln} Math.random() feeds a rendered metric')
    for ln in demo_lines(src[f]):
        findings.append(f'{rel(f)}:{ln} demo/sample data assigned or used as state')
    for ln, msg in whole_file_findings(src[f]):
        findings.append(f'{rel(f)}:{ln} {msg}')
for d in dash_dirs:
    # A file root (build-standalone.js) is named from the repo root like a dir root.
    base = d.rstrip('/') if os.path.isdir(d) else os.path.dirname(d)
    drel = lambda f: os.path.relpath(f, os.path.dirname(os.path.dirname(base)))
    for f in moatlib.walk(d, ('.js', '.html')):
        # The built bundle is never evidence about source.
        if f.endswith(os.sep + 'static' + os.sep + 'index.html') or (os.sep + 'assets' + os.sep) in f:
            continue
        s = moatlib.strip_comments(moatlib.read(f), html=f.endswith('.html'))
        for ln in lines_matching(s, FALLBACK):
            findings.append(f'{drel(f)}:{ln} sample-data fallback in a shipped web component')
        for ln in lines_matching(s, METRIC):
            findings.append(f'{drel(f)}:{ln} Math.random() feeds a rendered metric')
        for ln in demo_lines(s):
            findings.append(f'{drel(f)}:{ln} demo/sample data assigned in a shipped web component')
        for ln, msg in whole_file_findings(s):
            findings.append(f'{drel(f)}:{ln} {msg} in a shipped web component')
print(f'SCANNED pages={len(pages)} reachable={len(reach)} files={len(files)}')
for f in sorted(reach):
    print('REACH ' + rel(f))
for x in findings:
    print('FINDING ' + x)
sys.exit(1 if findings else 0)
PY

# Rules 6-9 control. The positives are the shipped fabrications VERBATIM (the
# Teams page and RBAC panel at 61af5915, the TEMPLATE_STATS table and fallback
# deleted in f63fae61, the zero-into-formatter lines from the learning and
# memory dashboards), each asserted at its exact line with an exact per-file
# finding count; the look-alikes must stay clean. Prints the reason and
# returns 1 on failure.
sample_rules_6_9_control() {
    local d="$1" out rc f want got
    mkdir -p "$d/src/pages" "$d/src/components" "$d/dash/components"
    printf '%s\n' 'export function P() { return <div />; }' > "$d/src/pages/P.tsx"
    # web-app/src/pages/TeamsPage.tsx:41-81 at 61af5915.
    cat > "$d/src/components/TeamsVerbatim.tsx" <<'TSX'
  // Load teams
  useEffect(() => {
    setLoading(true);
    api.getTeams()
      .then(data => {
        setTeams(data);
        if (data.length > 0 && !selectedTeam) {
          setSelectedTeam(data[0]);
        }
      })
      .catch(() => {
        // Use sample data when endpoint is not available
        const sample: TeamInfo[] = [
          {
            id: 'team-1',
            name: 'Engineering',
            created_at: new Date().toISOString(),
            members: [
              { id: 'm1', email: 'admin@example.com', name: 'Team Admin', role: 'admin' as const, joined_at: new Date().toISOString() },
              { id: 'm2', email: 'dev@example.com', name: 'Developer', role: 'editor' as const, joined_at: new Date().toISOString() },
              { id: 'm3', email: 'viewer@example.com', name: 'Viewer', role: 'viewer' as const, joined_at: new Date().toISOString() },
            ],
          },
        ];
        setTeams(sample);
        if (!selectedTeam) setSelectedTeam(sample[0]);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load activities
  useEffect(() => {
    if (!selectedTeam) return;
    setActivities([
      { id: 'a1', action: 'Created project "my-app"', user: 'Developer', timestamp: '2 hours ago' },
      { id: 'a2', action: 'Deployed to production', user: 'Team Admin', timestamp: '5 hours ago' },
      { id: 'a3', action: 'Invited viewer@example.com', user: 'Team Admin', timestamp: '1 day ago' },
      { id: 'a4', action: 'Updated RBAC settings', user: 'Team Admin', timestamp: '2 days ago' },
    ]);
  }, [selectedTeam]);
TSX
    # web-app/src/components/RBACPanel.tsx:302-317 at 61af5915.
    cat > "$d/src/components/RbacVerbatim.tsx" <<'TSX'
  // Load audit log
  useEffect(() => {
    if (activeSection !== 'audit') return;
    setAuditLoading(true);
    api.getAuditLog()
      .then(entries => setAuditEntries(entries))
      .catch(() => {
        // Use sample data when endpoint is not yet available
        setAuditEntries([
          { id: '1', action: 'member.invited', user: 'admin@example.com', target: 'dev@example.com', timestamp: new Date().toISOString(), details: 'Invited as editor' },
          { id: '2', action: 'role.created', user: 'admin@example.com', target: 'Deployer', timestamp: new Date(Date.now() - 3600000).toISOString() },
          { id: '3', action: 'project.created', user: 'editor@example.com', target: 'my-app', timestamp: new Date(Date.now() - 7200000).toISOString() },
        ]);
      })
      .finally(() => setAuditLoading(false));
  }, [activeSection, teamId]);
TSX
    # The TEMPLATE_STATS table and its fallback (TemplatesPage.tsx:77-98 and
    # :407 before f63fae61), then the same lookup with a constant fallback.
    cat > "$d/src/components/TemplateStats.tsx" <<'TSX'
const TEMPLATE_STATS: Record<string, { uses: number; rating: number }> = {
  'saas-starter.md': { uses: 2847, rating: 4.9 },
  'rest-api-auth.md': { uses: 1923, rating: 4.8 },
  'discord-bot.md': { uses: 1654, rating: 4.7 },
  'full-stack-demo.md': { uses: 1432, rating: 4.8 },
  'data-pipeline.md': { uses: 1198, rating: 4.6 },
  'cli-tool.md': { uses: 987, rating: 4.7 },
  'e-commerce.md': { uses: 2156, rating: 4.8 },
  'blog-platform.md': { uses: 1345, rating: 4.5 },
  'rest-api.md': { uses: 1567, rating: 4.6 },
  'slack-bot.md': { uses: 876, rating: 4.4 },
  'dashboard.md': { uses: 1789, rating: 4.7 },
  'web-scraper.md': { uses: 654, rating: 4.3 },
  'chrome-extension.md': { uses: 543, rating: 4.5 },
  'microservice.md': { uses: 1123, rating: 4.6 },
  'mobile-app.md': { uses: 932, rating: 4.4 },
  'game.md': { uses: 765, rating: 4.5 },
  'npm-library.md': { uses: 445, rating: 4.3 },
  'static-landing-page.md': { uses: 1876, rating: 4.6 },
  'simple-todo-app.md': { uses: 2345, rating: 4.7 },
  'ai-chatbot.md': { uses: 1234, rating: 4.8 },
};
            const stats = TEMPLATE_STATS[t.filename] || { uses: Math.floor(Math.random() * 800) + 100, rating: (Math.random() * 0.7 + 4.0).toFixed(1) };
            const stats = TEMPLATE_STATS[t.filename] || { uses: 500, rating: 4.5 };
TSX
    # Rule 9, one line each: web-app MetricsPanel.tsx:43 and the learning and
    # memory dashboards' token/confidence lines, plus a toFixed form.
    cat > "$d/src/components/ZeroFmt.tsx" <<'TSX'
export function Z({ metrics, e }) {
              {(metrics.tokens_used ?? 0).toLocaleString()}
                <span class="econ-value">${this._tokenEconomics.discoveryTokens?.toLocaleString() || 0}</span>
              ${this._formatPercent(this._metrics.avgConfidence || 0)}
  const d = (e.rate || 0).toFixed(1);
  return null; }
TSX
    # Rule 7: a binding NAMED sample/mock/demo/fake/placeholder holding literal data.
    cat > "$d/src/components/Named.tsx" <<'TSX'
export function N() {
  const sample = [{ id: 1, name: 'Engineering' }];
  const mockRows = { a: 1 };
  this._demoData = [];
  const PLACEHOLDER_USERS = [{ email: 'viewer@example.com' }];
  let fakeStats: Stats = { uses: 1 };
  return null; }
TSX
    # Honest look-alikes: a row reading a variable, an append, idle initial
    # state, an empty reset, a config fallback, a string placeholder, an error
    # path that renders no rows, a mapped response, a price table carrying a
    # label, a null-aware formatter, and a user message built from input.
    cat > "$d/src/components/HonestRows.tsx" <<'TSX'
export function H({ stars, x, opts, data }) {
  setStats([{ label: 'GitHub Stars', value: stars }]);
  setItems(prev => [...prev, x]);
  const [deploy] = useState({ vercel: { status: 'idle' }, netlify: { status: 'idle' } });
  setRows([]);
  const o = opts || { retries: 3, timeout: 30 };
  const placeholder = 'Search teams';
  try { load(); } catch { setRows([]); setError('Could not load teams'); }
  api.get().catch(() => { setError('failed'); setRows(data.map((r) => ({ id: r.id }))); });
  const RATES = { sonnet: { input: 3, output: 15, label: 'Sonnet' }, haiku: { input: 1, output: 5, label: 'Haiku' } };
  const t = x == null ? '--' : x.toLocaleString();
  const u = (x ?? null);
  setMessages(prev => [...prev, { role: 'user', content: x, at: new Date().toISOString() }]);
  return null; }
TSX
    # A shipped web component that fills its table with literal rows when the
    # read fails; flagged at the assignment (line 6).
    cat > "$d/dash/components/loki-audit-fallback.js" <<'JS'
export class LokiAuditFallback extends LokiElement {
  async _load() {
    try {
      this._entries = await this._api._get('/api/audit');
    } catch (err) {
      this._entries = [
        { user: 'admin@example.com', action: 'role.created', timestamp: new Date().toISOString() },
      ];
    }
  }
}
JS
    # Round-4 adversarial reviewer's three exact reproductions of the rule 6
    # gap (a fabrication in a ||/??, ternary or Array.of() fallback, none of
    # which is a setter's or useState's FIRST argument or inside a catch body):
    # the TeamsPage ternary, the cost-waterfall || fallback, and Array.of().
    cat > "$d/src/components/TernaryFallback.tsx" <<'TSX'
export function T({ entries, selectedTeam }) {
  useEffect(() => {
    setActivities(entries.length ? entries.filter(e => e.team_id === selectedTeam.id) : [{ id: 'a1', action: 'Deployed to production', user: 'Team Admin', timestamp: '2 hours ago' }, { id: 'a2', action: 'Invited viewer@example.com', user: 'Team Admin', timestamp: '1 day ago' }]);
  }, [entries, selectedTeam]);
  return null;
}
TSX
    cat > "$d/dash/components/loki-cost-waterfall-or.js" <<'JS'
export class LokiCostWaterfallOr extends LokiElement {
  async _loadData(data) {
    this._phases = data.phases || [{ name: 'build', cost_usd: 0.42, tokens: 18000 }, { name: 'test', cost_usd: 0.17, tokens: 7000 }];
  }
}
JS
    cat > "$d/src/components/ArrayOfFallback.tsx" <<'TSX'
export function A() {
  setActivities(Array.of({ id: 'a1', action: 'Deployed to production', user: 'Team Admin', timestamp: '2 hours ago' }));
  return null;
}
TSX
    # Extra positives for the rule 6 extension's other new shapes: a ternary
    # whose LITERAL branch is the `?` side (not just the `:` side above), a
    # local that flows into a plain setter, and the same flowing into a
    # generic useState<T>(name) form.
    cat > "$d/src/components/TernaryQBranch.tsx" <<'TSX'
export function TQ({ data }) {
  this._x = data.length ? [{ id: 'a1', action: 'Deployed', user: 'Admin', timestamp: 'now' }] : data;
  return null;
}
TSX
    cat > "$d/src/components/DeclFlowsToState.tsx" <<'TSX'
export function DF({ cond, data }) {
  const rows = cond ? data : [{ id: 'a1', action: 'Deployed', user: 'Admin', timestamp: 'now' }];
  setRows(rows);
  return null;
}
TSX
    cat > "$d/src/components/DeclGenericUseState.tsx" <<'TSX'
export function DG() {
  const items = [{ id: 'a1', action: 'Deployed', user: 'Admin', timestamp: 'now' }];
  const [x] = useState<Row[]>(items);
  return null;
}
TSX
    # Per-arm coverage positives: each of these is shaped so exactly one arm
    # can claim it (an earlier arm in scan order never reaches it), so
    # deleting that arm changes this control's result. Without these, THIS_ARR,
    # the setter-span "anywhere in the argument list" reach, and Array.from()
    # have no committed control at all, and a reviewer deleting any of them
    # would leave the suite green.
    cat > "$d/dash/components/ThisArrOnly.js" <<'JS'
export class ThisArrOnly extends LokiElement {
  _seed() {
    this._phases = [{ phase: 'build', cost_usd: 0.42, tokens: 18000 }];
  }
}
JS
    cat > "$d/src/components/SetterSpanOnly.tsx" <<'TSX'
export function SS({ prev }) {
  setActivities(prev.concat([{ id: 'a1', action: 'Deployed', user: 'Admin', timestamp: 'now' }]));
  return null;
}
TSX
    cat > "$d/dash/components/ArrayFromOnly.js" <<'JS'
export class ArrayFromOnly extends LokiElement {
  _seed() {
    this._rows = Array.from([{ id: 'a1', action: 'Deployed', user: 'Admin', timestamp: 'now' }]);
  }
}
JS
    cat > "$d/src/components/DeclPlainSetter.tsx" <<'TSX'
export function DP() {
  const rows = [{ id: 'a1', action: 'Deployed', user: 'Admin', timestamp: 'now' }];
  setRows(rows);
  return null;
}
TSX
    # The two FLOWS_TO_STATE_TMPL alternatives DeclPlainSetter and
    # DeclGenericUseState do not reach: a local reassigned to `this.y` instead
    # of passed to a setter, and the lazy useState(() => name) initializer form.
    cat > "$d/dash/components/ThisFlowOnly.js" <<'JS'
export class ThisFlowOnly extends LokiElement {
  _seed() {
    const rows = [{ phase: 'build', cost_usd: 0.42, tokens: 18000 }];
    this._phases = rows;
  }
}
JS
    cat > "$d/src/components/DeclLazyUseState.tsx" <<'TSX'
export function DL() {
  const items = [{ id: 'a1', action: 'Deployed', user: 'Admin', timestamp: 'now' }];
  const [x] = useState(() => items);
  return null;
}
TSX
    # BACKLOG 125 B-1: a bare reassignment AFTER declaration, not at `const/let/
    # var x = [`. DECL_ARR only ever matches the declaration site, so
    # `let rows = data;` followed by a later `rows = [...]` inside a guard was
    # invisible to every existing arm. The name flows to setRows() the same way
    # DECL_ARR's own fixtures prove flow, so REASSIGN_ARR reuses that same
    # FLOWS_TO_STATE_TMPL check rather than re-deriving "flows to a sink".
    cat > "$d/src/components/ReassignFallback.tsx" <<'TSX'
export function RF({ data }) {
  let rows = data;
  if (!rows.length) rows = [{ id: 'a1', action: 'Deployed', user: 'Admin', timestamp: 'now' }];
  setRows(rows);
  return null;
}
TSX
    # Negative control for the same shape: the reassignment builds an object
    # row from a real API response (a variable value, not a typed-in literal),
    # so REASSIGN_ARR's regex fires but literal_rows() must reject it because
    # `id: res.id` is not a literal value. Proves the arm gates on content, not
    # merely on the `name = [` shape.
    cat > "$d/src/components/ReassignHonest.tsx" <<'TSX'
export function RH({ data, res }) {
  let rows = data;
  if (!rows.length) rows = [{ id: res.id, action: res.action }];
  setRows(rows);
  return null;
}
TSX
    # Negative controls for the rule 6 extension: a ternary between two
    # literals (advisorOpts, real shape at loki-session-control.js:471), a
    # render-local literal list mapped straight into markup with no setter, a
    # named module-level table that seeds useState (DEFAULT_PROVIDERS, real
    # shape at SystemSettingsPage.tsx:69), the module-level config tables
    # named in the moat task (DEFAULT_PERMISSIONS, COLUMNS, GALLERY, verbatim
    # shapes from RBACPanel.tsx, Footer.tsx and ShowcasePage.tsx), and a
    # timer callback (never a React/state setter).
    cat > "$d/src/components/AdvisorOptsHonest.tsx" <<'TSX'
export function H({ provider }) {
  const advisorOpts = provider === 'claude' ? [
    { value: '', label: 'Account default' },
    { value: 'opus', label: 'Opus (stronger judge)' },
  ] : [];
  return null;
}
TSX
    cat > "$d/src/components/RenderLocalTabsHonest.tsx" <<'TSX'
export function R() {
  const tabs = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];
  return tabs.map((t) => t.id);
}
TSX
    cat > "$d/src/components/DefaultProvidersHonest.tsx" <<'TSX'
const DEFAULT_PROVIDERS = [
  { id: 'claude', name: 'Claude', secretKey: 'ANTHROPIC_API_KEY', model: 'claude-opus-4-7', fallbackOrder: 1, enabled: true },
];

export function S() {
  const [providers, setProviders] = useState(DEFAULT_PROVIDERS);
  return providers;
}
TSX
    cat > "$d/src/components/ModuleTablesHonest.tsx" <<'TSX'
const DEFAULT_PERMISSIONS = [
  { id: 'project.create', label: 'Create Projects', description: 'Create new projects' },
  { id: 'project.edit', label: 'Edit Projects', description: 'Modify project files and settings' },
];

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', to: '/' },
      { label: 'Templates', to: '/templates' },
    ],
  },
];

const GALLERY = [
  {
    title: 'SaaS Dashboard',
    description: 'Admin dashboard with user analytics, charts, and real-time data visualization.',
    techStack: ['React', 'Tailwind', 'Chart.js'],
    buildTime: '~25 min',
    gradient: 'from-[#553DE9] to-[#7B6BEF]',
    prompt: 'Build a SaaS admin dashboard',
  },
];

export function M() {
  return DEFAULT_PERMISSIONS.length + COLUMNS.length + GALLERY.length;
}
TSX
    cat > "$d/src/components/TimerHonest.tsx" <<'TSX'
export function TM() {
  setTimeout(() => {
    const x = [{ id: 'a1', action: 'Deployed', user: 'Admin', timestamp: 'now' }];
    void x;
  }, 0);
  return null;
}
TSX
    # BACKLOG 125 B-8 (S-32): Array.from({length:N}, generator) fabrication.
    # Positive: a generator callback inventing static string fields per row
    # (no sample/mock/demo/fake/placeholder name, not in a catch, no `[`
    # anywhere so the setter-span and Array.of()/Array.from()-literal-arg arms
    # cannot claim it -- only the new arm can).
    cat > "$d/src/components/ArrayFromGenFabricated.tsx" <<'TSX'
export function AG() {
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: i, action: 'Deployed', user: 'Admin' }));
  return rows.length;
}
TSX
    # Negative look-alikes: bare index, derived-only fields (id only), a real
    # iterable source with a static tag (not a {length} generator, so out of
    # this arm's narrow scope), and a {length} generator reading real data by
    # index (no static string field, only a passthrough value).
    cat > "$d/src/components/ArrayFromGenHonest.tsx" <<'TSX'
export function AH({ items, data }) {
  const ids = Array.from({ length: 3 }, (_, i) => i);
  const idOnly = Array.from({ length: 3 }, (_, i) => ({ id: i }));
  const tagged = Array.from(items, (x) => ({ id: x.id, kind: 'row' }));
  const fromData = Array.from({ length: data.length }, (_, i) => ({ id: i, value: data[i] }));
  return ids.length + idOnly.length + tagged.length + fromData.length;
}
TSX
    rc=0; out="$(python3 "$MOAT_TMP/sample-panels.py" "$d/src" "$d/dash/components" 2>&1)" || rc=$?
    [ "$rc" = 1 ] || { echo "rules 6-9 scan exited $rc, want 1: $(tr '\n' ' ' <<<"$out" | head -c 200)"; return 1; }
    while IFS='|' read -r f want; do
        grep -q "^FINDING [a-z/]*$f $want" <<<"$out" \
            || { echo "missed $f $want: $(grep "^FINDING.*${f%%:*}" <<<"$out" | tr '\n' ' ' | head -c 200)"; return 1; }
    done <<'EOF'
TeamsVerbatim.tsx:13|'sample' binds sample/mock/demo/fake/placeholder literal data
TeamsVerbatim.tsx:13|literal sample rows assigned in a catch block
TeamsVerbatim.tsx:35|literal sample rows passed to setActivities()
RbacVerbatim.tsx:9|literal sample rows passed to setAuditEntries()
TemplateStats.tsx:1|invented stats lookup table
TemplateStats.tsx:23|Math.random() feeds a rendered metric
TemplateStats.tsx:24|invented stats: constant metric fallback
ZeroFmt.tsx:2|unmeasured value rendered as zero
ZeroFmt.tsx:3|unmeasured value rendered as zero
ZeroFmt.tsx:4|unmeasured value rendered as zero
ZeroFmt.tsx:5|unmeasured value rendered as zero
Named.tsx:2|'sample' binds
Named.tsx:3|'mockRows' binds
Named.tsx:4|'_demoData' binds
Named.tsx:5|'PLACEHOLDER_USERS' binds
Named.tsx:6|'fakeStats' binds
loki-audit-fallback.js:6|literal sample rows assigned in a catch block
TernaryFallback.tsx:3|literal sample rows in a ternary branch
loki-cost-waterfall-or.js:3|literal sample rows used as a ||/?? fallback
ArrayOfFallback.tsx:2|literal sample rows via Array.of()
TernaryQBranch.tsx:2|literal sample rows in a ternary branch
DeclFlowsToState.tsx:2|literal sample rows in a ternary branch
DeclGenericUseState.tsx:2|literal sample rows assigned to items
ThisArrOnly.js:3|literal sample rows assigned to this._phases
SetterSpanOnly.tsx:2|literal sample rows in the setActivities() argument list
ArrayFromOnly.js:3|literal sample rows via Array.from()
DeclPlainSetter.tsx:2|literal sample rows assigned to rows
ThisFlowOnly.js:3|literal sample rows assigned to rows
DeclLazyUseState.tsx:2|literal sample rows assigned to items
ReassignFallback.tsx:3|literal sample rows reassigned to rows
EOF
    # Exact per-file counts: no extra finding anywhere, none on a look-alike.
    for want in TeamsVerbatim.tsx:3 RbacVerbatim.tsx:1 TemplateStats.tsx:3 ZeroFmt.tsx:4 Named.tsx:5 \
        loki-audit-fallback.js:1 HonestRows.tsx:0 P.tsx:0 \
        TernaryFallback.tsx:1 loki-cost-waterfall-or.js:1 ArrayOfFallback.tsx:1 \
        TernaryQBranch.tsx:1 DeclFlowsToState.tsx:1 DeclGenericUseState.tsx:1 \
        ThisArrOnly.js:1 SetterSpanOnly.tsx:1 ArrayFromOnly.js:1 DeclPlainSetter.tsx:1 \
        ThisFlowOnly.js:1 DeclLazyUseState.tsx:1 \
        ReassignFallback.tsx:1 ReassignHonest.tsx:0 \
        AdvisorOptsHonest.tsx:0 RenderLocalTabsHonest.tsx:0 DefaultProvidersHonest.tsx:0 \
        ModuleTablesHonest.tsx:0 TimerHonest.tsx:0; do
        f="${want%%:*}"
        got="$(grep -c "^FINDING [a-z/]*$f:" <<<"$out")"
        [ "$got" = "${want##*:}" ] \
            || { echo "$f has $got finding(s), want ${want##*:}: $(grep "^FINDING.*$f:" <<<"$out" | tr '\n' ' ' | head -c 200)"; return 1; }
    done
    # BACKLOG 125 B-8 (S-32) own check, kept separate from the shared loops
    # above to stay additive against S-29/S-30/S-31 editing this same
    # function concurrently.
    grep -q "^FINDING [a-z/]*ArrayFromGenFabricated.tsx:2 fabricated static fields via Array.from() generator callback" <<<"$out" \
        || { echo "missed ArrayFromGenFabricated.tsx:2 fabricated static fields via Array.from() generator callback: $(grep '^FINDING.*ArrayFromGenFabricated' <<<"$out" | tr '\n' ' ' | head -c 200)"; return 1; }
    for want in ArrayFromGenFabricated.tsx:1 ArrayFromGenHonest.tsx:0; do
        f="${want%%:*}"
        got="$(grep -c "^FINDING [a-z/]*$f:" <<<"$out")"
        [ "$got" = "${want##*:}" ] \
            || { echo "$f has $got finding(s), want ${want##*:}: $(grep "^FINDING.*$f:" <<<"$out" | tr '\n' ' ' | head -c 200)"; return 1; }
    done
    return 0
}

case_sample_panels() {
    command -v python3 >/dev/null 2>&1 || { echo "FAIL|prerequisite missing: python3"; return 0; }
    local ctl="$MOAT_TMP/sample-ctl" rc out why
    # Positive control: a page reaching a sample-fallback panel and a random
    # metric must both be flagged; confetti randomness must not be.
    mkdir -p "$ctl/src/pages" "$ctl/src/components" "$ctl/fixed/src/pages" "$ctl/fixed/src/components" "$ctl/dash/components"
    printf '%s\n' 'export function P() { return <div><Panel /><Stats /><Clean /><Gauge /><Plain /><Forms /><Honest /></div>; }' > "$ctl/src/pages/P.tsx"
    printf '%s\n' 'export function Panel({ data }) { const d = data || generateSampleData(); return <b>{d}</b>; }' > "$ctl/src/components/Panel.tsx"
    printf '%s\n' 'export function Stats() { const s = { uses: Math.floor(Math.random() * 10) }; return <i>{s.uses}</i>; }' > "$ctl/src/components/Stats.tsx"
    printf '%s\n' 'export function Clean() { const left = Math.random() * 100; return <i style={{ left }} />; }' > "$ctl/src/components/Clean.tsx"
    # Rule 4: a literal and a literal ternary, each on its own line so each is
    # flagged individually; a measured prop and layout numbers must not be.
    printf '%s\n' 'export function Gauge({ n }) { return <div>' '<Ring gatePassRate={0.8} size={28} />' \
        '<Ring testCoverage={n > 2 ? 60 : 20} /></div>; }' > "$ctl/src/components/Gauge.tsx"
    printf '%s\n' 'export function Plain({ rate }) { return <Ring gatePassRate={rate} size={28} thickness={4} />; }' > "$ctl/src/components/Plain.tsx"
    printf '%s\n' 'export function P() { return <div><Panel data={x} /><Gauge g={g} /></div>; }' > "$ctl/fixed/src/pages/P.tsx"
    printf '%s\n' 'export function Panel({ data }) { return <b>{data ?? null}</b>; }' > "$ctl/fixed/src/components/Panel.tsx"
    printf '%s\n' 'export function Gauge({ g }) { return g == null ? null : <Ring gatePassRate={g} size={28} />; }' > "$ctl/fixed/src/components/Gauge.tsx"
    # Rule 5: every unconditional form on its own line (lines 2-7), each
    # flagged individually; flags, hooks, Mockup names, id generators and
    # strings in Honest.tsx never are.
    printf '%s\n' 'export function Forms() {' \
        '  const [cards] = useState(generateOverviewCards);' \
        '  const [rows] = useState<Record<string, Row>>(() => generateRows(5));' \
        '  const [users] = useState(SAMPLE_USERS);' \
        '  try { phases = load(); } catch { phases = this._getDemoData(); }' \
        '  const t = demoTotals;' \
        '  return <T rows={mockRows} />; }' > "$ctl/src/components/Forms.tsx"
    # `sample` here is a parameter (a measured sample), never a literal: a
    # binding NAMED sample that holds literal data is rule 7's positive below.
    printf '%s\n' 'export function Honest() {' \
        '  const on = isDemoMode(); const [n] = useState(0); const m = InputMockup();' \
        "  const id = generateId(); const pick = (sample) => { const s = sample; return s; }; const k = 'mock_integrity';" \
        '  const [x] = useState(() => load()); const y = this._showMockBanner;' \
        '  return <T rows={rows} />; }' > "$ctl/src/components/Honest.tsx"
    rc=0; out="$(python3 "$MOAT_TMP/sample-panels.py" "$ctl/src" 2>&1)" || rc=$?
    if [ "$rc" != 1 ] || ! grep -q 'components/Panel.tsx:1 sample-data fallback' <<<"$out" \
        || ! grep -q 'components/Stats.tsx:1 Math.random' <<<"$out" || grep -q '^FINDING.*Clean.tsx' <<<"$out" \
        || ! grep -q 'components/Gauge.tsx:2 hardcoded number' <<<"$out" \
        || ! grep -q 'components/Gauge.tsx:3 hardcoded number' <<<"$out" || grep -q '^FINDING.*Plain.tsx' <<<"$out" \
        || grep -q '^FINDING.*Honest.tsx' <<<"$out"; then
        echo "FAIL|positive control failed (rc=$rc): $(grep -v '^REACH ' <<<"$out" | tr '\n' ' ' | head -c 200)"; return 0
    fi
    for n in 2 3 4 5 6 7; do
        grep -q "components/Forms.tsx:$n demo/sample data assigned" <<<"$out" \
            || { echo "FAIL|positive control: rule 5 missed Forms.tsx line $n: $(sed -n "${n}p" "$ctl/src/components/Forms.tsx")"; return 0; }
    done
    why="$(sample_rules_6_9_control "$ctl/r69")" || { echo "FAIL|positive control: $why"; return 0; }
    rc=0; out="$(python3 "$MOAT_TMP/sample-panels.py" "$ctl/fixed/src" 2>&1)" || rc=$?
    [ "$rc" = 0 ] || { echo "FAIL|control: a panel without a sample fallback was flagged: $(grep -v '^REACH ' <<<"$out" | tr '\n' ' ' | head -c 200)"; return 0; }
    # The cost waterfall's old failure path, verbatim: on a failed read it drew
    # a hardcoded $0.85/$3.20 breakdown as if it were this run. A shipped web
    # component carrying it must be flagged at the assignment (line 10).
    cat > "$ctl/dash/components/loki-cost-waterfall.js" <<'JS'
export class LokiCostWaterfall extends LokiElement {
  async _loadData() {
    const api = this._api;
    try {
      const data = await api._get('/api/v2/cost/breakdown');
      this._phases = data.phases || [];
    } catch {
      if (api !== this._api) return;
      if (this._phases.length === 0) {
        this._phases = this._getDemoData();
        this._budget = 10.00;
        this._totalCost = this._phases.reduce((sum, p) => sum + p.cost_usd, 0);
      }
    }
    this.render();
  }

  _getDemoData() {
    return [
      { phase: 'planning',  cost_usd: 0.85, tokens: 12400 },
      { phase: 'building',  cost_usd: 3.20, tokens: 68500 },
    ];
  }
}
JS
    rc=0; out="$(python3 "$MOAT_TMP/sample-panels.py" "$ctl/fixed/src" "$ctl/dash/components" 2>&1)" || rc=$?
    { [ "$rc" = 1 ] && grep -q '^FINDING dash/components/loki-cost-waterfall.js:10 demo/sample data assigned' <<<"$out" \
        && [ "$(grep -c '^FINDING' <<<"$out")" = 1 ]; } \
        || { echo "FAIL|positive control: the old waterfall catch-block demo fallback was not flagged exactly once (rc=$rc): $(grep '^FINDING' <<<"$out" | tr '\n' ' ' | head -c 200)"; return 0; }

    rc=0
    # The shell of the shipped dashboard (its inline script lives in
    # build-standalone.js) and the standalone cost/proofs/trust pages ship too.
    python3 "$MOAT_TMP/sample-panels.py" "$REPO_ROOT/web-app/src" \
        "$REPO_ROOT/dashboard-ui/components" "$REPO_ROOT/dashboard-ui/core" \
        "$REPO_ROOT/dashboard-ui/scripts/build-standalone.js" "$REPO_ROOT/dashboard/static" > "$MOAT_TMP/sample.txt" 2>&1 || rc=$?
    grep -v '^REACH ' "$MOAT_TMP/sample.txt" | sed 's/^/  /' >&2
    # The workspace is where rule 4's defect lived; a scan that never reached it
    # would pass without looking.
    if [ "$rc" -le 1 ] && ! grep -q '^REACH .*components/ProjectWorkspace.tsx$' "$MOAT_TMP/sample.txt"; then
        echo "FAIL|ProjectWorkspace.tsx is not in the reachable set; the scan would miss the workspace panels"; return 0
    fi
    case "$rc" in
        0) echo "PASS|$(grep '^SCANNED' "$MOAT_TMP/sample.txt")" ;;
        1) echo "FAIL|$(grep -c '^FINDING' "$MOAT_TMP/sample.txt") sample-data finding(s): $(grep '^FINDING' "$MOAT_TMP/sample.txt" | head -4 | sed 's/^FINDING //; s/ reachable via.*//' | tr '\n' ';')" ;;
        *) echo "FAIL|scanner refused (rc=$rc): $(tr '\n' ' ' < "$MOAT_TMP/sample.txt" | head -c 200)" ;;
    esac
}

# ---------------------------------------------------------------------------
# P7.unmeasured-cost-never-zero
# ---------------------------------------------------------------------------
# Flags, on comment-stripped lines:
#   A. a cost-named value defaulted to zero: `cost || 0`, `status?.cost ?? 0`,
#      `(run.cost_usd ?? 0).toFixed(2)` (identifier contains cost|usd|spend).
#      Uniform on purpose: a chart scale or accumulator that defaults a missing
#      cost to 0 is the same latent lie, and `?? null` plus a filter fixes it.
#   B. a "$0.00" literal returned from a null/undefined/NaN/falsy guard or as a
#      ternary else branch. `if (amount === 0) return '$0.00'` is a MEASURED
#      zero and is correct, so an exact-zero guard is not flagged.
# ponytail: line-level scan; a guard split across two lines is not seen.
# Upgrade to the TS AST if a multi-line fallback is ever found by review.
cat > "$MOAT_TMP/cost-zero.py" <<'PY'
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import moatlib
A = re.compile(r'[\w.?\]\[]*(?:cost|usd|spend)\w*\s*\)?\s*(?:\|\||\?\?)\s*0(?![\w.])', re.I)
ZLIT = re.compile(r'''['"`]\$0\.00['"`]''')
GUARD = re.compile(r'''==\s*null|===\s*null|==\s*undefined|===\s*undefined|isNaN|!\s*[\w(]|:\s*['"`]\$0\.00''')
hits, nfiles = [], 0
for root in sys.argv[1:]:
    for f in moatlib.walk(root, ('.js', '.mjs', '.ts', '.tsx', '.html')):
        # Built output is never evidence about source: skip the bundle and assets.
        if f.endswith(os.sep + 'static' + os.sep + 'index.html') or (os.sep + 'static' + os.sep + 'assets' + os.sep) in f:
            continue
        nfiles += 1
        s = moatlib.strip_comments(moatlib.read(f), html=f.endswith('.html'))
        for i, line in enumerate(s.split('\n'), 1):
            if A.search(line) or (ZLIT.search(line) and GUARD.search(line)):
                hits.append(f'{f}:{i}: {line.strip()[:110]}')
print(f'SCANNED {nfiles}')
for h in hits:
    print('HIT ' + h)
sys.exit(1 if hits else 0)
PY

# SERVER LEG. A client can only say "not recorded" if the server sends null: a
# budget reader that re-derives 0 from nothing makes every honest formatter
# above print "$0.00 of $10.00 used, 0.0%". One scenario per process (no module
# state carries over), LOKI_DIR resolved by the app's own resolver, a budget cap
# of $10, one efficiency record, per-run proofs, and a fleet registry of its own
# under the scenario directory (never the operator's ~/.loki):
#   unmeasured     no token or cost field    -> every budget field and the
#                                               by_phase/by_model token counts
#                                               null, status never
#                                               ok/warn/exceeded; two
#                                               proofs with usd null -> project
#                                               total null; fleet run cost and
#                                               fleet total null
#   measured       tokens + cost_usd 2.5     -> every field a positive number;
#                                               proof 2.5 -> total 2.5; fleet 2.5
#   measured-zero  tokens + cost_usd 0.0     -> spent/percent read 0, not null;
#                                               proof 0.0 -> total 0; fleet 0
#   mixed          as measured, plus a null  -> project total 2.5 marked
#                  proof and an unmeasured      partial; fleet runs 2.5 and
#                  second fleet project         null, fleet total 2.5 partial
# measured, measured-zero and mixed are the controls: a fix that nulls every
# zero, or that drops the measured runs from a mixed total, is as wrong.
# mixed also carries a second iteration that recorded nothing, so the current
# run total, the budget spend and /api/budget must each say partial there and
# nowhere else, and that iteration's tokens and model must read null.
# The same app is asked for four non-cost readings that used to be seeded as
# 0 / 0.0% / eight "pending" gate rows: /api/context, /api/memory/economics,
# /api/learning/metrics avgConfidence and /api/council/gate gates. They are
# null (or []) in every scenario except measured, which writes real readings
# and must read them back.
cat > "$MOAT_TMP/budget-null.py" <<'PY'
import json, numbers, os, sys
repo, loki, scenario = sys.argv[1:4]
sys.path.insert(0, repo)
os.environ.pop('LOKI_BUDGET_LIMIT', None)
os.environ['LOKI_DIR'] = loki
# mixed reads as measured for every budget field; only its totals differ.
kind = {'mixed': 'measured'}.get(scenario, scenario)
extra = {
    'unmeasured': {},
    'measured': {'input_tokens': 1000, 'output_tokens': 500, 'cost_usd': 2.5},
    'measured-zero': {'input_tokens': 9412, 'output_tokens': 11008, 'cost_usd': 0.0},
}[kind]
def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as fh:
        json.dump(obj, fh)
rec = dict({'iteration': 1, 'model': 'sonnet', 'phase': 'build'}, **extra)
write(os.path.join(loki, 'metrics', 'efficiency', 'iteration-1.json'), rec)
write(os.path.join(loki, 'metrics', 'budget.json'), {'limit': 10})
if scenario == 'mixed':
    # A second iteration that recorded nothing (no tokens, cost or model): the
    # run's total and the budget spend become lower bounds.
    write(os.path.join(loki, 'metrics', 'efficiency', 'iteration-2.json'), {'iteration': 2, 'phase': 'build'})
if scenario == 'measured':
    # Readings for the non-cost unknowns, so their null assertions below have a
    # control that reads real numbers back through the same endpoints.
    write(os.path.join(loki, 'context', 'tracking.json'), {
        'session_id': 's1', 'updated_at': '2026-09-01T00:00:00Z',
        'current': {'input_tokens': 1000, 'output_tokens': 500, 'cache_read_tokens': 0,
                    'cache_creation_tokens': 0, 'total_tokens': 1500, 'context_window_pct': 42.5,
                    'estimated_cost_usd': 0.12},
        'compactions': [], 'per_iteration': [],
        'totals': {'total_input': 1000, 'total_output': 500, 'total_cost_usd': 0.12,
                   'compaction_count': 0, 'iterations_tracked': 1}})
    write(os.path.join(loki, 'memory', 'token_economics.json'), {
        'session_id': 's1', 'metrics': {'discovery_tokens': 1200, 'read_tokens': 800,
                                        'cache_hits': 7, 'cache_misses': 3}, 'savings_percent': 62.5})
    write(os.path.join(loki, 'learning', 'signals', 's1.json'), {'id': 's1', 'type': 'success', 'confidence': 0.8})
    write(os.path.join(loki, 'council', 'gate-block.json'),
          {'blocked': False, 'gates': [{'name': 'Test Suite', 'status': 'pass'}]})
# (proof run costs, want project_total_usd, want partial, fleet: want per-run
# costs sorted with None first, want fleet total, want fleet partial)
NULL = {'usd': None, 'available': False}
PLAN = {
    'unmeasured': ([NULL, NULL], None, False, [None], None, False),
    'measured': ([{'usd': 2.5, 'available': True}], 2.5, False, [2.5], 2.5, False),
    'measured-zero': ([{'usd': 0.0, 'available': True}], 0.0, False, [0.0], 0.0, False),
    'mixed': ([NULL, {'usd': 2.5, 'available': True}], 2.5, True, [None, 2.5], 2.5, True),
}[scenario]
for i, cost in enumerate(PLAN[0], 1):
    write(os.path.join(loki, 'proofs', f'run-{i}', 'proof.json'),
          {'run_id': f'run-{i}', 'generated_at': f'2026-09-0{i}T00:00:00Z', 'cost': cost})
from fastapi.testclient import TestClient
from dashboard import server, registry
home = os.path.dirname(loki)
registry.REGISTRY_DIR = type(registry.REGISTRY_DIR)(os.path.join(home, 'registry'))
registry.REGISTRY_FILE = registry.REGISTRY_DIR / 'projects.json'
registry.register_project(home, name='moat-p7')
if scenario == 'mixed':
    other = os.path.join(home, 'other')
    write(os.path.join(other, '.loki', 'metrics', 'efficiency', 'iteration-1.json'),
          {'iteration': 1, 'model': 'sonnet', 'phase': 'build'})
    registry.register_project(other, name='moat-p7-unmeasured')
client = TestClient(server.app, raise_server_exceptions=False)
got = {}
for path in ('/api/cost', '/api/budget', '/api/cost/timeline', '/api/fleet/runs', '/api/fleet/summary',
             '/api/context', '/api/memory/economics', '/api/learning/metrics', '/api/council/gate'):
    r = client.get(path)
    if r.status_code != 200:
        print(f'FATAL GET {path} -> HTTP {r.status_code}')
        sys.exit(2)
    got[path] = r.json()
# (label, endpoint, key path, reads 0 on a measured zero)
FIELDS = [
    ('/api/cost budget_used', '/api/cost', ['budget_used'], True),
    ('/api/cost budget_remaining', '/api/cost', ['budget_remaining'], False),
    ('/api/cost by_phase.build.input_tokens', '/api/cost', ['by_phase', 'build', 'input_tokens'], False),
    ('/api/cost by_model.sonnet.output_tokens', '/api/cost', ['by_model', 'sonnet', 'output_tokens'], False),
    ('/api/budget current_cost', '/api/budget', ['current_cost'], True),
    ('/api/budget remaining', '/api/budget', ['remaining'], False),
    ('/api/cost/timeline budget.used', '/api/cost/timeline', ['budget', 'used'], True),
    ('/api/cost/timeline budget.remaining', '/api/cost/timeline', ['budget', 'remaining'], False),
    ('/api/cost/timeline budget.percent_used', '/api/cost/timeline', ['budget', 'percent_used'], True),
    ('/api/cost/timeline iterations[0].cost_usd', '/api/cost/timeline', ['current_run', 'iterations', 0, 'cost_usd'], True),
]
MISSING = object()
def dig(d, keys):
    for k in keys:
        try:
            d = d[k]
        except (KeyError, IndexError, TypeError):
            return MISSING
    return d
def isnum(v):
    return isinstance(v, numbers.Real) and not isinstance(v, bool)
bad = []
for label, path, keys, zero in FIELDS:
    v = dig(got[path], keys)
    if v is MISSING:
        bad.append(f'{label} missing')
    elif kind == 'unmeasured' and v is not None:
        bad.append(f'{label} = {v!r}, want null')
    elif kind == 'measured' and not (isnum(v) and v > 0):
        bad.append(f'{label} = {v!r}, want a positive number')
    elif kind == 'measured-zero' and not (isnum(v) and (v == 0) == zero):
        bad.append(f'{label} = {v!r}, want {"0" if zero else "a positive number"}')
    elif kind not in ('unmeasured', 'measured', 'measured-zero'):
        bad.append(f'{label}: scenario {scenario!r} has no expectation')
status = dig(got['/api/cost/timeline'], ['budget', 'status'])
if kind == 'unmeasured' and status in ('ok', 'warn', 'exceeded', MISSING):
    bad.append(f'/api/cost/timeline budget.status = {status!r} claims a reading')
if kind != 'unmeasured' and status != 'ok':
    bad.append(f'/api/cost/timeline budget.status = {status!r}, want ok')
# Totals: exact value (null, 0 or a number) and an exact partial flag, which
# must be present: a mixed total that does not say "partial" reads as complete.
def same(v, want):
    if want is None:
        return v is None
    return isnum(v) and abs(v - want) < 1e-9
_, want_total, want_partial, want_runs, want_fleet, want_fleet_partial = PLAN
TOTALS = [
    ('/api/cost/timeline project_total_usd', dig(got['/api/cost/timeline'], ['project_total_usd']), want_total),
    ('/api/cost/timeline project_total_partial', dig(got['/api/cost/timeline'], ['project_total_partial']), want_partial),
    ('/api/fleet/summary total_cost_usd', dig(got['/api/fleet/summary'], ['total_cost_usd']), want_fleet),
    ('/api/fleet/summary total_cost_partial', dig(got['/api/fleet/summary'], ['total_cost_partial']), want_fleet_partial),
]
for label, v, want in TOTALS:
    if v is MISSING:
        bad.append(f'{label} missing')
    elif isinstance(want, bool):
        if v is not want:
            bad.append(f'{label} = {v!r}, want {want!r}')
    elif not same(v, want):
        bad.append(f'{label} = {v!r}, want {"null" if want is None else repr(want)}')
runs = got['/api/fleet/runs']
fleet = sorted((r.get('cost_usd', MISSING) for r in runs if isinstance(r, dict)),
               key=lambda v: (v is not None, v if isnum(v) else 0))
if len(fleet) != len(want_runs) or not all(same(v, w) for v, w in zip(fleet, want_runs)):
    bad.append(f'/api/fleet/runs cost_usd = {fleet!r}, want {want_runs!r}')
# Partial flags: some iterations recorded a cost and some did not (mixed only).
# A sum over them is a lower bound and must say so; a fully measured, a
# measured-zero and an unmeasured run are never partial.
want_part = scenario == 'mixed'
PARTS = [
    ('/api/cost/timeline current_run.partial', dig(got['/api/cost/timeline'], ['current_run', 'partial'])),
    ('/api/cost/timeline budget.partial', dig(got['/api/cost/timeline'], ['budget', 'partial'])),
    ('/api/budget partial', dig(got['/api/budget'], ['partial'])),
]
for label, v in PARTS:
    if v is MISSING:
        bad.append(f'{label} missing')
    elif v is not want_part:
        bad.append(f'{label} = {v!r}, want {want_part!r}')
# An iteration that recorded nothing has null tokens and no model, not 0 and
# not the pricing default "sonnet"; a measured iteration keeps its numbers.
its = dig(got['/api/cost/timeline'], ['current_run', 'iterations'])
its = its if isinstance(its, list) else []
blank = [it for it in its if isinstance(it, dict) and it.get('cost_usd') is None]
read = [it for it in its if isinstance(it, dict) and it.get('cost_usd') is not None]
for it in blank:
    for k in ('input_tokens', 'output_tokens'):
        if it.get(k) is not None:
            bad.append(f"/api/cost/timeline unmeasured iteration {it.get('iteration')} {k} = {it.get(k)!r}, want null")
    if it.get('iteration') == 2 and it.get('model') is not None:
        bad.append(f"/api/cost/timeline iteration 2 model = {it.get('model')!r}, want null (none recorded)")
if kind == 'measured' and not all(isnum(it.get('input_tokens')) and it['input_tokens'] > 0 for it in read):
    bad.append(f'/api/cost/timeline measured iteration tokens = {[it.get("input_tokens") for it in read]!r}, want positive')
if (scenario == 'mixed') != bool(blank) and kind != 'unmeasured':
    bad.append(f'/api/cost/timeline has {len(blank)} unmeasured iteration(s) in {scenario}')
# Non-cost unknowns on the same app: the context tracker, token economics,
# learning confidence and per-gate results. Only 'measured' wrote readings.
real = scenario == 'measured'
UNKNOWNS = [
    ('/api/context current.context_window_pct', ['current', 'context_window_pct'], 42.5),
    ('/api/context current.total_tokens', ['current', 'total_tokens'], 1500),
    ('/api/context current.estimated_cost_usd', ['current', 'estimated_cost_usd'], 0.12),
    ('/api/context totals.iterations_tracked', ['totals', 'iterations_tracked'], 1),
    ('/api/memory/economics total_tokens', ['total_tokens'], 2000),
    ('/api/memory/economics hit_rate', ['hit_rate'], 0.7),
    ('/api/memory/economics savings_percent', ['savings_percent'], 62.5),
    ('/api/learning/metrics avgConfidence', ['avgConfidence'], 0.8),
]
for label, keys, want in UNKNOWNS:
    v = dig(got[label.split(' ')[0]], keys)
    if v is MISSING:
        bad.append(f'{label} missing')
    elif not same(v, want if real else None):
        bad.append(f'{label} = {v!r}, want {want if real else "null"}')
gates = dig(got['/api/council/gate'], ['gates'])
if not isinstance(gates, list) or len(gates) != (1 if real else 0):
    bad.append(f'/api/council/gate gates = {gates!r}, want {"the one recorded gate" if real else "[] (no constant pending rows)"}')
print(f'CHECKED {len(FIELDS) + len(TOTALS) + len(PARTS) + len(UNKNOWNS) + 4} fields ({scenario})')
for b in bad:
    print('BAD ' + b)
sys.exit(1 if bad else 0)
PY

# WEB-APP LEG. The web-app's own status readers (GET /api/session/status, which
# the workspace and home cost/iteration tiles read, and /api/session/memory)
# seeded cost 0.0, iteration 0, complexity "standard", a 10-iteration cap and
# running_agents 0 before anything was recorded. Separate process: the web-app
# module is also named `server`. measured writes the state files the CLI writes
# and must read them back; unmeasured has none and must read null.
cat > "$MOAT_TMP/webapp-status.py" <<'PY'
import json, os, sys
repo, home, scenario = sys.argv[1:4]
os.environ.pop('LOKI_MAX_ITERATIONS', None)
sys.path.insert(0, os.path.join(repo, 'web-app'))
import server
from fastapi.testclient import TestClient
server.session.project_dir = home
loki = os.path.join(home, '.loki')
os.makedirs(loki, exist_ok=True)
if scenario == 'measured':
    with open(os.path.join(loki, 'dashboard-state.json'), 'w') as fh:
        json.dump({'phase': 'act', 'iteration': 3, 'complexity': 'simple',
                   'tasks': {'pending': 2, 'inProgress': 0},
                   'tokens': {'input': 1000, 'output': 500, 'cost_usd': 2.5}}, fh)
    with open(os.path.join(loki, 'autonomy-state.json'), 'w') as fh:
        json.dump({'maxIterations': 8}, fh)
client = TestClient(server.app, raise_server_exceptions=False)
got = {}
for path in ('/api/session/status', '/api/session/memory'):
    r = client.get(path)
    if r.status_code != 200:
        print(f'FATAL GET {path} -> HTTP {r.status_code}')
        sys.exit(2)
    got[path] = r.json()
st, mem = got['/api/session/status'], got['/api/session/memory']
real = {'iteration': 3, 'complexity': 'simple', 'pending_tasks': 2, 'max_iterations': 8, 'cost': 2.5}
bad = []
for k, want in real.items():
    v = st.get(k, 'MISSING')
    exp = want if scenario == 'measured' else None
    if v != exp or isinstance(v, bool):
        bad.append(f'/api/session/status {k} = {v!r}, want {exp!r}')
# Tracked by nothing in this server: unknown in every scenario.
if st.get('running_agents', 'MISSING') is not None:
    bad.append(f"/api/session/status running_agents = {st.get('running_agents', 'MISSING')!r}, want null")
if mem.get('total_tokens', 'MISSING') is not None:
    bad.append(f"/api/session/memory total_tokens = {mem.get('total_tokens', 'MISSING')!r}, want null")
print(f'CHECKED {len(real) + 2} web-app fields ({scenario})')
for b in bad:
    print('BAD ' + b)
sys.exit(1 if bad else 0)
PY

# Prints nothing and returns 0 on pass; prints the reason and returns 1 on fail.
cost_server_leg() {
    py_server -c 'import fastapi, httpx' >/dev/null 2>&1 \
        || { echo "prerequisite missing: python fastapi + httpx (the server leg drives the real app)"; return 1; }
    local sc d rc out
    # Controls first: a red unmeasured leg means something only once the same
    # probe has read real numbers back.
    for sc in measured measured-zero mixed unmeasured; do
        d="$MOAT_TMP/budget-$sc"
        mkdir -p "$d/.loki"
        rc=0
        out="$(cd "$d" && py_server "$MOAT_TMP/budget-null.py" "$REPO_ROOT" "$d/.loki" "$sc" 2> "$d/err")" || rc=$?
        printf '%s\n' "$out" | sed "s/^/  server[$sc] /" >&2
        grep -q '^CHECKED ' <<<"$out" \
            || { echo "server leg ($sc) did not run (rc=$rc): $(tail -c 200 "$d/err" | tr '\n' ' ') $(tr '\n' ' ' <<<"$out")"; return 1; }
        [ "$rc" = 0 ] \
            || { echo "server leg ($sc): $(grep '^BAD ' <<<"$out" | head -4 | sed 's/^BAD //' | tr '\n' ';')"; return 1; }
    done
    for sc in measured unmeasured; do
        d="$MOAT_TMP/webapp-$sc"
        mkdir -p "$d/proj"
        rc=0
        out="$(cd "$d" && py_server "$MOAT_TMP/webapp-status.py" "$REPO_ROOT" "$d/proj" "$sc" 2> "$d/err")" || rc=$?
        printf '%s\n' "$out" | sed "s/^/  webapp[$sc] /" >&2
        grep -q '^CHECKED ' <<<"$out" \
            || { echo "web-app leg ($sc) did not run (rc=$rc): $(tail -c 200 "$d/err" | tr '\n' ' ') $(tr '\n' ' ' <<<"$out")"; return 1; }
        [ "$rc" = 0 ] \
            || { echo "web-app leg ($sc): $(grep '^BAD ' <<<"$out" | head -4 | sed 's/^BAD //' | tr '\n' ';')"; return 1; }
    done
    return 0
}

case_cost_zero() {
    command -v python3 >/dev/null 2>&1 || { echo "FAIL|prerequisite missing: python3"; return 0; }
    local ctl="$MOAT_TMP/cost-ctl" n rc good f out
    mkdir -p "$ctl"
    # Positive control: every synthetic bad line flagged individually; the
    # measured-zero and not-recorded lines never flagged.
    n=0
    while IFS= read -r snippet; do
        n=$((n + 1))
        printf '%s\n' "$snippet" > "$ctl/bad$n.js"
        rc=0; python3 "$MOAT_TMP/cost-zero.py" "$ctl/bad$n.js" >/dev/null 2>&1 || rc=$?
        [ "$rc" = 1 ] || { echo "FAIL|positive control: synthetic bad line not flagged: $snippet"; return 0; }
    done <<'EOF'
const c = status.cost || 0;
const label = (run.cost_usd ?? 0).toFixed(2);
if (cost == null || isNaN(cost)) return '$0.00';
const s = total > 0 ? '$' + total.toFixed(2) : "$0.00";
if (!spend) return `$0.00`;
EOF
    [ "$n" = 5 ] || { echo "FAIL|positive control read $n of 5 synthetic lines"; return 0; }
    printf '%s\n' "if (amount === 0) return '\$0.00';" "if (v === null || v === undefined) return 'Not recorded';" \
        "// a cost || 0 here would lie" > "$ctl/good.js"
    rc=0; out="$(python3 "$MOAT_TMP/cost-zero.py" "$ctl/good.js" 2>&1)" || rc=$?
    [ "$rc" = 0 ] || { echo "FAIL|positive control: a correct line was flagged: $(grep '^HIT' <<<"$out" | head -1)"; return 0; }

    # Known-correct cost formatters (null -> "not recorded"/"unknown", measured
    # 0 -> "$0.00") must pass. Each is extracted by name so the control is the
    # formatter itself; each must still contain its required marker (a toFixed
    # call, or the null seeding), or the control is vacuous.
    good=0
    while IFS='|' read -r f fn need; do
        [ -f "$REPO_ROOT/$f" ] || { echo "FAIL|known-correct file missing: $f"; return 0; }
        python3 - "$REPO_ROOT/$f" "$fn" > "$ctl/known.js" <<'PY'
import re, sys
lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
start = next((i for i, l in enumerate(lines) if re.search(sys.argv[2], l)), None)
if start is None:
    sys.exit(3)
depth, out = 0, []
for l in lines[start:]:
    out.append(l)
    depth += l.count('{') - l.count('}')
    if depth <= 0 and '{' in ''.join(out):
        break
print('\n'.join(out))
PY
        grep -qE "$need" "$ctl/known.js" \
            || { echo "FAIL|known-correct code $fn not found in $f or lost its marker '$need'; control is vacuous"; return 0; }
        rc=0; out="$(python3 "$MOAT_TMP/cost-zero.py" "$ctl/known.js" 2>&1)" || rc=$?
        [ "$rc" = 0 ] || { echo "FAIL|known-correct formatter $f $fn flagged (probe too broad): $(grep '^HIT' <<<"$out" | head -1)"; return 0; }
        good=$((good + 1))
    done <<'EOF'
dashboard-ui/components/loki-context-tracker.js|_formatUSD\(amount\)|toFixed\(
dashboard-ui/components/loki-cost-dashboard.js|^  constructor\(\)|estimated_cost_usd: null
dashboard/static/cost.html|function fmtUsd\(|toFixed\(
web-app/src/pages/MetricsPage.tsx|function formatUsd\(|toFixed\(
dashboard-ui/core/loki-unified-styles.js|export function formatUSD\(|toFixed\(
EOF
    [ "$good" = 5 ] || { echo "FAIL|only $good of 5 known-correct formatters were checked"; return 0; }

    local srv="" srv_fail=""
    srv="$(cost_server_leg)" || srv_fail="${srv:-server leg failed with no reason}"

    rc=0
    python3 "$MOAT_TMP/cost-zero.py" "$REPO_ROOT/dashboard-ui/components" "$REPO_ROOT/dashboard-ui/core" \
        "$REPO_ROOT/web-app/src" "$REPO_ROOT/dashboard/static" > "$MOAT_TMP/cost.txt" 2>&1 || rc=$?
    sed "s#$REPO_ROOT/##; s/^/  /" "$MOAT_TMP/cost.txt" >&2
    case "$rc" in
        0) if [ -n "$srv_fail" ]; then echo "FAIL|$srv_fail"
           else echo "PASS|$(grep '^SCANNED' "$MOAT_TMP/cost.txt") files, $good known-correct files pass; /api/cost, /api/budget, /api/cost/timeline (budget and project total) and /api/fleet/runs + /api/fleet/summary send null for unmeasured spend, numbers for measured and measured-zero, a partial total and partial current run/budget for mixed; context, token economics, learning confidence, gate rows and web-app session status are null or empty until measured"; fi ;;
        1) echo "FAIL|$(grep -c '^HIT' "$MOAT_TMP/cost.txt") unmeasured-cost-as-zero site(s): $(grep '^HIT' "$MOAT_TMP/cost.txt" | sed "s#^HIT $REPO_ROOT/##; s/: .*//" | tr '\n' ' ')${srv_fail:+; $srv_fail}" ;;
        *) echo "FAIL|scanner refused (rc=$rc)${srv_fail:+; $srv_fail}" ;;
    esac
}

# ---------------------------------------------------------------------------
# Runner: exactly one CASE line per case, even when a case function dies.
# ---------------------------------------------------------------------------
EMITTED=""
run_case() {
    local id="$1" desc="$2" fn="$3" out rc status reason
    rc=0
    out="$("$fn")" || rc=$?
    out="${out##*$'\n'}"
    status="${out%%|*}"
    reason="${out#*|}"
    case "$status" in
        PASS|FAIL) ;;
        *) status=FAIL; reason="case crashed (rc=$rc, last output: ${out:0:120})" ;;
    esac
    # A function that printed PASS and then failed has not passed.
    if [ "$status" = PASS ] && [ "$rc" -ne 0 ]; then status=FAIL; reason="printed PASS but exited $rc: $reason"; fi
    reason="$(printf '%s' "$reason" | tr '\n\r' '  ')"
    if [ "$status" = PASS ]; then
        printf 'CASE %s PASS %s (%s)\n' "$id" "$desc" "$reason"
    else
        printf 'CASE %s FAIL %s: %s\n' "$id" "$desc" "$reason"
    fi
    EMITTED="$EMITTED $id"
}

START_S=$SECONDS
run_case P7.webapp-client-routes-exist "web-app client paths resolve to real web-app/server.py routes" case_webapp_routes
run_case P7.dashboard-client-routes-exist "dashboard-ui /api paths resolve to real dashboard/server.py routes" case_dashboard_routes
run_case P7.no-sample-data-panels "no production page reaches sample, random or hardcoded-metric data panels" case_sample_panels
run_case P7.unmeasured-cost-never-zero "no cost path, client or server, turns unmeasured cost into 0 or \$0.00" case_cost_zero

for id in P7.webapp-client-routes-exist P7.dashboard-client-routes-exist P7.no-sample-data-panels P7.unmeasured-cost-never-zero; do
    case " $EMITTED " in *" $id "*) ;; *) printf 'CASE %s FAIL runner did not emit this case\n' "$id" ;; esac
done
diag "runtime $((SECONDS - START_S))s"
exit 0
