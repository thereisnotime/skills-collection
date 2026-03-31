#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "scope-guards-"));
const manifestPath = join(projectRoot, "manifest.json");

writeFileSync(manifestPath, JSON.stringify({ auto_approve: true }, null, 2));

let passed = 0;
let failed = 0;

function run(args, options = {}) {
    try {
        return JSON.parse(execFileSync("node", [cliPath, ...args], {
            cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        }));
    } catch (error) {
        if (options.allowFailure) { return JSON.parse(error.stdout || error.stderr); }
        throw error;
    }
}

function expect(name, result, expectedOk) {
    if (result.ok === expectedOk) { passed++; process.stdout.write(`  PASS: ${name}\n`); }
    else { failed++; process.stdout.write(`  FAIL: ${name} (expected ok=${expectedOk}, got ok=${result.ok}, error=${result.error})\n`); }
}

try {
    run(["start", "--identifier", "scope", "--manifest-file", manifestPath]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.CONFIG]);
    run(["advance", "--identifier", "scope", "--to", PHASES.DISCOVERY]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.DISCOVERY, "--payload", "{\"discovery_summary\":{\"ok\":true}}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.EPIC_DECOMPOSITION]);

    // TEST 1: STORY_LOOP blocked without epic_summary
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.EPIC_DECOMPOSITION]);
    const t1 = run(["advance", "--identifier", "scope", "--to", PHASES.STORY_LOOP], { allowFailure: true });
    expect("STORY_LOOP blocked without epic_summary", t1, false);

    // Fix: record epic summary
    run(["record-epic-summary", "--identifier", "scope", "--payload", "{\"schema_version\":\"1.0.0\",\"summary_kind\":\"epic-plan\",\"run_id\":\"t\",\"identifier\":\"scope\",\"producer_skill\":\"ln-210\",\"produced_at\":\"2026-03-30T00:00:00Z\",\"payload\":{\"mode\":\"CREATE\",\"scope_identifier\":\"scope\",\"epics_created\":2,\"epics_updated\":0,\"epics_canceled\":0,\"epic_urls\":[],\"warnings\":[],\"kanban_updated\":true}}"]);

    // TEST 2: STORY_LOOP allowed with epic_summary
    const t2 = run(["advance", "--identifier", "scope", "--to", PHASES.STORY_LOOP]);
    expect("STORY_LOOP allowed with epic_summary", t2, true);

    // TEST 3: PRIORITIZATION_LOOP blocked without story_summaries
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.STORY_LOOP]);
    const t3 = run(["advance", "--identifier", "scope", "--to", PHASES.PRIORITIZATION_LOOP], { allowFailure: true });
    expect("PRIORITIZATION blocked without story_summaries", t3, false);

    // Fix: record story summary
    run(["record-story-summary", "--identifier", "scope", "--payload", "{\"schema_version\":\"1.0.0\",\"summary_kind\":\"story-plan\",\"run_id\":\"t\",\"identifier\":\"epic-1\",\"producer_skill\":\"ln-221\",\"produced_at\":\"2026-03-30T00:00:00Z\",\"payload\":{\"mode\":\"CREATE\",\"epic_id\":\"1\",\"stories_created\":3,\"stories_updated\":0,\"stories_canceled\":0,\"story_urls\":[],\"warnings\":[],\"kanban_updated\":true}}"]);

    // TEST 4: PRIORITIZATION allowed with story_summaries
    const t4 = run(["advance", "--identifier", "scope", "--to", PHASES.PRIORITIZATION_LOOP]);
    expect("PRIORITIZATION allowed with story_summaries", t4, true);

    // TEST 5: DONE blocked without final_result
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.PRIORITIZATION_LOOP]);
    run(["advance", "--identifier", "scope", "--to", PHASES.FINALIZE]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.FINALIZE]);
    run(["advance", "--identifier", "scope", "--to", PHASES.SELF_CHECK]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.SELF_CHECK, "--payload", "{\"pass\":true}"]);
    const t5 = run(["complete", "--identifier", "scope"], { allowFailure: true });
    expect("DONE blocked without final_result", t5, false);

    process.stdout.write(`\nscope-decomposition-runtime guards: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
