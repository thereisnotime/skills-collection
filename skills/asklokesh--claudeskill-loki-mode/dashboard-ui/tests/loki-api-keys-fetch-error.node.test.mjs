/**
 * Regression test (S-170, BACKLOG 114): the API keys panel must not claim
 * "No API keys configured" when the list load itself failed.
 *
 * THE BUG. A failed load sets _error = "Failed to load API keys: ..." and
 * leaves _keys empty. The table branch fell through to keys.length === 0 and
 * rendered the empty-state sentence directly above its own error banner, so a
 * panel that read nothing reported an empty key store.
 *
 * The load-bearing assertion is negative: the error render must NOT contain
 * the empty-state sentence. A real empty list (and an empty list after an
 * unrelated create failure) must keep it.
 *
 * Harness: the real component class against a minimal DOM stub, same pattern
 * as loki-empty-vs-error.node.test.mjs.
 *
 * Run with: node --test dashboard-ui/tests/loki-api-keys-fetch-error.node.test.mjs
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

let LokiApiKeys;
before(async () => {
  ({ LokiApiKeys } = await import('../components/loki-api-keys.js'));
});

const EMPTY = 'No API keys configured';

function mount(getImpl) {
  const el = new LokiApiKeys();
  el.attachShadow({ mode: 'open' });
  el._api = { _get: getImpl, _post: async () => ({}) };
  return el;
}

// Strip the <style> block so assertions only see rendered markup.
const html = (el) => el.shadowRoot.innerHTML.replace(/<style>[\s\S]*?<\/style>/g, '');

describe('loki-api-keys: failed load vs empty list', () => {
  it('a failed load does NOT render the empty-state sentence', async () => {
    const el = mount(async () => { throw new Error('ECONNREFUSED'); });
    await el._loadData();
    const out = html(el);
    assert.ok(out.includes('Failed to load API keys: ECONNREFUSED'), 'error banner missing');
    assert.ok(!out.includes(EMPTY), `rendered "${EMPTY}" after a FAILED load`);
  });

  it('a real empty list keeps the empty-state sentence', async () => {
    const el = mount(async () => ({ keys: [] }));
    await el._loadData();
    const out = html(el);
    assert.ok(out.includes(EMPTY), 'real empty list lost its empty-state sentence');
    assert.ok(!out.includes('error-banner'), 'real empty list rendered an error banner');
  });

  it('an empty list with a non-load error (create failed) keeps the sentence', async () => {
    const el = mount(async () => []);
    await el._loadData();
    el._error = 'Create failed: boom';
    el.render();
    assert.ok(html(el).includes(EMPTY));
  });

  it('a successful reload after a failure restores the sentence', async () => {
    let fail = true;
    const el = mount(async () => { if (fail) throw new Error('down'); return []; });
    await el._loadData();
    assert.ok(!html(el).includes(EMPTY));
    fail = false;
    await el._loadData();
    assert.ok(html(el).includes(EMPTY));
  });
});
