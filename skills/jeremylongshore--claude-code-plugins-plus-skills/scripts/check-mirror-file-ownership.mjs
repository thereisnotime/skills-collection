#!/usr/bin/env node
/** Mirror contract: selected upstream files + engine metadata; curated roots
 * retain explicit local ownership. Existing unowned debt is reported and byte
 * pinned, never silently adopted into a source's provenance inventory. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { isRepositoryGeneratedTrackingManifest } from './generate-plugin-package-jsons.mjs';

const BASELINE = 'scripts/.mirror-file-ownership-baseline.json';
const ENGINE_FILES = new Set(['.source.json', '.claude-plugin/plugin.json', 'README.md']);
const regular = (entry) => entry && ['100644', '100755'].includes(entry.mode);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function safePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    /[\\\0\r\n:]/.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Invalid ownership path: ${JSON.stringify(value)}`);
  return value;
}

export function inspectMirrorOwnership({ entries, read, sources, baseline }) {
  if (
    !Array.isArray(sources) ||
    baseline?.schema_version !== 'mirror-file-ownership/v1' ||
    !Array.isArray(baseline.entries)
  )
    throw new Error('Malformed ownership policy');
  const registered = new Map();
  for (const source of sources) {
    const target = safePath(source.target_path);
    if (registered.has(target)) throw new Error(`Duplicate source target: ${target}`);
    registered.set(target, source);
  }
  const retained = new Map();
  for (const entry of baseline.entries) {
    safePath(entry.path);
    if (
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !entry.bead ||
      !entry.reason ||
      retained.has(entry.path)
    ) {
      throw new Error(`Invalid or duplicate legacy ownership record: ${entry.path}`);
    }
    retained.set(entry.path, entry);
  }
  const markers = [...entries.keys()].filter((p) => p.endsWith('/.source.json')).sort();
  if (!markers.length)
    throw new Error('No tracked provenance markers; refusing empty ownership scan');
  const report = {
    mirrors: markers.length,
    upstream: 0,
    engine: 0,
    curated: 0,
    legacy: [],
    violations: [],
  };
  const used = new Set();
  for (const markerPath of markers) {
    if (!regular(entries.get(markerPath))) throw new Error(`Non-regular marker: ${markerPath}`);
    const root = markerPath.slice(0, -13);
    const source = registered.get(root);
    if (!source) throw new Error(`Unregistered mirror: ${root}`);
    const marker = JSON.parse(read(markerPath).toString('utf8'));
    if (!marker || typeof marker !== 'object' || Array.isArray(marker))
      throw new Error(`Invalid marker: ${markerPath}`);
    const frozen = source.curated === true;
    if (!Array.isArray(marker.files) && !(frozen && !Object.hasOwn(marker, 'files'))) {
      throw new Error(`Missing or malformed source inventory: ${markerPath}`);
    }
    const owned = new Set((marker.files ?? []).map(safePath));
    if (owned.size !== (marker.files ?? []).length || owned.has('.source.json')) {
      throw new Error(`Duplicate or reserved source inventory path: ${markerPath}`);
    }
    // A selected upstream file must actually ship. Git ignores and local
    // untracked copies cannot satisfy the committed distribution contract.
    // Frozen sources deliberately own their local inventory instead.
    if (!frozen) {
      for (const relative of owned) {
        const file = `${root}/${relative}`;
        if (!entries.has(file))
          report.violations.push(`${file}: selected upstream file missing from Git index`);
      }
    }
    for (const [file, entry] of entries) {
      if (!file.startsWith(`${root}/`)) continue;
      const relative = file.slice(root.length + 1);
      if (!regular(entry)) {
        report.violations.push(`${file}: non-regular mirror file`);
      } else if (frozen) {
        report.curated++;
      } else if (owned.has(relative)) {
        report.upstream++;
      } else if (ENGINE_FILES.has(relative)) {
        report.engine++;
      } else if (relative === 'package.json') {
        const pkg = JSON.parse(read(file).toString('utf8'));
        if (
          pkg.private !== true ||
          !isRepositoryGeneratedTrackingManifest(pkg, root) ||
          Object.keys(pkg.scripts ?? {}).some((name) => name !== 'postinstall') ||
          ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(
            (key) => Object.keys(pkg[key] ?? {}).length > 0,
          )
        )
          report.violations.push(`${file}: unowned package must be a private tracking manifest`);
        else report.engine++;
      } else {
        const prior = retained.get(file);
        if (prior && digest(read(file)) === prior.sha256) {
          used.add(file);
          report.legacy.push({ path: file, bead: prior.bead });
        } else report.violations.push(`${file}: unowned${prior ? ' (legacy bytes changed)' : ''}`);
      }
    }
  }
  for (const file of retained.keys()) {
    if (!used.has(file))
      report.violations.push(`${file}: stale legacy record; remove it from the baseline`);
  }
  return report;
}

export function checkMirrorOwnership(root = process.cwd()) {
  const run = (args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const entries = new Map();
  for (const line of run(['ls-files', '--stage', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)) {
    const match = /^(\d+) ([a-f0-9]+) 0\t(.+)$/.exec(line);
    if (!match) throw new Error('Ownership check requires an unconflicted Git index');
    safePath(match[3]);
    if (entries.has(match[3])) throw new Error(`Duplicate index path: ${match[3]}`);
    entries.set(match[3], { mode: match[1], oid: match[2] });
  }
  // Blob IDs bind every read to the captured index, without following local
  // symlinks or inspecting untracked runtime/node_modules files.
  const read = (file) => {
    const entry = entries.get(file);
    if (!regular(entry)) throw new Error(`Missing or non-regular policy/input file: ${file}`);
    return run(['cat-file', 'blob', entry.oid]);
  };
  return inspectMirrorOwnership({
    entries,
    read,
    sources: yaml.load(read('sources.yaml').toString('utf8')).sources,
    baseline: JSON.parse(read(BASELINE).toString('utf8')),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkMirrorOwnership();
    console.log(
      `mirror-file-ownership: ${result.mirrors} mirrors; ${result.upstream} upstream, ${result.engine} engine, ${result.curated} curated files`,
    );
    for (const entry of result.legacy)
      console.log(`UNOWNED retained debt: ${entry.path} (${entry.bead})`);
    for (const violation of result.violations) console.error(violation);
    console.log(
      `mirror-file-ownership: ${result.legacy.length} pinned legacy files; ${result.violations.length} violations`,
    );
    if (result.violations.length) process.exitCode = 1;
  } catch (error) {
    console.error(`mirror-file-ownership: ${error.message}`);
    process.exitCode = 1;
  }
}
