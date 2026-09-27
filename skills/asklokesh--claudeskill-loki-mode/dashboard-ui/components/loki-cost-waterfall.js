/**
 * @fileoverview Cost Breakdown Waterfall Chart - visualizes cost composition
 * by phase with running total line and budget comparison. Each phase has a
 * colored bar showing its contribution, with hover tooltips for exact amounts.
 *
 * @example
 * <loki-cost-waterfall api-url="http://localhost:57374" theme="dark"></loki-cost-waterfall>
 */

import { LokiElement } from '../core/loki-theme.js';
import { getApiClient } from '../core/loki-api-client.js';
import { registerPoll } from '../core/loki-poll-registry.js';
import { formatUSD } from '../core/loki-unified-styles.js';

/** @type {Object<string, {color: string, label: string}>} Phase color mapping */
const PHASE_COLORS = {
  planning:       { color: 'var(--loki-blue, #2F71E3)',   label: 'Planning' },
  building:       { color: 'var(--loki-green, #1FC5A8)',   label: 'Building' },
  implementation: { color: 'var(--loki-green, #1FC5A8)',   label: 'Building' },
  testing:        { color: 'var(--loki-purple, #553DE9)',  label: 'Testing' },
  review:         { color: 'var(--loki-yellow, #D4A03C)',  label: 'Review' },
  overhead:       { color: 'var(--loki-text-muted, #939084)', label: 'Overhead' },
};

/**
 * @class LokiCostWaterfall
 * @extends LokiElement
 * @property {string} api-url - API base URL (default: window.location.origin)
 * @property {string} theme - Theme name (default: auto-detect)
 */
export class LokiCostWaterfall extends LokiElement {
  static get observedAttributes() {
    return ['api-url', 'theme'];
  }

  constructor() {
    super();
    this._phases = [];
    this._budget = null;
    // null, not 0. Before any fetch nothing has been measured, and seeding a
    // number here makes a component that has never loaded render "$0.00" --
    // a measured-looking claim that the run was free.
    this._totalCost = null;
    this._hoveredPhase = null;
    this._loadFailed = false;
    this._api = null;
    this._pollInterval = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._setupApi();
    this._loadData();
    this._startPolling();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopPolling();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === 'api-url' && this._api) {
      this._api = getApiClient({ baseUrl: newValue });
      this._loadData();
    }
    if (name === 'theme') {
      this._applyTheme();
    }
  }

  _setupApi() {
    const apiUrl = this.getAttribute('api-url') || window.location.origin;
    this._api = getApiClient({ baseUrl: apiUrl });
  }

  _startPolling() {
    // Central registry gates this poll to the active + visible section so a
    // hidden tab or a background section does not fetch. connectedCallback
    // already does the initial load, so immediate is disabled here to avoid a
    // duplicate first fetch.
    this._poll = registerPoll({
      loadFn: () => this._loadData(),
      intervalMs: 10000,
      element: this,
      immediate: false,
    });
  }

  _stopPolling() {
    if (this._poll) {
      this._poll.stop();
      this._poll = null;
    }
  }

  async _loadData() {
    // Capture the api instance so a mid-flight api-url switch can be detected.
    const api = this._api;
    try {
      // /api/cost is the real per-phase cost reader (there was never a
      // /api/v2/cost/breakdown route). A phase nobody measured carries
      // cost_usd null there, and so does the total.
      const cost = await api._get('/api/cost');
      // Drop a stale response if the api-url switched mid-flight.
      if (api !== this._api) return;
      const data = {
        phases: Object.entries(cost.by_phase || {}).map(([phase, v]) => ({ phase, cost_usd: v.cost_usd ?? null })),
        budget_usd: cost.budget_limit,
        total_usd: cost.estimated_cost_usd,
      };
      this._phases = data.phases || [];
      this._budget = data.budget_usd || null;
      // `|| 0` inside a reduce fabricates a total: null + null is 0 in JS, so
      // phases that nobody measured summed to a confident $0.00 while each
      // individual phase correctly rendered "unknown" right beside it. The
      // total is null unless at least ONE phase carries a real number, and
      // sums only the measured ones otherwise.
      if (data.total_usd != null) {
        this._totalCost = data.total_usd;
      } else {
        const measured = this._phases.filter(p => p.cost_usd != null);
        this._totalCost = measured.length
          ? measured.reduce((sum, p) => sum + p.cost_usd, 0)
          : null;
      }
      this._loadFailed = false;
    } catch {
      // Drop a stale response if the api-url switched mid-flight.
      if (api !== this._api) return;
      // A failed read used to draw a hardcoded demo breakdown ($0.85 planning,
      // $3.20 building, a $10 budget) as if it were this run. Keep the last real
      // data if there is any, and otherwise say the read failed.
      this._loadFailed = true;
    }
    this.render();
  }

  _formatCost(usd) {
    // Was '--', which reads as a value (a minus, a zero rule) rather than an
    // absent measurement.
    return formatUSD(usd);
  }

  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _bindEvents() {
    const root = this.shadowRoot;
    root.querySelectorAll('.waterfall-bar').forEach(bar => {
      bar.addEventListener('mouseenter', () => {
        this._hoveredPhase = bar.dataset.phase;
        this._updateTooltip(bar);
      });
      bar.addEventListener('mouseleave', () => {
        this._hoveredPhase = null;
        this._hideTooltip();
      });
    });
  }

  _updateTooltip(barEl) {
    const tooltip = this.shadowRoot.querySelector('.tooltip');
    if (!tooltip) return;
    const phase = this._phases.find(p => p.phase === this._hoveredPhase);
    if (!phase) return;
    const cfg = PHASE_COLORS[phase.phase] || { label: phase.phase };
    tooltip.innerHTML = `<strong>${this._escapeHtml(cfg.label)}</strong>: ${this._formatCost(phase.cost_usd)}`;
    tooltip.style.display = 'block';
    const rect = barEl.getBoundingClientRect();
    const containerRect = this.shadowRoot.querySelector('.chart-area').getBoundingClientRect();
    tooltip.style.left = (rect.left - containerRect.left + rect.width / 2) + 'px';
    tooltip.style.top = (rect.top - containerRect.top - 30) + 'px';
  }

  _hideTooltip() {
    const tooltip = this.shadowRoot.querySelector('.tooltip');
    if (tooltip) tooltip.style.display = 'none';
  }

  _getStyles() {
    return `
      :host {
        display: block;
      }

      .waterfall-container {
        font-family: var(--loki-font-family, 'Inter', -apple-system, sans-serif);
        color: var(--loki-text-primary, #201515);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .title {
        font-size: 16px;
        font-weight: 600;
        margin: 0;
      }

      .total-cost {
        font-size: 14px;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
        color: var(--loki-accent, #553DE9);
      }

      .chart-card {
        background: var(--loki-bg-card, #ffffff);
        border: 1px solid var(--loki-border, #ECEAE3);
        border-radius: 5px;
        padding: 20px;
      }

      .chart-area {
        position: relative;
        display: flex;
        align-items: flex-end;
        gap: 8px;
        height: 200px;
        padding-bottom: 40px;
        border-bottom: 1px solid var(--loki-border, #ECEAE3);
      }

      .bar-group {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100%;
        justify-content: flex-end;
        position: relative;
      }

      .waterfall-bar {
        width: 100%;
        max-width: 60px;
        border-radius: 4px 4px 0 0;
        transition: all 0.3s ease;
        cursor: pointer;
        min-height: 4px;
        position: relative;
      }

      .waterfall-bar:hover {
        opacity: 0.85;
        transform: scaleY(1.03);
        transform-origin: bottom;
      }

      .bar-label {
        position: absolute;
        bottom: -32px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 10px;
        font-weight: 600;
        color: var(--loki-text-muted, #939084);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        white-space: nowrap;
      }

      .bar-value {
        position: absolute;
        top: -20px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 11px;
        font-family: 'JetBrains Mono', monospace;
        color: var(--loki-text-secondary, #36342E);
        white-space: nowrap;
      }

      .budget-line {
        position: absolute;
        left: 0;
        right: 0;
        border-top: 2px dashed var(--loki-red, #C45B5B);
        z-index: 1;
      }

      .budget-label {
        position: absolute;
        right: 0;
        top: -16px;
        font-size: 10px;
        font-family: 'JetBrains Mono', monospace;
        color: var(--loki-red, #C45B5B);
        font-weight: 600;
      }

      .running-total-line {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 40px;
        height: calc(100% - 40px);
        pointer-events: none;
      }

      .running-total-line svg {
        width: 100%;
        height: 100%;
      }

      .tooltip {
        display: none;
        position: absolute;
        background: var(--loki-bg-primary, #FFFEFB);
        border: 1px solid var(--loki-border, #ECEAE3);
        border-radius: 4px;
        padding: 6px 10px;
        font-size: 12px;
        box-shadow: var(--loki-shadow-md, 0 4px 6px rgba(32, 21, 21, 0.06));
        white-space: nowrap;
        z-index: 10;
        transform: translateX(-50%);
        pointer-events: none;
      }

      .summary-row {
        display: flex;
        gap: 16px;
        margin-top: 16px;
        flex-wrap: wrap;
      }

      .summary-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
      }

      .summary-dot {
        width: 10px;
        height: 10px;
        border-radius: 3px;
        flex-shrink: 0;
      }

      .summary-label {
        color: var(--loki-text-secondary, #36342E);
        font-weight: 500;
      }

      .summary-value {
        font-family: 'JetBrains Mono', monospace;
        color: var(--loki-text-muted, #939084);
        font-size: 11px;
      }

      .empty-state {
        text-align: center;
        padding: 32px 16px;
        color: var(--loki-text-muted, #939084);
        font-size: 13px;
      }
    `;
  }

  render() {
    const s = this.shadowRoot;
    if (!s) return;

    if (this._phases.length === 0) {
      const msg = this._loadFailed
        ? 'Could not load the cost breakdown. Nothing is shown rather than a guess.'
        : 'Cost details will appear once a build starts running.';
      s.innerHTML = `
        <style>${this.getBaseStyles()}${this._getStyles()}</style>
        <div class="waterfall-container">
          <div class="header">
            <h3 class="title">Cost Breakdown</h3>
          </div>
          <div class="empty-state">${msg}</div>
        </div>
      `;
      return;
    }

    // Scale over measured phases only. An unmeasured phase is drawn as an
    // outlined placeholder, never as a bar that reads as zero dollars.
    const measured = this._phases.filter(p => p.cost_usd != null);
    const maxCost = Math.max(...measured.map(p => p.cost_usd), 0.01);
    const partial = this._totalCost != null && measured.length < this._phases.length ? ' (partial)' : '';
    const chartHeight = 160; // usable height in pixels
    const maxBarHeight = this._budget ? Math.max(maxCost, this._budget) : maxCost;

    // Budget line position
    const budgetLineBottom = this._budget ? (this._budget / maxBarHeight) * chartHeight : null;

    // Build bars
    const bars = this._phases.map(p => {
      const cfg = PHASE_COLORS[p.phase] || { color: 'var(--loki-text-muted)', label: p.phase };
      const isHovered = this._hoveredPhase === p.phase;
      const unmeasured = p.cost_usd == null;
      const style = unmeasured
        ? `height: 4px; border: 1px dashed ${cfg.color}; background: transparent;`
        : `height: ${Math.max((p.cost_usd / maxBarHeight) * chartHeight, 4)}px; background: ${cfg.color}; ${isHovered ? 'opacity: 0.85;' : ''}`;

      return `
        <div class="bar-group">
          <span class="bar-value">${this._formatCost(p.cost_usd)}</span>
          <div class="waterfall-bar${unmeasured ? ' unmeasured' : ''}" data-phase="${this._escapeHtml(p.phase)}"
               style="${style}">
          </div>
          <span class="bar-label">${this._escapeHtml(cfg.label)}</span>
        </div>
      `;
    }).join('');

    // Budget line
    const budgetHtml = budgetLineBottom != null ? `
      <div class="budget-line" style="bottom: ${budgetLineBottom + 40}px;">
        <span class="budget-label">Budget: ${this._formatCost(this._budget)}</span>
      </div>
    ` : '';

    // Summary
    const summaryItems = this._phases.map(p => {
      const cfg = PHASE_COLORS[p.phase] || { color: 'var(--loki-text-muted)', label: p.phase };
      // A share of the total exists only for a measured phase over a measured total.
      const pct = p.cost_usd != null && this._totalCost > 0
        ? ` (${((p.cost_usd / this._totalCost) * 100).toFixed(0)}%)` : '';
      return `<div class="summary-item">
        <div class="summary-dot" style="background: ${cfg.color};"></div>
        <span class="summary-label">${this._escapeHtml(cfg.label)}</span>
        <span class="summary-value">${this._formatCost(p.cost_usd)}${pct}</span>
      </div>`;
    }).join('');

    s.innerHTML = `
      <style>${this.getBaseStyles()}${this._getStyles()}</style>
      <div class="waterfall-container">
        <div class="header">
          <h3 class="title">Cost Breakdown</h3>
          <span class="total-cost">Total: ${this._formatCost(this._totalCost)}${partial}</span>
        </div>
        <div class="chart-card">
          <div class="chart-area">
            ${bars}
            ${budgetHtml}
            <div class="tooltip"></div>
          </div>
          <div class="summary-row">
            ${summaryItems}
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
  }
}

if (!customElements.get('loki-cost-waterfall')) {
  customElements.define('loki-cost-waterfall', LokiCostWaterfall);
}

export default LokiCostWaterfall;
