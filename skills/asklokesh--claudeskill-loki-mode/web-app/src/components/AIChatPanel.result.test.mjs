// S-164 / BACKLOG 114: both AIChatPanel completion paths rendered
// `content || 'Done.'` whatever the returncode, so a task that failed with no
// output read as a success.
//
// AIChatPanel.tsx is JSX and imports browser-only modules, so it cannot be
// imported under plain `node --test`. The pure helper is cut out of the source
// by name, its types stripped with node:module, and evaluated on its own.
// Run: node --test web-app/src/components/AIChatPanel.result.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const src = readFileSync(new URL('./AIChatPanel.tsx', import.meta.url), 'utf8');

function loadHelper() {
  const m = src.match(/^function completionContent\([\s\S]*?\n\}\n/m);
  assert.ok(m, 'completionContent helper not found in AIChatPanel.tsx');
  return new Function(`${stripTypeScriptTypes(m[0])}; return completionContent;`)();
}

test('no completion path falls back to a bare Done.', () => {
  assert.doesNotMatch(src, /\|\|\s*'Done\.'/);
});

test('both completion paths (poll and SSE) route through the helper', () => {
  assert.match(src, /content: completionContent\(poll\.output_lines\.join\('\\n'\), poll\.returncode\)/);
  assert.match(src, /content: completionContent\(last\.content, returncode\)/);
});

test('non-zero exit with no output reads as a failure', () => {
  const f = loadHelper();
  assert.equal(f('', 1), 'Failed (exit 1), no output');
  assert.equal(f('', 124), 'Failed (exit 124), no output');
});

test('zero exit with no output reads as finished, not Done.', () => {
  assert.equal(loadHelper()('', 0), 'Finished with no output');
});

test('missing exit code with no output is not reported as success', () => {
  const out = loadHelper()('', undefined);
  assert.doesNotMatch(out, /Done|Finished/);
});

test('real output is unchanged regardless of exit code', () => {
  const f = loadHelper();
  assert.equal(f('built ok', 0), 'built ok');
  assert.equal(f('boom\ntrace', 2), 'boom\ntrace');
});
