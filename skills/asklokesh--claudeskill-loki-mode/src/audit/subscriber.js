#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var AuditLog = require('./log').AuditLog;
var crosslink = require('./crosslink');

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
    // The operator pinned one model and a different one was dispatched. The
    // substitution may be legitimate (a model unavailable on this transport),
    // but it must never be SILENT: without a record the receipt shows only the
    // dispatched model, so the swap cannot be audited and its stated reason
    // cannot be refuted by whoever has evidence against it.
    'model_substituted': { what: 'model_substituted', why: 'Pinned model was not the model dispatched' },
    // Distinct from policy_denied: the policy was never EVALUATED. A policy
    // file was present (so enforcement was intended) but node was unavailable,
    // so run.sh refused fail-closed rather than proceeding unenforced. The
    // receipt must be able to tell "denied by a rule" from "could not check".
    'policy_unevaluable': { what: 'policy_unevaluable', why: 'Policy present but could not be evaluated; action refused fail-closed' },
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

/**
 * Pin the current chain tip to the append-only witness file.
 *
 * Why the agent chain needs this: its hash is unkeyed over public fields from a
 * constant genesis (log.js:16,127-134), so verifyChain() cannot tell an honest
 * chain from one recomputed over invented history. A witness records what the
 * tip actually was, and verifyUnified reconciles later chains against it
 * (crosslink.reconcileWitnessedPrefix). Without a witness there is nothing to
 * reconcile against, so this is what gives that check something to work with.
 * See docs/AUDIT-CHAIN-THREAT-MODEL.md.
 *
 * Best-effort by design: a witness that cannot be written must never take down
 * the run or block the audit flush. A missing witness is reported honestly by
 * verifyUnified as state "no_records", never as a pass.
 *
 * LOKI_AUDIT_WITNESS=0 opts out.
 * LOKI_AUDIT_WITNESS_COMMAND, if set, is invoked with the witness line so an
 * external party (a WORM mount, a timestamping authority) holds an out-of-band
 * copy. That out-of-band copy is the only form that survives an adversary who
 * controls this machine: a local witness file is itself rewritable.
 */
function writeWitnessSafely(reason) {
    if (process.env.LOKI_AUDIT_WITNESS === '0') return null;
    try {
        var opts = { projectDir: process.cwd() };
        var cmd = process.env.LOKI_AUDIT_WITNESS_COMMAND;
        if (cmd) opts.witnessCommand = cmd;
        var res = crosslink.writeWitness(opts);
        console.log('[audit-subscriber] witness written (' + reason + '), agentEntries=' +
                    (res && res.record && res.record.agentEntries));
        return res;
    } catch (e) {
        // Reported, never swallowed: an operator who expected a witness must be
        // able to see that none was taken.
        console.error('[audit-subscriber] witness NOT written (' + reason + '): ' +
                      String((e && e.message) || e));
        return null;
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

    // A witness taken only at shutdown is lost precisely when it matters most
    // (SIGKILL, power loss, a crashed run). Pin one periodically so the
    // witnessed prefix covers work already done. Default 300s; 0 disables.
    var witnessEvery = parseInt(process.env.LOKI_AUDIT_WITNESS_INTERVAL_SEC || '300', 10);
    var witnessInterval = null;
    if (process.env.LOKI_AUDIT_WITNESS !== '0' &&
        Number.isFinite(witnessEvery) && witnessEvery > 0) {
        witnessInterval = setInterval(function () {
            writeWitnessSafely('periodic');
        }, witnessEvery * 1000);
        // Do not hold the event loop open for the sake of witnessing.
        if (witnessInterval.unref) witnessInterval.unref();
    }

    function shutdown() {
        clearInterval(pollInterval);
        if (witnessInterval) clearInterval(witnessInterval);
        audit.flush();
        // AFTER the flush: writeWitness reads the tip off disk, so witnessing
        // before flushing would pin a tip that omits every buffered entry and
        // then read as truncation on the next verify.
        writeWitnessSafely('session end');
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
        writeWitnessSafely: writeWitnessSafely,
        _setPendingDir: function(d) { pendingDir = d; },
        _getLastProcessedFile: function() { return lastProcessedFile; },
        _resetState: function() { lastProcessedFile = ''; },
    };
}
