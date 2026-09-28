// S-187 / BACKLOG 118: ProjectWorkspace passed buildStatus.maxIterations (the
// iteration cap) to CostEstimator as estimatedIterations, so a cap of 1000 was
// priced as 1000 iterations. The cap must not change the estimate.
//
// Both files are TSX with browser-only imports, so plain `node --test` cannot
// import them. ponytail: the test lifts estimateCosts (and its rate tables) out
// of CostEstimator.tsx and the estimatedIterations expression out of the
// ProjectWorkspace call site, strips types with node:module and evaluates them.
// Run: node --test web-app/src/components/CostEstimator.estimate.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const est = fs.readFileSync(new URL('./CostEstimator.tsx', import.meta.url), 'utf8');
const start = est.indexOf('const PROVIDER_RATES');
const end = est.indexOf('\nfunction formatTokens', start);
assert.ok(start >= 0 && end > start, 'estimateCosts block not found in CostEstimator.tsx');
const estimateCosts = new Function(`${stripTypeScriptTypes(est.slice(start, end))}\nreturn estimateCosts;`)();

const ws = fs.readFileSync(new URL('./ProjectWorkspace.tsx', import.meta.url), 'utf8');
const site = ws.indexOf('<CostEstimator');
assert.ok(site >= 0, '<CostEstimator call site not found in ProjectWorkspace.tsx');
const m = ws.slice(site, ws.indexOf('/>', site)).match(/estimatedIterations=\{([^}]*)\}/);
assert.ok(m, 'estimatedIterations prop not found at the CostEstimator call site');
const propFor = (buildStatus) => new Function('buildStatus', `return (${m[1]});`)(buildStatus);

for (const complexity of ['simple', 'standard', 'complex']) {
  test(`${complexity}: a cap of 1000 does not change the estimate`, () => {
    const baseline = estimateCosts(complexity, 'claude', 0);
    const capped = estimateCosts(complexity, 'claude', propFor({ maxIterations: 1000 }));
    assert.deepEqual(capped, baseline);
  });
}

test('no cap configured still yields the complexity default', () => {
  assert.deepEqual(
    estimateCosts('standard', 'claude', propFor({ maxIterations: null })),
    estimateCosts('standard', 'claude', 0),
  );
});

test('positive control: the estimator does scale with iterations', () => {
  assert.notDeepEqual(estimateCosts('standard', 'claude', 1000), estimateCosts('standard', 'claude', 0));
});
