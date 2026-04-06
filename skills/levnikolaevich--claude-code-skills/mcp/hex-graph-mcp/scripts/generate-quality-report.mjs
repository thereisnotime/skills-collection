#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { buildQualityReport, paths, readJson } from "./quality-support.mjs";

function normalize(text) {
    return text.replace(/\r\n/g, "\n");
}

function main() {
    const checkOnly = process.argv.includes("--check");
    const report = buildQualityReport({
        benchmarkWorkflowSummary: readJson(paths.benchmarkWorkflowSummary),
        corporaManifest: readJson(paths.corporaManifest),
    });
    const expected = `${JSON.stringify(report, null, 2)}\n`;
    const current = readFileSync(paths.qualityReportArtifact, "utf8");
    if (checkOnly) {
        if (normalize(current) !== normalize(expected)) {
            console.error("quality-report.json is stale. Run npm run evals.");
            process.exitCode = 1;
        }
        return;
    }
    writeFileSync(paths.qualityReportArtifact, expected, "utf8");
}

main();
