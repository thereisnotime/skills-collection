import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkMirrorOwnership, inspectMirrorOwnership } from './check-mirror-file-ownership.mjs';
import { trackingPostinstall } from './generate-plugin-package-jsons.mjs';

const root = 'plugins/testing/example';
function fixture() {
  const bytes = new Map();
  const entries = new Map();
  const add = (relative, value, mode = '100644') => {
    const path = `${root}/${relative}`;
    bytes.set(path, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
    entries.set(path, { mode });
  };
  add('.source.json', { files: ['SKILL.md', 'scripts/run.sh'] });
  add('SKILL.md', 'upstream skill');
  add('scripts/run.sh', 'upstream script', '100755');
  add('README.md', 'engine README');
  add('.claude-plugin/plugin.json', { name: 'example' });
  add('package.json', {
    name: '@intentsolutionsio/example',
    private: true,
    repository: {
      url: 'git+https://github.com/jeremylongshore/tons-of-skills-marketplace.git',
      directory: root,
    },
    scripts: { postinstall: trackingPostinstall('example') },
  });
  const sources = [{ target_path: root }];
  const baseline = { schema_version: 'mirror-file-ownership/v1', entries: [] };
  const inspect = () =>
    inspectMirrorOwnership({ entries, read: (p) => bytes.get(p), sources, baseline });
  return { add, bytes, entries, sources, baseline, inspect };
}

test('selected source files and engine metadata have separate owners', () => {
  const result = fixture().inspect();
  assert.deepEqual(result, {
    mirrors: 1,
    upstream: 2,
    engine: 4,
    curated: 0,
    legacy: [],
    violations: [],
  });
});

test('an unexpected script fails even inside an upstream-selected directory', () => {
  const f = fixture();
  f.add('scripts/extra.sh', 'unexpected');
  assert.deepEqual(f.inspect().violations, [`${root}/scripts/extra.sh: unowned`]);
});

test('missing selected files fail, while explicit exclusion and curated ownership remain valid', () => {
  const f = fixture();
  f.entries.delete(`${root}/scripts/run.sh`);
  assert.deepEqual(f.inspect().violations, [
    `${root}/scripts/run.sh: selected upstream file missing from Git index`,
  ]);
  f.sources[0].curated = true;
  assert.deepEqual(f.inspect().violations, []);
  f.sources[0].curated = false;
  f.add('.source.json', { files: ['SKILL.md'] });
  assert.deepEqual(f.inspect().violations, []);
});

test('a root manifest is upstream-owned only when explicitly recorded', () => {
  const f = fixture();
  f.add('package.json', {
    name: 'upstream-tool',
    private: true,
    scripts: { test: 'upstream-test' },
  });
  assert.equal(f.inspect().violations.length, 1);
  f.add('.source.json', { files: ['SKILL.md', 'scripts/run.sh', 'package.json'] });
  assert.deepEqual(f.inspect().violations, []);
});

test('unowned tracking manifests cannot accumulate build scripts or dependencies', () => {
  for (const change of [
    { private: false },
    { scripts: { test: 'vitest' } },
    { devDependencies: { vitest: '*' } },
  ]) {
    const f = fixture();
    const pkg = JSON.parse(f.bytes.get(`${root}/package.json`));
    f.add('package.json', { ...pkg, ...change });
    assert.equal(f.inspect().violations.length, 1);
  }
});

test('legacy debt is visible and pinned to exact bytes; drift and stale records refuse', () => {
  const f = fixture();
  f.add('legacy.md', 'old');
  f.baseline.entries.push({
    path: `${root}/legacy.md`,
    sha256: createHash('sha256').update('old').digest('hex'),
    bead: 'test-1',
    reason: 'known debt',
  });
  assert.deepEqual(f.inspect().legacy, [{ path: `${root}/legacy.md`, bead: 'test-1' }]);
  assert.deepEqual(f.inspect().violations, []);
  f.add('legacy.md', 'changed');
  assert.match(f.inspect().violations[0], /legacy bytes changed/);
  f.entries.delete(`${root}/legacy.md`);
  assert.match(f.inspect().violations[0], /stale legacy record/);
});

test('only an explicitly curated source may retain local payload without a file inventory', () => {
  const f = fixture();
  f.add('.source.json', {});
  f.add('local-hardening.sh', 'local');
  assert.throws(f.inspect, /Missing or malformed source inventory/);
  f.sources[0].curated = true;
  const report = f.inspect();
  assert.equal(report.curated, 7);
  assert.deepEqual(report.violations, []);
});

test('malformed, traversing and duplicate inventories fail closed', () => {
  for (const files of [
    null,
    'SKILL.md',
    ['../secret'],
    ['/absolute'],
    ['a\\b'],
    ['SKILL.md', 'SKILL.md'],
    ['.source.json'],
  ]) {
    const f = fixture();
    f.add('.source.json', { files });
    assert.throws(f.inspect);
  }
});

test('unregistered mirrors, empty census, symlink markers and payloads fail closed', () => {
  let f = fixture();
  f.sources.length = 0;
  assert.throws(f.inspect, /Unregistered/);
  f = fixture();
  f.entries.clear();
  assert.throws(f.inspect, /No tracked provenance/);
  f = fixture();
  f.entries.get(`${root}/.source.json`).mode = '120000';
  assert.throws(f.inspect, /Non-regular marker/);
  f = fixture();
  f.entries.get(`${root}/SKILL.md`).mode = '120000';
  assert.match(f.inspect().violations[0], /non-regular mirror/);
});

test('the real gate uses captured Git blobs and ignores untracked runtime files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mirror-ownership-'));
  const put = (name, contents) => {
    const target = join(directory, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  try {
    const f = fixture();
    for (const [name, bytes] of f.bytes) put(name, bytes);
    put('sources.yaml', `sources:\n  - target_path: ${root}\n`);
    put('scripts/.mirror-file-ownership-baseline.json', JSON.stringify(f.baseline));
    git('init');
    git('add', '.');
    put(`${root}/node_modules/runtime.js`, 'untracked runtime');
    put(`${root}/.source.json`, 'invalid unstaged provenance');
    assert.deepEqual(checkMirrorOwnership(directory).violations, []);
    git('rm', '--cached', `${root}/scripts/run.sh`);
    // The working copy remains, but it will not be distributed by Git.
    assert.deepEqual(checkMirrorOwnership(directory).violations, [
      `${root}/scripts/run.sh: selected upstream file missing from Git index`,
    ]);
    git('add', `${root}/scripts/run.sh`);
    put(`${root}/scripts/extra.sh`, 'new unowned script');
    git('add', `${root}/scripts/extra.sh`);
    assert.deepEqual(checkMirrorOwnership(directory).violations, [
      `${root}/scripts/extra.sh: unowned`,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
