#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "scope-decomposition-runtime-"));
const manifestPath = join(projectRoot, "manifest.json");

writeFileSync(manifestPath, JSON.stringify({ auto_approve: true }, null, 2));

function run(args) {
    return JSON.parse(execFileSync("node", [cliPath, ...args], {
        cwd: projectRoot,
        encoding: "utf8",
    }));
}

try {
    const started = run(["start", "--identifier", "scope", "--manifest-file", manifestPath]);
    if (!started.ok) {
        throw new Error("Failed to start scope-decomposition runtime");
    }
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.CONFIG, "--payload", "{\"config_ready\":true}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.DISCOVERY]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.DISCOVERY, "--payload", "{\"discovery_summary\":{\"scope\":\"ok\"}}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.EPIC_DECOMPOSITION]);
    run(["record-epic-summary", "--identifier", "scope", "--payload", "{\"schema_version\":\"1.0.0\",\"summary_kind\":\"epic-plan\",\"run_id\":\"scope-test\",\"identifier\":\"scope\",\"producer_skill\":\"ln-210\",\"produced_at\":\"2026-03-27T00:00:00Z\",\"payload\":{\"mode\":\"CREATE\",\"scope_identifier\":\"scope\",\"epics_created\":2,\"epics_updated\":0,\"epics_canceled\":0,\"epic_urls\":[\"url-1\",\"url-2\"],\"warnings\":[],\"kanban_updated\":true}}"]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.EPIC_DECOMPOSITION, "--payload", "{\"epics_ready\":true}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.STORY_LOOP]);
    run(["record-story-summary", "--identifier", "scope", "--payload", "{\"schema_version\":\"1.0.0\",\"summary_kind\":\"story-plan\",\"run_id\":\"scope-test\",\"identifier\":\"epic-1\",\"producer_skill\":\"ln-221\",\"produced_at\":\"2026-03-27T00:00:00Z\",\"payload\":{\"mode\":\"CREATE\",\"epic_id\":\"1\",\"stories_created\":5,\"stories_updated\":0,\"stories_canceled\":0,\"story_urls\":[\"s-1\"],\"warnings\":[],\"kanban_updated\":true}}"]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.STORY_LOOP, "--payload", "{\"stories_ready\":true}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.PRIORITIZATION_LOOP]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.PRIORITIZATION_LOOP, "--payload", "{\"prioritization_summary\":{\"status\":\"skipped\"}}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.FINALIZE]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.FINALIZE, "--payload", "{\"final_result\":\"READY\"}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.SELF_CHECK]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.SELF_CHECK, "--payload", "{\"pass\":true,\"final_result\":\"READY\"}"]);
    const completed = run(["complete", "--identifier", "scope"]);
    if (!completed.ok || completed.state.phase !== "DONE") {
        throw new Error("Scope-decomposition runtime did not complete");
    }
    process.stdout.write("scope-decomposition-runtime smoke passed\n");
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
