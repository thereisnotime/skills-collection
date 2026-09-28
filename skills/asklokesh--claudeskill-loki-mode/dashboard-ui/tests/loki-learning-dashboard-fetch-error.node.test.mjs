/**
 * Regression test (S-189, BACKLOG 114): the learning dashboard must not
 * report "No metrics available" / "No trend data available" when the
 * metrics or trends read itself failed.
 *
 * THE BUG. _loadData swallowed both reads with .catch(() => null), so a
 * rejected request left _metrics / _trends null and the render took the
 * empty-state branch: a panel that read nothing claimed there was no data.
 *
 * The load-bearing assertions are negative: a failed read must NOT render
 * the empty-state sentence. A real empty trends response must keep it.
 *
 * Harness: the real component class against a minimal DOM stub, same pattern
 * as loki-api-keys-fetch-error.node.test.mjs.
 *
 * Run with: node --test dashboard-ui/tests/loki-learning-dashboard-fetch-error.node.test.mjs
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// -- Minimal DOM stubs, installed before the component module is imported.
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
  constructor() {
    this._shadow = null;
  }
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

let LokiLearningDashboard;
before(async () => {
  ({ LokiLearningDashboard } = await import('../components/loki-learning-dashboard.js'));
});

const fail = async () => { throw new Error('ECONNREFUSED'); };
const METRICS = { totalSignals: 0, signalsByType: {}, signalsBySource: {}, aggregation: null };

function mount({ metrics, trends }) {
  const el = new LokiLearningDashboard();
  el.attachShadow({ mode: 'open' });
  el._api = {
    getLearningMetrics: metrics,
    getLearningTrends: trends,
    getLearningSignals: async () => [],
  };
  return el;
}

// Strip the <style> block so assertions only see rendered markup.
const html = (el) => el.shadowRoot.innerHTML.replace(/<style>[\s\S]*?<\/style>/g, '');

describe('loki-learning-dashboard: failed metrics/trends read vs empty data', () => {
  it('rejected metrics and trends render Could not load, not the empty state', async () => {
    const el = mount({ metrics: fail, trends: fail });
    await el._loadData();
    const out = html(el);
    assert.ok(out.includes('Could not load metrics'), 'metrics failure not shown');
    assert.ok(out.includes('Could not load trend data'), 'trends failure not shown');
    assert.ok(!out.includes('No metrics available'), 'rendered "No metrics available" after a FAILED read');
    assert.ok(!out.includes('No trend data available'), 'rendered "No trend data available" after a FAILED read');
  });

  it('a real empty trends response still renders No trend data available', async () => {
    const el = mount({ metrics: async () => METRICS, trends: async () => ({ dataPoints: [], maxValue: 0, period: '7d' }) });
    await el._loadData();
    const out = html(el);
    assert.ok(out.includes('No trend data available'), 'real empty trends lost its empty-state sentence');
    assert.ok(!out.includes('Could not load'), 'real empty data rendered a load failure');
  });

  it('a successful reload after a failure clears the failure', async () => {
    let down = true;
    const el = mount({
      metrics: async () => { if (down) throw new Error('down'); return METRICS; },
      trends: async () => { if (down) throw new Error('down'); return { dataPoints: [] }; },
    });
    await el._loadData();
    assert.ok(html(el).includes('Could not load trend data'));
    down = false;
    await el._loadData();
    const out = html(el);
    assert.ok(!out.includes('Could not load'), 'failure stuck after a successful reload');
    assert.ok(out.includes('No trend data available'));
  });
});
