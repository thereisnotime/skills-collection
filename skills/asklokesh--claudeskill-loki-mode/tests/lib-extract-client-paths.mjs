// Walk client.ts with the TypeScript AST and emit every fetchJSON path.
// A regex over this file produced BOTH a false positive (/sessions "missing"
// while 58 such routes exist) and a false negative (missed the /github/runs
// drift). The AST removes both failure modes.
//
// REPO_ROOT is resolved from this script's own location, never hardcoded to
// the main checkout: run from a worktree, this must read THAT worktree's
// client.ts, not main's.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = (await import(path.join(REPO_ROOT, 'web-app/node_modules/typescript/lib/typescript.js'))).default;

const FILE = path.join(REPO_ROOT, 'web-app/src/api/client.ts');
const src = fs.readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true);
const out = [];
let unresolved = 0;

// A path segment is acceptable ONLY if it is fully literal or exactly a single
// interpolation. Anything else is fatal: truncating a mixed segment SHORTENS
// the path, and a shortened path can coincidentally match a real route, which
// is exactly the false-negative class that discredited the regex.
function pathFromTemplate(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let p = node.head.text;
  for (const span of node.templateSpans) p += '{p}' + span.literal.text;
  return p;
}

function methodOf(callNode) {
  const opts = callNode.arguments[1];
  if (!opts) return 'GET';
  if (!ts.isObjectLiteralExpression(opts)) return null;   // non-literal -> fatal
  for (const pr of opts.properties) {
    if (!ts.isPropertyAssignment(pr)) continue;
    if (pr.name.getText(sf) !== 'method') continue;
    const v = pr.initializer;
    if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) return v.text;
    return null;                                           // { method: someVar } -> fatal
  }
  return 'GET';
}

function visit(node) {
  if (ts.isCallExpression(node)) {
    const fn = node.expression;
    const name = ts.isIdentifier(fn) ? fn.text
               : (ts.isPropertyAccessExpression(fn) ? fn.name.text : '');
    if (name === 'fetchJSON' && node.arguments.length) {
      const raw = pathFromTemplate(node.arguments[0]);
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      if (raw === null) { unresolved++; out.push({line, path: null, method: null, raw: node.arguments[0].getText(sf).slice(0,80)}); }
      else out.push({line, path: raw, method: methodOf(node)});
    }
  }
  ts.forEachChild(node, visit);
}
visit(sf);
// repoRoot is echoed so a caller (or the shell test) can assert this ran
// against the tree it meant to check, never a copy's own directory or a
// hardcoded main checkout.
console.log(JSON.stringify({captured: out.length, unresolved, calls: out, repoRoot: REPO_ROOT}, null, 1));
