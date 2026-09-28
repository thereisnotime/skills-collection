// S-162 / BACKLOG 114: SecretsPanel and DocsPanel swallowed fetch errors
// (`catch { // ignore }`), so a 500 or network failure rendered "No secrets
// configured yet" / "No documentation generated yet", indistinguishable from
// a genuine empty. /api/secrets and /docs/status both return 200 with an
// empty body for the real empty case (web-app/server.py), so a rejection is
// always a genuine load failure.
//
// ProjectWorkspace.tsx is JSX with browser-only imports and web-app deps are
// not guaranteed to be installed, so this runs under a plain `node --test`:
// the pure panelEmptyText() helper is extracted and executed; the wiring (catch sets the
// failure flag, success clears it, the empty branch reads the helper) is
// checked on the component bodies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./ProjectWorkspace.tsx', import.meta.url), 'utf8');

function slice(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found after ${startMarker}: ${endMarker}`);
  return src.slice(start, end);
}

// The only TypeScript in the helper is its signature; rewrite that one line
// instead of relying on node:module stripTypeScriptTypes (absent on Node 20).
const HELPER_SIG = "function panelEmptyText(kind: 'secrets' | 'docs', loadFailed: boolean): string {";

function loadHelper() {
  const fnSrc = slice(HELPER_SIG, '\n}\n') + '\n}\n';
  const js = fnSrc.replace(HELPER_SIG, 'function panelEmptyText(kind, loadFailed) {');
  return new Function(`${js}; return panelEmptyText;`)();
}

const secretsBody = () => slice('function SecretsPanel()', '\nfunction DocsPanel(');
const docsBody = () => slice('function DocsPanel(', '\n}\n');

test('panelEmptyText: failed secrets load says Could not load secrets', () => {
  const t = loadHelper()('secrets', true);
  assert.match(t, /^Could not load secrets/);
  assert.doesNotMatch(t, /No secrets configured/);
});

test('panelEmptyText: failed docs load says Could not load documentation', () => {
  const t = loadHelper()('docs', true);
  assert.match(t, /^Could not load documentation/);
  assert.doesNotMatch(t, /No documentation generated/);
});

test('panelEmptyText: genuine empties keep their original copy', () => {
  const h = loadHelper();
  assert.equal(h('secrets', false), 'No secrets configured yet. Add your first secret below.');
  assert.equal(
    h('docs', false),
    'No documentation generated yet. Click "Generate Documentation" to create docs for this project.',
  );
});

function assertWiring(body, fetchName, kind) {
  const fetchSrc = body.slice(body.indexOf(`const ${fetchName} = useCallback(`));
  const fetchBlock = fetchSrc.slice(0, fetchSrc.indexOf('}, ['));
  assert.match(fetchBlock, /catch\s*\{[^}]*setLoadFailed\(true\)/, `${fetchName} catch must set loadFailed`);
  assert.doesNotMatch(fetchBlock, /catch\s*\{\s*\/\/[^\n]*\n\s*\}/, `${fetchName} catch must not be comment-only`);
  const trySection = fetchBlock.slice(0, fetchBlock.indexOf('catch'));
  assert.match(trySection, /setLoadFailed\(false\)/, `${fetchName} success must clear loadFailed`);
  assert.match(body, /const \[loadFailed, setLoadFailed\] = useState\(false\)/);
  assert.ok(body.includes(`panelEmptyText('${kind}', loadFailed)`), `${kind} empty branch must render panelEmptyText`);
  assert.ok(!/No (secrets configured|documentation generated) yet/.test(body), `${kind} empty copy must come from the helper only`);
}

test('SecretsPanel: fetch failure is recorded and rendered, not swallowed', () => {
  assertWiring(secretsBody(), 'fetchSecrets', 'secrets');
});

test('DocsPanel: fetch failure is recorded and rendered, not swallowed', () => {
  const body = docsBody();
  assertWiring(body, 'fetchStatus', 'docs');
  // A failure must show even when status is null (has_docs unknown).
  assert.match(body, /loadFailed \|\| !status\?\.has_docs/);
});
