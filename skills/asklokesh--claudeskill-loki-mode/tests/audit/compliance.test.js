'use strict';
var test = require('node:test');
var assert = require('node:assert');
var compliance = require('../../src/audit/compliance');

function makeEntries() {
  return [
    { seq: 0, timestamp: '2026-01-01T00:00:00Z', who: 'agent-1', what: 'agent_start', hash: 'h0' },
    { seq: 1, timestamp: '2026-01-01T00:01:00Z', who: 'agent-1', what: 'file_write', where: 'src/app.js', hash: 'h1' },
    { seq: 2, timestamp: '2026-01-01T00:02:00Z', who: 'agent-1', what: 'test_run', hash: 'h2' },
    { seq: 3, timestamp: '2026-01-01T00:03:00Z', who: 'agent-2', what: 'deploy', hash: 'h3' },
    { seq: 4, timestamp: '2026-01-01T00:04:00Z', who: 'agent-1', what: 'command_execute', hash: 'h4' },
    { seq: 5, timestamp: '2026-01-01T00:05:00Z', who: 'agent-2', what: 'agent_stop', hash: 'h5' },
  ];
}

// --- SOC 2 ---

test('SOC2 report - structure', function () {
  var entries = makeEntries();
  var report = compliance.generateSoc2Report(entries);
  assert.equal(report.reportType, 'SOC2_TYPE_II');
  assert.equal(report.totalAuditEntries, 6);
  assert.ok(report.generatedAt);
  assert.ok(report.controls);
  assert.equal(report.chainIntegrity, null);
});

test('SOC2 report - control evidence mapping', function () {
  var entries = makeEntries();
  var report = compliance.generateSoc2Report(entries);
  assert.ok(report.controls.CC6_1.evidenceCount > 0);
  assert.ok(report.controls.CC6_2.evidenceCount > 0);
  assert.ok(report.controls.CC6_3.evidenceCount > 0);
  assert.ok(report.controls.CC8_1.evidenceCount > 0);
  assert.ok(report.controls.CC7_1.evidenceCount > 0);
});

test('SOC2 report - sample entries capped at 5', function () {
  var entries = [];
  for (var i = 0; i < 20; i++) {
    entries.push({ seq: i, timestamp: '2026-01-01T00:00:00Z', who: 'a', what: 'file_write', hash: 'h' + i });
  }
  var report = compliance.generateSoc2Report(entries);
  assert.ok(report.controls.CC6_3.sampleEntries.length <= 5);
  assert.equal(report.controls.CC6_3.evidenceCount, 20);
});

test('SOC2 report - custom options', function () {
  var report = compliance.generateSoc2Report([], { projectName: 'TestProject', period: 'Q1 2026' });
  assert.equal(report.projectName, 'TestProject');
  assert.equal(report.period, 'Q1 2026');
  assert.equal(report.totalAuditEntries, 0);
});

test('SOC2 report - empty entries', function () {
  var report = compliance.generateSoc2Report([]);
  assert.equal(report.totalAuditEntries, 0);
  Object.keys(report.controls).forEach(function (id) {
    assert.equal(report.controls[id].evidenceCount, 0);
    assert.equal(report.controls[id].sampleEntries.length, 0);
  });
});

// --- ISO 27001 ---

test('ISO27001 report - structure', function () {
  var entries = makeEntries();
  var report = compliance.generateIso27001Report(entries);
  assert.equal(report.reportType, 'ISO27001');
  assert.equal(report.totalAuditEntries, 6);
  assert.ok(report.controls['A.9.2']);
  assert.ok(report.controls['A.12.4']);
  assert.ok(report.controls['A.12.5']);
  assert.ok(report.controls['A.14.2']);
});

test('ISO27001 report - control evidence mapping', function () {
  var entries = makeEntries();
  var report = compliance.generateIso27001Report(entries);
  assert.ok(report.controls['A.9.2'].evidenceCount > 0);
  assert.ok(report.controls['A.12.4'].evidenceCount > 0);
  assert.ok(report.controls['A.12.5'].evidenceCount > 0);
  assert.ok(report.controls['A.14.2'].evidenceCount > 0);
});

// --- GDPR ---

test('GDPR report - structure', function () {
  var entries = makeEntries();
  var report = compliance.generateGdprReport(entries);
  assert.equal(report.reportType, 'GDPR_DATA_PROCESSING_RECORD');
  assert.ok(report.dataSubjects.length > 0);
  assert.ok(report.processingActivities.length > 0);
  assert.ok(report.securityMeasures.length > 0);
  assert.ok(report.purposes.length > 0);
});

test('GDPR report - data subjects extracted', function () {
  var entries = makeEntries();
  var report = compliance.generateGdprReport(entries);
  var ids = report.dataSubjects.map(function (s) { return s.id; });
  assert.ok(ids.includes('agent-1'));
  assert.ok(ids.includes('agent-2'));
});

test('GDPR report - data categories from metadata', function () {
  var entries = [
    { seq: 0, who: 'a', what: 'file_write', metadata: { dataType: 'source_code', containsPii: true } },
  ];
  var report = compliance.generateGdprReport(entries);
  assert.ok(report.dataCategories.includes('source_code'));
  assert.ok(report.dataCategories.includes('personal_data'));
});

test('GDPR report - custom options', function () {
  var report = compliance.generateGdprReport([], {
    projectName: 'TestProject',
    controller: 'Acme Corp',
    retentionDays: 90,
  });
  assert.equal(report.projectName, 'TestProject');
  assert.equal(report.controller, 'Acme Corp');
  assert.equal(report.retentionPolicy, '90 days');
});

// --- Export ---

test('exportReportJson - valid JSON output', function () {
  var report = compliance.generateSoc2Report([]);
  var json = compliance.exportReportJson(report);
  var parsed = JSON.parse(json);
  assert.equal(parsed.reportType, 'SOC2_TYPE_II');
});

// --- Constants exported ---

test('control constants are exported', function () {
  assert.ok(compliance.SOC2_CONTROLS);
  assert.ok(compliance.ISO27001_CONTROLS);
  assert.ok(compliance.ACTION_TO_SOC2);
  assert.ok(compliance.ACTION_TO_ISO);
  assert.ok(Object.keys(compliance.SOC2_CONTROLS).length > 0);
  assert.ok(Object.keys(compliance.ISO27001_CONTROLS).length > 0);
});
