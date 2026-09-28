/**
 * Moat P7: every shipped dashboard panel renders an unmeasured value as
 * unknown, never as 0 / 0.0% / $0.00 / a default label, and a failed read as
 * an error, never as an empty-but-healthy state. A measured 0 still renders 0.
 *
 * WHY A RENDER TEST. The P7 scanner (tests/moat/p7-no-fabricated-data.sh)
 * reads source for shapes such as `(x || 0).toFixed(`. It cannot see a zero
 * built in one statement and formatted in another: the context tracker's
 * `pct = current.context_window_pct || 0` then `pct.toFixed(1)` rendered
 * "0.0% Context Used" beside "Total Tokens unknown", and the learning
 * dashboard's `_formatPercent(null)` itself printed "0.0%". Only rendering the
 * real component catches those coming back.
 *
 * Every panel below failed at 61af5915 and passes after the P7 sweep. Each
 * unknown assertion is paired with a measured control so a fix that blanks
 * every value fails too.
 *
 * Run with: node --test dashboard-ui/tests/loki-unmeasured-panels-honesty.node.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// -- Minimal DOM stubs, installed before the component modules are imported.
const fakeClassList = { contains: () => false, add() {}, remove() {}, toggle() {} };
globalThis.document = {
  body: { classList: fakeClassList },
  documentElement: { classList: fakeClassList, dataset: {}, style: { setProperty() {} } },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  createElement: () => {
    const o = { style: {}, setAttribute() {}, appendChild() {} };
    Object.defineProperty(o, 'textContent', {
      set(v) { o.innerHTML = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
    });
    return o;
  },
};
class FakeHTMLElement {
  attachShadow() {
    this._shadow = { innerHTML: '', getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
    return this._shadow;
  }
  get shadowRoot() { return this._shadow; }
  getAttribute() { return null; }
  hasAttribute() { return false; }
  setAttribute() {}
  removeAttribute() {}
  dispatchEvent() {}
}
globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = {
  _d: new Map(),
  define(n, c) { this._d.set(n, c); },
  get(n) { return this._d.get(n); },
};
globalThis.window = globalThis.window || {
  location: { origin: 'http://localhost:57374' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({ getPropertyValue: () => '' }));
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const C = (name) => new URL(`../components/${name}`, import.meta.url).href;
const html = (el) => el.shadowRoot.innerHTML.replace(/<style>[\s\S]*?<\/style>/g, '');
const mk = (Ctor) => { const e = new Ctor(); e.attachShadow({ mode: 'open' }); return e; };
const mount = (Ctor, api) => { const e = mk(Ctor); e._api = api; e._loading = false; return e; };
const fail = async () => { throw new Error('HTTP 500'); };
// The server's pre-fix /api/context reply with no tracking.json: every reading 0.
const ZERO_STUB = {
  session_id: '', updated_at: '',
  current: { input_tokens: 0, output_tokens: 0, total_tokens: 0, context_window_pct: 0.0, estimated_cost_usd: 0.0 },
  totals: { compaction_count: 0, iterations_tracked: 0 }, per_iteration: [], compactions: [],
};

describe('context tracker', async () => {
  const { LokiContextTracker } = await import(C('loki-context-tracker.js'));
  it('before any fetch the gauge reads unknown, not 0.0%', () => {
    const e = mk(LokiContextTracker); e.render(); const o = html(e);
    assert.ok(!o.includes('0.0%'), 'unmeasured context rendered as 0.0%');
    assert.match(o, /unknown/);
    assert.ok(!/card-value">0</.test(o));
  });
  it('the unmeasured stub (zeros or nulls) reads unknown, not 0 / $0.00', () => {
    for (const data of [ZERO_STUB, { updated_at: null, current: { context_window_pct: null }, totals: {} }]) {
      const e = mk(LokiContextTracker); e._data = data; e._connected = true; e.render(); const o = html(e);
      assert.ok(!o.includes('0.0%') && !o.includes('$0.00') && !/card-value">0</.test(o), 'stub rendered as a reading');
    }
  });
  it('a measured zero still reads 0.0%, $0.00 and 0', () => {
    const e = mk(LokiContextTracker); e._data = { ...ZERO_STUB, updated_at: '2026-09-26T00:00:00Z' }; e._connected = true; e.render();
    const o = html(e);
    assert.ok(o.includes('0.0%') && o.includes('$0.00')); assert.match(o, /card-value">0</);
  });
  it('an HTTP 500 says so instead of "Connecting..." forever', async () => {
    const e = mk(LokiContextTracker); e._api = {}; globalThis.fetch = async () => ({ ok: false, status: 500 });
    await e._loadContext(); const o = html(e);
    assert.match(o, /HTTP 500/); assert.ok(!o.includes('Connecting'));
  });
});

describe('learning dashboard', async () => {
  const { LokiLearningDashboard } = await import(C('loki-learning-dashboard.js'));
  it('its formatters map null to "--" and keep a measured 0', () => {
    const e = mk(LokiLearningDashboard);
    assert.equal(e._formatPercent(null), '--'); assert.equal(e._formatNumber(undefined), '--'); assert.equal(e._formatDuration(null), '--');
    assert.equal(e._formatPercent(0), '0.0%'); assert.equal(e._formatNumber(0), '0'); assert.equal(e._formatDuration(0), '0s');
  });
  it('no signals means no "Avg Confidence 0.0%"; a measured average renders', () => {
    const e = mk(LokiLearningDashboard);
    e._metrics = { totalSignals: 0, avgConfidence: 0.0, signalsByType: {}, signalsBySource: {} };
    const o = e._renderSummaryCards(); assert.ok(!o.includes('0.0%')); assert.match(o, /--/);
    e._metrics = { totalSignals: 4, avgConfidence: 0.5 }; assert.ok(e._renderSummaryCards().includes('50.0%'));
  });
  it('unmeasured durations and resolution rates are not 0ms / 0.0% resolved / 0s', () => {
    const e = mk(LokiLearningDashboard);
    e._metrics = { aggregation: {
      tool_efficiencies: [{ tool_name: 'x', efficiency_score: 1, success_rate: 1 }],
      error_patterns: [{ error_type: 'e', resolution_rate: null, frequency: 1, confidence: 0.1 }],
      success_patterns: [{ pattern_name: 'p', avg_duration_seconds: null, frequency: 1, confidence: 0.1 }],
    } };
    const o = e._renderTopLists();
    assert.ok(!o.includes('0ms') && !o.includes('0.0% resolved') && !/item-duration">0s/.test(o));
    e._selectedMetric = { type: 'tool_efficiency', item: { tool_name: 'x', count: 7 } };
    const d = e._renderDetailPanel();
    assert.ok(d.includes('>7<') && !d.includes('undefined') && !d.includes('0ms'));
  });
  it('a failed signals read says so; an empty one says none', () => {
    const e = mk(LokiLearningDashboard);
    e._signals = null; assert.match(e._renderRecentSignals(), /Could not load signals/);
    e._signals = []; assert.match(e._renderRecentSignals(), /No recent signals/);
  });
});

describe('memory browser', async () => {
  const { LokiMemoryBrowser } = await import(C('loki-memory-browser.js'));
  it('reads usage_count, shows "--" when absent, draws no invented-capacity bars, and names a failed read', () => {
    const e = mk(LokiMemoryBrowser);
    e._patterns = [{ id: 'a', pattern: 'p', confidence: 0.5, usage_count: 3 }, { id: 'b', pattern: 'q', confidence: 0.5 }];
    const o = e._renderPatterns(); assert.ok(o.includes('Used 3 times') && o.includes('Used -- times'));
    e._summary = { episodic: { count: 5 }, semantic: { patterns: 2, antiPatterns: 0 }, procedural: { skills: 1 } };
    const s = e._renderSummary(); assert.ok(!s.includes('memory-bar') && s.includes('Anti-patterns: 0'));
    e._episodes = null; assert.match(e._renderEpisodes(), /Could not load episodes/);
    e._skills = null; assert.match(e._renderSkills(), /Could not load skills/);
    e._patterns = null; assert.match(e._renderPatterns(), /Could not load patterns/);
  });
  it('token economics with nothing recorded reads "--", not 0 / 0.0%', () => {
    const e = mk(LokiMemoryBrowser);
    e._summary = { episodic: { count: 0 }, semantic: { patterns: 0, antiPatterns: 0 }, procedural: { skills: 0 } };
    e._tokenEconomics = { discoveryTokens: null, readTokens: null, savingsPercent: null };
    const o = e._renderSummary(); const econ = o.slice(o.indexOf('Token Economics'));
    assert.ok(!/econ-value[^>]*>0</.test(econ) && !econ.includes('0.0%'), 'unmeasured economics rendered as 0');
    e._tokenEconomics = { discoveryTokens: 1200, readTokens: 800, savingsPercent: 62.5 };
    const m = e._renderSummary(); assert.ok(m.includes('1,200') && m.includes('62.5%'));
  });
  it('reads the real snake_case keys the memory store writes, not camelCase', () => {
    const e = mk(LokiMemoryBrowser);
    // Real /api/memory/episodes shape: memory/schemas.py EpisodeTrace.to_dict().
    const episode = {
      id: 'ep-1', task_id: 'task-42', agent: 'loki-orchestrator', outcome: 'success',
      duration_seconds: 12, tokens_used: 500, timestamp: '2026-01-01T00:00:00Z',
      context: { phase: 'ACT', goal: 'fix the thing' },
      action_log: [{ t: 1, action: 'edit', target: 'foo.py' }],
    };
    e._episodes = [episode];
    const listHtml = e._renderEpisodes();
    assert.ok(listHtml.includes('task-42'), 'episode list still shows "Task" instead of the real task_id');
    assert.ok(listHtml.includes('ACT'), 'episode list did not read the nested context.phase');

    // The detail panel discriminates on action_log, not actionLog.
    e._selectedItem = episode;
    const detailHtml = e._renderDetail();
    assert.ok(detailHtml.includes('Episode:'), 'action_log-keyed object was not recognized as an episode');
    assert.ok(detailHtml.includes('task-42'), 'detail panel did not read task_id');
    assert.ok(detailHtml.includes('ACT'), 'detail panel did not read context.phase');
    assert.ok(detailHtml.includes('fix the thing'), 'detail panel did not read context.goal');
    assert.ok(detailHtml.includes('12s'), 'detail panel did not read duration_seconds');
    assert.match(detailHtml, /Tokens Used[\s\S]*?500/, 'detail panel did not read tokens_used');
    assert.ok(detailHtml.includes('Action Log (1)'), 'detail panel did not read action_log entries');

    // /api/memory/stats sends episode_count / pattern_count / skill_count.
    e._stats = { backend: 'json', episode_count: 7, pattern_count: 2, skill_count: 1 };
    const summaryHtml = e._renderSummary.call(Object.assign(e, { _summary: { episodic: {}, semantic: {}, procedural: {} } }));
    assert.match(summaryHtml, />7</, 'summary did not read episode_count');
    assert.match(summaryHtml, />2</, 'summary did not read pattern_count');
    assert.match(summaryHtml, />1</, 'summary did not read skill_count');
  });
});

describe('analytics, overview, session control, fleet, cost', async () => {
  it('analytics velocity reads "--" for the unmeasured stub; a measured 0 reads 0; estimates are labelled', async () => {
    const { LokiAnalytics } = await import(C('loki-analytics.js'));
    const e = mk(LokiAnalytics);
    e._context = ZERO_STUB; let o = e._renderVelocity(); assert.ok(!o.includes('>0.0<') && !/velocity-value">0</.test(o));
    e._context = {}; o = e._renderVelocity(); assert.ok(!/velocity-value">0/.test(o));
    e._context = { updated_at: 'x', totals: { iterations_tracked: 0 } }; assert.match(e._renderVelocity(), /velocity-value">0</);
    e._cost = { by_model: { sonnet: { cost_usd: 1, input_tokens: 1 } } }; e._context = {};
    assert.match(e._renderProviders(), /Cost \/ Iteration \(est\.\)/);
  });
  it('overview with null fields shows no 0 / CLAUDE / STANDARD / Inline', async () => {
    const { LokiOverview } = await import(C('loki-overview.js'));
    const e = mk(LokiOverview); e._data = { ...e._data, connected: true, status: 'running' }; e.render(); const o = html(e);
    for (const bad of ['CLAUDE', 'STANDARD', 'Inline', 'null']) assert.ok(!o.includes(bad), bad);
    assert.ok(!/card-value">\s*0\s*</.test(o));
  });
  it('council gate card reads `blocked`, the field /api/council/gate actually sends, not `status`', async () => {
    const { LokiOverview } = await import(C('loki-overview.js'));
    const e = mk(LokiOverview); e._data = { ...e._data, connected: true, status: 'running' };
    // Real shape: gate-block.json absent, nothing evaluated yet.
    e._gateStatus = { blocked: false, gates: [], gates_reason: 'No per-gate results recorded', evidence: { blocked: false } };
    assert.match(e._renderCouncilGateCard(), /Not blocked/);
    // Real shape: gate-block.json present, blocked, no `status` guaranteed.
    e._gateStatus = { blocked: true, critical_failures: 2, gates: [], evidence: { blocked: false } };
    assert.match(e._renderCouncilGateCard(), /BLOCKED/);
    assert.match(e._renderCouncilGateCard(), /2 critical failures/);
    // Unreadable gate file: blocked is explicitly null, not a pass.
    e._gateStatus = { blocked: null, error: 'Failed to read gate file' };
    assert.match(e._renderCouncilGateCard(), /Not evaluated|Pending review/);
    assert.ok(!e._renderCouncilGateCard().includes('BLOCKED'));
  });
  it('session control seeds agents and tasks as unknown, not 0', async () => {
    const { LokiSessionControl } = await import(C('loki-session-control.js'));
    const e = new LokiSessionControl(); assert.equal(e._status.activeAgents, null); assert.equal(e._status.pendingTasks, null);
  });
  it('fleet shows "--" for a null iteration and keeps a measured 0', async () => {
    const { LokiFleet } = await import(C('loki-fleet.js'));
    const e = mk(LokiFleet);
    e._api = { _get: async (p) => (p.endsWith('/runs')
      ? [{ name: 'a', status: 'running', iteration: null, phase: 'build', duration_seconds: 5 },
         { name: 'b', status: 'running', iteration: 0, phase: 'build', duration_seconds: 5 }]
      : { total_runs: 2 }), _post: async () => ({}) };
    await e._loadData(); const o = html(e);
    assert.match(o, /<td>--<\/td>/); assert.match(o, /<td>0<\/td>/);
  });
  it('a model with no rate is not priced at $0.00; a real $0.00 rate stays', async () => {
    const { LokiCostDashboard } = await import(C('loki-cost-dashboard.js'));
    const e = mk(LokiCostDashboard); e._modelPricing = { x: { label: 'X' }, y: { input: 0, output: 1.5, label: 'Y' } }; e.render();
    const o = html(e);
    assert.match(o, /In: unknown \/ Out: unknown/); assert.match(o, /In: \$0\.00 \/ Out: \$1\.50/); assert.ok(!o.includes('$$'));
  });
});

describe('quality, council, migration, notifications, optimizer', async () => {
  it('quality score: unreported categories read "--"; history is the newest 10 in order', async () => {
    const { LokiQualityScore } = await import(C('loki-quality-score.js'));
    const el = mount(LokiQualityScore, null);
    const hist = [{ score: 90 }, { score: 80 }, { score: null }, ...Array.from({ length: 12 }, (_, i) => ({ score: 70 - i }))];
    el._api = { _get: async (p) => (p.endsWith('history') ? hist : { score: 77, categories: { security: 88 } }) };
    await el._loadData();
    assert.equal(el._history.length, 10); assert.equal(el._history[9].score, 90); assert.equal(el._history[8].score, 80);
    const h = html(el); assert.match(h, /category-score">--</); assert.match(h, /category-score">88</); assert.doesNotMatch(h, /width:0%/);
  });
  it('council: a failed read is Unknown with "--" counts, never Active or 0; a real state renders', async () => {
    const { LokiCouncilDashboard } = await import(C('loki-council-dashboard.js'));
    const el = mount(LokiCouncilDashboard, { _get: fail });
    el.render(); let h = html(el);
    assert.match(h, /Unknown/); assert.doesNotMatch(h, />\s*Active\s*</); assert.doesNotMatch(h, /Monitoring/);
    await el._loadData(); h = html(el);
    assert.match(h, /stat-value[^>]*>\s*--/); assert.match(h, /agent list unavailable/);
    el._activeTab = 'decisions'; el._verdicts = []; el._councilState = { enabled: true }; el.render(); h = html(el);
    assert.doesNotMatch(h, /every 5/); assert.match(h, /periodically/);
    el._councilState = { enabled: true, total_votes: 0, approve_votes: 0 }; el._activeTab = 'overview'; el.render(); h = html(el);
    assert.match(h, /Monitoring/); assert.match(h, /stat-value">0</);
  });
  it('migration: no features or plan is said, not drawn as 0 / 0, 0%; completed steps are counted', async () => {
    const { LokiMigrationDashboard } = await import(C('loki-migration-dashboard.js'));
    const el = new LokiMigrationDashboard();
    assert.match(el._renderFeatureStats({ passing: 0, total: 0 }), /No features recorded/);
    assert.match(el._renderStepProgress({ current: 0, completed: 0, total: 0 }), /No plan recorded/);
    const s = el._renderStepProgress({ current: 1, completed: 0, total: 5 }); assert.match(s, /0 \/ 5/); assert.match(s, /0% complete/);
    assert.match(el._renderFeatureStats({ passing: 0, total: 4 }), /0 \/ 4/);
  });
  it('notifications: counts are unknown until read; a failed read says so; a real empty read is 0', async () => {
    const { LokiNotificationCenter } = await import(C('loki-notification-center.js'));
    const el = mk(LokiNotificationCenter); el.render(); let h = html(el);
    assert.doesNotMatch(h, /card-value[^>]*>0</); assert.match(h, /Unread count unknown/); assert.match(h, /Notifications not loaded/);
    globalThis.fetch = async () => ({ ok: false }); await el._loadNotifications(); h = html(el);
    assert.match(h, /Could not reach notifications API/); assert.doesNotMatch(h, /card-value[^>]*>0</);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ notifications: [], summary: { total: 0, unacknowledged: 0, critical: 0 } }) });
    await el._loadNotifications(); h = html(el); assert.match(h, /card-value">0</); assert.match(h, /No notifications</);
  });
  it('prompt optimizer: the never-ran sentinel is not "v0" / 0 failures; a real run renders', async () => {
    const { LokiPromptOptimizer } = await import(C('loki-prompt-optimizer.js'));
    const el = mount(LokiPromptOptimizer, { _get: async () => ({ version: 0, generated_at: null, failures_analyzed: 0, changes: [] }) });
    await el._loadData(); let h = html(el);
    assert.match(h, /No optimization run yet/); assert.doesNotMatch(h, /v0/); assert.doesNotMatch(h, /info-value">0</);
    el._api = { _get: async () => ({ version: 3, generated_at: new Date().toISOString(), failures_analyzed: 0 }) };
    await el._loadData(); h = html(el); assert.match(h, /v3/); assert.match(h, /info-value">0</);
  });
});

describe('app status, keys, runs, checklist, gates, diff, preview', async () => {
  it('app status is Unknown before a read and for an error status; Not Started only when reported', async () => {
    const { LokiAppStatus } = await import(C('loki-app-status.js'));
    const el = mk(LokiAppStatus); el._logs = []; el.render(); let h = html(el);
    assert.doesNotMatch(h, /Not Started/); assert.doesNotMatch(h, /not running yet/); assert.match(h, /Unknown/);
    el._status = { status: 'error' }; el.render(); h = html(el); assert.doesNotMatch(h, /Not Started/); assert.match(h, /App status unknown/);
    el._status = { status: 'not_initialized' }; el.render(); h = html(el); assert.match(h, /Not Started/);
  });
  it('an API key status is derived from its timestamps, unknown when nothing says', async () => {
    const { deriveKeyStatus } = await import(C('loki-api-keys.js'));
    assert.equal(deriveKeyStatus({ revoked: false, expires_at: null }), 'active');
    assert.equal(deriveKeyStatus({ revoked: false, expires_at: '2000-01-01T00:00:00+00:00' }), 'expired');
    assert.equal(deriveKeyStatus({ revoked: false, rotation_expires_at: '2999-01-01T00:00:00+00:00' }), 'rotating');
    assert.equal(deriveKeyStatus({}), 'unknown');
  });
  it('a run with no end time grows only while live', async () => {
    const { formatRunDuration } = await import(C('loki-run-manager.js'));
    const start = new Date(Date.now() - 65000).toISOString();
    assert.equal(formatRunDuration(null, start, null), '--');
    assert.match(formatRunDuration(null, start, null, true), /^1m/);
    assert.equal(formatRunDuration(null, start, new Date(Date.parse(start) + 2000).toISOString()), '2s');
  });
  it('checklist: unreadable waivers are unknown, not "0 waived"; a real empty list is', async () => {
    const { LokiChecklistViewer } = await import(C('loki-checklist-viewer.js'));
    const checklist = { status: 'ok', summary: { total: 2, verified: 1, failing: 1, pending: 0 },
      categories: [{ name: 'c', items: [{ id: 'a', status: 'failing', priority: 'critical' }] }] };
    const el = mk(LokiChecklistViewer);
    el._api = { getChecklist: async () => checklist, getChecklistWaivers: async () => { throw new Error('x'); } };
    await el._loadData(); let h = html(el);
    assert.match(h, /waivers unknown/); assert.doesNotMatch(h, /0 waived/); assert.match(h, /COUNCIL GATE: UNKNOWN/);
    el._api = { getChecklist: async () => checklist, getChecklistWaivers: async () => ({ waivers: [] }) };
    el._lastDataHash = null; await el._loadData(); h = html(el); assert.match(h, /0 waived/); assert.match(h, /COUNCIL GATE: BLOCKED/);
  });
  it('quality gates: no rows is "No gate results recorded yet", never eight pending rows or "Never"', async () => {
    const { LokiQualityGates, summarizeGates } = await import(C('loki-quality-gates.js'));
    assert.deepEqual(summarizeGates([{}, { status: 'pass' }]), { pass: 1, fail: 0, pending: 0, notEvaluated: 1, total: 2 });
    const el = mount(LokiQualityGates, { _get: async (p) => (p === '/api/council/gate'
      ? { blocked: false, gates: [], gates_reason: 'No per-gate results recorded' } : { gates: [] }) });
    await el._loadData(); let h = html(el);
    assert.match(h, /No gate results recorded yet/); assert.doesNotMatch(h, /Never/); assert.doesNotMatch(h, /Pending/);
    const el2 = mount(LokiQualityGates, { _get: fail }); await el2._loadData(); h = html(el2);
    assert.match(h, /Could not read gate results/); assert.doesNotMatch(h, /No gate results/);
  });
  it('session diff reads the keys the server sends; a failed read is an error', async () => {
    const { LokiSessionDiff } = await import(C('loki-session-diff.js'));
    const el = mount(LokiSessionDiff, { _get: async () => ({ since: 'x', period_hours: 24,
      summary: { tasks_created: 3, tasks_completed: 1, tasks_blocked: 0, errors: 2 }, highlights: [], decisions: [] }) });
    await el._loadData(); let h = html(el);
    assert.match(h, /Last 24h/); assert.match(h, /summary-value">3</); assert.doesNotMatch(h, /Fills in after/);
    const el2 = mount(LokiSessionDiff, { _get: fail }); await el2._loadData(); h = html(el2);
    assert.match(h, /Could not load session diff/); assert.doesNotMatch(h, /Nothing to compare/);
  });
  it('app preview does not claim "No app running yet" before a read or after a failed one', async () => {
    const { LokiAppPreview } = await import(C('loki-app-preview.js'));
    const el = mk(LokiAppPreview); el.render(); let h = html(el);
    assert.doesNotMatch(h, /No app running yet/); assert.match(h, /Checking app status/);
    el._api = { getAppRunnerStatus: fail }; await el._loadData(); h = html(el);
    assert.match(h, /Could not read app status/); assert.doesNotMatch(h, /No app running yet/);
    el._error = null; el._status = { status: 'not_initialized' }; el.render(); h = html(el); assert.match(h, /No app running yet/);
  });
});

// BACKLOG 113: the audit viewer printed "[VALID] ... verified" for any result
// whose `valid` was not false, so a server that checked zero files read as a
// verified chain, and its catch turned a failed request into "[TAMPERED]".
// A verdict needs a computed result behind it: VALID only for valid === true
// with files checked, TAMPERED only for a chain the server found broken.
describe('audit viewer verify banner', async () => {
  const { LokiAuditViewer } = await import(C('loki-audit-viewer.js'));
  const verify = async (get) => {
    const el = mount(LokiAuditViewer, { _get: get });
    await el._verifyIntegrity();
    return html(el);
  };
  it('a chain with files checked reads VALID (control)', async () => {
    const h = await verify(async () => ({ valid: true, files_checked: 2, entries_checked: 9 }));
    assert.match(h, /\[VALID\]/); assert.doesNotMatch(h, /TAMPERED|NOT VERIFIED/);
  });
  it('zero files checked is not a verified chain', async () => {
    const h = await verify(async () => ({ valid: true, files_checked: 0, entries_checked: 0 }));
    assert.doesNotMatch(h, /\[VALID\]|integrity verified/i); assert.doesNotMatch(h, /TAMPERED/);
    assert.match(h, /NOT VERIFIED/); assert.match(h, /nothing was checked/i);
  });
  it('a failed request reads NOT VERIFIED (could not check), never TAMPERED', async () => {
    const h = await verify(fail);
    assert.doesNotMatch(h, /TAMPERED|\[VALID\]/); assert.match(h, /NOT VERIFIED/); assert.match(h, /could not check/i);
  });
  it('a body with no verdict reads NOT VERIFIED', async () => {
    const h = await verify(async () => ({ detail: 'Not authenticated' }));
    assert.doesNotMatch(h, /TAMPERED|\[VALID\]/); assert.match(h, /NOT VERIFIED/);
  });
  it('a broken chain reads TAMPERED with where it broke (control)', async () => {
    const h = await verify(async () => ({ valid: false, files_checked: 1, entries_checked: 1,
      first_tampered_file: '/x/audit-2026-09-26.jsonl', first_tampered_line: 2 }));
    assert.match(h, /\[TAMPERED\]/); assert.match(h, /audit-2026-09-26\.jsonl/); assert.match(h, /line 2/);
    assert.doesNotMatch(h, /\[VALID\]/);
  });
});
