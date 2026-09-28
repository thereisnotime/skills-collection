// BACKLOG 123 (S-188): the overview "Gates and evidence" proof card wording
// had no test of its own. Pins loki-overview.js _renderJourney proofValue and
// proofMeta: no proof reads "Not evaluated", a recorded headline carries the
// "Recorded, not re-verified here; " prefix, and gaps null reads
// "uncertainty not measured" (never a fabricated "no recorded gaps").
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const fakeClassList = { contains: () => false, add() {}, remove() {}, toggle() {} };
globalThis.document = {
  body: { classList: fakeClassList },
  documentElement: { classList: fakeClassList, dataset: {}, style: { setProperty() {} } },
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
};

class FakeHTMLElement {
  attachShadow() {
    this._shadow = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    return this._shadow;
  }
  get shadowRoot() { return this._shadow; }
  getAttribute() { return null; }
  hasAttribute() { return false; }
}

globalThis.HTMLElement = FakeHTMLElement;
globalThis.customElements = {
  _defined: new Map(),
  define(name, ctor) { this._defined.set(name, ctor); },
  get(name) { return this._defined.get(name); },
};
globalThis.window = {
  location: { origin: 'http://localhost:57374' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let LokiOverview;
before(async () => ({ LokiOverview } = await import('../components/loki-overview.js')));

// Render an issue-run receipt with the given honesty block and return the
// value and meta text of the "Gates and evidence" step only.
function proofCard(honesty) {
  const el = new LokiOverview();
  el.attachShadow({ mode: 'open' });
  el._data.connected = true;
  el._journeyState = 'ready';
  el._journeyProof = { facts: { journey: { issue: { ref: 'owner/repo#42' } } } };
  if (honesty !== undefined) el._journeyProof.honesty = honesty;
  el.render();
  const out = el.shadowRoot.innerHTML;
  const m = out.match(/<div class="journey-label">Gates and evidence<\/div>\s*<div class="journey-value">([^<]*)<\/div>\s*<div class="journey-meta">([^<]*)<\/div>/);
  assert.ok(m, 'Gates and evidence step not rendered');
  return { value: m[1], meta: m[2] };
}

describe('overview proof card wording (BACKLOG 123)', () => {
  it('no proof verdict reads "Not evaluated" with no recorded-copy prefix', () => {
    for (const honesty of [undefined, null, {}]) {
      const { value, meta } = proofCard(honesty);
      assert.equal(value, 'Not evaluated');
      assert.equal(meta, 'uncertainty not measured');
    }
  });

  it('a recorded headline carries the "Recorded, not re-verified here;" prefix', () => {
    const { value, meta } = proofCard({ headline: 'VERIFIED', degraded: [] });
    assert.equal(value, 'VERIFIED');
    assert.ok(meta.startsWith('Recorded, not re-verified here; '), `meta was: ${meta}`);
    assert.equal(meta, 'Recorded, not re-verified here; no recorded gaps');
  });

  it('gaps null reads "uncertainty not measured", never "no recorded gaps"', () => {
    const { meta } = proofCard({ headline: 'VERIFIED' });
    assert.equal(meta, 'Recorded, not re-verified here; uncertainty not measured');
    assert.doesNotMatch(meta, /no recorded gaps/);
  });

  it('counts recorded gaps with correct pluralisation', () => {
    assert.equal(proofCard({ headline: 'NOT VERIFIED', degraded: [{ item: 'e2e' }] }).meta,
      'Recorded, not re-verified here; 1 recorded gap');
    assert.equal(proofCard({ headline: 'NOT VERIFIED', degraded: [{}, {}, {}] }).meta,
      'Recorded, not re-verified here; 3 recorded gaps');
  });
});
