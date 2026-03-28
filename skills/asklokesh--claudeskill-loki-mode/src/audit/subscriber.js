#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var AuditLog = require('./log').AuditLog;

var lokiDir = process.env.LOKI_DIR || '.loki';
var pendingDir = path.join(process.cwd(), lokiDir, 'events', 'pending');
var lastProcessedFile = '';

var audit = new AuditLog({ projectDir: process.cwd() });

// Event type to audit mapping
var EVENT_TO_AUDIT = {
    'iteration_start': { what: 'iteration_start', why: 'RARV cycle iteration started' },
    'iteration_complete': { what: 'iteration_complete', why: 'RARV cycle iteration completed' },
    'session_start': { what: 'session_start', why: 'Loki session initialized' },
    'session_end': { what: 'session_end', why: 'Loki session terminated' },
    'phase_change': { what: 'phase_change', why: 'RARV phase transition' },
    'policy_denied': { what: 'policy_violation', why: 'Policy engine blocked action' },
    'policy_approval_required': { what: 'policy_approval', why: 'Policy requires approval' },
    'otel_span_start': null, // Skip OTEL internal events
    'otel_span_end': null,   // Skip OTEL internal events
};

function processEventFile(filepath) {
    try {
        var data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        var eventType = data.type;
        var payload = data.payload || {};

        // Check if this event type should be audited
        if (!(eventType in EVENT_TO_AUDIT)) {
            // Unknown event types get a generic audit entry
            audit.record({
                who: payload.provider || data.source || 'system',
                what: eventType,
                where: 'iteration:' + (payload.iteration || 'unknown'),
                why: 'Event recorded',
                metadata: payload,
            });
            return;
        }

        var mapping = EVENT_TO_AUDIT[eventType];
        if (!mapping) return; // null = skip

        audit.record({
            who: payload.provider || data.source || 'system',
            what: mapping.what,
            where: 'iteration:' + (payload.iteration || 'unknown'),
            why: mapping.why,
            metadata: payload,
        });
    } catch (e) {
        // Fire-and-forget: errors must not crash the subscriber
    }
}

function scanPendingEvents() {
    if (!fs.existsSync(pendingDir)) return;
    try {
        var files = fs.readdirSync(pendingDir)
            .filter(function(f) { return f.endsWith('.json'); })
            .sort();
        for (var i = 0; i < files.length; i++) {
            if (files[i] > lastProcessedFile) {
                processEventFile(path.join(pendingDir, files[i]));
                lastProcessedFile = files[i];
            }
        }
    } catch (e) { /* ignore */ }
}

// Export for testing
if (require.main === module) {
    // Poll every 500ms
    var pollInterval = setInterval(scanPendingEvents, 500);
    scanPendingEvents();

    function shutdown() {
        clearInterval(pollInterval);
        audit.flush();
        process.exit(0);
    }
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    console.log('[audit-subscriber] Started, watching ' + pendingDir);
} else {
    module.exports = {
        processEventFile: processEventFile,
        scanPendingEvents: scanPendingEvents,
        EVENT_TO_AUDIT: EVENT_TO_AUDIT,
        _setAudit: function(a) { audit = a; },
        _setPendingDir: function(d) { pendingDir = d; },
        _getLastProcessedFile: function() { return lastProcessedFile; },
        _resetState: function() { lastProcessedFile = ''; },
    };
}
