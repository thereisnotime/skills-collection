#!/usr/bin/env python3
"""Report run-written values interpolated into dashboard HTML without escaping.

The dashboard builds markup as strings and assigns it to innerHTML. A value
that came from the API (a run wrote it: a task title, a log line, a receipt
field) and is spliced into that markup unescaped is an XSS sink. Cycle 4 fixed
two such panels in build-standalone.js (f6050ef1); this guard stops the class
coming back.

WHAT IS SCANNED: every .js under dashboard-ui/components (vendor/ too) and
dashboard-ui/scripts/build-standalone.js. build-standalone.js emits the browser
code inside one big Node template literal, so the <script> bodies inside any
template literal are re-tokenized as JavaScript; otherwise every browser-side
concatenation there would read as inert template text.

WHAT IS AN HTML STRING: a template literal whose static text contains a tag
(`<b`, `</div`), and a `+` chain containing a string literal with a tag. Every
value that reaches the output of one of those is examined. The condition of a
ternary and the left side of `&&` are skipped (they choose, they do not print).

A VALUE IS SAFE WHEN it is mechanically provable:
  - a whole call to the file's escape helper (`_escapeHtml`, `_escapeHTML`,
    `escapeHtml`, `esc`, `_esc`, `escapeAttr`, ...);
  - a numeric coercion (`Number(...)`, `Math.*`, `parseInt`, `parseFloat`,
    `x.toFixed(...)`, `x.length`) or a numeric literal;
  - a string literal, or a nested HTML template (scanned on its own);
  - a bare local identifier or a `this._render*`/`this._*Html` style method
    call with no arguments that reach data: see CEILING.

CEILING (ponytail): a bare identifier (`${body}`, `${styles}`) or a call to a
markup-building method (`${this._renderRows()}`) is treated as composition of
markup built elsewhere in the same file, and that builder's own HTML strings
are scanned where they are written. A local variable that holds a raw API
field (`const n = data.name; html = '<b>' + n`) is therefore NOT caught. The
upgrade is local dataflow (track `const x = <member access>`), add it when a
bare-identifier XSS is found in review.

Exit 0 = every finding is in ALLOWLIST. Exit 1 = an unlisted finding. Exit 2 =
the scan could not run, or ALLOWLIST carries an entry without a real reason
(unmeasured, never reported as clean).

Usage: scan-unescaped-innerhtml.py [--stats] [FILE ...]
With FILE arguments only those files are scanned (the test's planted fixture);
paths are reported relative to the repo root when inside it.
"""
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Findings that were looked at and judged not exploitable, keyed by
# "<repo-relative file>::<expression with whitespace removed>" (also inside
# string literals, so join(' ') is keyed as join('')). Every reason
# must say WHY the value cannot carry markup (at least 40 characters). Adding an
# entry is a deliberate act that shows up in review as one; it is not a way to
# silence the check.
# _RISK entries are the S-171 audit's findings: a run-written value reaches
# markup unescaped. They are listed so the guard can land green and stop NEW
# sites; each one is a fix-forward item, not a verdict that it is safe.
_RISK = ("REPORTED (S-171): an API response field spliced into markup with no "
         "escape; a hostile or corrupt .loki file can inject HTML here. Fix by "
         "wrapping it in the escape helper, then delete this entry.")
_SELF = ("SELF-ONLY: the viewer's own input value echoed back into its value "
         "attribute; not API data, still worth escaping")
ALLOWLIST = {
    'dashboard-ui/components/loki-analytics.js::m.col':
        'Math.max(weekCol, 1): a number computed from the loop counter',
    'dashboard-ui/components/loki-analytics.js::m.month':
        'months[getMonth()], an index into the constant month-name array',
    'dashboard-ui/components/loki-analytics.js::c.date':
        'this._localDateKey(date): a YYYY-MM-DD key built from Date getters',
    'dashboard-ui/components/loki-analytics.js::c.count':
        'counts[key] || 0, where counts[key] is only ever built by (counts[key] || 0) + 1',
    'dashboard-ui/components/loki-analytics.js::cfg.color':
        'config lookup: providerConfig[key] || providerConfig.unknown, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-analytics.js::cfg.label':
        'config lookup: providerConfig[key] || providerConfig.unknown, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-analytics.js::data.tokens.toLocaleString()':
        _RISK,
    'dashboard-ui/components/loki-analytics.js::t.id':
        'loop variable over the render() tabs array, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-analytics.js::t.label':
        'loop variable over the render() tabs array, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-analytics.js::t.icon':
        'loop variable over the render() tabs array (constant SVG strings), a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-api-keys.js::this._createExpiration':
        _SELF,
    'dashboard-ui/components/loki-api-keys.js::this._rotateGracePeriod':
        _SELF,
    'dashboard-ui/components/loki-app-preview.js::cfg.color':
        'config lookup: STATUS_CONFIG[view] || STATUS_CONFIG.unknown, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-app-status.js::cfg.color':
        'config lookup: STATUS_CONFIG[status] || STATUS_CONFIG.unknown, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-app-status.js::st.restart_count':
        _RISK,
    'dashboard-ui/components/loki-audit-viewer.js::v.kind':
        "auditVerifyVerdict returns kind as one of the literals 'valid', 'invalid' or 'unchecked'",
    'dashboard-ui/components/loki-audit-viewer.js::this._filters.dateFrom':
        _SELF,
    'dashboard-ui/components/loki-audit-viewer.js::this._filters.dateTo':
        _SELF,
    'dashboard-ui/components/loki-checklist-viewer.js::summary.verified':
        _RISK,
    'dashboard-ui/components/loki-checklist-viewer.js::summary.failing':
        _RISK,
    'dashboard-ui/components/loki-checklist-viewer.js::summary.pending':
        _RISK,
    'dashboard-ui/components/loki-checklist-viewer.js::summary.total':
        _RISK,
    'dashboard-ui/components/loki-context-tracker.js::this._formatTokens(current.total_tokens)':
        _RISK,
    'dashboard-ui/components/loki-context-tracker.js::this._formatTokens(current.input_tokens)':
        _RISK,
    'dashboard-ui/components/loki-context-tracker.js::this._formatTokens(current.output_tokens)':
        _RISK,
    'dashboard-ui/components/loki-context-tracker.js::totals.compaction_count':
        _RISK,
    'dashboard-ui/components/loki-context-tracker.js::totals.iterations_tracked':
        _RISK,
    'dashboard-ui/components/loki-context-tracker.js::this._formatTokens(current.cache_read_tokens)':
        _RISK,
    'dashboard-ui/components/loki-context-tracker.js::this._formatTokens(current.cache_creation_tokens)':
        _RISK,
    'dashboard-ui/components/loki-context-tracker.js::it.iteration':
        _RISK,
    'dashboard-ui/components/loki-context-tracker.js::this._formatTokens(totalIt)':
        _RISK,
    'dashboard-ui/components/loki-cost-waterfall.js::cfg.color':
        'config lookup: PHASE_COLORS[phase] with a fallback whose color is a literal or absent, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-council-dashboard.js::tab.id':
        'loop variable over COUNCIL_TABS, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-council-dashboard.js::tab.label':
        'loop variable over COUNCIL_TABS, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-council-dashboard.js::show(noChange)':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::show(doneSignals)':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::lastVerdict.result':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::lastVerdict.iteration':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::p.iteration':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::p.files_changed':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::v.result':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::v.iteration':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::v.approve':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::v.reject':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::p.no_change_streak':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::p.done_signals':
        _RISK,
    'dashboard-ui/components/loki-council-dashboard.js::agent.pid':
        _RISK,
    'dashboard-ui/components/loki-council-transcripts.js::sev.toLowerCase()':
        'sev is already this._escapeHtml(iss.severity); lowercasing escaped text keeps every entity intact',
    'dashboard-ui/components/loki-fleet.js::cfg.bg':
        'config lookup: FLEET_STATUS_CONFIG[status] || FLEET_STATUS_CONFIG.unknown, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-fleet.js::cfg.color':
        'config lookup: FLEET_STATUS_CONFIG[status] || FLEET_STATUS_CONFIG.unknown, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-fleet.js::cfg.label':
        'config lookup: FLEET_STATUS_CONFIG[status] || FLEET_STATUS_CONFIG.unknown, a constant table in this file, so the value is a literal written here',
    "dashboard-ui/components/loki-kpi-card.js::coords.join('')":
        'coords are x,y numbers computed from points, which are parseFloat()ed and NaN-filtered',
    'dashboard-ui/components/loki-learning-dashboard.js::t.id':
        'loop variable over TIME_RANGES and SIGNAL_TYPES, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-learning-dashboard.js::t.label':
        'loop variable over TIME_RANGES and SIGNAL_TYPES, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-learning-dashboard.js::s.id':
        'loop variable over SIGNAL_SOURCES, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-learning-dashboard.js::s.label':
        'loop variable over SIGNAL_SOURCES, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-learning-dashboard.js::p.frequency':
        _RISK,
    'dashboard-ui/components/loki-learning-dashboard.js::e.frequency':
        _RISK,
    'dashboard-ui/components/loki-learning-dashboard.js::s.frequency':
        _RISK,
    'dashboard-ui/components/loki-learning-dashboard.js::item.frequency':
        _RISK,
    'dashboard-ui/components/loki-log-stream.js::levelConfig.color':
        'config lookup: LOG_LEVELS[log.level] || LOG_LEVELS.info, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-log-stream.js::this._autoScroll':
        "a boolean toggled by the component's own button, never assigned from a response",
    'dashboard-ui/components/loki-managed-memory-panel.js::this._eventsCount':
        'assigned only data.length, a typeof-number-checked data.count, events.length or 0',
    'dashboard-ui/components/loki-memory-browser.js::r.rank':
        _RISK,
    'dashboard-ui/components/loki-memory-browser.js::this._stats.episode_count':
        _RISK,
    'dashboard-ui/components/loki-memory-browser.js::this._stats.pattern_count':
        _RISK,
    'dashboard-ui/components/loki-memory-browser.js::this._stats.skill_count':
        _RISK,
    'dashboard-ui/components/loki-memory-browser.js::item.duration_seconds':
        _RISK,
    'dashboard-ui/components/loki-memory-browser.js::tab.id':
        'loop variable over TABS, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-memory-browser.js::tab.icon':
        'loop variable over TABS (constant SVG strings), a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-memory-browser.js::tab.label':
        'loop variable over TABS, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-memory-browser.js::this._activeTab':
        "set only from a TABS entry's id by the component's own tab clicks",
    'dashboard-ui/components/loki-migration-dashboard.js::PHASE_LABELS[phase]':
        'config lookup: PHASE_LABELS, an object literal of four words, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-migration-dashboard.js::PHASE_LABELS[currentPhase]':
        'config lookup: PHASE_LABELS, an object literal of four words, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-notification-center.js::show(unack)':
        _RISK,
    'dashboard-ui/components/loki-notification-center.js::SEVERITY_COLORS.critical':
        'config lookup: SEVERITY_COLORS, an object literal of CSS colors, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-notification-center.js::catCfg.icon':
        "config lookup: CATEGORIES[category] with a fallback icon of the literal '?', a constant table in this file, so the value is a literal written here",
    'dashboard-ui/components/loki-notification-center.js::n.iteration':
        _RISK,
    'dashboard-ui/components/loki-overview.js::s.verified':
        _RISK,
    'dashboard-ui/components/loki-overview.js::s.total':
        _RISK,
    'dashboard-ui/components/loki-overview.js::s.failing':
        _RISK,
    'dashboard-ui/components/loki-quality-gates.js::cfg.bg':
        'config lookup: GATE_STATUS_CONFIG[status], a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-quality-gates.js::cfg.color':
        'config lookup: GATE_STATUS_CONFIG[status], a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-quality-gates.js::this._policyLine(gate.name)':
        'REPORTED (S-171): markup builder that escapes promote_with but interpolates p.audit_hits raw through a non-HTML template',
    'dashboard-ui/components/loki-quality-gates.js::summary.pass':
        'summarizeGates returns integer counters incremented in this file, never a response value',
    'dashboard-ui/components/loki-quality-gates.js::summary.fail':
        'summarizeGates returns integer counters incremented in this file, never a response value',
    'dashboard-ui/components/loki-quality-gates.js::summary.pending':
        'summarizeGates returns integer counters incremented in this file, never a response value',
    'dashboard-ui/components/loki-quality-gates.js::summary.notEvaluated':
        'summarizeGates returns integer counters incremented in this file, never a response value',
    "dashboard-ui/components/loki-quality-score.js::points.split('').pop().split(',')[0]":
        'points is joined x,y numbers from arithmetic over values; a piece of it is a number',
    "dashboard-ui/components/loki-quality-score.js::points.split('').pop().split(',')[1]":
        'points is joined x,y numbers from arithmetic over values; a piece of it is a number',
    'dashboard-ui/components/loki-quality-score.js::categoryLabels[name]':
        'config lookup: categoryLabels, an object literal of words (undefined for any other key), a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-quality-score.js::s.cls':
        'loop variable over the severities array, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-quality-score.js::s.label':
        'loop variable over the severities array, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-quality-score.js::findings[s.key]':
        'rendered only after the filter (findings[s.key] || 0) > 0 held, which a string passes only when Number() parses it',
    'dashboard-ui/components/loki-rarv-timeline.js::cfg.color':
        'config lookup: PHASE_CONFIG[phase], a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-rarv-timeline.js::cfg.label':
        'config lookup: PHASE_CONFIG[phase], a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-rarv-timeline.js::cfg.description':
        'config lookup: PHASE_CONFIG[phase], a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-rarv-timeline.js::formatTokens(phaseData?.tokens_used)':
        _RISK,
    'dashboard-ui/components/loki-rarv-timeline.js::phaseData.action_count':
        _RISK,
    'dashboard-ui/components/loki-rarv-timeline.js::pw.phase':
        _RISK,
    'dashboard-ui/components/loki-rarv-timeline.js::p.phase':
        _RISK,
    'dashboard-ui/components/loki-run-manager.js::run.id':
        _RISK,
    'dashboard-ui/components/loki-run-manager.js::cfg.bg':
        'config lookup: RUN_STATUS_CONFIG[status], whose fallback spreads RUN_STATUS_CONFIG.unknown and overrides only label, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-run-manager.js::cfg.color':
        'config lookup: RUN_STATUS_CONFIG[status], whose fallback spreads RUN_STATUS_CONFIG.unknown and overrides only label, a constant table in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-run-manager.js::f.source':
        "core/loki-freshness.js dataFreshness returns source as one of the literals 'server', 'client' or 'none'",
    'dashboard-ui/components/loki-run-manager.js::String(f.isStale)':
        "String() of dataFreshness isStale, a boolean in this non-null branch, so 'true' or 'false'",
    'dashboard-ui/components/loki-session-control.js::this._status.version':
        _RISK,
    'dashboard-ui/components/loki-session-diff.js::counts.tasks_created':
        _RISK,
    'dashboard-ui/components/loki-session-diff.js::counts.tasks_completed':
        _RISK,
    'dashboard-ui/components/loki-session-diff.js::counts.tasks_blocked':
        _RISK,
    'dashboard-ui/components/loki-session-diff.js::counts.errors':
        _RISK,
    'dashboard-ui/components/loki-session-timeline.js::config.color':
        "_phaseStyle returns PHASE_COLORS[...].color or the literal 'var(--loki-text-muted)'",
    'dashboard-ui/components/loki-session-timeline.js::m.pct':
        'marker percentages computed by arithmetic over the timeline bounds',
    'dashboard-ui/components/loki-session-timeline.js::`#${phase.iteration}`':
        _RISK,
    'dashboard-ui/components/loki-spec-panel.js::this._historyOpen':
        "a boolean toggled by the component's own history button",
    'dashboard-ui/components/loki-task-board.js::task.assigned_agent_id':
        _RISK,
    'dashboard-ui/components/loki-task-board.js::f.id':
        'loop variable over the filter-pill array in _buildContent, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-task-board.js::f.label':
        'loop variable over the filter-pill array in _buildContent, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-task-board.js::this._selectedTasks.size':
        'the size property of the component-owned Set of selected task ids, always a number',
    'dashboard-ui/components/loki-task-board.js::col.status':
        'loop variable over COLUMNS, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-task-board.js::col.color':
        'loop variable over COLUMNS, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-task-board.js::col.label':
        'loop variable over COLUMNS, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/loki-wiki-browser.js::t.id':
        'loop variable over TABS, a constant array literal in this file, so the value is a literal written here',
    'dashboard-ui/components/vendor/loki-mascot/loki-mascot.js::cfg.label':
        'cfg is getEmotion(): a copy of EMOTIONS[key] or the default, a constant table of literal labels',
    'dashboard-ui/scripts/build-standalone.js::t.id':
        'loop variable over TYPES in the memory-files panel, a constant array literal in this file, so the value is a literal written here',
    "dashboard-ui/scripts/build-standalone.js::plural(total,'receipt')":
        _RISK,
    "dashboard-ui/scripts/build-standalone.js::plural(verified,'receipt')":
        "assigned to badge.title, a text property rather than innerHTML; the '<run-id>' in the literal is prose, not markup",
}

# Helper functions whose RETURN VALUE was read and cannot carry markup (it
# formats a number or a date, or escapes internally), keyed
# "<repo-relative file>::<function name>". A whole call to one is safe.
# Read for S-171 on 2026-09-27. NOT here on purpose, because they pass a
# string argument straight through: loki-context-tracker.js _formatTokens and
# loki-rarv-timeline.js formatTokens (String(n) for a non-number), the
# council-dashboard and notification-center `show` (identity), build-standalone
# plural (n + ' ' + word).
_FMT_METRIC = ("delegates to core/loki-unified-styles.js formatMetric, which "
               "coerces with Number() and returns 'unknown' for NaN, so only "
               "digits, a sign, a unit suffix or a fixed word come back")
_DATE_FMT = ("formats with new Date(x).toLocale*String(); an unparseable "
             "input yields 'Invalid Date', never the input text")
_ARITH = ("every return path is arithmetic on the input (Math.floor, "
          "division, comparison), so a string input yields NaN text, never "
          "its own characters")
SAFE_HELPERS = {
    "dashboard-ui/components/loki-analytics.js::formatTokens": _FMT_METRIC,
    "dashboard-ui/components/loki-analytics.js::formatUSD": _FMT_METRIC,
    "dashboard-ui/components/loki-cost-dashboard.js::_formatTokens": _FMT_METRIC,
    "dashboard-ui/components/loki-cost-dashboard.js::_formatUSD": _FMT_METRIC,
    "dashboard-ui/components/loki-cost-dashboard.js::formatUSD": _FMT_METRIC,
    "dashboard-ui/components/loki-cost-waterfall.js::_formatCost": _FMT_METRIC,
    "dashboard-ui/components/loki-fleet.js::formatFleetCost": _FMT_METRIC,
    "dashboard-ui/components/loki-learning-dashboard.js::formatDuration": _FMT_METRIC,
    "dashboard-ui/components/loki-learning-dashboard.js::_formatDuration":
        "coerces through this._num (Number(), null when not finite) and "
        "returns '--' or toFixed() text with a unit",
    "dashboard-ui/components/loki-learning-dashboard.js::_formatNumber":
        "coerces through this._num (Number(), null when not finite) and "
        "returns '--' or toFixed()/String() of that finite number",
    "dashboard-ui/components/loki-learning-dashboard.js::_formatPercent":
        "coerces through this._num (Number(), null when not finite) and "
        "returns '--' or a toFixed(1) percentage",
    "dashboard-ui/components/loki-memory-browser.js::_fmtCount":
        "returns v.toLocaleString() only when typeof v is a finite number, "
        "otherwise the literal '--'",
    "dashboard-ui/components/loki-context-tracker.js::_formatUSD":
        "returns fixed words or '$' + amount.toFixed(2); a string input "
        "throws on toFixed instead of being echoed",
    "dashboard-ui/components/loki-api-keys.js::formatKeyTime": _DATE_FMT,
    "dashboard-ui/components/loki-audit-viewer.js::formatAuditTimestamp": _DATE_FMT,
    "dashboard-ui/components/loki-council-dashboard.js::_formatTime": _DATE_FMT,
    "dashboard-ui/components/loki-quality-gates.js::formatGateTime": _DATE_FMT,
    "dashboard-ui/components/loki-run-manager.js::formatRunTime": _DATE_FMT,
    "dashboard-ui/components/loki-notification-center.js::_formatTime":
        "returns relative 'Ns ago' arithmetic or new Date(x)."
        "toLocaleDateString(); an unparseable input yields 'Invalid Date'",
    "dashboard-ui/components/loki-session-timeline.js::_formatTime":
        "builds HH:MM from new Date(ms).getHours()/getMinutes() padded "
        "digits, never the input text",
    "dashboard-ui/components/loki-session-timeline.js::_formatDuration": _ARITH,
    "dashboard-ui/components/loki-session-control.js::_formatUptime": _ARITH,
    "dashboard-ui/components/loki-app-status.js::_formatUptime": _ARITH,
    "dashboard-ui/components/loki-checkpoint-viewer.js::_formatRelativeTime":
        "returns 'N{s,m,h,d} ago' from Date arithmetic; its catch branch "
        "escapes the input with this._escapeHTML",
    "dashboard-ui/components/loki-rarv-timeline.js::formatDuration":
        "echoes ms only after ms < 1000 held, which a string passes only "
        "when Number() parses it, so no markup character survives; other "
        "paths are Math.floor arithmetic",
    "dashboard-ui/scripts/build-standalone.js::fmtSize":
        "echoes n only after n < 1024 held, which needs a numeric string; "
        "other paths are toFixed() arithmetic",
    "dashboard-ui/scripts/build-standalone.js::inlineFormat":
        "escapes the whole input with escapeHtml before applying the bold, "
        "italic, code and http(s)-only link patterns",
    "dashboard-ui/scripts/build-standalone.js::encodeURIComponent":
        "percent-encodes < > \" & and spaces; used inside double-quoted "
        "href attributes where the unencoded ' cannot break out",
    "dashboard-ui/components/loki-escalations.js::renderMarkdown":
        "core/loki-markdown.js renderMarkdown escapes the whole source with "
        "escapeHtml first and only allows http(s)/mailto/relative links",
    "dashboard-ui/components/loki-spec-panel.js::renderMarkdown":
        "core/loki-markdown.js renderMarkdown escapes the whole source with "
        "escapeHtml first and only allows http(s)/mailto/relative links",
    "dashboard-ui/components/loki-wiki-browser.js::renderMarkdown":
        "core/loki-markdown.js renderMarkdown escapes the whole source with "
        "escapeHtml first and only allows http(s)/mailto/relative links",
    "dashboard-ui/components/loki-spec-panel.js::_when":
        "returns a fixed word, toLocaleString() of a valid Date, or the "
        "input passed through this._esc",
    "dashboard-ui/components/loki-spec-panel.js::_typeBadge":
        "builds a badge whose class and label both go through this._esc",
    "dashboard-ui/components/vendor/loki-mascot/loki-mascot.js::legs":
        "takes no argument and returns one constant SVG <g> fragment built "
        "from string literals",
    "dashboard-ui/components/vendor/loki-mascot/loki-mascot.js::frag":
        "returns map[key] only when key is an own property of the constant "
        "BROWS/EYES/MOUTHS/PROPS tables, else the literal fallback",
    "dashboard-ui/components/loki-task-board.js::_columnIcon":
        "a switch over the status that returns one of five constant SVG "
        "fragments; the input is never echoed",
    "dashboard-ui/components/loki-task-board.js::getAgentAvatar":
        "initials, css class and status class are constants picked by "
        "includes() tests; the one data-bearing tooltip goes through "
        "this._escapeHtml",
}

MIN_REASON = 40

ESCAPE_NAME = re.compile(r"^_?esc(?:ape)?(?:Html|HTML|Attr|Attribute)?$")
NUMERIC_CALLS = {"Number", "parseInt", "parseFloat", "Math"}
HTML_TAG = re.compile(r"<\s*/?\s*[A-Za-z!]")
REGEX_PREV_PUNCT = set("(,=:[!&|?{};+-*%<>~^")
REGEX_PREV_WORDS = {"return", "typeof", "case", "in", "of", "delete", "void",
                    "throw", "new", "else", "do", "instanceof", "yield", "await"}
PUNCT3 = ("===", "!==", "**=", "...", ">>>", "<<=", ">>=", "&&=", "||=", "??=")
PUNCT2 = ("=>", "==", "!=", "<=", ">=", "&&", "||", "??", "+=", "-=", "*=",
          "/=", "%=", "++", "--", "?.", "<<", ">>", "**", "|=", "&=", "^=")


class Tok:
    __slots__ = ("kind", "text", "line", "parts", "exprs")

    def __init__(self, kind, text, line, parts=None, exprs=None):
        self.kind = kind      # str tpl regex num ident punct
        self.text = text      # raw source text (str: cooked value)
        self.line = line
        self.parts = parts    # tpl: cooked static parts
        self.exprs = exprs    # tpl: [(raw expr source, line)]


def _cook(raw):
    return re.sub(r"\\(.)", r"\1", raw, flags=re.S)


def tokenize(src, line=1, stop_at_brace=False):
    """Return (tokens, index after stop). Raises ValueError on unterminated input."""
    toks = []
    i, n, depth = 0, len(src), 0
    while i < n:
        c = src[i]
        if c == "\n":
            line += 1
            i += 1
            continue
        if c in " \t\r\f\v":
            i += 1
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            if j < 0:
                raise ValueError("unterminated comment at line %d" % line)
            line += src.count("\n", i, j)
            i = j + 2
            continue
        if c in "'\"":
            j, start_line = i + 1, line
            while j < n and src[j] != c:
                if src[j] == "\\":
                    j += 1
                elif src[j] == "\n":
                    raise ValueError("newline in string at line %d" % line)
                j += 1
            if j >= n:
                raise ValueError("unterminated string at line %d" % start_line)
            toks.append(Tok("str", _cook(src[i + 1:j]), start_line))
            i = j + 1
            continue
        if c == "`":
            start_line, j = line, i + 1
            parts, exprs, buf = [], [], i + 1
            while True:
                if j >= n:
                    raise ValueError("unterminated template at line %d" % start_line)
                ch = src[j]
                if ch == "\\":
                    j += 2
                    continue
                if ch == "`":
                    break
                if src.startswith("${", j):
                    parts.append(src[buf:j])
                    line += src.count("\n", buf, j)
                    _, used = tokenize(src[j + 2:], line, stop_at_brace=True)
                    exprs.append((src[j + 2:j + 2 + used], line))
                    line += src.count("\n", j + 2, j + 2 + used)
                    j = j + 2 + used + 1
                    buf = j
                    continue
                j += 1
            parts.append(src[buf:j])
            line += src.count("\n", buf, j)
            toks.append(Tok("tpl", src[i:j + 1], start_line,
                            [_cook(p) for p in parts], exprs))
            i = j + 1
            continue
        if c == "/":
            prev = toks[-1] if toks else None
            if (prev is None or (prev.kind == "punct" and prev.text[-1] in REGEX_PREV_PUNCT)
                    or (prev.kind == "ident" and prev.text in REGEX_PREV_WORDS)):
                j, in_class = i + 1, False
                while j < n:
                    ch = src[j]
                    if ch == "\\":
                        j += 2
                        continue
                    if ch == "\n":
                        raise ValueError("newline in regex at line %d" % line)
                    if ch == "[":
                        in_class = True
                    elif ch == "]":
                        in_class = False
                    elif ch == "/" and not in_class:
                        break
                    j += 1
                j += 1
                while j < n and (src[j].isalnum()):
                    j += 1
                toks.append(Tok("regex", src[i:j], line))
                i = j
                continue
        if c.isalpha() or c in "_$":
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in "_$"):
                j += 1
            toks.append(Tok("ident", src[i:j], line))
            i = j
            continue
        if c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            m = re.match(r"(?:0[xXbBoO][0-9a-fA-F_]+|[0-9_]*\.?[0-9_]+(?:[eE][+-]?\d+)?)n?", src[i:])
            j = i + max(1, len(m.group(0)))
            toks.append(Tok("num", src[i:j], line))
            i = j
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if c == "}" and depth == 0 and stop_at_brace:
                return toks, i
            depth -= 1
        for p in PUNCT3 + PUNCT2:
            if src.startswith(p, i):
                toks.append(Tok("punct", p, line))
                i += len(p)
                break
        else:
            toks.append(Tok("punct", c, line))
            i += 1
    if stop_at_brace:
        raise ValueError("unterminated ${ at line %d" % line)
    return toks, i


def is_html_tpl(t):
    return t.kind == "tpl" and any(HTML_TAG.search(p) for p in t.parts)


def expr_text(toks):
    return "".join(t.text if t.kind != "str" else repr(t.text) for t in toks)


def split_depth0(toks, seps):
    """Split at depth-0 punct tokens in seps. Returns (pieces, separators)."""
    pieces, cur, seplist, d = [], [], [], 0
    for t in toks:
        if t.kind == "punct":
            if t.text in "([{":
                d += 1
            elif t.text in ")]}":
                d -= 1
            elif d == 0 and t.text in seps:
                pieces.append(cur)
                seplist.append(t.text)
                cur = []
                continue
        cur.append(t)
    pieces.append(cur)
    return pieces, seplist


def wrapped_in_parens(toks):
    if len(toks) < 2 or toks[0].text != "(" or toks[-1].text != ")":
        return False
    d = 0
    for k, t in enumerate(toks):
        if t.kind == "punct" and t.text in "([{":
            d += 1
        elif t.kind == "punct" and t.text in ")]}":
            d -= 1
            if d == 0 and k != len(toks) - 1:
                return False
    return True


def whole_call(toks):
    """Return callee tokens if toks is exactly `callee(...)`, else None."""
    if len(toks) < 3 or toks[-1].text != ")":
        return None
    d = 0
    for k in range(len(toks) - 1, -1, -1):
        t = toks[k]
        if t.kind == "punct" and t.text in ")]}":
            d += 1
        elif t.kind == "punct" and t.text in "([{":
            d -= 1
            if d == 0:
                return toks[:k] if t.text == "(" and k > 0 else None
    return None


def contains_html_tpl(toks):
    for t in toks:
        if is_html_tpl(t):
            return True
        if t.kind == "tpl":
            for src, ln in t.exprs:
                if contains_html_tpl(tokenize(src, ln)[0]):
                    return True
    return False


def leaves(toks):
    """Token sequences whose value reaches the HTML output unproven-safe."""
    while wrapped_in_parens(toks):
        toks = toks[1:-1]
    if not toks:
        return []
    # Ternary: skip the condition.
    d, q = 0, None
    for k, t in enumerate(toks):
        if t.kind == "punct":
            if t.text in "([{":
                d += 1
            elif t.text in ")]}":
                d -= 1
            elif d == 0 and t.text == "?":
                q = k
                break
    if q is not None:
        rest, nest, d = toks[q + 1:], 0, 0
        for k, t in enumerate(rest):
            if t.kind != "punct":
                continue
            if t.text in "([{":
                d += 1
            elif t.text in ")]}":
                d -= 1
            elif d == 0 and t.text == "?":
                nest += 1
            elif d == 0 and t.text == ":":
                if nest == 0:
                    return leaves(rest[:k]) + leaves(rest[k + 1:])
                nest -= 1
        return [toks]
    pieces, seps = split_depth0(toks, {"||", "??"})
    if len(pieces) > 1:
        return [x for p in pieces for x in leaves(p)]
    pieces, seps = split_depth0(toks, {"&&"})
    if len(pieces) > 1:
        return leaves(pieces[-1])
    pieces, seps = split_depth0(toks, {"+"})
    if len(pieces) > 1:
        return [x for p in pieces for x in leaves(p)]
    return [] if safe_atom(toks) else [toks]


def map_body_safe(callee):
    """`xs.map(v => BODY).join` where every output leaf of BODY is safe."""
    # callee ends with: map ( ... ) . join
    if len(callee) < 6 or callee[-1].text != "join" or callee[-3].text != ")":
        return False
    inner_call = callee[:-2]
    head = whole_call(inner_call)
    if not head or head[-1].text != "map":
        return False
    args = inner_call[len(head) + 1:-1]
    for k, t in enumerate(args):
        if t.kind == "punct" and t.text == "=>":
            body = args[k + 1:]
            if body and body[0].text == "{":
                return False
            return bool(body) and not leaves(body)
    return False


_CURRENT = [""]
SITES = [0]  # HTML strings examined, for the test's non-vacuity floor


def safe_atom(toks):
    if len(toks) == 1:
        t = toks[0]
        if t.kind in ("str", "num"):
            return True
        if t.kind == "tpl":
            if is_html_tpl(t):
                return True  # scanned on its own
            return all(not leaves(tokenize(s, ln)[0]) for s, ln in t.exprs)
        if t.kind == "ident":
            return True  # CEILING: bare identifier treated as composition
        return False
    if toks[0].kind == "punct" and toks[0].text in ("-", "+", "!") and safe_atom(toks[1:]):
        return True
    if toks[0].kind == "punct" and toks[0].text == "!":
        return True  # boolean
    # Comparison and arithmetic yield a boolean or a number (NaN at worst).
    ops, _ = split_depth0(toks, {"===", "!==", "==", "!=", "<", ">", "<=", ">=",
                                 "-", "*", "/", "%", "instanceof"})
    if len(ops) > 1 and all(ops):
        return True
    if len(toks) >= 3 and toks[0].text == "new" and toks[1].text == "Date":
        return True  # Date methods emit fixed-format text
    callee = whole_call(toks)
    if callee is not None:
        names = [t.text for t in callee if t.kind == "ident"]
        if names and ESCAPE_NAME.match(names[-1]) and (names[0] == names[-1] or names[0] in ("this", "self")):
            return True
        if names and names[0] in NUMERIC_CALLS:
            return True
        if names and names[-1] in ("toFixed", "toPrecision"):
            return True
        if contains_html_tpl(toks):
            return True  # .map(x => `<li>..`).join('') or an IIFE: templates scanned on their own
        if names and names[-1] == "join" and map_body_safe(callee):
            return True
        if (names and (names[0] == names[-1] or names[0] in ("this", "self"))
                and "%s::%s" % (_CURRENT[0], names[-1]) in SAFE_HELPERS):
            return True
        # CEILING: this._renderX() / this._xHtml() style builders are composition.
        if (len(names) == 2 and names[0] == "this" and len(callee) == 3
                and re.match(r"^_?(render|build|get)\w*|\w*(Html|HTML|Markup|Styles?)$", names[1])):
            return True
    if len(toks) >= 3 and toks[-1].text == "length" and toks[-2].text in (".", "?."):
        return True
    return False


def html_concat_segments(toks):
    """Depth-0 `+` chains in toks that contain an HTML string literal."""
    bounds = {";", ",", "=", "+=", "?", ":", "=>", "&&", "||", "??", "return"}
    segs, cur, d_stack = [], [], []
    # Walk each bracket level independently: collect segments per level.
    out = []

    def walk(seq):
        cur = []
        k = 0
        while k < len(seq):
            t = seq[k]
            if t.kind == "punct" and t.text in "([{":
                d, j = 0, k
                while j < len(seq):
                    if seq[j].kind == "punct" and seq[j].text in "([{":
                        d += 1
                    elif seq[j].kind == "punct" and seq[j].text in ")]}":
                        d -= 1
                        if d == 0:
                            break
                    j += 1
                walk(seq[k + 1:j])
                cur.extend(seq[k:j + 1])
                k = j + 1
                continue
            if (t.kind == "punct" and t.text in bounds) or (t.kind == "ident" and t.text == "return"):
                out.append(cur)
                cur = []
            else:
                cur.append(t)
            k += 1
        out.append(cur)

    walk(toks)
    for seg in out:
        pieces, seps = split_depth0(seg, {"+"})
        if len(pieces) < 2:
            continue
        if any(len(p) == 1 and p[0].kind == "str" and HTML_TAG.search(p[0].text) for p in pieces):
            segs.append(seg)
    return segs


def scan_tokens(toks, findings):
    for seg in html_concat_segments(toks):
        SITES[0] += 1
        for leaf in leaves(seg):
            findings.append(leaf)
    for t in toks:
        if t.kind != "tpl":
            continue
        html = is_html_tpl(t)
        SITES[0] += 1 if html else 0
        for src, ln in t.exprs:
            sub = tokenize(src, ln)[0]
            if html:
                findings.extend(leaves(sub))
            scan_tokens(sub, findings)
        # Browser code emitted inside a template (build-standalone.js).
        whole = "\x00".join(t.parts)
        for m in re.finditer(r"<script[^>]*>(.*?)</script>", whole, re.S | re.I):
            # A build-time ${bundleCode} becomes an inert identifier.
            body = m.group(1).replace("\x00", " __build_time_expr__ ")
            ln = t.line + whole.count("\n", 0, m.start(1))
            scan_tokens(tokenize(body, ln)[0], findings)


def scan_file(path):
    _CURRENT[0] = rel(path)
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    toks = tokenize(src)[0]
    raw = []
    scan_tokens(toks, raw)
    seen, out = set(), []
    for leaf in raw:
        key = (leaf[0].line, expr_text(leaf))
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def default_targets():
    comp = os.path.join(REPO_ROOT, "dashboard-ui", "components")
    files = sorted(os.path.join(dp, f) for dp, _, fs in os.walk(comp)
                   for f in fs if f.endswith(".js"))
    files.append(os.path.join(REPO_ROOT, "dashboard-ui", "scripts", "build-standalone.js"))
    return files


def rel(p):
    ap = os.path.abspath(p)
    return os.path.relpath(ap, REPO_ROOT) if ap.startswith(REPO_ROOT + os.sep) else ap


def main(argv):
    stats = "--stats" in argv
    args = [a for a in argv if a != "--stats"]
    bad = [k for k, v in list(ALLOWLIST.items()) + list(SAFE_HELPERS.items())
           if not isinstance(v, str) or len(v.strip()) < MIN_REASON]
    if bad:
        sys.stderr.write("UNMEASURED: allowlist entries without a real reason: %s\n" % ", ".join(bad))
        return 2
    try:
        files = args or default_targets()
        offenders, nfindings = [], 0
        for f in files:
            for line, expr in scan_file(f):
                nfindings += 1
                key = "%s::%s" % (rel(f), re.sub(r"\s+", "", expr))
                if key not in ALLOWLIST:
                    offenders.append((rel(f), line, expr, key))
    except Exception as exc:  # noqa: BLE001 - unmeasured, never clean
        sys.stderr.write("UNMEASURED: %s: %s\n" % (type(exc).__name__, exc))
        return 2
    for f, line, expr, key in offenders:
        print("%s:%d: unescaped value in HTML string: %s" % (f, line, expr))
    if stats:
        print("STATS files=%d sites=%d findings=%d offenders=%d allowlist=%d"
              % (len(files), SITES[0], nfindings, len(offenders), len(ALLOWLIST)))
    return 1 if offenders else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
