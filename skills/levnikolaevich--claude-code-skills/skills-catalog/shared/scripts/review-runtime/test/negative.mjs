#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "review-runtime-negative-"));

function run(args, options = {}) {
    try {
        return JSON.parse(execFileSync("node", [cliPath, ...args], {
            cwd: projectRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }));
    } catch (error) {
        if (options.allowFailure) {
            return JSON.parse(error.stdout || error.stderr);
        }
        throw error;
    }
}

try {
    mkdirSync(join(projectRoot, ".hex-skills", "agent-review"), { recursive: true });

    const manifestPath = join(projectRoot, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
        storage_mode: "file",
        expected_agents: [],
        phase_policy: { phase5: "required", phase8: "required" },
    }, null, 2));

    run([
        "start", "--project-root", projectRoot,
        "--skill", "ln-310", "--mode", "story",
        "--identifier", "NEG-TEST", "--manifest-file", manifestPath,
    ]);

    // Fast-forward to AGENT_LAUNCH
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.CONFIG]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.DISCOVERY]);
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.DISCOVERY]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.AGENT_LAUNCH]);

    // TEST 1: advance to RESEARCH without health_check_done should BLOCK
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.AGENT_LAUNCH,
        "--payload", JSON.stringify({ health_check_done: false, agents_available: 0 }),
    ]);
    const blocked1 = run([
        "advance", "--project-root", projectRoot,
        "--skill", "ln-310", "--to", PHASES.RESEARCH,
    ], { allowFailure: true });
    if (blocked1.ok !== false || !String(blocked1.error || "").includes("health check")) {
        throw new Error("Expected RESEARCH blocked without health_check_done");
    }

    // Fix and fast-forward to MERGE
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.AGENT_LAUNCH,
        "--payload", JSON.stringify({ health_check_done: true, agents_available: 0, agents_skipped_reason: "test" }),
    ]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.RESEARCH]);
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.RESEARCH]);

    // TEST 2: story mode must pass AUTOFIX before MERGE
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.DOCS]);
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.DOCS,
        "--payload", JSON.stringify({ docs_checkpoint: { docs_created: [], docs_skipped_reason: "test" } }),
    ]);
    const blocked2 = run([
        "advance", "--project-root", projectRoot,
        "--skill", "ln-310", "--to", PHASES.MERGE,
    ], { allowFailure: true });
    if (blocked2.ok !== false || !String(blocked2.error || "").includes("Phase 5")) {
        throw new Error("Expected MERGE blocked without AUTOFIX in story mode");
    }

    process.stdout.write("review-runtime negative passed\n");
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
