'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var os = require('os');
var { AuditLog } = require('../../src/audit/log');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loki-audit-test-'));
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

test('AuditLog - basic recording', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    var entry = log.record({ who: 'agent-1', what: 'file_write', where: 'src/app.js', why: 'implement feature' });
    assert.equal(entry.seq, 0);
    assert.equal(entry.who, 'agent-1');
    assert.equal(entry.what, 'file_write');
    assert.equal(entry.where, 'src/app.js');
    assert.equal(entry.previousHash, 'GENESIS');
    assert.ok(entry.hash);
    assert.ok(entry.timestamp);
    log.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - hash chain linkage', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    var e1 = log.record({ who: 'a', what: 'action1' });
    var e2 = log.record({ who: 'b', what: 'action2' });
    var e3 = log.record({ who: 'c', what: 'action3' });
    assert.equal(e1.previousHash, 'GENESIS');
    assert.equal(e2.previousHash, e1.hash);
    assert.equal(e3.previousHash, e2.hash);
    assert.notEqual(e1.hash, e2.hash);
    assert.notEqual(e2.hash, e3.hash);
    log.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - flush and verify chain', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    log.record({ who: 'a', what: 'x' });
    log.record({ who: 'b', what: 'y' });
    log.record({ who: 'c', what: 'z' });
    log.flush();
    var result = log.verifyChain();
    assert.equal(result.valid, true);
    assert.equal(result.entries, 3);
    assert.equal(result.brokenAt, null);
    log.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - detect tampering', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    log.record({ who: 'a', what: 'x' });
    log.record({ who: 'b', what: 'y' });
    log.flush();
    // Tamper with the log file
    var logFile = path.join(dir, 'audit.jsonl');
    var content = fs.readFileSync(logFile, 'utf8');
    var lines = content.trim().split('\n');
    var entry = JSON.parse(lines[0]);
    entry.who = 'tampered';
    lines[0] = JSON.stringify(entry);
    fs.writeFileSync(logFile, lines.join('\n') + '\n');
    // Verify detects tampering
    var log2 = new AuditLog({ logDir: dir });
    var result = log2.verifyChain();
    assert.equal(result.valid, false);
    assert.equal(result.brokenAt, 0);
    assert.ok(result.error.includes('tampered'));
    log2.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - detect chain break', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    log.record({ who: 'a', what: 'x' });
    log.record({ who: 'b', what: 'y' });
    log.record({ who: 'c', what: 'z' });
    log.flush();
    // Remove middle entry to break chain
    var logFile = path.join(dir, 'audit.jsonl');
    var content = fs.readFileSync(logFile, 'utf8');
    var lines = content.trim().split('\n');
    lines.splice(1, 1); // remove entry 1
    fs.writeFileSync(logFile, lines.join('\n') + '\n');
    var log2 = new AuditLog({ logDir: dir });
    var result = log2.verifyChain();
    assert.equal(result.valid, false);
    assert.equal(result.brokenAt, 1);
    log2.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - readEntries with filters', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    log.record({ who: 'agent-1', what: 'file_write' });
    log.record({ who: 'agent-2', what: 'command_execute' });
    log.record({ who: 'agent-1', what: 'deploy' });
    var all = log.readEntries();
    assert.equal(all.length, 3);
    var agent1 = log.readEntries({ who: 'agent-1' });
    assert.equal(agent1.length, 2);
    var deploys = log.readEntries({ what: 'deploy' });
    assert.equal(deploys.length, 1);
    log.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - getSummary', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    log.record({ who: 'a', what: 'file_write' });
    log.record({ who: 'b', what: 'deploy' });
    log.record({ who: 'a', what: 'test_run' });
    var summary = log.getSummary();
    assert.equal(summary.totalEntries, 3);
    assert.ok(summary.actors.includes('a'));
    assert.ok(summary.actors.includes('b'));
    assert.ok(summary.actions.includes('file_write'));
    assert.ok(summary.firstEntry);
    assert.ok(summary.lastEntry);
    log.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - persist and reload chain', function (t) {
  var dir = makeTmpDir();
  try {
    var log1 = new AuditLog({ logDir: dir });
    log1.record({ who: 'a', what: 'x' });
    log1.record({ who: 'b', what: 'y' });
    log1.flush();
    log1.destroy();
    // New instance should continue the chain
    var log2 = new AuditLog({ logDir: dir });
    var e3 = log2.record({ who: 'c', what: 'z' });
    assert.equal(e3.seq, 2);
    assert.notEqual(e3.previousHash, 'GENESIS');
    log2.flush();
    var result = log2.verifyChain();
    assert.equal(result.valid, true);
    assert.equal(result.entries, 3);
    log2.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - empty log verifies ok', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    var result = log.verifyChain();
    assert.equal(result.valid, true);
    assert.equal(result.entries, 0);
    log.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - requires who and what', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    assert.throws(function () { log.record({}); }, /who.*what/);
    assert.throws(function () { log.record({ who: 'a' }); }, /what/);
    assert.throws(function () { log.record(null); }, /who.*what/);
    log.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - metadata field', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    var entry = log.record({ who: 'a', what: 'deploy', metadata: { version: '1.0', env: 'prod' } });
    assert.deepStrictEqual(entry.metadata, { version: '1.0', env: 'prod' });
    log.flush();
    var entries = log.readEntries();
    assert.deepStrictEqual(entries[0].metadata, { version: '1.0', env: 'prod' });
    log.destroy();
  } finally { cleanup(dir); }
});

test('AuditLog - sequential numbering', function (t) {
  var dir = makeTmpDir();
  try {
    var log = new AuditLog({ logDir: dir });
    for (var i = 0; i < 10; i++) {
      var e = log.record({ who: 'a', what: 'x' });
      assert.equal(e.seq, i);
    }
    log.destroy();
  } finally { cleanup(dir); }
});
