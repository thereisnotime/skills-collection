'use strict';

/**
 * Loki Mode Audit Trail - Public API
 *
 * Enterprise audit logging with tamper-evident hash chains,
 * compliance report generation, and data residency enforcement.
 *
 * Usage:
 *   var audit = require('./src/audit');
 *   audit.init('/path/to/project');
 *   audit.record({ who: 'agent-1', what: 'file_write', where: 'src/app.js', why: 'implement feature' });
 *   var result = audit.verifyChain();
 *   var report = audit.generateReport('soc2');
 *   var allowed = audit.checkProvider('anthropic', 'us');
 */

var { AuditLog } = require('./log');
var compliance = require('./compliance');
var { ResidencyController } = require('./residency');

var _log = null;
var _residency = null;
var _initialized = false;
var _projectDir = null;

/**
 * Initialize the audit trail system.
 */
function init(projectDir) {
  var dir = projectDir || process.cwd();
  if (_initialized && _projectDir === dir) return;
  if (_initialized) destroy();

  _projectDir = dir;
  _log = new AuditLog({ projectDir: dir });
  _residency = new ResidencyController({ projectDir: dir });
  _initialized = true;
}

/**
 * Record an audit entry.
 */
function record(entry) {
  if (!_initialized) init();
  return _log.record(entry);
}

/**
 * Verify the hash chain integrity.
 */
function verifyChain() {
  if (!_initialized) init();
  return _log.verifyChain();
}

/**
 * Generate a compliance report.
 * @param {string} type - 'soc2', 'iso27001', or 'gdpr'
 * @param {object} [opts] - Report options
 */
function generateReport(type, opts) {
  if (!_initialized) init();
  var entries = _log.readEntries();
  switch (type) {
    case 'soc2':
      return compliance.generateSoc2Report(entries, opts);
    case 'iso27001':
      return compliance.generateIso27001Report(entries, opts);
    case 'gdpr':
      return compliance.generateGdprReport(entries, opts);
    default:
      throw new Error('Unknown report type: ' + type + '. Supported: soc2, iso27001, gdpr');
  }
}

/**
 * Export a report as JSON string.
 */
function exportReport(type, opts) {
  var report = generateReport(type, opts);
  return compliance.exportReportJson(report);
}

/**
 * Check if a provider is allowed by data residency policy.
 */
function checkProvider(provider, region) {
  if (!_initialized) init();
  return _residency.checkProvider(provider, region);
}

/**
 * Check if air-gapped mode is enabled.
 */
function isAirGapped() {
  if (!_initialized) init();
  return _residency.isAirGapped();
}

/**
 * Read filtered audit entries.
 */
function readEntries(filter) {
  if (!_initialized) init();
  return _log.readEntries(filter);
}

/**
 * Get audit log summary.
 */
function getSummary() {
  if (!_initialized) init();
  return _log.getSummary();
}

/**
 * Flush pending entries to disk.
 */
function flush() {
  if (_log) _log.flush();
}

/**
 * Destroy audit trail (for testing).
 */
function destroy() {
  if (_log) _log.destroy();
  _log = null;
  _residency = null;
  _initialized = false;
  _projectDir = null;
}

module.exports = {
  init: init,
  record: record,
  verifyChain: verifyChain,
  generateReport: generateReport,
  exportReport: exportReport,
  checkProvider: checkProvider,
  isAirGapped: isAirGapped,
  readEntries: readEntries,
  getSummary: getSummary,
  flush: flush,
  destroy: destroy,
};
