/**
 * Tests for UI component utility functions and data transformations.
 *
 * Uses Node.js built-in test runner. Imports the actual exported pure
 * functions from each component (no DOM APIs required for these functions),
 * so behavior changes in the shipped code are caught here instead of against
 * a stale hand-copy.
 *
 * Run with: node --test dashboard-ui/tests/ui-components.test.js
 *
 * @version 2.0.0
 */

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// -- Minimal DOM stubs, installed before the component modules are imported.
// Each component module extends LokiElement (HTMLElement) at class-definition
// time, so importing it for its pure functions still needs these globals even
// though the functions under test touch no DOM themselves.
const fakeClassList = { contains: () => false, add() {}, remove() {}, toggle() {} };
globalThis.document = {
  body: { classList: fakeClassList },
  documentElement: { classList: fakeClassList, dataset: {}, style: { setProperty() {} } },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
};
class FakeHTMLElement {
  attachShadow() {
    this._shadow = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    return this._shadow;
  }
  get shadowRoot() { return this._shadow; }
  getAttribute() { return null; }
  hasAttribute() { return false; }
}
globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = {
  _d: new Map(),
  define(n, c) { this._d.set(n, c); },
  get(n) { return this._d.get(n); },
};
globalThis.window = globalThis.window || {
  location: { origin: 'http://localhost:57374' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({ getPropertyValue: () => '' }));
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

// Dynamic imports, run only after the DOM stubs above are installed. A static
// import is hoisted above this file's own top-level statements, which would
// run each component module's class definition (extends HTMLElement) before
// globalThis.HTMLElement exists.
let formatDuration, computePhaseWidths;
let formatGateTime, summarizeGates;
let formatAuditTimestamp, buildAuditQuery;
let formatTenantLabel;
let formatRunDuration, formatRunTime;
let formatKeyTime, maskToken;

before(async () => {
  ({ formatDuration, computePhaseWidths } = await import('../components/loki-rarv-timeline.js'));
  ({ formatGateTime, summarizeGates } = await import('../components/loki-quality-gates.js'));
  ({ formatAuditTimestamp, buildAuditQuery } = await import('../components/loki-audit-viewer.js'));
  ({ formatTenantLabel } = await import('../components/loki-tenant-switcher.js'));
  ({ formatRunDuration, formatRunTime } = await import('../components/loki-run-manager.js'));
  ({ formatKeyTime, maskToken } = await import('../components/loki-api-keys.js'));
});

// -------------------------------------------------------------------
// 1. loki-rarv-timeline
// -------------------------------------------------------------------
describe('loki-rarv-timeline', () => {
  it('formatDuration returns -- for null/undefined/negative', () => {
    assert.equal(formatDuration(null), '--');
    assert.equal(formatDuration(undefined), '--');
    assert.equal(formatDuration(-5), '--');
  });

  it('formatDuration formats milliseconds correctly', () => {
    assert.equal(formatDuration(500), '500ms');
    assert.equal(formatDuration(3000), '3s');
    assert.equal(formatDuration(90000), '1m 30s');
    assert.equal(formatDuration(7200000), '2h 0m');
  });

  it('computePhaseWidths returns empty array for empty/null input', () => {
    assert.deepEqual(computePhaseWidths([]), []);
    assert.deepEqual(computePhaseWidths(null), []);
  });

  it('computePhaseWidths computes correct percentages', () => {
    const phases = [
      { phase: 'reason', duration_ms: 1000 },
      { phase: 'act', duration_ms: 3000 },
    ];
    const result = computePhaseWidths(phases);
    assert.equal(result.length, 2);
    assert.equal(result[0].phase, 'reason');
    assert.equal(result[0].pct, 25);
    assert.equal(result[1].phase, 'act');
    assert.equal(result[1].pct, 75);
  });

  it('computePhaseWidths handles zero durations with equal distribution', () => {
    const phases = [
      { phase: 'reason', duration_ms: 0 },
      { phase: 'act', duration_ms: 0 },
    ];
    const result = computePhaseWidths(phases);
    assert.equal(result.length, 2);
    assert.equal(result[0].pct, 50);
    assert.equal(result[1].pct, 50);
  });
});

// -------------------------------------------------------------------
// 2. loki-quality-gates
// -------------------------------------------------------------------
describe('loki-quality-gates', () => {
  it('summarizeGates counts statuses correctly', () => {
    const gates = [
      { name: 'Gate 1', status: 'pass' },
      { name: 'Gate 2', status: 'pass' },
      { name: 'Gate 3', status: 'fail' },
      { name: 'Gate 4', status: 'pending' },
    ];
    const summary = summarizeGates(gates);
    assert.equal(summary.pass, 2);
    assert.equal(summary.fail, 1);
    assert.equal(summary.pending, 1);
    assert.equal(summary.notEvaluated, 0);
    assert.equal(summary.total, 4);
  });

  it('summarizeGates treats a missing/unknown status as notEvaluated, not pending', () => {
    const gates = [{ name: 'Gate 1' }, { name: 'Gate 2', status: 'weird' }];
    const summary = summarizeGates(gates);
    assert.equal(summary.pending, 0);
    assert.equal(summary.notEvaluated, 2);
    assert.equal(summary.total, 2);
  });

  it('summarizeGates handles empty input', () => {
    const summary = summarizeGates([]);
    assert.equal(summary.total, 0);
    assert.equal(summary.pass, 0);
    assert.equal(summary.notEvaluated, 0);
  });

  it('formatGateTime returns "Not recorded" for null/undefined', () => {
    assert.equal(formatGateTime(null), 'Not recorded');
    assert.equal(formatGateTime(undefined), 'Not recorded');
  });
});

// -------------------------------------------------------------------
// 3. loki-audit-viewer
// -------------------------------------------------------------------
describe('loki-audit-viewer', () => {
  it('buildAuditQuery builds correct query string', () => {
    const query = buildAuditQuery({ limit: 50, action: 'create', resource: '' });
    assert.ok(query.includes('limit=50'));
    assert.ok(query.includes('action=create'));
    assert.ok(!query.includes('resource='));
  });

  it('buildAuditQuery returns empty for no params', () => {
    assert.equal(buildAuditQuery({}), '');
  });

  it('formatAuditTimestamp returns -- for null/undefined', () => {
    assert.equal(formatAuditTimestamp(null), '--');
    assert.equal(formatAuditTimestamp(undefined), '--');
  });
});

// -------------------------------------------------------------------
// 4. loki-tenant-switcher
// -------------------------------------------------------------------
describe('loki-tenant-switcher', () => {
  it('formatTenantLabel formats name and slug', () => {
    assert.equal(formatTenantLabel({ name: 'Acme Corp', slug: 'acme' }), 'Acme Corp (acme)');
  });

  it('formatTenantLabel handles name only', () => {
    assert.equal(formatTenantLabel({ name: 'Solo' }), 'Solo');
  });

  it('formatTenantLabel handles null', () => {
    assert.equal(formatTenantLabel(null), 'Unknown');
  });
});

// -------------------------------------------------------------------
// 5. loki-run-manager
// -------------------------------------------------------------------
describe('loki-run-manager', () => {
  it('formatRunDuration computes from start and end timestamps', () => {
    const start = '2026-02-21T10:00:00Z';
    const end = '2026-02-21T10:05:30Z';
    const result = formatRunDuration(null, start, end);
    assert.equal(result, '5m 30s');
  });

  it('formatRunDuration uses explicit ms when provided', () => {
    assert.equal(formatRunDuration(120000, null, null), '2m 0s');
  });

  it('formatRunDuration returns -- for a finished run with no end recorded', () => {
    // isLive defaults to false: no end and not live means the duration is
    // unknown, not "now minus start".
    assert.equal(formatRunDuration(null, '2026-02-21T10:00:00Z', null), '--');
  });

  it('formatRunDuration computes from start to now when isLive is true', () => {
    const start = new Date(Date.now() - 5000).toISOString();
    const result = formatRunDuration(null, start, null, true);
    assert.match(result, /^\d+s$|^\d+ms$/);
  });

  it('formatRunTime returns -- for null', () => {
    assert.equal(formatRunTime(null), '--');
  });
});

// -------------------------------------------------------------------
// 6. loki-api-keys
// -------------------------------------------------------------------
describe('loki-api-keys', () => {
  it('maskToken masks long tokens correctly', () => {
    const token = 'sk_live_abcdefghijklmnop';
    const masked = maskToken(token);
    assert.ok(masked.startsWith('sk_l'));
    assert.ok(masked.endsWith('mnop'));
    assert.ok(masked.includes('****'));
  });

  it('maskToken returns **** for short/null tokens', () => {
    assert.equal(maskToken('abc'), '****');
    assert.equal(maskToken(null), '****');
    assert.equal(maskToken(''), '****');
  });

  it('formatKeyTime returns Never for null/undefined', () => {
    assert.equal(formatKeyTime(null), 'Never');
    assert.equal(formatKeyTime(undefined), 'Never');
  });
});
