/**
 * Moat P7: an unmeasured cost is never rendered as 0 or "$0.00", and a chart
 * never plots a point nobody measured.
 *
 * THE BUG. Four dashboard surfaces turned a missing cost into a number:
 *   - loki-fleet formatFleetCost(null) returned "$0.00".
 *   - loki-analytics summed `data.cost_usd || 0` per provider and printed
 *     "$0.00" for a provider whose models carried no cost at all.
 *   - loki-cost-waterfall scaled bars with `p.cost_usd || 0`, printed an
 *     unmeasured phase as "(0%)" of the total, and on a failed fetch drew a
 *     hardcoded demo breakdown ($0.85 planning, $3.20 building, $10 budget).
 *   - dashboard/static/cost.html plotted `Number(x) || 0`, so an iteration with
 *     no recorded cost sat on the chart floor as a measured zero.
 *
 * BOTH DIRECTIONS ARE ASSERTED. A genuinely measured 0 must still read "$0.00";
 * a fix that renders every zero as "unknown" is exactly as wrong.
 *
 * Real component classes against the minimal DOM stub this suite already uses
 * (loki-empty-vs-error.node.test.mjs); cost.html functions are extracted by name
 * from the shipped file, never reimplemented.
 *
 * Run with: node --test dashboard-ui/tests/loki-unmeasured-cost-never-zero.node.test.mjs
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fakeClassList = { contains: () => false, add() {}, remove() {}, toggle() {} };
globalThis.document = {
  body: { classList: fakeClassList },
  documentElement: { classList: fakeClassList, dataset: {}, style: { setProperty() {} } },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
};
class FakeHTMLElement {
  constructor() { this._shadow = null; }
  attachShadow() {
    this._shadow = { innerHTML: '', getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
    return this._shadow;
  }
  get shadowRoot() { return this._shadow; }
  getAttribute() { return null; }
  hasAttribute() { return false; }
  setAttribute() {}
  removeAttribute() {}
}
globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = {
  _defined: new Map(),
  define(name, ctor) { this._defined.set(name, ctor); },
  get(name) { return this._defined.get(name); },
};
globalThis.window = globalThis.window || {
  location: { origin: 'http://localhost:57374' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({ getPropertyValue: () => '' }));
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

let formatFleetCost, LokiFleet, LokiAnalytics, LokiCostWaterfall;
before(async () => {
  ({ formatFleetCost, LokiFleet } = await import('../components/loki-fleet.js'));
  ({ LokiAnalytics } = await import('../components/loki-analytics.js'));
  ({ LokiCostWaterfall } = await import('../components/loki-cost-waterfall.js'));
});

function mount(Ctor, getImpl) {
  const el = new Ctor();
  el.attachShadow({ mode: 'open' });
  el._api = { _get: getImpl, _post: async () => ({}) };
  el._loading = false;
  return el;
}
const markup = (s) => s.replace(/<style>[\s\S]*?<\/style>/g, '');

describe('loki-fleet', () => {
  it('formatFleetCost: unmeasured is not $0.00, measured zero is', () => {
    assert.notEqual(formatFleetCost(null), '$0.00');
    assert.notEqual(formatFleetCost(undefined), '$0.00');
    assert.notEqual(formatFleetCost(NaN), '$0.00');
    assert.equal(formatFleetCost(0), '$0.00');
    assert.equal(formatFleetCost(2.5), '$2.50');
  });

  it('a fleet total over a run with no recorded cost says partial', async () => {
    const el = mount(LokiFleet, async (path) => (path.endsWith('/runs')
      ? [{ name: 'a', status: 'running', cost_usd: 1.25 }, { name: 'b', status: 'stopped', cost_usd: null }]
      : { total_runs: 2, running_runs: 1, stopped_runs: 1, total_cost_usd: 1.25 }));
    await el._loadData();
    const out = markup(el.shadowRoot.innerHTML);
    assert.ok(/\$1\.25[^<]*partial/i.test(out), 'total summed over an unmeasured run without saying partial');
    assert.ok(!out.includes('$0.00'), 'an unmeasured run rendered $0.00');
  });
});

describe('loki-analytics provider comparison', () => {
  const render = (byModel, estimated) => {
    const el = mount(LokiAnalytics, async () => ({}));
    el._cost = { by_model: byModel, estimated_cost_usd: estimated };
    el._context = {};
    return markup(el._renderProviders());
  };

  it('a provider whose models carry no cost is not $0.00', () => {
    const out = render({ 'claude-sonnet': { input_tokens: 10, output_tokens: 5 } }, null);
    assert.ok(!out.includes('$0.00'), 'unmeasured provider cost rendered as $0.00');
    assert.ok(/unknown|unmeasured|not recorded/i.test(out), 'unmeasured cost has no explicit state');
  });

  it('a provider total with one unmeasured model says partial', () => {
    const out = render({
      'claude-sonnet': { input_tokens: 10, output_tokens: 5, cost_usd: 1.5 },
      'claude-haiku': { input_tokens: 10, output_tokens: 5 },
    }, 1.5);
    assert.ok(/\$1\.50[^<]*partial/i.test(out), 'partial provider total not labelled partial');
  });

  it('a measured zero cost still renders $0.00', () => {
    const out = render({ 'claude-sonnet': { input_tokens: 0, output_tokens: 0, cost_usd: 0 } }, 0);
    assert.ok(out.includes('$0.00'), 'a measured zero was hidden');
  });
});

describe('loki-cost-waterfall', () => {
  it('an unmeasured phase is not scaled, not a share of the total, and the total says partial', async () => {
    // The /api/cost shape the component reads (by_phase + estimated_cost_usd).
    const el = mount(LokiCostWaterfall, async () => ({
      by_phase: { planning: { cost_usd: null }, building: { cost_usd: 2 } },
      estimated_cost_usd: 2,
    }));
    await el._loadData();
    const out = markup(el.shadowRoot.innerHTML);
    assert.ok(!/unknown \(0%\)/.test(out), 'unmeasured phase rendered as 0% of the total');
    assert.ok(/data-phase="planning"[^>]*unmeasured|unmeasured[^>]*data-phase="planning"/.test(out),
      'the unmeasured phase bar is drawn like a measured one');
    assert.ok(/Total: \$2\.00[^<]*partial/i.test(out), 'total over an unmeasured phase not labelled partial');
  });

  it('a failed fetch renders no demo breakdown', async () => {
    const el = mount(LokiCostWaterfall, async () => { throw new Error('ECONNREFUSED'); });
    await el._loadData();
    const out = markup(el.shadowRoot.innerHTML);
    for (const fake of ['$0.85', '$3.20', '$10.00', 'Budget:']) {
      assert.ok(!out.includes(fake), `failed fetch rendered demo value ${fake}`);
    }
  });

  it('a measured zero phase still renders $0.00', async () => {
    const el = mount(LokiCostWaterfall, async () => ({
      by_phase: { planning: { cost_usd: 0 } },
      estimated_cost_usd: 0,
    }));
    await el._loadData();
    assert.ok(markup(el.shadowRoot.innerHTML).includes('$0.00'));
  });
});

describe('dashboard/static/cost.html', () => {
  const html = readFileSync(new URL('../../dashboard/static/cost.html', import.meta.url), 'utf8');
  const pick = (name) => {
    const i = html.indexOf(`function ${name}(`);
    if (i < 0) throw new Error(`function not found in cost.html: ${name}`);
    let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++;
      else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
    }
    throw new Error(`unbalanced function: ${name}`);
  };
  const fns = new Function(
    `${pick('esc')}\n${pick('fmtUsd')}\n${pick('statusText')}\n${pick('renderBudget')}\n${pick('renderCurrentRun')}\n` +
    `${pick('projectTotal')}\n${pick('partialUsd')}\n${pick('orNotRecorded')}\n` +
    'return { renderBudget, renderCurrentRun, statusText, projectTotal };')();
  const points = (out) => {
    const m = /points="([^"]*)"/.exec(out);
    return m ? m[1].trim().split(/\s+/).filter(Boolean).length : 0;
  };

  it('the chart skips iterations with no recorded cost instead of plotting zero', () => {
    const out = fns.renderCurrentRun({
      cost_recorded: true, total_usd: 2,
      iterations: [{ iteration: 1, cumulative_usd: null }, { iteration: 2, cumulative_usd: 1 }, { iteration: 3, cumulative_usd: 2 }],
    });
    assert.equal(points(out), 2, 'an unmeasured iteration was plotted as a point');
  });

  it('no measured point means no chart line', () => {
    const out = fns.renderCurrentRun({
      cost_recorded: true, total_usd: null,
      iterations: [{ iteration: 1, cumulative_usd: null }],
    });
    assert.equal(points(out), 0, 'a line was drawn through nothing but unmeasured points');
  });

  it('the project total over unmeasured runs is not recorded, and a mixed total says partial', () => {
    // The server sends null when no run recorded a cost, and a sum marked
    // partial when only some did. A measured $0.00 project stays $0.00.
    assert.equal(fns.projectTotal({ project_total_usd: null, project_total_partial: false }), 'not recorded');
    assert.equal(fns.projectTotal({ project_total_usd: 2.5, project_total_partial: true }), '$2.50 (partial)');
    assert.equal(fns.projectTotal({ project_total_usd: 0, project_total_partial: false }), '$0.00');
    assert.equal(fns.projectTotal({ project_total_usd: 2.5, project_total_partial: false }), '$2.50');
  });

  it('a current run with an unmeasured iteration says partial, and its unknowns are not 0', () => {
    // The server marks current_run.partial when some iterations recorded a
    // cost and some did not; that iteration carries null tokens and model.
    const out = fns.renderCurrentRun({
      cost_recorded: true, total_usd: 2.5, partial: true,
      iterations: [
        { iteration: 1, model: 'sonnet', phase: 'build', input_tokens: 1000, output_tokens: 500, cost_usd: 2.5, cumulative_usd: 2.5 },
        { iteration: 2, model: null, phase: 'build', input_tokens: null, output_tokens: null, cost_usd: null, cumulative_usd: null },
      ],
    });
    assert.ok(out.includes('$2.50 (partial)'), 'a partial run total was shown as complete');
    const row2 = out.slice(out.lastIndexOf('<tr>'));
    assert.ok(!/>0</.test(row2), 'an unmeasured iteration showed 0 tokens');
    assert.ok(row2.includes('not recorded'), 'an unmeasured iteration did not say not recorded');
    const whole = fns.renderCurrentRun({
      cost_recorded: true, total_usd: 2.5, partial: false,
      iterations: [{ iteration: 1, model: 'sonnet', phase: 'build', input_tokens: 1000, output_tokens: 500, cost_usd: 2.5, cumulative_usd: 2.5 }],
    });
    assert.ok(!whole.includes('(partial)'), 'a fully measured run was marked partial');
  });

  it('a partial budget says partial, bounds remaining, and never claims within budget', () => {
    const out = fns.renderBudget({ limit: 10, used: 2.5, remaining: 7.5, percent_used: 25, status: 'ok', warn_threshold_percent: 80, partial: true });
    assert.ok(out.includes('$2.50 (partial)') && out.includes('25.0% (partial)'), 'partial spend shown as complete');
    assert.ok(out.includes('at most $7.50'), 'remaining over a lower-bound spend was not marked as an upper bound');
    assert.ok(!out.includes('Within budget.'), 'a partial spend claimed "Within budget."');
    const whole = fns.renderBudget({ limit: 10, used: 2.5, remaining: 7.5, percent_used: 25, status: 'ok', warn_threshold_percent: 80, partial: false });
    assert.ok(whole.includes('Within budget.') && !whole.includes('(partial)'), 'a fully measured budget lost its reading');
  });

  it('a budget with an unknown percent is not 0.0%', () => {
    const out = fns.renderBudget({ limit: 10, used: null, remaining: null, percent_used: null, status: 'ok', warn_threshold_percent: 80 });
    assert.ok(!out.includes('0.0%'), 'unknown budget use rendered as 0.0%');
  });

  it('a cap with unknown spend says unknown, not within budget or no cap', () => {
    // The server sends status "unknown" when a cap is set and nothing was
    // measured. Unknown is never a pass, and the cap exists.
    const out = fns.renderBudget({ limit: 10, used: null, remaining: null, percent_used: null, status: 'unknown', warn_threshold_percent: 80 });
    assert.ok(!/Within budget/i.test(out), 'unknown spend rendered as within budget');
    assert.ok(!/No budget cap set/i.test(out), 'a set cap with unknown spend rendered as no cap');
    assert.ok(/not recorded|unknown/i.test(fns.statusText('unknown')), 'unknown status has no explicit state');
  });
});
