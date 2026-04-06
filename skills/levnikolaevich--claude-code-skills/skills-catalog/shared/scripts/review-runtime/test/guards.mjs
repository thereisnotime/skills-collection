#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "review-guards-"));

let passed = 0;
let failed = 0;

function run(args, options = {}) {
    try {
        return JSON.parse(execFileSync("node", [cliPath, ...args], {
            cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        }));
    } catch (error) {
        if (options.allowFailure) {
            try { return JSON.parse(error.stdout || error.stderr); }
            catch { return { ok: false, error: error.message }; }
        }
        throw error;
    }
}

function expect(name, result, expectedOk) {
    if (result.ok === expectedOk) { passed++; process.stdout.write(`  PASS: ${name}\n`); }
    else { failed++; process.stdout.write(`  FAIL: ${name} (expected ok=${expectedOk}, got ok=${result.ok}, error=${result.error})\n`); }
}

const P = "--project-root";
const S = "--skill";
const M = "--mode";
const I = "--identifier";

try {
    const manifestPath = join(projectRoot, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
        mode: "story",
        phase_order: [
            "PHASE_0_CONFIG", "PHASE_1_DISCOVERY", "PHASE_2_AGENT_LAUNCH",
            "PHASE_3_RESEARCH", "PHASE_4_DOCS", "PHASE_5_AUTOFIX",
            "PHASE_6_MERGE", "PHASE_7_REFINEMENT", "PHASE_8_APPROVE",
            "PHASE_9_SELF_CHECK",
        ],
    }, null, 2));

    // Start and advance through CONFIG → DISCOVERY → AGENT_LAUNCH
    run(["start", P, projectRoot, S, "ln-510", M, "story", I, "guards-test", "--manifest-file", manifestPath]);
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_0_CONFIG"]);
    run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_1_DISCOVERY"]);
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_1_DISCOVERY"]);
    run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_2_AGENT_LAUNCH"]);

    // TEST 1: RESEARCH blocked without health_check_done
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_2_AGENT_LAUNCH",
        "--payload", JSON.stringify({ health_check_done: false, agents_available: 0, agents_skipped_reason: "test" })]);
    const t1 = run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_3_RESEARCH"], { allowFailure: true });
    expect("RESEARCH blocked without health_check_done", t1, false);

    // TEST 2: RESEARCH blocked without agents_skipped_reason when agents_available=0
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_2_AGENT_LAUNCH",
        "--payload", JSON.stringify({ health_check_done: true, agents_available: 0 })]);
    const t2 = run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_3_RESEARCH"], { allowFailure: true });
    expect("RESEARCH blocked without agents_skipped_reason", t2, false);

    // TEST 3: RESEARCH allowed with valid checkpoint
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_2_AGENT_LAUNCH",
        "--payload", JSON.stringify({ health_check_done: true, agents_available: 0, agents_skipped_reason: "no agents configured" })]);
    const t3 = run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_3_RESEARCH"]);
    expect("RESEARCH allowed with agents_skipped_reason", t3, true);

    // Advance through RESEARCH → DOCS
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_3_RESEARCH"]);
    run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_4_DOCS"]);

    // TEST 4: MERGE blocked without docs_checkpoint in story mode
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_4_DOCS"]);
    const t4 = run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_6_MERGE"], { allowFailure: true });
    expect("MERGE blocked without docs_checkpoint in story mode", t4, false);

    // TEST 5: MERGE blocked - story mode must pass through AUTOFIX first
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_4_DOCS",
        "--payload", JSON.stringify({ docs_checkpoint: true })]);
    const t5 = run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_6_MERGE"], { allowFailure: true });
    expect("MERGE blocked - story mode requires AUTOFIX first", t5, false);

    // Go through AUTOFIX → MERGE → REFINEMENT
    run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_5_AUTOFIX"]);
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_5_AUTOFIX"]);
    run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_6_MERGE"]);
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_6_MERGE",
        "--payload", JSON.stringify({ merge_summary: { total_issues: 5 } })]);
    run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_7_REFINEMENT"]);

    // TEST 6: APPROVE blocked without refinement_exit_reason
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_7_REFINEMENT",
        "--payload", JSON.stringify({ iterations: 1 })]);
    const t6 = run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_8_APPROVE"], { allowFailure: true });
    expect("APPROVE blocked without refinement_exit_reason", t6, false);

    // TEST 7: APPROVE allowed with valid refinement
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_7_REFINEMENT",
        "--payload", JSON.stringify({ iterations: 1, exit_reason: "CONVERGED", applied: 2 })]);
    const t7 = run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_8_APPROVE"]);
    expect("APPROVE allowed with refinement_exit_reason", t7, true);

    // APPROVE → SELF_CHECK
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_8_APPROVE",
        "--payload", JSON.stringify({ verdict: "PASS" })]);
    run(["advance", P, projectRoot, S, "ln-510", I, "guards-test", "--to", "PHASE_9_SELF_CHECK"]);

    // TEST 8: DONE blocked without self_check_passed (processes not verified)
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_9_SELF_CHECK",
        "--payload", JSON.stringify({ pass: true, processes_verified_dead: false })]);
    const t8 = run(["complete", P, projectRoot, S, "ln-510", I, "guards-test"], { allowFailure: true });
    expect("DONE blocked without processes_verified_dead", t8, false);

    // TEST 9: DONE allowed with all guards satisfied
    run(["checkpoint", P, projectRoot, S, "ln-510", I, "guards-test", "--phase", "PHASE_9_SELF_CHECK",
        "--payload", JSON.stringify({ pass: true, processes_verified_dead: true, final_verdict: "PASS" })]);
    const t9 = run(["complete", P, projectRoot, S, "ln-510", I, "guards-test"]);
    expect("DONE allowed with all guards satisfied", t9, true);

    process.stdout.write(`\nreview-runtime guards: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
