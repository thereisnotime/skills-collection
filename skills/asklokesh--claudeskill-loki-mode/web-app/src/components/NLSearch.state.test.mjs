// S-159 / BACKLOG 114: a failed search request used to render
// "No results found. Try a different query." because the catch did
// setResults([]). The failure must be kept and shown as "Search failed".
//
// NLSearch.tsx is JSX and imports the browser-only api client, so it cannot
// be imported under plain `node --test`. ponytail: extract the one exported
// pure function from the source and strip its types with node's built-in
// stripTypeScriptTypes instead of adding a bundler step to this test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const src = readFileSync(new URL('./NLSearch.tsx', import.meta.url), 'utf8');
const m = src.match(/export function searchResultView\([\s\S]*?\n\}\n/);
assert.ok(m, 'NLSearch.tsx must export a pure searchResultView function');
const js = stripTypeScriptTypes(m[0].replace(/^export /, ''));
const searchResultView = new Function(`${js}; return searchResultView;`)();

test('a failed request renders "Search failed: <reason>"', () => {
  const v = searchResultView({ searched: true, loading: false, error: 'HTTP 500', count: 0 });
  assert.equal(v.kind, 'error');
  assert.equal(v.message, 'Search failed: HTTP 500');
});

test('negative: a failed request never renders "No results found"', () => {
  const v = searchResultView({ searched: true, loading: false, error: 'network down', count: 0 });
  assert.notEqual(v.kind, 'empty');
  assert.doesNotMatch(v.message ?? '', /No results found/);
});

test('a genuine empty result still says "No results found"', () => {
  const v = searchResultView({ searched: true, loading: false, error: null, count: 0 });
  assert.equal(v.kind, 'empty');
  assert.match(v.message, /^No results found/);
});

test('results present renders the list', () => {
  assert.equal(searchResultView({ searched: true, loading: false, error: null, count: 3 }).kind, 'results');
});

test('loading or not yet searched renders nothing', () => {
  assert.equal(searchResultView({ searched: true, loading: true, error: null, count: 0 }).kind, 'hidden');
  assert.equal(searchResultView({ searched: false, loading: false, error: null, count: 0 }).kind, 'hidden');
});

test('the component renders through searchResultView and the catch keeps the error', () => {
  assert.match(src, /searchResultView\(\{\s*searched,\s*loading,\s*error,\s*count: results\.length\s*\}\)/);
  const catchBlock = src.match(/\} catch \(([^)]*)\) \{([\s\S]*?)\} finally/);
  assert.ok(catchBlock, 'performSearch must catch the error value');
  assert.match(catchBlock[2], /setError\(/);
});
