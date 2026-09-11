// A witness nobody reconciles is not a control.
//
// MEASURED on v9.29.0, before this fix: writeWitness recorded the honest tip,
// the chain was re-forged, and verifyUnified returned valid:true anyway.
// verifyWitnessFile only checks the witness file's own monotonicity; nothing
// compared a witnessed tip to the live chain. Wiring writeWitness without this
// reconciliation would have shipped security theatre.
//
// The agent chain hash is unkeyed over public fields from a constant genesis
// (src/audit/log.js:16,127-134), so verifyChain() cannot distinguish an honest
// chain from a recomputed one. A witness pins what the tip really was, which is
// the one thing a forger cannot retroactively change once it has left the
// machine. See docs/AUDIT-CHAIN-THREAT-MODEL.md.
//
// Case B is as important as case C: a guard that fires on honest growth gets
// disabled and then protects nothing.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const cross = require(path.join(REPO, 'src/audit/crosslink.js'));
const { AuditLog } = require(path.join(REPO, 'src/audit/log.js'));

let PASS = 0;
let FAIL = 0;
const made = [];

function ok(name) { PASS++; console.log('  PASS: ' + name); }
function bad(name, got, want) {
  FAIL++;
  console.log('  FAIL: ' + name + ' (got ' + JSON.stringify(got) +
              ', want ' + JSON.stringify(want) + ')');
}
function eq(name, got, want) { (got === want) ? ok(name) : bad(name, got, want); }

// Every fixture root is resolved with realpath: on macOS $TMPDIR lives under
// /var -> /private/var, and code that compares resolved paths refuses fixtures
// built on the unresolved one.
function fresh() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'witrec-'));
  // Scope the dashboard side to an empty dir. Without this the helper reads the
  // developer's REAL ~/.loki/dashboard chain (observed: 10,163 live entries),
  // which makes the test depend on machine state it does not control.
  const dash = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'witrec-dash-'));
  made.push(dir, dash);
  return { dir, opts: { projectDir: dir, dashboardAuditDir: dash, requireDashboard: false } };
}

function append(dir, label, n) {
  const log = new AuditLog({ projectDir: dir });
  for (let i = 0; i < n; i++) {
    log.record({ who: 'agent', what: label + ' ' + i, where: 'prod', why: 'test' });
  }
  log.flush();
  log.destroy();
}

function chainFile(dir) {
  return path.join(dir, '.loki', 'audit', 'audit.jsonl');
}

// Recompute a complete chain with the SAME public recipe the writer uses. No
// secret is required; that is the entire point.
function reforge(dir, count) {
  const hash = (e) => crypto.createHash('sha256').update(JSON.stringify({
    seq: e.seq, timestamp: e.timestamp, who: e.who, what: e.what,
    where: e.where, why: e.why, metadata: e.metadata, previousHash: e.previousHash,
  })).digest('hex');
  let prev = 'GENESIS';
  const rows = [];
  for (let i = 0; i < count; i++) {
    const e = {
      seq: i, timestamp: '2020-01-01T00:00:0' + i + '.000Z', who: 'agent',
      what: 'NEVER HAPPENED ' + i, where: 'prod', why: 'forged',
      metadata: null, previousHash: prev,
    };
    e.hash = hash(e);
    prev = e.hash;
    rows.push(JSON.stringify(e));
  }
  fs.writeFileSync(chainFile(dir), rows.join('\n') + '\n');
}

console.log('test-witness-reconciliation');

// A. No witness -> honest no_records, and the trail must not fail for it.
//    Absence of a witness is an absent measurement, not a failure.
{
  const { dir, opts } = fresh();
  append(dir, 'action', 2);
  const r = cross.verifyUnified(opts);
  eq('no witness: trail is still valid', r.valid, true);
  eq('no witness: reported as no_records', r.witnessedPrefix.state, 'no_records');
  eq('no witness: nothing claimed as checked', r.witnessedPrefix.witnessesChecked, 0);
}

// B. FALSE-POSITIVE CONTROL. The chain grows after a witness; that is normal
//    operation and must stay valid. Tip-equality would fail here, which is why
//    the comparison is prefix-based.
{
  const { dir, opts } = fresh();
  append(dir, 'early', 2);
  cross.writeWitness(opts);
  append(dir, 'later', 3);
  const r = cross.verifyUnified(opts);
  eq('honest growth after a witness stays valid', r.valid, true);
  eq('honest growth: reconciliation actually ran', r.witnessedPrefix.state, 'checked');
  eq('honest growth: one witness reconciled', r.witnessedPrefix.witnessesChecked, 1);
}

// C. THE ANCHOR CASE. Witnessed history rewritten. The chain still self-reports
//    valid, so asserting on r.agent.valid would MISS this entirely; the trail
//    verdict is what must go false.
{
  const { dir, opts } = fresh();
  append(dir, 'real', 2);
  cross.writeWitness(opts);
  reforge(dir, 2);

  const selfReport = new AuditLog({ projectDir: dir }).verifyChain();
  eq('re-forged chain STILL self-reports valid (the gap)', selfReport.valid, true);

  const r = cross.verifyUnified(opts);
  eq('re-forged witnessed history: trail is invalid', r.valid, false);
  eq('re-forge: names the rewritten entry', r.witnessedPrefix.rewrittenAt, 2);
}

// D. Truncation below the witnessed length.
{
  const { dir, opts } = fresh();
  append(dir, 'real', 3);
  cross.writeWitness(opts);
  const kept = fs.readFileSync(chainFile(dir), 'utf8').trim().split('\n').slice(0, 1);
  fs.writeFileSync(chainFile(dir), kept.join('\n') + '\n');
  const r = cross.verifyUnified(opts);
  eq('truncation below a witness: trail is invalid', r.valid, false);
}

// E. Multiple witnesses: a rewrite of the EARLIEST witnessed prefix is caught
//    even when later witnesses agree with the current chain.
{
  const { dir, opts } = fresh();
  append(dir, 'first', 2);
  cross.writeWitness(opts);
  append(dir, 'second', 2);
  cross.writeWitness(opts);
  reforge(dir, 4);
  const r = cross.verifyUnified(opts);
  eq('rewrite under multiple witnesses is caught', r.valid, false);
}

for (const d of made) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

console.log('  ' + PASS + ' passed, ' + FAIL + ' failed');
process.exit(FAIL === 0 ? 0 : 1);
