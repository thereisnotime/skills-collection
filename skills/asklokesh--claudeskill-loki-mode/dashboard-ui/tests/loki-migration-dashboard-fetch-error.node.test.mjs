/**
 * Regression test (S-183, BACKLOG 114): a failed migration list read must not
 * render as an empty-state sentence.
 *
 * THE BUG. When /api/migration/list rejected, _fetchMigrations stored the
 * error, but render() showed "No migration data available" and dropped the
 * message: an unreachable API looked like a project with no migrations.
 *
 * The load-bearing assertion is NEGATIVE: after a failed read no empty-state
 * sentence may appear.
 *
 * Run with: node --test dashboard-ui/tests/loki-migration-dashboard-fetch-error.node.test.mjs
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const fakeClassList = { contains: () => false, add() {}, remove() {}, toggle() {} };
globalThis.document = {
  body: { classList: fakeClassList },
  documentElement: { classList: fakeClassList, dataset: {}, style: { setProperty() {} } },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
};

class FakeHTMLElement {
  attachShadow() {
    this._shadow = {
      innerHTML: '',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    return this._shadow;
  }
  get shadowRoot() { return this._shadow; }
  getAttribute() { return null; }
  hasAttribute() { return false; }
  setAttribute() {}
  removeAttribute() {}
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = {
  _defined: new Map(),
  define(name, ctor) { this._defined.set(name, ctor); },
  get(name) { return this._defined.get(name); },
};
globalThis.window = globalThis.window || {
  location: { origin: 'http://localhost:57374' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({ getPropertyValue: () => '' }));
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

let LokiMigrationDashboard;
before(async () => {
  ({ LokiMigrationDashboard } = await import('../components/loki-migration-dashboard.js'));
});

function mount(getImpl) {
  const el = new LokiMigrationDashboard();
  el.attachShadow({ mode: 'open' });
  el._api = { _get: getImpl };
  return el;
}

// Markup only: the stylesheet names .empty-state on every render.
const html = (el) => el.shadowRoot.innerHTML.replace(/<style>[\s\S]*?<\/style>/g, '');

const EMPTY_OLD = 'No migration data available';
const EMPTY = 'No migrations found';
const FAIL = 'Could not load migrations';

describe('migration dashboard: failed read vs empty read', () => {
  it('a rejected fetch renders the failure and its message, not an empty state', async () => {
    const el = mount(async () => { throw new Error('ECONNREFUSED'); });
    await el._fetchMigrations();
    const out = html(el);

    assert.ok(!out.includes(EMPTY_OLD), 'a FAILED read rendered "No migration data available"');
    assert.ok(!out.includes(EMPTY), 'a FAILED read rendered "No migrations found"');
    assert.ok(out.includes(FAIL), 'no load-failure message rendered');
    assert.ok(out.includes('ECONNREFUSED'), 'the failure detail was dropped');
  });

  it('the failure message is HTML-escaped', async () => {
    const el = mount(async () => { throw new Error('<img src=x onerror=1>'); });
    await el._fetchMigrations();
    const out = html(el);
    assert.ok(!out.includes('<img'), 'raw error markup spliced into innerHTML');
    assert.ok(out.includes('&lt;img'), 'escaped error detail missing');
  });

  it('a fulfilled empty list still renders "No migrations found", no failure', async () => {
    const el = mount(async () => ({ migrations: [] }));
    await el._fetchMigrations();
    const out = html(el);

    assert.ok(out.includes(EMPTY), 'empty list lost its empty-state sentence');
    assert.equal(el._error, null);
    assert.ok(!out.includes(FAIL), 'empty list claimed a read failure');
  });
});
