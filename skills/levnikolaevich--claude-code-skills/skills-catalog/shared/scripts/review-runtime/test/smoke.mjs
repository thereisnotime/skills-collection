#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    REVIEW_AGENT_STATUSES,
} from "../../coordinator-runtime/lib/runtime-constants.mjs";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "review-runtime-smoke-"));

function run(args) {
    return JSON.parse(execFileSync("node", [cliPath, ...args], {
        cwd: projectRoot,
        encoding: "utf8",
    }));
}

try {
    mkdirSync(join(projectRoot, ".hex-skills", "agent-review"), { recursive: true });

    const manifestPath = join(projectRoot, "manifest.json");
    const metadataPath = join(projectRoot, "codex.meta.json");
    const resultPath = join(projectRoot, "codex_result.md");

    writeFileSync(manifestPath, JSON.stringify({
        storage_mode: "file",
        expected_agents: ["codex"],
        phase_policy: { phase5: "required", phase8: "required" },
    }, null, 2));

    const started = run([
        "start",
        "--project-root", projectRoot,
        "--skill", "ln-310",
        "--mode", "story",
        "--identifier", "PROJ-123",
        "--manifest-file", manifestPath,
    ]);

    if (!started.ok) {
        throw new Error("Failed to start review runtime");
    }

    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.CONFIG]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.DISCOVERY]);
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.DISCOVERY]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.AGENT_LAUNCH]);
    run([
        "register-agent",
        "--project-root", projectRoot,
        "--skill", "ln-310",
        "--agent", "codex",
        "--metadata-file", "codex.meta.json",
        "--result-file", "codex_result.md",
    ]);
    run([
        "checkpoint",
        "--project-root", projectRoot,
        "--skill", "ln-310",
        "--phase", PHASES.AGENT_LAUNCH,
        "--payload",
        JSON.stringify({
            health_check_done: true,
            agents_available: 1,
            agents_required: ["codex"],
        }),
    ]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.RESEARCH]);
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.RESEARCH]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.DOCS]);
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.DOCS,
        "--payload", JSON.stringify({ docs_checkpoint: { docs_created: [], docs_skipped_reason: "test" } }),
    ]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.AUTOFIX]);
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.AUTOFIX]);

    writeFileSync(metadataPath, JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: REVIEW_AGENT_STATUSES.RESULT_READY,
        success: true,
        exit_code: 0,
    }, null, 2));
    writeFileSync(resultPath, "<!-- AGENT_REVIEW_RESULT -->ok<!-- END_AGENT_REVIEW_RESULT -->");

    const synced = run(["sync-agent", "--project-root", projectRoot, "--skill", "ln-310", "--agent", "codex"]);
    if (synced.agents.codex.status !== REVIEW_AGENT_STATUSES.RESULT_READY) {
        throw new Error("Agent did not resolve to result_ready");
    }

    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.MERGE]);
    run([
        "checkpoint",
        "--project-root", projectRoot,
        "--skill", "ln-310",
        "--phase", PHASES.MERGE,
        "--payload",
        JSON.stringify({ merge_summary: { accepted: 2, rejected: 1 } }),
    ]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.REFINEMENT]);
    run([
        "checkpoint",
        "--project-root", projectRoot,
        "--skill", "ln-310",
        "--phase", PHASES.REFINEMENT,
        "--payload",
        JSON.stringify({ iterations: 1, exit_reason: "CONVERGED", applied: 3 }),
    ]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.APPROVE]);
    run([
        "checkpoint",
        "--project-root", projectRoot,
        "--skill", "ln-310",
        "--phase", PHASES.APPROVE,
        "--payload",
        JSON.stringify({ verdict: "GO" }),
    ]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.SELF_CHECK]);
    run([
        "checkpoint",
        "--project-root", projectRoot,
        "--skill", "ln-310",
        "--phase", PHASES.SELF_CHECK,
        "--payload",
        JSON.stringify({ pass: true, processes_verified_dead: true, final_verdict: "GO" }),
    ]);
    const completed = run(["complete", "--project-root", projectRoot, "--skill", "ln-310"]);

    if (!completed.ok || completed.state.phase !== PHASES.DONE) {
        throw new Error("Runtime did not complete successfully");
    }

    process.stdout.write("review-runtime smoke passed\n");
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
