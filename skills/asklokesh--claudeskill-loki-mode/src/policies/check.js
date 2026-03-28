#!/usr/bin/env node
'use strict';

var PolicyEngine = require('./engine').PolicyEngine;

var enforcementPoint = process.argv[2];
if (!enforcementPoint) {
    process.stderr.write('Usage: node check.js <enforcement_point> [context_json]\n');
    process.exit(1);
}

var context = {};
if (process.argv[3]) {
    try {
        context = JSON.parse(process.argv[3]);
    } catch (e) {
        process.stderr.write('Invalid context JSON: ' + e.message + '\n');
        process.exit(1);
    }
}

var projectDir = process.env.LOKI_PROJECT_DIR || process.cwd();
var engine;
try {
    engine = new PolicyEngine(projectDir);
} catch (e) {
    // No policies configured - allow by default
    process.stdout.write(JSON.stringify({ allowed: true, decision: 'ALLOW', reason: 'No policies configured' }));
    process.exit(0);
}

var result = engine.evaluate(enforcementPoint, context);
process.stdout.write(JSON.stringify(result));

if (!result.allowed) {
    process.exit(result.requiresApproval ? 2 : 1);
}
process.exit(0);
