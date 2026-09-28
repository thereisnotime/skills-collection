/**
 * BACKLOG 118 (S-151): loki-analytics heatmap counted every day before the
 * returned activity window as "0 activities" -- indistinguishable from a real
 * day where the agent ran and did nothing. _computeHeatmap always builds a
 * fixed 52-week grid ending today and fills every day not present in the
 * `/api/activity` response with count 0, even days far before the earliest
 * entry the API ever returned (up to ~355 days on a fresh install whose
 * activity history starts 10 days ago).
 *
 * Fix: track the earliest timestamp actually returned, mark every cell before
 * that day (the window start) `noData: true` with count forced to 0 (so it
 * never inflates maxCount or a level), and render those cells with a
 * dedicated "no data" class/title distinct from a real, measured zero.
 *
 * This exercises the REAL component class against the project's DOM-free
 * `node --test` harness (see loki-session-control-focus.test.js for the same
 * pattern; jsdom suites do not run under ESM in this environment).
 *
 * Run: node --test dashboard-ui/tests/loki-analytics-heatmap-window.test.js
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// -- Minimal DOM stubs so the component module imports and constructs.
const fakeClassList = { contains: () => false, add() {}, remove() {}, toggle() {} };
globalThis.document = {
  body: { classList: fakeClassList },
  documentElement: { classList: fakeClassList, dataset: {}, style: { setProperty() {} } },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  createElement() {
    return {
      _text: '',
      set textContent(v) { this._text = String(v); },
      get innerHTML() { return this._text; },
    };
  },
};

class FakeHTMLElement {
  constructor() {
    this._shadow = null;
  }
  attachShadow() {
    this._shadow = { innerHTML: '', getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
    return this._shadow;
  }
  get shadowRoot() { return this._shadow; }
  getAttribute() { return null; }
  hasAttribute() { return false; }
  setAttribute() {}
  dispatchEvent() { return true; }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = { _d: new Map(), define(n, c) { this._d.set(n, c); }, get(n) { return this._d.get(n); } };
globalThis.window = globalThis.window || {
  location: { origin: 'http://localhost:57374' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({ getPropertyValue: () => '' }));
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

let LokiAnalytics;

before(async () => {
  ({ LokiAnalytics } = await import('../components/loki-analytics.js'));
});

function daysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe('loki-analytics heatmap: days before the returned activity window', () => {
  it('marks pre-window days as no-data, not 0 activities', () => {
    const el = new LokiAnalytics();
    // Fixture: the API's earliest returned entry is 10 days ago.
    el._activity = [
      { timestamp: daysAgo(10) },
      { timestamp: daysAgo(3) },
      { timestamp: daysAgo(3) },
    ];

    const { cells, maxCount } = el._computeHeatmap();

    assert.equal(maxCount, 2, 'the real 3-days-ago count must still be measured');

    // Find the cell exactly at day -10 (the window start) and one clearly before it.
    const byDate = new Map(cells.map(c => [c.date, c]));
    const startKey = el._localDateKey(new Date(daysAgo(10)));
    const farBeforeKey = el._localDateKey(new Date(daysAgo(300)));

    assert.ok(byDate.has(startKey), 'the window-start day must be in the grid');
    assert.equal(byDate.get(startKey).noData, false, 'the window-start day itself has real data');
    assert.equal(byDate.get(startKey).count, 1, 'the window-start day keeps its real count');

    assert.ok(byDate.has(farBeforeKey), 'a day long before the window must still be in the 52-week grid');
    assert.equal(byDate.get(farBeforeKey).noData, true, 'a day before the earliest returned entry must be no-data');
    assert.equal(byDate.get(farBeforeKey).count, 0, 'a no-data cell reports 0, never a fabricated count');

    // A day inside the window with genuinely zero activity stays a measured 0,
    // never no-data.
    const insideZeroKey = el._localDateKey(new Date(daysAgo(5)));
    assert.ok(byDate.has(insideZeroKey));
    assert.equal(byDate.get(insideZeroKey).noData, false, 'a zero day inside the window is measured, not no-data');
    assert.equal(byDate.get(insideZeroKey).count, 0);
  });

  it('renders no-data cells with a distinct class and title, not "0 activities"', () => {
    const el = new LokiAnalytics();
    el._activity = [{ timestamp: daysAgo(10) }];

    const html = el._renderHeatmap();
    const divs = html.match(/<div class="heatmap-cell[^>]*><\/div>/g) || [];
    assert.ok(divs.length > 300, `expected the full grid of cell divs, got ${divs.length}`);

    const noDataDivs = divs.filter(d => d.includes('level-no-data'));
    assert.ok(noDataDivs.length > 0, 'expected at least one level-no-data cell in the rendered grid');
    for (const d of noDataDivs) {
      assert.ok(d.includes(': no data"'), `no-data cell missing the "no data" title: ${d}`);
      assert.ok(!d.includes('activities'), `no-data cell must not claim a measured count: ${d}`);
    }
  });

  it('treats an empty/unusable activity list as entirely unknown, not all-zero', () => {
    const el = new LokiAnalytics();
    el._activity = [];

    const { cells, maxCount } = el._computeHeatmap();

    assert.equal(maxCount, 0);
    assert.ok(cells.length > 300, 'expected the full ~365-day grid');
    assert.ok(cells.every(c => c.noData === true), 'with no returned entries, every cell is unknown, not measured zero');
  });
});
