#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "story-gate-negative-"));

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
    const manifestPath = join(projectRoot, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
        task_provider: "file",
        worktree_dir: ".hex-skills/worktrees/story-NEG",
        branch: "feature/neg-test",
    }, null, 2));

    run(["start", "--project-root", projectRoot, "--story", "NEG-1", "--manifest-file", manifestPath]);

    // Fast-forward to QUALITY_CHECKS
    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.CONFIG]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.DISCOVERY]);
    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.DISCOVERY]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.FAST_TRACK]);
    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.FAST_TRACK, "--payload", "{\"fast_track\":false}"]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.QUALITY_CHECKS]);
    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.QUALITY_CHECKS]);

    // TEST 1: VERDICT blocked without quality_summary
    const blocked1 = run([
        "advance", "--project-root", projectRoot,
        "--to", PHASES.VERDICT,
    ], { allowFailure: true });
    if (blocked1.ok !== false || !String(blocked1.error || "").includes("Quality summary")) {
        throw new Error("Expected VERDICT blocked without quality_summary");
    }

    // Fix and fast-forward to SELF_CHECK
    run([
        "checkpoint", "--project-root", projectRoot,
        "--phase", PHASES.QUALITY_CHECKS,
        "--payload", JSON.stringify({ quality_summary: { verdict: "PASS" } }),
    ]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.TEST_PLANNING]);
    run([
        "checkpoint", "--project-root", projectRoot,
        "--phase", PHASES.TEST_PLANNING,
        "--payload", JSON.stringify({ test_planner_invoked: true, test_task_status: "SKIPPED" }),
    ]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.TEST_VERIFICATION]);
    run([
        "checkpoint", "--project-root", projectRoot,
        "--phase", PHASES.TEST_VERIFICATION,
        "--payload", JSON.stringify({ test_task_status: "SKIPPED" }),
    ]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.VERDICT]);
    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.VERDICT]);

    // TEST 2: FINALIZATION blocked without final_verdict
    const blocked2 = run([
        "advance", "--project-root", projectRoot,
        "--to", PHASES.FINALIZATION,
    ], { allowFailure: true });
    if (blocked2.ok !== false || !String(blocked2.error || "").includes("verdict")) {
        throw new Error("Expected FINALIZATION blocked without final_verdict");
    }

    process.stdout.write("story-gate-runtime negative passed\n");
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
