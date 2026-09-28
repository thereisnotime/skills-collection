/**
 * Regression test (S-169, BACKLOG 114): the log stream must not swallow API
 * failures silently.
 *
 * THE BUG. loki-log-stream.js polled /api/logs and its catch body was only the
 * comment "API not available, will retry on next poll". A panel that never
 * reached the API rendered "No log output yet...", which reads as a quiet log.
 *
 * THE CONTRACT. Consecutive failed polls render a visible "Log source
 * unreachable, retrying" state instead of the quiet-log sentence, and the next
 * successful poll clears it. A single transient failure does not flip it.
 *
 * Exercises the REAL component class against a minimal DOM stub (the harness
 * pattern of loki-empty-vs-error.node.test.mjs).
 *
 * Run with: node --test dashboard-ui/tests/loki-log-stream-fetch-error.node.test.mjs
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
  // _escapeHtml sets textContent and reads innerHTML back; echo it (test data has no markup).
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, textContent: '', get innerHTML() { return this.textContent; } }),
};

class FakeHTMLElement {
  attachShadow() {
    const output = { innerHTML: '' };
    this._shadow = {
      innerHTML: '',
      output,
      getElementById: (id) => (id === 'log-output' ? output : null),
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
  dispatchEvent() { return true; }
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
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => fn());

let LokiLogStream;

before(async () => {
  ({ LokiLogStream } = await import('../components/loki-log-stream.js'));
});

const UNREACHABLE = 'Log source unreachable, retrying';
const QUIET = 'No log output yet';

/** Mount with a stubbed API whose getLogs follows the given script of outcomes. */
function mount(outcomes) {
  const el = new LokiLogStream();
  el.attachShadow({ mode: 'open' });
  let i = 0;
  el._api = {
    getLogs: async () => {
      const o = outcomes[Math.min(i++, outcomes.length - 1)];
      if (o instanceof Error) throw o;
      return o;
    },
  };
  return el;
}

const out = (el) => el.shadowRoot.output.innerHTML;
const fail = new Error('ECONNREFUSED');

describe('log stream API failure is visible, not a quiet log', () => {
  it('consecutive failed polls render the unreachable state, not the quiet-log sentence', async () => {
    const el = mount([fail, fail]);
    await el._apiLogPollTick();
    await el._apiLogPollTick();
    assert.ok(out(el).includes(UNREACHABLE), `expected "${UNREACHABLE}", got: ${out(el)}`);
    assert.ok(!out(el).includes(QUIET), `a blind panel rendered "${QUIET}"`);
  });

  it('a single transient failure does not flip the state', async () => {
    const el = mount([fail]);
    el._renderLogs();
    await el._apiLogPollTick();
    assert.ok(!out(el).includes(UNREACHABLE), `one failure flipped the state: ${out(el)}`);
  });

  it('the next successful poll clears the unreachable state (even an empty or unchanged log)', async () => {
    const el = mount([fail, fail, [], []]);
    await el._apiLogPollTick();
    await el._apiLogPollTick();
    assert.ok(out(el).includes(UNREACHABLE));
    await el._apiLogPollTick();
    assert.ok(!out(el).includes(UNREACHABLE), `success did not clear: ${out(el)}`);
    assert.ok(out(el).includes(QUIET), 'a real empty log keeps the quiet-log sentence');
    // Fail twice again after an unchanged-signature success path, then recover.
    el._api.getLogs = async () => { throw fail; };
    await el._apiLogPollTick();
    await el._apiLogPollTick();
    assert.ok(out(el).includes(UNREACHABLE));
    el._api.getLogs = async () => [];
    await el._apiLogPollTick(); // same signature as the last success: early-return path
    assert.ok(!out(el).includes(UNREACHABLE), `unchanged-log success did not clear: ${out(el)}`);
  });

  it('a recovered poll with entries renders the entries', async () => {
    const el = mount([fail, fail, [{ message: 'hello world', level: 'info', timestamp: '10:00:00' }]]);
    await el._apiLogPollTick();
    await el._apiLogPollTick();
    await el._apiLogPollTick();
    assert.ok(out(el).includes('hello world'));
    assert.ok(!out(el).includes(UNREACHABLE));
  });
});
