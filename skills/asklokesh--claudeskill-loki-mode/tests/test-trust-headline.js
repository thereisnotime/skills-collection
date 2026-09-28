'use strict';

/**
 * S-148: dashboard/static/trust.html showed "Stable: no significant change"
 * even when every axis was insufficient (not enough history). The headline
 * choice is now a named function, trustHeadline(d), extracted here (via a
 * brace-balanced source slice, not a DOM/browser) and run against fixture
 * API-shaped data:
 *   - every axis insufficient/unavailable -> "Not enough history yet."
 *   - a real flat axis (data present, direction genuinely flat) -> "Stable"
 *
 * Run: node tests/test-trust-headline.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var HTML_PATH = path.join(__dirname, '..', 'dashboard', 'static', 'trust.html');

function extractFunctionSource(html, name) {
  var marker = 'function ' + name;
  var start = html.indexOf(marker);
  if (start === -1) throw new Error(marker + ' not found in ' + HTML_PATH);
  var braceOpen = html.indexOf('{', start);
  if (braceOpen === -1) throw new Error('no opening brace for ' + name);
  var depth = 0;
  for (var i = braceOpen; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces extracting ' + name);
}

function loadTrustHeadline() {
  var html = fs.readFileSync(HTML_PATH, 'utf8');
  var axisOrderMatch = html.match(/var AXIS_ORDER = \[[^\]]*\];/);
  if (!axisOrderMatch) throw new Error('AXIS_ORDER not found in ' + HTML_PATH);
  var src = axisOrderMatch[0] + '\n' +
    extractFunctionSource(html, 'trustHeadline') + '\n' +
    'trustHeadline;';
  return vm.runInNewContext(src, {}, { filename: 'trust.html (extracted)' });
}

var trustHeadline = loadTrustHeadline();

var failures = 0;
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    failures++;
    console.error('FAIL: ' + msg + ' -- expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  } else {
    console.log('PASS: ' + msg);
  }
}

function axis(overrides) {
  return Object.assign({ available: true, insufficient: false, direction: 'flat', improving: null }, overrides);
}

// Fixture 1: every axis insufficient (per-axis, even though overall runs_count
// could be >=2 -- e.g. each axis only ever had 1 non-null point). This is the
// exact bug: the old code fell through to "Stable" here.
assertEqual(trustHeadline({
  axes: {
    council_pass_rate: axis({ insufficient: true }),
    gate_pass_rate: axis({ insufficient: true }),
    iterations: axis({ insufficient: true }),
    interventions: axis({ available: false })
  },
  improving_count: 0,
  regressing_count: 0
}), 'Not enough history yet.', 'all axes insufficient/unavailable');

// Fixture 2: real flat axes (data present, genuinely no change) must still
// say Stable, not be swallowed by the insufficient-history message.
assertEqual(trustHeadline({
  axes: {
    council_pass_rate: axis(),
    gate_pass_rate: axis(),
    iterations: axis(),
    interventions: axis()
  },
  improving_count: 0,
  regressing_count: 0
}), 'Stable: no significant change across axes yet.', 'real flat axes stay Stable');

// Fixture 3: insufficient mixed with flat -> still Stable (at least one axis
// has real data, so it is not "no history").
assertEqual(trustHeadline({
  axes: {
    council_pass_rate: axis({ insufficient: true }),
    gate_pass_rate: axis(),
    iterations: axis({ insufficient: true }),
    interventions: axis({ available: false })
  },
  improving_count: 0,
  regressing_count: 0
}), 'Stable: no significant change across axes yet.', 'mixed insufficient + one real flat axis');

// Fixture 4: a real improving axis is reported, unaffected by the fix.
assertEqual(trustHeadline({
  axes: {
    council_pass_rate: axis({ direction: 'up', improving: true }),
    gate_pass_rate: axis(),
    iterations: axis(),
    interventions: axis({ available: false })
  },
  improving_count: 1,
  regressing_count: 0
}), 'Trending more trustworthy: 1 axis improving, none regressing on this repo.', 'real improving axis unaffected');

if (failures > 0) {
  console.error(failures + ' failure(s)');
  process.exit(1);
}
console.log('All trust-headline tests passed.');
