'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('otel-bridge.js - OTEL event bridge', () => {
  let bridge;
  let otel;
  let tmpDir;
  let pendingDir;
  const ORIGINAL_ENDPOINT = process.env.LOKI_OTEL_ENDPOINT;
  const ORIGINAL_LOKI_DIR = process.env.LOKI_DIR;
  const ORIGINAL_TRACE_ID = process.env.LOKI_TRACE_ID;

  beforeEach(() => {
    // Create a temp directory with the .loki/events/pending structure
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'otel-bridge-test-'));
    pendingDir = path.join(tmpDir, '.loki', 'events', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });

    // Set environment for OTEL
    process.env.LOKI_OTEL_ENDPOINT = 'http://localhost:4318';
    process.env.LOKI_DIR = path.join(tmpDir, '.loki');
    process.env.LOKI_TRACE_ID = 'abcdef0123456789abcdef0123456789';

    // Clear module caches
    delete require.cache[require.resolve('../../src/observability/otel')];
    delete require.cache[require.resolve('../../src/observability/otel-bridge')];

    otel = require('../../src/observability/otel');
  });

  afterEach(() => {
    // Shutdown bridge if loaded
    if (bridge) {
      try { bridge.shutdown(); } catch (_) { /* ignore */ }
      bridge = null;
    }

    // Shutdown otel
    if (otel && otel.isInitialized()) {
      otel.shutdown();
    }

    // Restore env
    if (ORIGINAL_ENDPOINT) {
      process.env.LOKI_OTEL_ENDPOINT = ORIGINAL_ENDPOINT;
    } else {
      delete process.env.LOKI_OTEL_ENDPOINT;
    }
    if (ORIGINAL_LOKI_DIR) {
      process.env.LOKI_DIR = ORIGINAL_LOKI_DIR;
    } else {
      delete process.env.LOKI_DIR;
    }
    if (ORIGINAL_TRACE_ID) {
      process.env.LOKI_TRACE_ID = ORIGINAL_TRACE_ID;
    } else {
      delete process.env.LOKI_TRACE_ID;
    }

    // Clean up temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }

    // Clear module caches
    delete require.cache[require.resolve('../../src/observability/otel')];
    delete require.cache[require.resolve('../../src/observability/otel-bridge')];
  });

  function writeEvent(filename, event) {
    fs.writeFileSync(path.join(pendingDir, filename), JSON.stringify(event));
  }

  function loadBridge() {
    // Must change cwd to tmpDir so bridge finds .loki relative to cwd
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    const bridgeModule = require('../../src/observability/otel-bridge');
    // Call start() to initialize OTEL and get bound functions
    bridge = bridgeModule.start();
    process.chdir(originalCwd);
    return bridge;
  }

  describe('iteration events', () => {
    it('should create a span on iteration_start', () => {
      writeEvent('001_iter_start.json', {
        type: 'iteration_start',
        payload: { action: 'start', iteration: '1', provider: 'claude' },
      });

      const b = loadBridge();
      b.processEventFile(path.join(pendingDir, '001_iter_start.json'));

      assert.ok(b.activeSpans.has('rarv.iteration.1'), 'should have active iteration span');
    });

    it('should end span on iteration_complete', () => {
      writeEvent('001_iter_start.json', {
        type: 'iteration_start',
        payload: { action: 'start', iteration: '2', provider: 'claude' },
      });
      writeEvent('002_iter_complete.json', {
        type: 'iteration_complete',
        payload: { action: 'complete', iteration: '2', status: 'completed', exit_code: '0' },
      });

      const b = loadBridge();
      b.processEventFile(path.join(pendingDir, '001_iter_start.json'));
      assert.ok(b.activeSpans.has('rarv.iteration.2'));

      b.processEventFile(path.join(pendingDir, '002_iter_complete.json'));
      assert.ok(!b.activeSpans.has('rarv.iteration.2'), 'span should be ended and removed');
    });
  });

  describe('otel_span events', () => {
    it('should create and end explicit OTEL spans', () => {
      writeEvent('001_span_start.json', {
        type: 'otel_span_start',
        payload: { span_name: 'rarv.phase.reason', iteration: '1', phase: 'reason' },
      });
      writeEvent('002_span_end.json', {
        type: 'otel_span_end',
        payload: { span_name: 'rarv.phase.reason', status: 'ok' },
      });

      const b = loadBridge();

      b.processEventFile(path.join(pendingDir, '001_span_start.json'));
      assert.ok(b.activeSpans.has('rarv.phase.reason'), 'should have active phase span');

      b.processEventFile(path.join(pendingDir, '002_span_end.json'));
      assert.ok(!b.activeSpans.has('rarv.phase.reason'), 'span should be ended');
    });

    it('should handle error status on span end', () => {
      writeEvent('001_span_start.json', {
        type: 'otel_span_start',
        payload: { span_name: 'test.span', action: 'ignored' },
      });
      writeEvent('002_span_end.json', {
        type: 'otel_span_end',
        payload: { span_name: 'test.span', status: 'error' },
      });

      const b = loadBridge();

      b.processEventFile(path.join(pendingDir, '001_span_start.json'));
      assert.ok(b.activeSpans.has('test.span'));

      b.processEventFile(path.join(pendingDir, '002_span_end.json'));
      assert.ok(!b.activeSpans.has('test.span'));
    });
  });

  describe('session events', () => {
    it('should create session span on session_start', () => {
      writeEvent('001_session.json', {
        type: 'session_start',
        payload: { action: 'start', provider: 'claude', prd: 'test.md' },
      });

      const b = loadBridge();
      b.processEventFile(path.join(pendingDir, '001_session.json'));

      assert.ok(b.activeSpans.has('loki.session'), 'should have active session span');
    });

    it('should end session span on session_end', () => {
      writeEvent('001_session_start.json', {
        type: 'session_start',
        payload: { action: 'start', provider: 'claude' },
      });
      writeEvent('002_session_end.json', {
        type: 'session_end',
        payload: { action: 'end', result: '0', iterations: '5' },
      });

      const b = loadBridge();

      b.processEventFile(path.join(pendingDir, '001_session_start.json'));
      assert.ok(b.activeSpans.has('loki.session'));

      b.processEventFile(path.join(pendingDir, '002_session_end.json'));
      assert.ok(!b.activeSpans.has('loki.session'), 'session span should be ended');
    });
  });

  describe('unknown events', () => {
    it('should silently ignore unknown event types', () => {
      writeEvent('001_unknown.json', {
        type: 'phase_change',
        payload: { action: 'change', phase: 'development' },
      });

      const b = loadBridge();
      // Should not throw
      b.processEventFile(path.join(pendingDir, '001_unknown.json'));
      assert.equal(b.activeSpans.size, 0, 'no spans created for unknown events');
    });

    it('should handle malformed JSON gracefully', () => {
      fs.writeFileSync(path.join(pendingDir, 'bad.json'), 'not valid json{{{');

      const b = loadBridge();
      // Should not throw
      b.processEventFile(path.join(pendingDir, 'bad.json'));
      assert.equal(b.activeSpans.size, 0);
    });

    it('should handle missing files gracefully', () => {
      const b = loadBridge();
      // Should not throw
      b.processEventFile(path.join(pendingDir, 'nonexistent.json'));
      assert.equal(b.activeSpans.size, 0);
    });
  });

  describe('shutdown', () => {
    it('should end all active spans on shutdown', () => {
      writeEvent('001_start.json', {
        type: 'otel_span_start',
        payload: { span_name: 'test.span.1' },
      });
      writeEvent('002_start.json', {
        type: 'otel_span_start',
        payload: { span_name: 'test.span.2' },
      });

      const b = loadBridge();
      b.processEventFile(path.join(pendingDir, '001_start.json'));
      b.processEventFile(path.join(pendingDir, '002_start.json'));
      assert.equal(b.activeSpans.size, 2);

      b.shutdown();
      assert.equal(b.activeSpans.size, 0, 'all spans should be cleared on shutdown');
    });
  });

  describe('trace ID', () => {
    it('should use LOKI_TRACE_ID from environment', () => {
      const b = loadBridge();
      assert.equal(b._getTraceId(), 'abcdef0123456789abcdef0123456789');
    });
  });

  describe('span end without start', () => {
    it('should silently ignore span end with no matching start', () => {
      writeEvent('001_end.json', {
        type: 'otel_span_end',
        payload: { span_name: 'nonexistent.span', status: 'ok' },
      });

      const b = loadBridge();
      // Should not throw
      b.processEventFile(path.join(pendingDir, '001_end.json'));
      assert.equal(b.activeSpans.size, 0);
    });
  });
});
