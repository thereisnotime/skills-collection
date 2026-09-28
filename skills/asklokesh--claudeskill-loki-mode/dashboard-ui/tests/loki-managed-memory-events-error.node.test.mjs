/**
 * Regression test (S-184, BACKLOG 114): the managed memory panel must not
 * claim "No managed memory events recorded yet." when the events endpoint
 * answered 200 with an error payload.
 *
 * THE BUG. dashboard/server.py returns {"events": [], "count": 0, "error": ...}
 * with status 200 when the events read fails. _loadEvents took the object
 * branch, ignored data.error, and the render fell through to the empty-state
 * sentence, so a failed read reported an empty event log.
 *
 * Run with: node --test dashboard-ui/tests/loki-managed-memory-events-error.node.test.mjs
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

let LokiManagedMemoryPanel;
before(async () => {
  ({ LokiManagedMemoryPanel } = await import('../components/loki-managed-memory-panel.js'));
});

const EMPTY = 'No managed memory events recorded yet.';

function mount(payload) {
  const el = new LokiManagedMemoryPanel();
  el.attachShadow({ mode: 'open' });
  el._api = { get: async () => payload };
  el._status = { enabled: true };
  return el;
}

// Strip the <style> block so assertions only see rendered markup.
const html = (el) => el.shadowRoot.innerHTML.replace(/<style>[\s\S]*?<\/style>/g, '');

describe('loki-managed-memory-panel: 200 error payload vs empty events', () => {
  it('an error payload renders the error line, not the empty sentence', async () => {
    const el = mount({ events: [], count: 0, error: 'events.jsonl unreadable' });
    await el._loadEvents();
    const out = html(el);
    assert.ok(out.includes('Events error:'), 'events error banner missing');
    assert.ok(out.includes('events.jsonl unreadable'), 'server error message missing');
    assert.ok(!out.includes(EMPTY), `rendered "${EMPTY}" for an error payload`);
  });

  it('a real empty list keeps the empty sentence', async () => {
    const el = mount({ events: [], count: 0 });
    await el._loadEvents();
    const out = html(el);
    assert.ok(out.includes(EMPTY), 'real empty list lost its empty sentence');
    assert.ok(!out.includes('Events error:'), 'real empty list rendered an error banner');
  });
});
