#!/usr/bin/env bash
# Every module under web-app/src must be reachable from the app entry point.
#
# THE DEFECT, measured: pages/ConnectionsPage.tsx rendered a complete
# <DeployConnections/> panel, and App.tsx imported it ZERO times (control:
# MetricsPage, imported once and routed). Navigating to /connections hit the
# SPA catch-all and rendered NotFoundPage, so the deploy-connections surface
# was unreachable by any user while looking fully built in the tree. A sweep
# for the same shape found 38 such modules: 24 components, 6 charts orphaned
# behind a barrel nothing imported, 2 dead barrels, 4 hooks, 1 page, 1 util.
#
# WHY REACHABILITY AND NOT AN INBOUND-IMPORT COUNT. Counting inbound edges
# gets BOTH directions wrong. main.tsx has zero inbound and is the entry, so a
# count reports the entry itself as dead. And charts/BarChart.tsx had one
# inbound edge -- from charts/index.ts, a barrel with zero inbound edges of its
# own -- so a count calls it live while no user can reach it. Only transitive
# reachability from the real entry answers the question the criterion asks:
# "wired to a route or a parent that is itself reachable".
#
# THE RESOLVER MUST SEE LAZY IMPORTS. Every page in this app is loaded with
# React.lazy(() => import('./pages/X')), so a resolver that only understands
# static `import ... from` would report all 15 routed pages as orphans and be
# useless. It also resolves the '@/' alias (tsconfig.json paths), extensionless
# specifiers, and directory index files.
#
# TWO FATAL RULES, each exiting non-zero rather than under-reporting, because
# under-reporting is the only outcome worse than failing -- it looks like
# success:
#   1. a vacuity floor. A resolver pointed at a missing or wrong root walks
#      zero files and reports "0 orphans, clean" forever. An empty result is
#      not evidence; it is an absent measurement.
#   2. an unresolvable relative specifier. A local import that does not resolve
#      means the graph has a hole, and a hole silently understates the orphan
#      set. Refuse to guess.
#
# KNOWN NON-PRODUCT REFERENCE: web-app/tests/fixtures/attachment-harness.html
# imports /src/components/AIChatPanel.tsx by raw path. That harness is
# deliberately NOT an entry point here. AIChatPanel is reachable from main.tsx
# anyway, so this changes nothing today, but admitting test fixtures as entries
# would let a fixture-only component stay "reachable" while no user can open
# it, which is the exact property this guard exists to deny.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO_ROOT/web-app/src"

PASS=0; FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

echo "TEST: web-app has no orphaned modules"

[ -d "$SRC" ] || { echo "  FAIL: $SRC missing"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "  SKIPPED: node not installed (not a pass)"; exit 0; }

# The walk, the resolver and the reachability pass. Emits one "ORPHAN <path>"
# line per unreachable module, plus "WALKED <n>" so the caller can refuse a
# vacuous run, and "UNRESOLVED <file> <spec>" for any hole in the graph.
REPORT="$(node -e '
const fs = require("fs"), path = require("path");
const SRC = process.argv[1];
const EXTS = [".tsx", ".ts", ".jsx", ".js"];

// Ambient type declarations are consumed by tsc via tsconfig.json
// "include": ["src"] and are never imported by anything. They are reachable in
// the only sense that matters and must not be reported.
const KEEP = new Set(["vite-env.d.ts"]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.includes(path.extname(p))) out.push(path.resolve(p));
  }
  return out;
}

// Static import, export-from, bare side-effect import, dynamic/lazy import(),
// and require(). The import() arm is what keeps the 15 lazy-loaded routes from
// reading as orphans.
const SPEC = /(?:\bimport\s+[^"\x27()]*?\bfrom\s*|\bexport\s+[^"\x27()]*?\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["\x27]([^"\x27]+)["\x27]/g;

function resolveSpec(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = path.resolve(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;                       // bare package specifier, not ours
  for (const e of ["", ...EXTS]) {
    const c = base + e;
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.resolve(c);
  }
  for (const e of EXTS) {
    const c = path.join(base, "index" + e);
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.resolve(c);
  }
  return undefined;                       // looked local but did not resolve
}

const all = walk(SRC, []);
console.log("WALKED " + all.length);

// Sole entry: the script tag in web-app/index.html. Reachability from here is
// exactly "wired to a route or a parent that is itself reachable".
const seen = new Set();
const stack = [path.resolve(SRC, "main.tsx")];
while (stack.length) {
  const f = stack.pop();
  if (seen.has(f) || !fs.existsSync(f)) continue;
  seen.add(f);
  for (const m of fs.readFileSync(f, "utf8").matchAll(SPEC)) {
    const t = resolveSpec(m[1], f);
    if (t === undefined) console.log("UNRESOLVED " + path.relative(SRC, f) + " " + m[1]);
    else if (t) stack.push(t);
  }
}

for (const f of all) {
  const rel = path.relative(SRC, f);
  if (!seen.has(f) && !KEEP.has(rel)) console.log("ORPHAN " + rel);
}
' "$SRC" 2>&1)"

if [ $? -ne 0 ] || [ -z "$REPORT" ]; then
    bad "the resolver produced no output -- an absent measurement, not a clean one"
    echo "$REPORT"
    echo "  $PASS passed, $FAIL failed"
    exit 1
fi

# --- 1. Vacuity floor. A resolver aimed at a wrong or empty root walks nothing
# --- and reports zero orphans forever. Assert it actually saw the tree first.
WALKED="$(printf '%s\n' "$REPORT" | awk '/^WALKED /{print $2; exit}')"
if [ -n "$WALKED" ] && [ "$WALKED" -gt 100 ] 2>/dev/null; then
    ok "walked $WALKED modules under web-app/src (not a vacuous run)"
else
    bad "walked '${WALKED:-nothing}' modules -- expected >100; the guard is measuring nothing"
fi

# --- 2. No hole in the graph. An unresolvable local specifier means some edge
# --- was missed, and a missed edge understates the orphan set.
UNRESOLVED="$(printf '%s\n' "$REPORT" | grep '^UNRESOLVED ' || true)"
if [ -z "$UNRESOLVED" ]; then
    ok "every relative import resolved (no hole in the reference graph)"
else
    bad "unresolvable local imports -- the graph is incomplete, refusing to guess:"
    printf '%s\n' "$UNRESOLVED" | sed 's/^/      /'
fi

# --- 3. THE PROPERTY: nothing under src is unreachable from main.tsx.
# --- Each orphan is named individually. A bare count could not say WHICH
# --- module regressed, and this guard exists to point at the file.
ORPHANS="$(printf '%s\n' "$REPORT" | grep '^ORPHAN ' | sed 's/^ORPHAN //' || true)"
if [ -z "$ORPHANS" ]; then
    ok "every module under web-app/src is reachable from main.tsx"
else
    ORPHAN_N="$(printf '%s\n' "$ORPHANS" | wc -l | tr -d ' ')"
    bad "$ORPHAN_N module(s) unreachable from main.tsx -- built, shipped in the tree, and openable by nobody:"
    printf '%s\n' "$ORPHANS" | sed 's/^/      /'
    echo "      Fix by wiring each to a reachable parent or route, or by deleting it."
fi

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
