'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var os = require('os');
var { ResidencyController } = require('../../src/audit/residency');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loki-residency-test-'));
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

function writeConfig(dir, config) {
  var lokiDir = path.join(dir, '.loki');
  fs.mkdirSync(lokiDir, { recursive: true });
  fs.writeFileSync(path.join(lokiDir, 'residency.json'), JSON.stringify(config));
}

// --- Default behavior ---

test('ResidencyController - default allows all providers', function () {
  var dir = makeTmpDir();
  try {
    var rc = new ResidencyController({ projectDir: dir });
    var result = rc.checkProvider('anthropic');
    assert.equal(result.allowed, true);
    assert.equal(result.reason, null);
  } finally { cleanup(dir); }
});

test('ResidencyController - default is not air-gapped', function () {
  var dir = makeTmpDir();
  try {
    var rc = new ResidencyController({ projectDir: dir });
    assert.equal(rc.isAirGapped(), false);
  } finally { cleanup(dir); }
});

// --- Provider restrictions ---

test('ResidencyController - allowed providers list', function () {
  var dir = makeTmpDir();
  try {
    writeConfig(dir, { allowed_providers: ['anthropic', 'ollama'] });
    var rc = new ResidencyController({ projectDir: dir });
    assert.equal(rc.checkProvider('anthropic').allowed, true);
    assert.equal(rc.checkProvider('ollama').allowed, true);
    assert.equal(rc.checkProvider('openai').allowed, false);
    assert.ok(rc.checkProvider('openai').reason.includes('not in allowed list'));
  } finally { cleanup(dir); }
});

test('ResidencyController - case insensitive provider check', function () {
  var dir = makeTmpDir();
  try {
    writeConfig(dir, { allowed_providers: ['anthropic'] });
    var rc = new ResidencyController({ projectDir: dir });
    assert.equal(rc.checkProvider('Anthropic').allowed, true);
    assert.equal(rc.checkProvider('ANTHROPIC').allowed, true);
  } finally { cleanup(dir); }
});

test('ResidencyController - requires provider name', function () {
  var dir = makeTmpDir();
  try {
    var rc = new ResidencyController({ projectDir: dir });
    assert.equal(rc.checkProvider(null).allowed, false);
    assert.equal(rc.checkProvider('').allowed, false);
    assert.equal(rc.checkProvider(undefined).allowed, false);
  } finally { cleanup(dir); }
});

// --- Region restrictions ---

test('ResidencyController - allowed regions', function () {
  var dir = makeTmpDir();
  try {
    writeConfig(dir, { allowed_regions: ['us', 'eu'] });
    var rc = new ResidencyController({ projectDir: dir });
    assert.equal(rc.checkProvider('anthropic', 'us').allowed, true);
    assert.equal(rc.checkProvider('anthropic', 'eu').allowed, true);
    assert.equal(rc.checkProvider('anthropic', 'asia').allowed, false);
    assert.ok(rc.checkProvider('anthropic', 'asia').reason.includes('not in allowed list'));
  } finally { cleanup(dir); }
});

test('ResidencyController - region not checked when no region given', function () {
  var dir = makeTmpDir();
  try {
    writeConfig(dir, { allowed_regions: ['us'] });
    var rc = new ResidencyController({ projectDir: dir });
    assert.equal(rc.checkProvider('anthropic').allowed, true);
  } finally { cleanup(dir); }
});

// --- Air-gapped mode ---

test('ResidencyController - air-gapped allows only local', function () {
  var dir = makeTmpDir();
  try {
    writeConfig(dir, { air_gapped: true });
    var rc = new ResidencyController({ projectDir: dir });
    assert.equal(rc.isAirGapped(), true);
    assert.equal(rc.checkProvider('ollama').allowed, true);
    assert.equal(rc.checkProvider('local').allowed, true);
    assert.equal(rc.checkProvider('anthropic').allowed, false);
    assert.equal(rc.checkProvider('openai').allowed, false);
    assert.ok(rc.checkProvider('anthropic').reason.includes('Air-gapped'));
  } finally { cleanup(dir); }
});

// --- Config override ---

test('ResidencyController - direct config override', function () {
  var rc = new ResidencyController({
    config: { allowed_providers: ['google'], allowed_regions: ['eu'], air_gapped: false },
  });
  assert.equal(rc.checkProvider('google', 'eu').allowed, true);
  assert.equal(rc.checkProvider('anthropic').allowed, false);
  assert.equal(rc.checkProvider('google', 'us').allowed, false);
});

// --- Accessor methods ---

test('ResidencyController - getConfig returns copy', function () {
  var rc = new ResidencyController({
    config: { allowed_providers: ['anthropic'], allowed_regions: ['us'], air_gapped: false },
  });
  var config = rc.getConfig();
  assert.deepStrictEqual(config.allowed_providers, ['anthropic']);
  config.allowed_providers.push('openai');
  assert.deepStrictEqual(rc.getConfig().allowed_providers, ['anthropic']);
});

test('ResidencyController - getAllowedProviders and getAllowedRegions', function () {
  var rc = new ResidencyController({
    config: { allowed_providers: ['anthropic', 'ollama'], allowed_regions: ['us', 'eu'], air_gapped: false },
  });
  assert.deepStrictEqual(rc.getAllowedProviders(), ['anthropic', 'ollama']);
  assert.deepStrictEqual(rc.getAllowedRegions(), ['us', 'eu']);
});

// --- Reload ---

test('ResidencyController - reload picks up changes', function () {
  var dir = makeTmpDir();
  try {
    writeConfig(dir, { allowed_providers: ['anthropic'] });
    var rc = new ResidencyController({ projectDir: dir });
    assert.equal(rc.checkProvider('openai').allowed, false);
    writeConfig(dir, { allowed_providers: ['anthropic', 'openai'] });
    rc.reload();
    assert.equal(rc.checkProvider('openai').allowed, true);
  } finally { cleanup(dir); }
});

// --- Malformed config ---

test('ResidencyController - handles malformed config gracefully', function () {
  var dir = makeTmpDir();
  try {
    var lokiDir = path.join(dir, '.loki');
    fs.mkdirSync(lokiDir, { recursive: true });
    fs.writeFileSync(path.join(lokiDir, 'residency.json'), 'not json{{{');
    var rc = new ResidencyController({ projectDir: dir });
    assert.equal(rc.checkProvider('anthropic').allowed, true);
    assert.equal(rc.isAirGapped(), false);
  } finally { cleanup(dir); }
});
