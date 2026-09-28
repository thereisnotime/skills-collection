/**
 * Regression test (S-166, BACKLOG 114): a rejected checkpoint read must not
 * render as "no checkpoints".
 *
 * THE BUG. _loadData wraps the fetch in Promise.allSettled, which never
 * throws. On status 'rejected' the code kept the empty list and then set
 * this._error = null, so a failed read rendered the empty-state sentence with
 * no error: a blind panel claiming there were no checkpoints.
 *
 * The load-bearing assertion is NEGATIVE: after a failed read the empty-state
 * sentence must NOT appear. Asserting only that an error banner appears would
 * pass with the empty sentence rendered beside it.
 *
 * Run with: node --test dashboard-ui/tests/loki-checkpoint-viewer-fetch-error.node.test.mjs
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

let LokiCheckpointViewer;
before(async () => {
  ({ LokiCheckpointViewer } = await import('../components/loki-checkpoint-viewer.js'));
});

function mount(getImpl) {
  const el = new LokiCheckpointViewer();
  el.attachShadow({ mode: 'open' });
  el._api = { _get: getImpl, _post: async () => ({}) };
  el._loading = false;
  return el;
}

// Markup only: the stylesheet names .empty-state/.error-banner on every render.
const html = (el) => el.shadowRoot.innerHTML.replace(/<style>[\s\S]*?<\/style>/g, '');

const EMPTY = 'No checkpoints yet.';
const FAIL = 'Could not load checkpoints';

describe('checkpoint viewer: failed read vs empty read', () => {
  it('a rejected fetch does NOT render the empty state and DOES render the failure', async () => {
    const el = mount(async () => { throw new Error('ECONNREFUSED'); });
    await el._loadData();
    const out = html(el);

    assert.ok(!out.includes(EMPTY), 'a FAILED read rendered the empty-state sentence');
    assert.ok(el._error, '_error was cleared after a rejected fetch');
    assert.ok(out.includes(FAIL), 'no load-failure message rendered');
    assert.ok(out.includes('ECONNREFUSED'), 'the failure detail was dropped');
  });

  it('a fulfilled empty result still renders the empty state, no error', async () => {
    const el = mount(async () => ({ checkpoints: [] }));
    await el._loadData();
    const out = html(el);

    assert.ok(out.includes(EMPTY), 'empty result lost its empty-state sentence');
    assert.equal(el._error, null);
    assert.ok(!out.includes(FAIL), 'empty result claimed a read failure');
  });

  it('a later successful read clears the load failure', async () => {
    let fail = true;
    const el = mount(async () => {
      if (fail) throw new Error('EHOSTUNREACH');
      return [];
    });
    await el._loadData();
    assert.ok(html(el).includes(FAIL));

    fail = false;
    await el._loadData();
    const out = html(el);
    assert.ok(!out.includes(FAIL), 'a recovered read still shows the old failure');
    assert.ok(out.includes(EMPTY));
  });
});
