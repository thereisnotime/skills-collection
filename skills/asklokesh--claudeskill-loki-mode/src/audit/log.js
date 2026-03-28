'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_MEMORY_ENTRIES = 1000;
const HASH_ALGO = 'sha256';

class AuditLog {
  constructor(opts) {
    const projectDir = (opts && opts.projectDir) || process.cwd();
    this._logDir = (opts && opts.logDir) || path.join(projectDir, '.loki', 'audit');
    this._logFile = path.join(this._logDir, 'audit.jsonl');
    this._entries = [];
    this._lastHash = 'GENESIS';
    this._entryCount = 0;
    this._loadChainTip();
  }

  record(entry) {
    if (!entry || !entry.who || !entry.what) {
      throw new Error('Audit entry requires at least "who" and "what" fields');
    }
    var auditEntry = {
      seq: this._entryCount,
      timestamp: new Date().toISOString(),
      who: String(entry.who),
      what: String(entry.what),
      where: entry.where ? String(entry.where) : null,
      why: entry.why ? String(entry.why) : null,
      metadata: entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : null,
      previousHash: this._lastHash,
      hash: null,
    };
    auditEntry.hash = this._computeHash(auditEntry);
    this._lastHash = auditEntry.hash;
    this._entryCount++;
    this._entries.push(auditEntry);
    if (this._entries.length >= MAX_MEMORY_ENTRIES) {
      this.flush();
    }
    return auditEntry;
  }

  flush() {
    if (this._entries.length === 0) return;
    if (!fs.existsSync(this._logDir)) {
      fs.mkdirSync(this._logDir, { recursive: true });
    }
    var lines = this._entries.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n';
    fs.appendFileSync(this._logFile, lines, 'utf8');
    this._entries = [];
  }

  verifyChain() {
    this.flush();
    if (!fs.existsSync(this._logFile)) {
      return { valid: true, entries: 0, brokenAt: null, error: null };
    }
    var content = fs.readFileSync(this._logFile, 'utf8').trim();
    if (!content) {
      return { valid: true, entries: 0, brokenAt: null, error: null };
    }
    var lines = content.split('\n');
    var expectedPrevHash = 'GENESIS';
    var count = 0;
    for (var i = 0; i < lines.length; i++) {
      var entry;
      try { entry = JSON.parse(lines[i]); } catch (e) {
        return { valid: false, entries: count, brokenAt: i, error: 'Invalid JSON at line ' + i };
      }
      if (entry.previousHash !== expectedPrevHash) {
        return { valid: false, entries: count, brokenAt: i,
          error: 'Hash chain broken at entry ' + i };
      }
      var computedHash = this._computeHash(entry);
      if (computedHash !== entry.hash) {
        return { valid: false, entries: count, brokenAt: i,
          error: 'Hash mismatch at entry ' + i + ': entry has been tampered with' };
      }
      expectedPrevHash = entry.hash;
      count++;
    }
    return { valid: true, entries: count, brokenAt: null, error: null };
  }

  readEntries(filter) {
    this.flush();
    if (!fs.existsSync(this._logFile)) return [];
    var content = fs.readFileSync(this._logFile, 'utf8').trim();
    if (!content) return [];
    var entries = content.split('\n').map(function (line) {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
    if (filter) {
      if (filter.who) entries = entries.filter(function (e) { return e.who === filter.who; });
      if (filter.what) entries = entries.filter(function (e) { return e.what === filter.what; });
      if (filter.since) entries = entries.filter(function (e) { return e.timestamp >= filter.since; });
      if (filter.until) entries = entries.filter(function (e) { return e.timestamp <= filter.until; });
    }
    return entries;
  }

  getSummary() {
    var entries = this.readEntries();
    var actors = {};
    var actions = {};
    for (var i = 0; i < entries.length; i++) {
      actors[entries[i].who] = true;
      actions[entries[i].what] = true;
    }
    return {
      totalEntries: entries.length,
      actors: Object.keys(actors),
      actions: Object.keys(actions),
      firstEntry: entries.length > 0 ? entries[0].timestamp : null,
      lastEntry: entries.length > 0 ? entries[entries.length - 1].timestamp : null,
    };
  }

  destroy() {
    this.flush();
    this._entries = [];
  }

  _computeHash(entry) {
    var data = JSON.stringify({
      seq: entry.seq, timestamp: entry.timestamp, who: entry.who,
      what: entry.what, where: entry.where, why: entry.why,
      metadata: entry.metadata, previousHash: entry.previousHash,
    });
    return crypto.createHash(HASH_ALGO).update(data).digest('hex');
  }

  _loadChainTip() {
    if (!fs.existsSync(this._logFile)) return;
    try {
      var content = fs.readFileSync(this._logFile, 'utf8').trim();
      if (!content) return;
      var lines = content.split('\n');
      var lastLine = lines[lines.length - 1];
      var lastEntry = JSON.parse(lastLine);
      this._lastHash = lastEntry.hash;
      this._entryCount = (lastEntry.seq || 0) + 1;
    } catch (_) {
      console.warn('[audit] Warning: corrupted chain tip detected, starting fresh chain');
      this._chainCorrupted = true;
    }
  }
}

module.exports = { AuditLog, HASH_ALGO, MAX_MEMORY_ENTRIES };
