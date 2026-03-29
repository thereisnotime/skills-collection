#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "epic-planning-runtime-"));
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
        throw new Error("Failed to start epic-planning runtime");
    }
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.CONFIG, "--payload", "{\"config_ready\":true}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.DISCOVERY]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.DISCOVERY, "--payload", "{\"discovery_summary\":{\"scope\":\"ok\"}}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.RESEARCH]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.RESEARCH, "--payload", "{\"research_summary\":{\"researched\":true}}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.PLAN]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.PLAN, "--payload", "{\"ideal_plan_summary\":{\"epics\":3}}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.MODE_DETECTION]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.MODE_DETECTION, "--payload", "{\"mode_detection\":{\"mode\":\"CREATE\"}}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.PREVIEW]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.PREVIEW, "--payload", "{\"preview_ready\":true}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.DELEGATE]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.DELEGATE, "--payload", "{\"delegated\":true}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.FINALIZE]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.FINALIZE, "--payload", "{\"final_result\":\"READY\"}"]);
    run(["advance", "--identifier", "scope", "--to", PHASES.SELF_CHECK]);
    run(["checkpoint", "--identifier", "scope", "--phase", PHASES.SELF_CHECK, "--payload", "{\"pass\":true,\"final_result\":\"READY\"}"]);
    const completed = run(["complete", "--identifier", "scope"]);
    if (!completed.ok || completed.state.phase !== "DONE") {
        throw new Error("Epic-planning runtime did not complete");
    }
    process.stdout.write("epic-planning-runtime smoke passed\n");
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
