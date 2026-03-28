/**
 * @fileoverview Loki KPI Card Component - displays a key performance indicator
 * with icon, animated counter, label, trend arrow, percentage, and SVG sparkline.
 *
 * G69: KPI Cards with Sparklines
 *
 * @example
 * <loki-kpi-card
 *   label="Tasks Completed"
 *   value="42"
 *   trend="up"
 *   trend-value="+12%"
 *   sparkline="10,15,13,17,20,18,22,25,30,42"
 *   icon="check-circle"
 *   compact
 * ></loki-kpi-card>
 */

import { LokiElement } from '../core/loki-theme.js';

/**
 * @class LokiKpiCard
 * @extends LokiElement
 * @property {string} label - KPI label text
 * @property {string} value - Metric value to display
 * @property {string} trend - Trend direction: "up", "down", or "flat"
 * @property {string} trend-value - Trend percentage text (e.g., "+12%")
 * @property {string} sparkline - Comma-separated data points (last 10)
 * @property {string} icon - Icon type: "check-circle", "clock", "zap", "dollar", "users", "alert"
 * @property {boolean} compact - Compact mode for sidebar display
 */
export class LokiKpiCard extends LokiElement {
  static get observedAttributes() {
    return ['label', 'value', 'trend', 'trend-value', 'sparkline', 'icon', 'compact', 'theme'];
  }

  constructor() {
    super();
    this._animatedValue = 0;
    this._targetValue = 0;
    this._animationFrame = null;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === 'value') {
      const numVal = parseFloat(newValue);
      if (!isNaN(numVal)) {
        this._targetValue = numVal;
        this._animateCounter();
      }
    }
    if (name === 'theme') {
      this._applyTheme();
    }
    this.render();
  }

  _animateCounter() {
    const start = this._animatedValue;
    const end = this._targetValue;
    const duration = 600;
    const startTime = performance.now();

    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      this._animatedValue = Math.round(start + (end - start) * eased);

      const valueEl = this.shadowRoot?.querySelector('.kpi-value');
      if (valueEl) {
        valueEl.textContent = this._formatValue(this._animatedValue);
      }

      if (progress < 1) {
        this._animationFrame = requestAnimationFrame(step);
      }
    };

    if (this._animationFrame) cancelAnimationFrame(this._animationFrame);
    this._animationFrame = requestAnimationFrame(step);
  }

  _formatValue(val) {
    // Use raw attribute if not a number
    const rawVal = this.getAttribute('value') || '0';
    if (isNaN(parseFloat(rawVal))) return rawVal;

    if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
    if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
    return String(val);
  }

  _getIconSvg(type) {
    const icons = {
      'check-circle': '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
      'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      'dollar': '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
      'users': '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
      'alert': '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
      'activity': '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
      'bar-chart': '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    };
    return icons[type] || icons['activity'];
  }

  _renderSparkline(dataStr) {
    if (!dataStr) return '';
    const points = dataStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    if (points.length < 2) return '';

    const width = 80;
    const height = 24;
    const padding = 2;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;

    const coords = points.map((val, i) => {
      const x = padding + (i / (points.length - 1)) * (width - padding * 2);
      const y = padding + (1 - (val - min) / range) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const trend = this.getAttribute('trend') || 'flat';
    const strokeColor = trend === 'up' ? 'var(--loki-green)' : trend === 'down' ? 'var(--loki-red)' : 'var(--loki-text-muted)';
    const fillColor = trend === 'up' ? 'var(--loki-green-muted)' : trend === 'down' ? 'var(--loki-red-muted)' : 'var(--loki-bg-tertiary)';

    // Area fill path
    const firstCoord = coords[0];
    const lastCoord = coords[coords.length - 1];
    const areaPath = `M${firstCoord} L${coords.join(' L')} L${lastCoord.split(',')[0]},${height} L${firstCoord.split(',')[0]},${height} Z`;

    return `
      <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${areaPath}" fill="${fillColor}" opacity="0.5"/>
        <polyline points="${coords.join(' ')}" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }

  _getTrendArrow(trend) {
    if (trend === 'up') return '<svg class="trend-arrow up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>';
    if (trend === 'down') return '<svg class="trend-arrow down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
    return '';
  }

  render() {
    const label = this.getAttribute('label') || 'Metric';
    const rawValue = this.getAttribute('value') || '0';
    const trend = this.getAttribute('trend') || 'flat';
    const trendValue = this.getAttribute('trend-value') || '';
    const sparklineData = this.getAttribute('sparkline') || '';
    const iconType = this.getAttribute('icon') || 'activity';
    const isCompact = this.hasAttribute('compact');

    const displayValue = isNaN(parseFloat(rawValue)) ? rawValue : this._formatValue(this._animatedValue || parseFloat(rawValue));

    this.shadowRoot.innerHTML = `
      <style>
        ${this.getBaseStyles()}

        :host {
          display: block;
        }

        .kpi-card {
          background: var(--loki-bg-card);
          border: 1px solid var(--loki-border);
          border-radius: 5px;
          padding: ${isCompact ? '10px 12px' : '14px 16px'};
          transition: all var(--loki-transition);
          display: flex;
          flex-direction: column;
          gap: ${isCompact ? '6px' : '10px'};
        }

        .kpi-card:hover {
          border-color: var(--loki-border-light);
          box-shadow: var(--loki-shadow-sm);
        }

        .kpi-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .kpi-icon {
          width: ${isCompact ? '28px' : '36px'};
          height: ${isCompact ? '28px' : '36px'};
          border-radius: 6px;
          background: var(--loki-accent-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .kpi-icon svg {
          width: ${isCompact ? '14px' : '18px'};
          height: ${isCompact ? '14px' : '18px'};
          stroke: var(--loki-accent);
          fill: none;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .kpi-trend {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 11px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 3px;
        }

        .kpi-trend.up {
          color: var(--loki-green);
          background: var(--loki-green-muted);
        }

        .kpi-trend.down {
          color: var(--loki-red);
          background: var(--loki-red-muted);
        }

        .kpi-trend.flat {
          color: var(--loki-text-muted);
          background: var(--loki-bg-tertiary);
        }

        .trend-arrow {
          width: 12px;
          height: 12px;
        }

        .trend-arrow.up { color: var(--loki-green); }
        .trend-arrow.down { color: var(--loki-red); }

        .kpi-value {
          font-size: ${isCompact ? '20px' : '28px'};
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
          color: var(--loki-text-primary);
          line-height: 1.1;
        }

        .kpi-label {
          font-size: ${isCompact ? '10px' : '11px'};
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--loki-text-muted);
        }

        .sparkline {
          width: 100%;
          height: ${isCompact ? '20px' : '28px'};
          display: block;
        }
      </style>

      <div class="kpi-card">
        <div class="kpi-top">
          <div class="kpi-icon">
            <svg viewBox="0 0 24 24">${this._getIconSvg(iconType)}</svg>
          </div>
          ${trendValue ? `
            <div class="kpi-trend ${this._escapeHtml(trend)}">
              ${this._getTrendArrow(trend)}
              <span>${this._escapeHtml(trendValue)}</span>
            </div>
          ` : ''}
        </div>
        <div class="kpi-value">${this._escapeHtml(displayValue)}</div>
        <div class="kpi-label">${this._escapeHtml(label)}</div>
        ${this._renderSparkline(sparklineData)}
      </div>
    `;
  }

  _escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

if (!customElements.get('loki-kpi-card')) {
  customElements.define('loki-kpi-card', LokiKpiCard);
}

export default LokiKpiCard;
