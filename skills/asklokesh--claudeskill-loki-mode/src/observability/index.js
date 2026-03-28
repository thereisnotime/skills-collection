'use strict';

/**
 * Loki Mode OpenTelemetry Observability - Public API
 *
 * Single entry point that conditionally loads the full OTEL implementation
 * based on the LOKI_OTEL_ENDPOINT environment variable.
 *
 * When LOKI_OTEL_ENDPOINT is NOT set:
 *   - Returns no-op implementations of all functions
 *   - ZERO overhead: no imports, no setup, no background threads
 *
 * When LOKI_OTEL_ENDPOINT IS set:
 *   - Lazily loads otel.js, spans.js, metrics.js
 *   - Configures OTLP export to the specified endpoint
 *
 * Usage:
 *   const { trace, metrics } = require('./src/observability');
 *   const span = trace.startProjectSpan('my-project');
 *   metrics.recordTaskDuration(1.5, { taskType: 'build' });
 *   span.end();
 */

// -------------------------------------------------------------------
// No-op span (used when OTEL is disabled)
// -------------------------------------------------------------------

const NOOP_SPAN = {
  traceId: '00000000000000000000000000000000',
  spanId: '0000000000000000',
  parentSpanId: '',
  name: 'noop',
  attributes: {},
  setAttribute: function () { return NOOP_SPAN; },
  setStatus: function () { return NOOP_SPAN; },
  end: function () {},
  traceparent: function () { return '00-00000000000000000000000000000000-0000000000000000-00'; },
};

// -------------------------------------------------------------------
// No-op trace functions
// -------------------------------------------------------------------

const noopTrace = {
  startProjectSpan: function () { return NOOP_SPAN; },
  startTaskSpan: function () { return NOOP_SPAN; },
  startRARVSpan: function () { return NOOP_SPAN; },
  startQualityGateSpan: function () { return NOOP_SPAN; },
  startAgentSpan: function () { return NOOP_SPAN; },
  startCouncilSpan: function () { return NOOP_SPAN; },
};

// -------------------------------------------------------------------
// No-op metrics functions
// -------------------------------------------------------------------

const noopMetrics = {
  initMetrics: function () { return {}; },
  getMetrics: function () { return null; },
  recordTaskDuration: function () {},
  recordQualityGateResult: function () {},
  setActiveAgents: function () {},
  recordTokensConsumed: function () {},
  setCouncilApprovalRate: function () {},
  flushMetrics: function () {},
  resetMetrics: function () {},
};

// -------------------------------------------------------------------
// Conditional loading
// -------------------------------------------------------------------

let _trace = null;
let _metrics = null;
let _otel = null;
let _enabled = false;

function _loadFull() {
  if (_trace) return; // already loaded

  _otel = require('./otel');
  _otel.initialize();

  const spans = require('./spans');
  const metricsModule = require('./metrics');

  _trace = {
    startProjectSpan: spans.startProjectSpan,
    startTaskSpan: spans.startTaskSpan,
    startRARVSpan: spans.startRARVSpan,
    startQualityGateSpan: spans.startQualityGateSpan,
    startAgentSpan: spans.startAgentSpan,
    startCouncilSpan: spans.startCouncilSpan,
  };

  _metrics = metricsModule;
  metricsModule.initMetrics();
  _enabled = true;
}

/**
 * Check if OTEL is enabled (LOKI_OTEL_ENDPOINT is set).
 */
function isEnabled() {
  return _enabled;
}

/**
 * Shutdown the OTEL system, flushing pending data.
 */
function shutdown() {
  if (_otel) {
    _otel.shutdown();
  }
  _trace = null;
  _metrics = null;
  _otel = null;
  _enabled = false;
}

// -------------------------------------------------------------------
// Module initialization: check env var at load time
// -------------------------------------------------------------------

if (process.env.LOKI_OTEL_ENDPOINT) {
  _loadFull();
}

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

module.exports = {
  get trace() {
    return _trace || noopTrace;
  },
  get metrics() {
    return _metrics || noopMetrics;
  },
  isEnabled,
  shutdown,
  NOOP_SPAN,
};

