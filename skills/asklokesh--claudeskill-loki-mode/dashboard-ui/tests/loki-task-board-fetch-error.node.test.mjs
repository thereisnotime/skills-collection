/**
 * S-168 (BACKLOG 114): a failed server task read must stay visible when local
 * tasks exist.
 *
 * Run: node --test dashboard-ui/tests/loki-task-board-fetch-error.node.test.mjs
 *
 * Bug: _loadTasks' catch refills _tasks with local tasks, and _buildContent
 * showed the error only when `this._error && this._tasks.length === 0`. Any
 * local task therefore hid the failure and the board looked complete.
 *
 * This drives the REAL _loadTasks and _buildContent from the shipped source on
 * a prototype-backed object (no constructor), with a rejecting api client.
 * Self-skips if jsdom is unavailable, like loki-task-board-modal-guard.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('[skip] jsdom not installed; skipping task-board fetch-error test');
  test('task-board fetch-error (skipped: jsdom absent)', { skip: true }, () => {});
}

if (JSDOM) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'http://localhost:57374',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.customElements = window.customElements;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Event = window.Event;
  globalThis.MutationObserver = window.MutationObserver;
  if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = window.WebSocket || class {};
  }
  const _store = new Map();
  const localStorageShim = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => { _store.set(k, String(v)); },
    removeItem: (k) => { _store.delete(k); },
    clear: () => { _store.clear(); },
  };
  Object.defineProperty(window, 'localStorage', { value: localStorageShim, configurable: true });
  globalThis.localStorage = localStorageShim;

  const { LokiTaskBoard } = await import('../components/loki-task-board.js');
  const BANNER = 'Server tasks could not be loaded; showing local tasks only';

  function makeBoard({ listTasks, localTasks }) {
    const board = Object.create(LokiTaskBoard.prototype);
    Object.assign(board, {
      _api: { listTasks },
      _state: { get: (k) => (k === 'localTasks' ? localTasks : undefined), update() {} },
      _tasks: [],
      _loading: false,
      _error: null,
      _activeFilter: 'all',
      _searchQuery: '',
      _bulkMode: false,
      _selectedTasks: new Set(),
      _expandedCards: new Set(),
      _visibleCounts: {},
      render() {},
      getAttribute: () => null,
      hasAttribute: () => false,
    });
    return board;
  }

  const failing = async () => { throw new Error('HTTP 500'); };
  const local = [{ id: 'local-1', title: 'My local task', status: 'pending' }];

  test('server failure with local tasks shows a banner above the local tasks', async () => {
    const board = makeBoard({ listTasks: failing, localTasks: local });
    await board._loadTasks();
    const html = board._buildContent();
    assert.ok(html.includes(BANNER), 'the load failure must stay visible when local tasks exist');
    assert.ok(html.includes('My local task'), 'local tasks still render');
    assert.ok(html.indexOf(BANNER) < html.indexOf('My local task'), 'banner sits above the tasks');
  });

  test('server failure with no local tasks keeps the full error state', async () => {
    const board = makeBoard({ listTasks: failing, localTasks: [] });
    await board._loadTasks();
    const html = board._buildContent();
    assert.ok(html.includes('HTTP 500'), 'the error message renders');
    assert.ok(!html.includes('kanban-board'), 'no empty board masquerades as complete');
  });

  test('successful server read shows no banner', async () => {
    const board = makeBoard({
      listTasks: async () => [{ id: 7, title: 'Server task', status: 'pending' }],
      localTasks: local,
    });
    await board._loadTasks();
    const html = board._buildContent();
    assert.ok(!html.includes(BANNER), 'no banner when the server read succeeded');
    assert.ok(html.includes('Server task') && html.includes('My local task'));
  });
}
