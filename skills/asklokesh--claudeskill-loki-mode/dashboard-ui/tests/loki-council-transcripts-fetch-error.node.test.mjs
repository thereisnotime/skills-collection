/**
 * Regression test (S-167, BACKLOG 114): a FAILED hook-events read must not
 * render the same as a real empty list.
 *
 * THE BUG. loki-council-transcripts.js caught a failed
 * /api/council/transcripts?type_prefix=claude_hook_ read by setting
 * this._hookEvents = [] and recording nothing, so the Live Tool Activity
 * section printed "No live tool activity yet" while it had read nothing.
 *
 * The load-bearing assertion is negative: the failure render must NOT contain
 * the empty-state sentence.
 *
 * Run with: node --test dashboard-ui/tests/loki-council-transcripts-fetch-error.node.test.mjs
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
  constructor() { this._shadow = null; }
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

let LokiCouncilTranscripts;
before(async () => {
  ({ LokiCouncilTranscripts } = await import('../components/loki-council-transcripts.js'));
});

const EMPTY = 'No live tool activity yet';
const FAILED = 'Could not load hook events';

/** Mount with a stubbed api whose hook-events read behaves as told. */
function mount(hookImpl) {
  const el = new LokiCouncilTranscripts();
  el.attachShadow({ mode: 'open' });
  el._api = {
    get: async (url) =>
      url.includes('type_prefix=claude_hook_') ? hookImpl() : { transcripts: [] },
  };
  return el;
}

const html = (el) => el.shadowRoot.innerHTML.replace(/<style>[\s\S]*?<\/style>/g, '');

describe('council transcripts: hook events empty vs failed', () => {
  it('a failed hook-events read renders a failure, not the empty state', async () => {
    const el = mount(async () => { throw new Error('ECONNREFUSED'); });
    await el._load();
    const out = html(el);
    assert.ok(!out.includes(EMPTY), 'failed read rendered as "no hook events"');
    assert.ok(out.includes(FAILED), 'failure message missing');
    assert.ok(out.includes('ECONNREFUSED'), 'error detail not surfaced');
    // The transcripts read succeeded, so its own empty state still shows.
    assert.ok(out.includes('No review rounds recorded yet'));
  });

  it('a real empty hook-events list still renders the empty state', async () => {
    const el = mount(async () => ({ hook_events: [] }));
    await el._load();
    const out = html(el);
    assert.ok(out.includes(EMPTY), 'empty list lost its empty state');
    assert.ok(!out.includes(FAILED), 'empty list claimed a read failure');
  });

  it('a later success clears an earlier failure', async () => {
    let fail = true;
    const el = mount(async () => {
      if (fail) throw new Error('EHOSTUNREACH');
      return { hook_events: [] };
    });
    await el._load();
    assert.ok(html(el).includes(FAILED));
    fail = false;
    await el._load();
    const out = html(el);
    assert.ok(!out.includes(FAILED), 'stale failure shown after a success');
    assert.ok(out.includes(EMPTY));
  });
});
