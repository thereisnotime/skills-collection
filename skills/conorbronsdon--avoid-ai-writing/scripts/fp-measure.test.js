#!/usr/bin/env node
/* Focused statistical-helper tests for `npm test`. */
'use strict';
const assert = require('assert');
const { wilson, rocAuc } = require('./fp-measure.js');

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; process.stdout.write(`  ✓ ${name}\n`); };
const close = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) <= 1e-12, `${message}: expected ${expected}, got ${actual}`);
};

t('wilson handles empty, boundary, and middle samples with z=2', () => {
  const cases = [
    [0, 0, [0, 0]],
    [0, 4, [0, 0.5]],
    [4, 4, [0.5, 1]],
    [2, 4, [0.1464466094067262, 0.8535533905932737]],
  ];
  for (const [successes, n, expected] of cases) {
    const actual = wilson(successes, n, 2);
    assert.strictEqual(actual.length, 2);
    actual.forEach((bound) => assert.ok(bound >= 0 && bound <= 1, `${successes}/${n} bound ${bound} is outside [0, 1]`));
    close(actual[0], expected[0], `${successes}/${n} lower`);
    close(actual[1], expected[1], `${successes}/${n} upper`);
  }
});

t('rocAuc credits separation, inversion, ties, and empty classes correctly', () => {
  assert.strictEqual(rocAuc([2, 3], [0, 1]), 1);
  assert.strictEqual(rocAuc([0, 1], [2, 3]), 0);
  assert.strictEqual(rocAuc([1, 1], [1, 1]), 0.5);
  assert.strictEqual(rocAuc([1, 2], [0, 1]), 0.875);
  assert.strictEqual(rocAuc([], [0, 1]), null);
  assert.strictEqual(rocAuc([0, 1], []), null);
});

process.stdout.write(`\n${passed} fp-measure helper tests passed\n`);
