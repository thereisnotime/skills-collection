/**
 * Regression coverage for the wave-4 WebSocket bugs (v7.113.0).
 *
 * Run: node --test tests/loki-ws-leak-reconnect.node.test.mjs
 *
 * Two related bugs, fixed together:
 *
 * BUG-LOW (loki-api-client.js): the WebSocket onclose handler
 *   unconditionally called _scheduleReconnect(). disconnect() sets _ws=null and
 *   calls close(), but close() fires onclose ASYNCHRONOUSLY -- so the deferred
 *   onclose ran after disconnect() and immediately reopened the socket, defeating
 *   the disconnect. Fix: an _intentionalClose flag set true in disconnect(),
 *   reset false at the top of connect(); onclose only reconnects when the flag is
 *   false.
 *
 * BUG-MED (loki-overview.js): attributeChangedCallback for 'api-url' detached its
 *   listeners then adopted a DIFFERENT per-URL singleton client and connect()ed
 *   it, never closing the OLD client's WebSocket + reconnect timer. Each project
 *   switch leaked a live socket. Fix: capture the previous client before
 *   _setupApi reassigns this._api, then oldApi.disconnect() (guarded by identity
 *   so an identical-URL switch does not sever the client just adopted).
 *
 * Both are proven FAIL-on-old / PASS-on-fix. The mock WebSocket fires onclose
 * asynchronously from close() -- the async fire IS the LOW bug; a synchronous
 * mock would hide it.
 *
 * This test needs no DOM library: the api-client runs on Node's native
 * EventTarget with only a WebSocket global, and the component's
 * attributeChangedCallback is driven via the real prototype with a minimal DOM
 * shim installed on globalThis before import. It self-skips only if the source
 * modules cannot be imported in this environment.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock WebSocket. close() fires onclose ASYNCHRONOUSLY (microtask) to mirror
// the browser, which is what makes BUG-LOW real. Tracks every construction so
// the test can assert "no new socket constructed after disconnect".
// ---------------------------------------------------------------------------
let wsConstructed = [];
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.closed = false;
    wsConstructed.push(this);
    // Simulate the socket opening on the next microtask.
    queueMicrotask(() => {
      if (this.closed) return;
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen();
    });
  }
  close() {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    // Fire onclose ASYNCHRONOUSLY, as browsers do.
    queueMicrotask(() => {
      if (this.onclose) this.onclose();
    });
  }
  send() {}
}
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

// Let queued microtasks (open, onclose) drain.
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

// ---------------------------------------------------------------------------
// Global shims installed BEFORE importing the source modules. loki-theme's
// LokiElement extends HTMLElement and customElements.define runs at import.
// ---------------------------------------------------------------------------
globalThis.WebSocket = MockWebSocket;
globalThis.window = {
  location: { origin: 'http://localhost:57374', protocol: 'http:', host: 'localhost:57374' },
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
};
if (typeof globalThis.HTMLElement === 'undefined') {
  globalThis.HTMLElement = class {};
}
globalThis.customElements = {
  _defs: new Map(),
  define(name, ctor) { this._defs.set(name, ctor); },
  get(name) { return this._defs.get(name); },
};

let apiMod, overviewMod, importError;
try {
  apiMod = await import('../core/loki-api-client.js');
  overviewMod = await import('../components/loki-overview.js');
} catch (e) {
  importError = e;
}

if (importError) {
  console.log('[skip] could not import source modules:', importError.message);
  test('ws-leak-reconnect (skipped: import failed)', { skip: true }, () => {});
}

if (apiMod && overviewMod) {
  const { LokiApiClient } = apiMod;
  const { LokiOverview } = overviewMod;

  // -------------------------------------------------------------------------
  // BUG-LOW: disconnect() must not be defeated by the async onclose.
  // Old source: onclose always _scheduleReconnect() -> a new socket is built
  //   and a reconnect timer is armed even after disconnect(). RED.
  // Fixed source: _intentionalClose gates onclose -> no new socket, no timer.
  // -------------------------------------------------------------------------
  test('BUG-LOW: disconnect() is not defeated by async onclose', async () => {
    LokiApiClient.clearInstances();
    wsConstructed = [];

    const client = new LokiApiClient({ baseUrl: 'http://127.0.0.1:59001' });
    await client.connect();
    await flush();
    assert.equal(wsConstructed.length, 1, 'exactly one socket after connect');
    assert.equal(client.isConnected, true, 'connected after open');

    client.disconnect();
    const countAtDisconnect = wsConstructed.length;

    // Drain the async onclose that close() queued.
    await flush();
    await flush();

    assert.equal(
      wsConstructed.length,
      countAtDisconnect,
      'no NEW socket may be constructed after disconnect() (old code reopened via onclose->_scheduleReconnect->connect)'
    );
    assert.equal(client._reconnectTimeout, null, 'no reconnect timer may be armed after an intentional disconnect');
    assert.equal(client._ws, null, 'socket reference stays null after disconnect');

    client.disconnect();
  });

  // -------------------------------------------------------------------------
  // BUG-LOW (positive control): an UNINTENTIONAL drop still reconnects, so the
  // flag does not over-block legitimate auto-reconnect.
  // -------------------------------------------------------------------------
  test('BUG-LOW: unexpected drop still schedules a reconnect', async () => {
    LokiApiClient.clearInstances();
    wsConstructed = [];

    const client = new LokiApiClient({ baseUrl: 'http://127.0.0.1:59002' });
    await client.connect();
    await flush();

    // Simulate the server dropping the socket (no disconnect() call).
    const sock = client._ws;
    sock.readyState = MockWebSocket.CLOSED;
    if (sock.onclose) sock.onclose();
    await flush();

    assert.notEqual(client._reconnectTimeout, null, 'an unexpected close must arm a reconnect timer');

    client.disconnect();
  });

  // -------------------------------------------------------------------------
  // BUG-MED: switching api-url must disconnect the OLD per-URL client so its
  // socket does not leak. Drives the REAL attributeChangedCallback source path.
  // Old source: _teardownApiListeners() + _setupApi() + connect() -- the old
  //   client's socket stays open (leak). RED.
  // Fixed source: oldApi.disconnect() closes the old socket. GREEN.
  // -------------------------------------------------------------------------
  test('BUG-MED: switching api-url closes the old client socket (no leak)', async () => {
    LokiApiClient.clearInstances();
    wsConstructed = [];

    // Build a component instance without invoking the custom-element upgrade
    // machinery: create a bare object over the real prototype and initialise the
    // fields attributeChangedCallback / _setupApi / _teardownApiListeners touch.
    const el = Object.create(LokiOverview.prototype);
    el._data = { connected: false, status: 'offline' };
    el._api = null;
    el._statusUpdateHandler = null;
    el._connectedHandler = null;
    el._disconnectedHandler = null;
    // Stub the DOM/render surface the callback reaches into.
    el.render = () => {};
    el._loadStatus = () => {};
    let currentUrl = 'http://127.0.0.1:59010';
    el.getAttribute = (n) => (n === 'api-url' ? currentUrl : null);

    // Initial setup + connect for project A (mirrors connectedCallback).
    el._setupApi();
    const clientA = el._api;
    await clientA.connect();
    await flush();
    const clientASocket = clientA._ws;
    assert.ok(clientASocket, 'client A has an open socket after connect');
    assert.equal(clientASocket.closed, false, 'client A socket open before switch');

    // Switch to project B via the REAL attributeChangedCallback.
    currentUrl = 'http://127.0.0.1:59011';
    el.attributeChangedCallback('api-url', 'http://127.0.0.1:59010', currentUrl);
    await flush();

    assert.notEqual(el._api, clientA, 'a different per-URL client is adopted on switch');
    assert.equal(
      clientASocket.closed,
      true,
      'OLD client socket must be closed on project switch (old code leaked it)'
    );
    assert.equal(clientA._ws, null, 'old client _ws cleared after disconnect');
    assert.equal(clientA._reconnectTimeout, null, 'old client reconnect timer cleared');

    // Fail-safe: an identical-URL "switch" must NOT sever the client we adopted.
    const clientB = el._api;
    await clientB.connect();
    await flush();
    const clientBSocket = clientB._ws;
    el.attributeChangedCallback('api-url', 'http://127.0.0.1:59011', 'http://127.0.0.1:59011');
    await flush();
    // oldValue === newValue returns early; the adopted client stays live.
    assert.equal(el._api, clientB, 'identical-URL callback keeps the same client');
    assert.equal(clientBSocket.closed, false, 'identical-URL switch must not close the live socket');

    el._api.disconnect();
    LokiApiClient.clearInstances();
  });
}
