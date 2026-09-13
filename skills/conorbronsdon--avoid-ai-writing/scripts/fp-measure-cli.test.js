#!/usr/bin/env node
/* Tests for scripts/fp-measure.js CLI option validation — run by `npm test`. */
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, 'fp-measure.js');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

// Invalid invocations must exit with code 2, write stderr naming accepted values, and emit no stdout JSON
const invalidCases = [
  ['--unit typo', ['--unit', 'typo']],
  ['--unit typo --json', ['--unit', 'typo', '--json']],
  ['trailing --unit', ['--unit']],
  ['--unit --json', ['--unit', '--json']],
  ['--unit=document equals syntax', ['--unit=document']],
  ['--unit paragraph --unit typo', ['--unit', 'paragraph', '--unit', 'typo']],
  ['--unit paragraph --unit document', ['--unit', 'paragraph', '--unit', 'document']],
  ['--unit paragraph --unit trailing', ['--unit', 'paragraph', '--unit']],
];

for (const [label, args] of invalidCases) {
  const res = run(args);
  assert.strictEqual(res.status, 2, `${label}: expected exit status 2`);
  assert.strictEqual(res.stdout, '', `${label}: expected empty stdout`);
  assert.ok(res.stderr.includes('paragraph'), `${label}: expected stderr to name "paragraph"`);
  assert.ok(res.stderr.includes('document'), `${label}: expected stderr to name "document"`);
}

// Valid invocations exit with code 0 and report correct unit in JSON
const validCases = [
  ['default unit (omitted)', ['--json'], 'paragraph'],
  ['explicit paragraph', ['--unit', 'paragraph', '--json'], 'paragraph'],
  ['explicit document', ['--unit', 'document', '--json'], 'document'],
];

for (const [label, args, expectedUnit] of validCases) {
  const res = run(args);
  assert.strictEqual(res.status, 0, `${label}: expected exit status 0, stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.unit, expectedUnit, `${label}: expected unit ${expectedUnit}`);
}

console.log('fp-measure cli: ok');
