// S-185 / BACKLOG 114: a failed api.getDeployStatus left every row on its
// {connected:false} default, so each row read "Not connected" under the
// component's own load-error banner.
//
// DeployConnections.tsx is JSX and imports browser-only modules, so plain
// `node --test` cannot import it. ponytail: evaluate the pure connectionLabel
// helper by extracting its source and pin the render wiring with source
// checks, same shape as CommandPalette.state.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'DeployConnections.tsx'),
  'utf8',
);

function loadHelper() {
  const m = src.match(/export function connectionLabel\([\s\S]*?\n}\n/);
  assert.ok(m, 'connectionLabel must exist in DeployConnections.tsx');
  const js = m[0].replace(/^export /, '').replace(/:\s*(boolean|string)\b/g, '');
  assert.doesNotMatch(js.split('\n')[0], /:/, `unstripped type annotation in signature:\n${js}`);
  return new Function(`${js}\nreturn connectionLabel;`)();
}

test('after a failed fetch, a default row does not read Not connected', () => {
  const label = loadHelper();
  assert.notEqual(label(false, true), 'Not connected');
  assert.equal(label(false, true), 'Status unknown');
});

test('a real {connected:false} still reads Not connected', () => {
  const label = loadHelper();
  assert.equal(label(false, false), 'Not connected');
});

test('a connected row reads Connected', () => {
  const label = loadHelper();
  assert.equal(label(true, false), 'Connected');
});

test('Not connected appears only inside the helper, not as a literal in any row', () => {
  const helper = src.match(/export function connectionLabel\([\s\S]*?\n}\n/)[0];
  const rest = src.replace(helper, '').replace(/\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.ok(!/Not connected/.test(rest), 'a row still renders a literal "Not connected"');
});

test('both row status sites pass the load failure to the helper', () => {
  const need = [
    /title=\{connectionLabel\(status\.connected, loadFailed\)\}/,
    /connectionLabel\(false, error !== null\)/,
    /status=\{statuses\[platform\.id\]\}\s*loadFailed=\{error !== null\}/,
  ];
  for (const re of need) assert.ok(re.test(src), `missing wiring: ${re}`);
});
