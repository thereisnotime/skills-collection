// S-46 / BACKLOG 115: the historical-view fallback used to default an
// unrecognized detail.status to 'completed', and the checklist was shown for
// a historical session even though the endpoint it comes from always reads
// the globally-running project.
//
// useCockpitState.ts imports ../api/client, which reads window.location at
// module load time (browser-only), so this cannot run under a plain
// `node --test <file>`. Run it with:
//   node web-app/src/cockpit/run-derive-view-test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveHistoricalView, scopeChecklistToLive, changeReviewEmptyState, settle } from './useCockpitState.ts';
import { riskSignals } from './RiskPanel.tsx';

test('deriveHistoricalView: an unrecognized status is unknown, not completed', () => {
  assert.equal(deriveHistoricalView({ status: 'bogus', prd: 'x' }, false), 'unknown');
});

test('deriveHistoricalView: a missing status with real content is unknown, not completed', () => {
  assert.equal(deriveHistoricalView({ status: '', prd: '# spec' }, false), 'unknown');
});

test('deriveHistoricalView: server "unknown" status maps through as unknown', () => {
  assert.equal(deriveHistoricalView({ status: 'unknown' }, false), 'unknown');
});

test('deriveHistoricalView: explicit completed status is honored', () => {
  assert.equal(deriveHistoricalView({ status: 'completed' }, false), 'completed');
});

test('deriveHistoricalView: explicit failed status is honored', () => {
  assert.equal(deriveHistoricalView({ status: 'failed' }, false), 'failed');
});

test('deriveHistoricalView: explicit paused status is honored (not swallowed by the fallback)', () => {
  assert.equal(deriveHistoricalView({ status: 'paused' }, false), 'paused');
});

test('deriveHistoricalView: no status, no prd, no changes, no files is empty', () => {
  assert.equal(deriveHistoricalView({ status: '' }, false), 'empty');
});

test('deriveHistoricalView: no status but git changes present is unknown, not completed', () => {
  assert.equal(deriveHistoricalView({ status: '' }, true), 'unknown');
});

test('scopeChecklistToLive: hides the checklist for a non-live (historical) session', () => {
  const checklist = { total: 3, passed: 3, failed: 0, skipped: 0, pending: 0, items: [] };
  assert.equal(scopeChecklistToLive(checklist, false), null);
});

test('scopeChecklistToLive: shows the checklist only for the live session', () => {
  const checklist = { total: 3, passed: 3, failed: 0, skipped: 0, pending: 0, items: [] };
  assert.equal(scopeChecklistToLive(checklist, true), checklist);
});

test('scopeChecklistToLive: a null checklist while live stays null (not swallowed)', () => {
  assert.equal(scopeChecklistToLive(null, true), null);
});

// S-58 / BACKLOG 114 (scoped subset): a failed git-status or checkpoint fetch
// must not render the same copy as a genuine empty result.

test('settle: a rejected fetch (matching fetchJSON\'s "API error 500: ..." shape) reports that message, not the fallback silently', async () => {
  const rejected = Promise.reject(new Error('API error 500: Internal Server Error'));
  const result = await settle(rejected, [], 'Could not load checkpoints');
  assert.deepEqual(result, { data: [], error: 'API error 500: Internal Server Error' });
});

test('settle: a network-level rejection with no Error instance falls back to the given message', async () => {
  // fetch() itself rejects with a TypeError on a network failure; simulate a
  // non-Error rejection too, since settle must not assume the shape.
  const rejected = Promise.reject('network down');
  const result = await settle(rejected, null, 'Could not load working tree status');
  assert.deepEqual(result, { data: null, error: 'Could not load working tree status' });
});

test('settle: a resolved fetch reports no error (positive control)', async () => {
  const resolved = Promise.resolve([{ id: 'cp-1' }]);
  const result = await settle(resolved, [], 'Could not load checkpoints');
  assert.deepEqual(result, { data: [{ id: 'cp-1' }], error: null });
});

test('settle: a resolved but genuinely empty fetch reports no error (positive control, matches "no checkpoints dir" server behavior)', async () => {
  const resolved = Promise.resolve([]);
  const result = await settle(resolved, [], 'Could not load checkpoints');
  assert.deepEqual(result, { data: [], error: null });
});

test('changeReviewEmptyState: a failed fetch with no files is "error", not "clean"', () => {
  assert.equal(changeReviewEmptyState(0, false, 'network error'), 'error');
});

test('changeReviewEmptyState: a failed fetch takes priority even if clean was also true', () => {
  assert.equal(changeReviewEmptyState(0, true, '500 Internal Server Error'), 'error');
});

test('changeReviewEmptyState: a genuinely clean, successful fetch is "clean" (positive control)', () => {
  assert.equal(changeReviewEmptyState(0, true, null), 'clean');
});

test('changeReviewEmptyState: files present means no empty-state copy at all, even with an error', () => {
  assert.equal(changeReviewEmptyState(3, false, 'network error'), null);
});

test('changeReviewEmptyState: no files, not clean, no error is neither (unknown, handled elsewhere)', () => {
  assert.equal(changeReviewEmptyState(0, false, null), null);
});

test('riskSignals: a failed checkpoints fetch reports "Could not load", not "No checkpoints"', () => {
  const signals = riskSignals([], null, [], 'network error');
  assert.ok(signals.some((s) => s.startsWith('Could not load checkpoints:')));
  assert.ok(!signals.some((s) => s.includes('No checkpoints were recorded')));
});

test('riskSignals: a genuine empty checkpoints list (successful fetch) reports "No checkpoints" (positive control)', () => {
  const checklist = { total: 1, passed: 1, failed: 0, skipped: 0, pending: 0, items: [] };
  const signals = riskSignals([], checklist, [], null);
  assert.ok(signals.some((s) => s.includes('No checkpoints were recorded')));
  assert.ok(!signals.some((s) => s.startsWith('Could not load checkpoints:')));
});
