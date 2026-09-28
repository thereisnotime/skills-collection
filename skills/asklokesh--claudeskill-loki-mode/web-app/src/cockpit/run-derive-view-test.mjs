#!/usr/bin/env node
// Bundles and runs useCockpitState.derive-view.test.ts.
//
// Plain `node --test <file>.ts` can't run it: the test imports
// useCockpitState.ts, which imports ../api/client, which reads
// window.location at module load time (browser-only code, no test DOM
// installed in this project). ponytail: a real DOM (jsdom) is a dependency
// this one test file doesn't earn; a `window` stub plus esbuild (already a
// devDependency, no new install) is the smaller fix. Upgrade to jsdom if a
// second test needs real browser APIs.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const webAppRoot = path.resolve(dir, '..', '..');
const entry = path.join(dir, 'useCockpitState.derive-view.test.mjs');
const bundle = path.join(webAppRoot, '.derive-view-test-bundle.mjs');

execFileSync(
  path.join(webAppRoot, 'node_modules', '.bin', 'esbuild'),
  [entry, '--bundle', '--platform=node', '--format=esm', "--define:import.meta.env={}", `--outfile=${bundle}`],
  { stdio: 'inherit' },
);

globalThis.window = { location: { origin: 'http://localhost', hostname: 'localhost' } };

try {
  await import(`file://${bundle}`);
} finally {
  fs.rmSync(bundle, { force: true });
}
