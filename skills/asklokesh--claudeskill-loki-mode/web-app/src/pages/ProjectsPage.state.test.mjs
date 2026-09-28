// S-161 / BACKLOG 114: ProjectsPage destructured only `data` and `refresh`
// from usePolling, so a failed history fetch rendered "No projects yet. Start
// building." -- the same copy as a genuine empty history.
//
// ProjectsPage.tsx is JSX and imports the browser-only api client, so it
// cannot be imported under plain `node --test`. ponytail: extract the one
// exported pure function and strip its types with node's built-in
// stripTypeScriptTypes (same approach as NLSearch.state.test.mjs) instead of
// adding a bundler step to this test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const src = readFileSync(new URL('./ProjectsPage.tsx', import.meta.url), 'utf8');
const m = src.match(/export function projectsListView\([\s\S]*?\n\}\n/);
assert.ok(m, 'ProjectsPage.tsx must export a pure projectsListView function');
const js = stripTypeScriptTypes(m[0].replace(/^export /, ''));
const projectsListView = new Function(`${js}; return projectsListView;`)();

test('error with no data renders the load-failure state, not the empty state', () => {
  const v = projectsListView({ hasData: false, count: 0, error: 'HTTP 500' });
  assert.equal(v.kind, 'error');
  assert.equal(v.stale, false);
});

test('data present and a later poll error keeps the list and flags it stale', () => {
  const v = projectsListView({ hasData: true, count: 4, error: 'network down' });
  assert.equal(v.kind, 'list');
  assert.equal(v.stale, true);
});

test('a genuine empty history is still the empty state, not stale', () => {
  const v = projectsListView({ hasData: true, count: 0, error: null });
  assert.equal(v.kind, 'empty');
  assert.equal(v.stale, false);
});

test('a healthy list is neither error nor stale', () => {
  assert.deepEqual(projectsListView({ hasData: true, count: 2, error: null }), { kind: 'list', stale: false });
});

test('the component reads the poll error and renders through projectsListView', () => {
  assert.match(src, /const \{ data: sessions, error, refresh \} = usePolling\(/);
  assert.match(src, /projectsListView\(\{ hasData: sessions !== null, count: filtered\.length, error \}\)/);
  assert.match(src, /view\.kind === 'error' \?/);
  assert.match(src, /view\.stale &&/);
});

test('the error branch says "Could not load projects" with a retry, the empty branch keeps its copy', () => {
  const errBranch = src.match(/view\.kind === 'error' \? \(([\s\S]*?)\) : view\.kind === 'empty' \? \(([\s\S]*?)\) : \(/);
  assert.ok(errBranch, 'render must branch error -> empty -> list');
  assert.match(errBranch[1], /Could not load projects/);
  assert.match(errBranch[1], /onClick=\{refresh\}/);
  assert.doesNotMatch(errBranch[1], /No projects yet/);
  assert.match(errBranch[2], /No projects yet/);
  const stale = src.match(/\{view\.stale && \(([\s\S]*?)\)\}/);
  assert.ok(stale, 'stale notice must render when view.stale');
  assert.match(stale[1], /stale/);
  assert.match(stale[1], /onClick=\{refresh\}/);
});
