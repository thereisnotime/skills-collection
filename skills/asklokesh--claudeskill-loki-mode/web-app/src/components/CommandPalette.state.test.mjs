// S-160 / BACKLOG 114: a failed api.searchFiles used to fall into
// `catch { setFileResults([]) }`, so the palette rendered "No results found"
// for a broken search, indistinguishable from a genuinely empty one.
//
// CommandPalette.tsx is JSX and imports browser-only modules, so plain
// `node --test` cannot import it. ponytail: evaluate the pure
// paletteStatusMessage helper by extracting its source (primitive type
// annotations only) and pin the wiring with source checks. A real render
// test needs jsdom, which this one component does not earn.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'CommandPalette.tsx'),
  'utf8',
);

function loadHelper() {
  const m = src.match(/export function paletteStatusMessage\([\s\S]*?\n}\n/);
  assert.ok(m, 'paletteStatusMessage must exist in CommandPalette.tsx');
  const js = m[0]
    .replace(/^export /, '')
    .replace(/:\s*(number|boolean|string \| null)\b(\s*\| null)?/g, '');
  assert.doesNotMatch(js.split('\n')[0], /:/, `unstripped type annotation in signature:\n${js}`);
  return new Function(`${js}\nreturn paletteStatusMessage;`)();
}

test('a failed file search reads as a failure, not as no results', () => {
  const msg = loadHelper();
  assert.equal(msg(0, false, true), 'File search failed');
});

test('a failure still surfaces when commands matched', () => {
  const msg = loadHelper();
  assert.equal(msg(3, false, true), 'File search failed');
});

test('a genuine empty result keeps "No results found"', () => {
  const msg = loadHelper();
  assert.equal(msg(0, false, false), 'No results found');
});

test('results present and no failure shows no status line', () => {
  const msg = loadHelper();
  assert.equal(msg(2, false, false), null);
});

test('while searching, neither message is shown', () => {
  const msg = loadHelper();
  assert.equal(msg(0, true, true), null);
  assert.equal(msg(0, true, false), null);
});

test('the catch path records the failure', () => {
  const m = src.match(/catch\s*\{([^}]*)\}/g) || [];
  const searchCatch = m.find((c) => c.includes('setFileResults'));
  assert.ok(searchCatch, 'file-search catch block not found');
  assert.match(searchCatch, /setFileSearchFailed\(true\)/);
});

test('a successful search clears a previous failure', () => {
  assert.match(src, /setFileResults\(results\.filter[^\n]*\n\s*setFileSearchFailed\(false\)/);
});

test('the render uses the helper, not a bare totalResults === 0 check', () => {
  assert.match(src, /paletteStatusMessage\(totalResults, showFileSearching, fileSearchFailed\)/);
  assert.match(src, /\{statusMessage && \(/);
  assert.doesNotMatch(src, />No results found</);
});
