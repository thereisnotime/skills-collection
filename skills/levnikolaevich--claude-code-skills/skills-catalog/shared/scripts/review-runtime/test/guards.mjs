#!/usr/bin/env node

/**
 * Guard integration tests — verifies that machine-enforced guards
 * actually block invalid state transitions.
 */

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
const projectRoot = mkdtempSync(join(tmpdir(), "review-guards-"));

let passed = 0;
let failed = 0;

function run(args) {
    try {
        return JSON.parse(execFileSync("node", [cliPath, ...args], {
            cwd: projectRoot,
            encoding: "utf8",
        }));
    } catch (e) {
        if (e.stdout) return JSON.parse(e.stdout);
        return { ok: false, error: e.message };
    }
}

function expect(name, result, expectedOk) {
    const ok = result.ok === expectedOk;
    if (ok) {
        passed++;
        process.stdout.write(`  PASS: ${name}\n`);
    } else {
        failed++;
        process.stdout.write(`  FAIL: ${name} (expected ok=${expectedOk}, got ok=${result.ok}, error=${result.error})\n`);
    }
}

try {
    mkdirSync(join(projectRoot, ".hex-skills", "agent-review"), { recursive: true });

    const manifestPath = join(projectRoot, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
        storage_mode: "file",
        expected_agents: [],
        phase_policy: { phase4: "required", phase7: "required" },
    }, null, 2));

    // Start runtime
    run([
        "start",
        "--project-root", projectRoot,
        "--skill", "ln-310",
        "--mode", "story",
        "--identifier", "GUARD-TEST",
        "--manifest-file", manifestPath,
    ]);

    // Fast-forward to Phase 6
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.CONFIG]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.DISCOVERY]);
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.DISCOVERY]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.AGENT_LAUNCH]);
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.AGENT_LAUNCH,
        "--payload", JSON.stringify({ health_check_done: true, agents_available: 0, agents_skipped_reason: "test" }),
    ]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.RESEARCH]);
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.RESEARCH]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.AUTOFIX]);
    run(["checkpoint", "--project-root", projectRoot, "--skill", "ln-310", "--phase", PHASES.AUTOFIX]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.MERGE]);
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.MERGE,
        "--payload", JSON.stringify({ merge_summary: "test" }),
    ]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.REFINEMENT]);

    // --- TEST 1: advance Phase 6 -> Phase 7 WITHOUT exit_reason (should BLOCK) ---
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.REFINEMENT,
        "--payload", JSON.stringify({ iterations: 1 }),
    ]);
    const t1 = run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.APPROVE]);
    expect("REFINEMENT->APPROVE without exit_reason blocks", t1, false);

    // --- TEST 2: checkpoint with CONVERGED, then advance (should ALLOW) ---
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.REFINEMENT,
        "--payload", JSON.stringify({ iterations: 3, exit_reason: "CONVERGED", applied: 5 }),
    ]);
    const t2 = run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.APPROVE]);
    expect("REFINEMENT->APPROVE with CONVERGED allows", t2, true);

    // --- TEST 3: Phase 8 pass=true WITHOUT processes_verified_dead (should BLOCK DONE) ---
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.APPROVE,
        "--payload", JSON.stringify({ verdict: "GO" }),
    ]);
    run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.SELF_CHECK]);
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.SELF_CHECK,
        "--payload", JSON.stringify({ pass: true, final_verdict: "GO" }),
    ]);
    const t3 = run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.DONE]);
    expect("SELF_CHECK->DONE without processes_verified_dead blocks", t3, false);

    // --- TEST 4: pass=true WITH processes_verified_dead (should ALLOW) ---
    run([
        "checkpoint", "--project-root", projectRoot, "--skill", "ln-310",
        "--phase", PHASES.SELF_CHECK,
        "--payload", JSON.stringify({ pass: true, processes_verified_dead: true, final_verdict: "GO" }),
    ]);
    const t4 = run(["advance", "--project-root", projectRoot, "--skill", "ln-310", "--to", PHASES.DONE]);
    expect("SELF_CHECK->DONE with processes_verified_dead allows", t4, true);

    // --- TEST 5: verify state fields ---
    const status = run(["status", "--project-root", projectRoot, "--skill", "ln-310"]);
    const s = status.state || {};
    const fieldsOk = s.refinement_exit_reason === "CONVERGED"
        && s.refinement_iterations === 3
        && s.refinement_applied === 5
        && s.processes_verified_dead === true;
    if (fieldsOk) {
        passed++;
        process.stdout.write("  PASS: state fields correct\n");
    } else {
        failed++;
        process.stdout.write(`  FAIL: state fields (got ${JSON.stringify({
            exit: s.refinement_exit_reason,
            iter: s.refinement_iterations,
            applied: s.refinement_applied,
            dead: s.processes_verified_dead,
        })})\n`);
    }

    // --- NON-STORY MODE: final_result guard ---
    const nonStoryRoot = mkdtempSync(join(tmpdir(), "review-guards-nonstory-"));
    try {
        mkdirSync(join(nonStoryRoot, ".hex-skills", "agent-review"), { recursive: true });
        const nsManifestPath = join(nonStoryRoot, "ns-manifest.json");
        writeFileSync(nsManifestPath, JSON.stringify({
            storage_mode: "file",
            expected_agents: [],
            phase_policy: { phase4: "skipped_by_mode", phase7: "skipped_by_mode" },
        }, null, 2));

        const nsRun = (args) => run([...args, "--project-root", nonStoryRoot]);

        nsRun([
            "start", "--skill", "ln-310", "--mode", "plan_review",
            "--identifier", "NS-TEST", "--manifest-file", nsManifestPath,
        ]);

        // Fast-forward through phases for plan_review
        nsRun(["checkpoint", "--skill", "ln-310", "--phase", PHASES.CONFIG]);
        nsRun(["advance", "--skill", "ln-310", "--to", PHASES.DISCOVERY]);
        nsRun(["checkpoint", "--skill", "ln-310", "--phase", PHASES.DISCOVERY]);
        nsRun(["advance", "--skill", "ln-310", "--to", PHASES.AGENT_LAUNCH]);
        nsRun([
            "checkpoint", "--skill", "ln-310",
            "--phase", PHASES.AGENT_LAUNCH,
            "--payload", JSON.stringify({ health_check_done: true, agents_available: 0, agents_skipped_reason: "test" }),
        ]);
        nsRun(["advance", "--skill", "ln-310", "--to", PHASES.RESEARCH]);
        nsRun(["checkpoint", "--skill", "ln-310", "--phase", PHASES.RESEARCH]);
        nsRun(["advance", "--skill", "ln-310", "--to", PHASES.AUTOFIX]);
        nsRun(["checkpoint", "--skill", "ln-310", "--phase", PHASES.AUTOFIX, "--payload", JSON.stringify({ status: "skipped_by_mode" })]);
        nsRun(["advance", "--skill", "ln-310", "--to", PHASES.MERGE]);
        nsRun(["checkpoint", "--skill", "ln-310", "--phase", PHASES.MERGE, "--payload", JSON.stringify({ merge_summary: "test" })]);
        nsRun(["advance", "--skill", "ln-310", "--to", PHASES.REFINEMENT]);
        nsRun([
            "checkpoint", "--skill", "ln-310",
            "--phase", PHASES.REFINEMENT,
            "--payload", JSON.stringify({ iterations: 0, exit_reason: "SKIPPED" }),
        ]);
        nsRun(["advance", "--skill", "ln-310", "--to", PHASES.SELF_CHECK]);

        // TEST 6: DONE without final_verdict (final_result=null) should BLOCK
        nsRun([
            "checkpoint", "--skill", "ln-310",
            "--phase", PHASES.SELF_CHECK,
            "--payload", JSON.stringify({ pass: true, processes_verified_dead: true }),
        ]);
        const t6 = nsRun(["advance", "--skill", "ln-310", "--to", PHASES.DONE]);
        expect("non-story DONE without final_result blocks", t6, false);

        // TEST 7: DONE with final_verdict should ALLOW
        nsRun([
            "checkpoint", "--skill", "ln-310",
            "--phase", PHASES.SELF_CHECK,
            "--payload", JSON.stringify({ pass: true, processes_verified_dead: true, final_verdict: "SUGGESTIONS" }),
        ]);
        const t7 = nsRun(["advance", "--skill", "ln-310", "--to", PHASES.DONE]);
        expect("non-story DONE with final_result allows", t7, true);
    } finally {
        rmSync(nonStoryRoot, { recursive: true, force: true });
    }

    process.stdout.write(`\nreview-runtime guards: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
