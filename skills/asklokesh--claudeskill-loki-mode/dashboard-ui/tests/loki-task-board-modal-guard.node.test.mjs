/**
 * Regression coverage for the wave-4 HIGH modal-render crash.
 *
 * Run: node --test tests/loki-task-board-modal-guard.node.test.mjs
 *
 * Bug: _renderTaskDetailModal did
 *        const criteria = task.acceptance_criteria || [];
 *        const contextFiles = task.context_files || [];
 *      with NO Array.isArray guard, then criteria.map(...) / contextFiles.map(...).
 *      The /api/tasks endpoint copies acceptance_criteria (and context_files)
 *      from the user/agent-written dashboard-state.json / queue files with only a
 *      not-empty / truthy filter, so a STRING survives to the client. A string
 *      has a truthy .length so the `criteria.length > 0` branch is taken, and
 *      then String.prototype has no .map -> "criteria.map is not a function"
 *      throws and the detail modal render blows up. The sibling notes/logs are
 *      already Array.isArray-guarded; this was an inconsistent oversight.
 *
 * Fix: coerce non-arrays to [] the same way notes/logs do.
 *
 * This test drives the REAL _renderTaskDetailModal from the shipped source
 * (via the prototype, so no constructor / DOM element is needed). It asserts:
 *   - a STRING acceptance_criteria / context_files renders without throwing and
 *     omits the corresponding section (graceful empty render);
 *   - a real ARRAY still renders the section with its items.
 * Against the pre-fix source it goes RED (the string case throws); against the
 * fixed source it passes. Both directions were verified during development.
 *
 * Self-skips if jsdom is unavailable so it never blocks a lean environment.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('[skip] jsdom not installed; skipping modal-guard regression test');
  // node:test has no top-level skip; register a single skipped test and exit.
  test('modal-guard regression (skipped: jsdom absent)', { skip: true }, () => {});
}

if (JSDOM) {
  // --- jsdom bootstrap (must precede the module import) ----------------------
  // The component module chains through loki-theme (LokiElement extends
  // HTMLElement) and calls customElements.define at load, and the api-client /
  // state modules reference WebSocket + localStorage. Provide all of it so the
  // import does not throw. None of these are touched by _renderTaskDetailModal
  // itself -- it only reads `task` and calls prototype helpers.
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

  // Drive the real method without invoking the constructor (which would call
  // getState()/getApiClient()). _renderTaskDetailModal references only
  // this._escapeHtml / this._renderMarkdown / this._formatTimestamp /
  // this._phaseClass / this._logLevelClass -- all prototype methods -- and no
  // instance fields, so a bare prototype-backed object is a faithful driver.
  const board = Object.create(LokiTaskBoard.prototype);
  const renderModal = (task) => LokiTaskBoard.prototype._renderTaskDetailModal.call(board, task);

  // ==========================================================================
  // The crash repro: a STRING where an array is expected must not throw.
  // ==========================================================================
  test('string acceptance_criteria renders without throwing and omits the section', () => {
    let html;
    assert.doesNotThrow(() => {
      html = renderModal({
        id: 1,
        title: 'String criteria task',
        acceptance_criteria: 'a string',
      });
    }, 'a string acceptance_criteria must not throw (was: criteria.map is not a function)');
    assert.equal(typeof html, 'string');
    assert.ok(!html.includes('Acceptance Criteria'),
      'a non-array acceptance_criteria must render as empty (section omitted)');
  });

  test('string context_files renders without throwing and omits the section', () => {
    let html;
    assert.doesNotThrow(() => {
      html = renderModal({
        id: 2,
        title: 'String context task',
        context_files: 'x',
      });
    }, 'a string context_files must not throw (was: contextFiles.map is not a function)');
    assert.equal(typeof html, 'string');
    assert.ok(!html.includes('Context Files'),
      'a non-array context_files must render as empty (section omitted)');
  });

  test('both fields as strings at once still render safely', () => {
    let html;
    assert.doesNotThrow(() => {
      html = renderModal({
        id: 3,
        title: 'Both strings',
        acceptance_criteria: 'a string',
        context_files: 'x',
      });
    });
    assert.ok(!html.includes('Acceptance Criteria'));
    assert.ok(!html.includes('Context Files'));
  });

  // ==========================================================================
  // No regression: real arrays still render their sections and items.
  // ==========================================================================
  test('array acceptance_criteria still renders the section with its items', () => {
    const html = renderModal({
      id: 4,
      title: 'Real criteria',
      acceptance_criteria: ['first criterion', { text: 'second criterion', done: true }],
    });
    assert.ok(html.includes('Acceptance Criteria'), 'array must render the section');
    assert.ok(html.includes('first criterion'), 'string item rendered');
    assert.ok(html.includes('second criterion'), 'object item text rendered');
  });

  test('array context_files still renders the section with its items', () => {
    const html = renderModal({
      id: 5,
      title: 'Real context',
      context_files: ['src/a.js', 'src/b.js'],
    });
    assert.ok(html.includes('Context Files'), 'array must render the section');
    assert.ok(html.includes('src/a.js'), 'context file item rendered');
    assert.ok(html.includes('src/b.js'), 'context file item rendered');
  });

  // Other non-array shapes must also be coerced, not crash.
  test('object / number / null acceptance_criteria coerce to empty without throwing', () => {
    for (const bad of [{ nope: true }, 42, null, undefined, true]) {
      let html;
      assert.doesNotThrow(() => {
        html = renderModal({ id: 6, title: 'Weird', acceptance_criteria: bad, context_files: bad });
      }, `acceptance_criteria=${JSON.stringify(bad)} must not throw`);
      assert.ok(!html.includes('Acceptance Criteria'));
      assert.ok(!html.includes('Context Files'));
    }
  });
}
