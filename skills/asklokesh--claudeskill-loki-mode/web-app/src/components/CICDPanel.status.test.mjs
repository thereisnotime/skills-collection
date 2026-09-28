// S-163 / BACKLOG 114: CICDPanel mapped every unlisted conclusion (neutral,
// action_required, stale, null) to "Failed" and every unlisted status to
// "Running". An unknown value must read as unknown, never as a guess.
//
// CICDPanel.tsx is JSX and imports ../api/client (browser-only at module
// load), so it cannot be imported under plain `node --test`. ponytail: the
// test lifts the status block (type through statusConfig) out of the source,
// strips its types with node:module and evaluates it with icon stubs. If that
// block moves into its own .ts module, import it directly instead.
// Run: node --test web-app/src/components/CICDPanel.status.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const src = fs.readFileSync(new URL('./CICDPanel.tsx', import.meta.url), 'utf8');
const start = src.indexOf('type NormalizedStatus');
const cfgStart = src.indexOf('const statusConfig', start);
const end = src.indexOf('\n};', cfgStart);
assert.ok(start >= 0 && cfgStart > start && end > cfgStart, 'status block not found in CICDPanel.tsx');
const block = stripTypeScriptTypes(src.slice(start, end + 3));

const icons = ['CheckCircle', 'XCircle', 'Clock', 'Loader', 'AlertTriangle', 'Ban', 'SkipForward', 'Timer', 'HelpCircle'];
const m = new Function(...icons, `${block}\nreturn { normalizeRunStatus, normalizeJobStatus, normalizeStepStatus, statusConfig };`)(
  ...icons.map((name) => ({ name })),
);
const normalizers = { run: m.normalizeRunStatus, job: m.normalizeJobStatus, step: m.normalizeStepStatus };

const conclusions = {
  success: 'success',
  failure: 'failed',
  timed_out: 'failed',
  startup_failure: 'failed',
  cancelled: 'cancelled',
  skipped: 'skipped',
  neutral: 'unknown',
  action_required: 'unknown',
  stale: 'unknown',
  bogus_future_value: 'unknown',
};

for (const [kind, fn] of Object.entries(normalizers)) {
  for (const [conclusion, want] of Object.entries(conclusions)) {
    test(`${kind}: completed + ${conclusion} -> ${want}`, () => {
      assert.equal(fn({ status: 'completed', conclusion }), want);
    });
  }

  test(`${kind}: completed + null conclusion -> unknown, not failed`, () => {
    assert.equal(fn({ status: 'completed', conclusion: null }), 'unknown');
  });

  test(`${kind}: completed + missing conclusion -> unknown, not failed`, () => {
    assert.equal(fn({ status: 'completed' }), 'unknown');
  });

  test(`${kind}: in_progress -> running`, () => {
    assert.equal(fn({ status: 'in_progress', conclusion: null }), 'running');
  });

  for (const status of ['queued', 'waiting', 'requested', 'pending']) {
    test(`${kind}: ${status} -> pending`, () => {
      assert.equal(fn({ status, conclusion: null }), 'pending');
    });
  }

  for (const status of ['bogus', '', null, undefined]) {
    test(`${kind}: unlisted status ${JSON.stringify(status)} -> unknown, not running`, () => {
      assert.equal(fn({ status, conclusion: null }), 'unknown');
    });
  }
}

test('statusConfig: unknown has a neutral style, not the failed red or the running spinner', () => {
  const u = m.statusConfig.unknown;
  assert.ok(u, 'statusConfig.unknown missing');
  assert.equal(u.label, 'Unknown');
  assert.notEqual(u.color, m.statusConfig.failed.color);
  assert.notEqual(u.color, m.statusConfig.running.color);
  assert.notEqual(u.Icon, m.statusConfig.failed.Icon);
  assert.notEqual(u.Icon, m.statusConfig.running.Icon);
  assert.equal(u.color, m.statusConfig.pending.color);
});

test('statusConfig: the six existing entries are unchanged', () => {
  const labels = Object.fromEntries(Object.entries(m.statusConfig).map(([k, v]) => [k, v.label]));
  assert.deepEqual(labels, {
    pending: 'Queued',
    running: 'Running',
    success: 'Success',
    failed: 'Failed',
    cancelled: 'Cancelled',
    skipped: 'Skipped',
    unknown: 'Unknown',
  });
});
