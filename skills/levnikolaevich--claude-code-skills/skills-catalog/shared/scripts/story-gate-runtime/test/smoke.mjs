#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    STORY_GATE_VERDICTS,
    TASK_BOARD_STATUSES,
} from "../../coordinator-runtime/lib/runtime-constants.mjs";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "story-gate-runtime-"));

function run(args) {
    return JSON.parse(execFileSync("node", [cliPath, ...args], {
        cwd: projectRoot,
        encoding: "utf8",
    }));
}

try {
    const manifestPath = join(projectRoot, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
        task_provider: "file",
        worktree_dir: ".hex-skills/worktrees/story-PROJ-123",
        branch: "feature/proj-123-story",
    }, null, 2));

    const started = run(["start", "--project-root", projectRoot, "--story", "PROJ-123", "--manifest-file", manifestPath]);
    if (!started.ok) {
        throw new Error("Failed to start story gate runtime");
    }

    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.CONFIG]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.DISCOVERY]);
    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.DISCOVERY]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.FAST_TRACK]);
    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.FAST_TRACK, "--payload", "{\"fast_track\":false}"]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.QUALITY_CHECKS]);
    run(["record-quality", "--project-root", projectRoot, "--payload", JSON.stringify({ story_id: "PROJ-123", verdict: STORY_GATE_VERDICTS.PASS, quality_score: 92 })]);
    run([
        "checkpoint",
        "--project-root", projectRoot,
        "--phase", PHASES.QUALITY_CHECKS,
        "--payload",
        JSON.stringify({ quality_summary: { story_id: "PROJ-123", verdict: STORY_GATE_VERDICTS.PASS }, quality_score: 92 }),
    ]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.TEST_PLANNING]);
    run(["record-test-status", "--project-root", projectRoot, "--payload", JSON.stringify({ story_id: "PROJ-123", planner_invoked: true, status: TASK_BOARD_STATUSES.SKIPPED })]);
    run([
        "checkpoint",
        "--project-root", projectRoot,
        "--phase", PHASES.TEST_PLANNING,
        "--payload",
        JSON.stringify({ test_planner_invoked: true, test_task_status: TASK_BOARD_STATUSES.SKIPPED }),
    ]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.TEST_VERIFICATION]);
    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.TEST_VERIFICATION, "--payload", JSON.stringify({ test_task_status: TASK_BOARD_STATUSES.SKIPPED })]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.VERDICT]);
    run([
        "checkpoint",
        "--project-root", projectRoot,
        "--phase", PHASES.VERDICT,
        "--payload",
        JSON.stringify({ final_result: STORY_GATE_VERDICTS.PASS, quality_score: 92, nfr_validation: { security: STORY_GATE_VERDICTS.PASS } }),
    ]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.FINALIZATION]);
    run([
        "checkpoint",
        "--project-root", projectRoot,
        "--phase", PHASES.FINALIZATION,
        "--payload",
        JSON.stringify({ branch_finalized: true, story_final_status: TASK_BOARD_STATUSES.DONE }),
    ]);
    run(["advance", "--project-root", projectRoot, "--to", PHASES.SELF_CHECK]);
    run(["checkpoint", "--project-root", projectRoot, "--phase", PHASES.SELF_CHECK, "--payload", JSON.stringify({ pass: true, final_result: STORY_GATE_VERDICTS.PASS })]);
    const completed = run(["complete", "--project-root", projectRoot]);

    if (!completed.ok || completed.state.phase !== PHASES.DONE) {
        throw new Error("Story gate runtime did not complete");
    }

    process.stdout.write("story-gate-runtime smoke passed\n");
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
