import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");

export { PHASES };

export function createTestEnv(prefix = "review-test-") {
    const projectRoot = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(projectRoot, ".hex-skills", "agent-review"), { recursive: true });
    return projectRoot;
}

export function cleanupTestEnv(projectRoot) {
    rmSync(projectRoot, { recursive: true, force: true });
}

export function run(projectRoot, args) {
    try {
        return JSON.parse(execFileSync("node", [cliPath, ...args, "--project-root", projectRoot], {
            cwd: projectRoot,
            encoding: "utf8",
        }));
    } catch (e) {
        if (e.stdout) return JSON.parse(e.stdout);
        return { ok: false, error: e.message };
    }
}

export function startStoryRuntime(projectRoot, identifier = "TEST") {
    const manifestPath = join(projectRoot, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
        storage_mode: "file",
        expected_agents: [],
        phase_policy: { phase5: "required", phase8: "required" },
    }, null, 2));
    return run(projectRoot, [
        "start", "--skill", "ln-310", "--mode", "story",
        "--identifier", identifier, "--manifest-file", manifestPath,
    ]);
}

export function startPlanRuntime(projectRoot, identifier = "NS-TEST") {
    const manifestPath = join(projectRoot, "ns-manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
        storage_mode: "file",
        expected_agents: [],
        phase_policy: { phase5: "skipped_by_mode", phase8: "skipped_by_mode" },
    }, null, 2));
    return run(projectRoot, [
        "start", "--skill", "ln-310", "--mode", "plan_review",
        "--identifier", identifier, "--manifest-file", manifestPath,
    ]);
}

const STORY_SEQUENCE = [
    [PHASES.CONFIG, null, PHASES.DISCOVERY],
    [PHASES.DISCOVERY, null, PHASES.AGENT_LAUNCH],
    [PHASES.AGENT_LAUNCH, { health_check_done: true, agents_available: 0, agents_skipped_reason: "test" }, PHASES.RESEARCH],
    [PHASES.RESEARCH, null, PHASES.DOCS],
    [PHASES.DOCS, { docs_checkpoint: { docs_created: [], docs_skipped_reason: "test" } }, PHASES.AUTOFIX],
    [PHASES.AUTOFIX, null, PHASES.MERGE],
    [PHASES.MERGE, { merge_summary: "test" }, PHASES.REFINEMENT],
    [PHASES.REFINEMENT, { iterations: 1, exit_reason: "CONVERGED", applied: 0 }, PHASES.APPROVE],
    [PHASES.APPROVE, { verdict: "GO" }, PHASES.SELF_CHECK],
];

export function fastForwardTo(projectRoot, targetPhase, overrides = {}) {
    for (const [phase, defaultPayload, nextPhase] of STORY_SEQUENCE) {
        const payload = overrides[phase] ?? defaultPayload;
        const args = ["checkpoint", "--skill", "ln-310", "--phase", phase];
        if (payload) args.push("--payload", JSON.stringify(payload));
        run(projectRoot, args);

        if (phase === targetPhase) return;
        run(projectRoot, ["advance", "--skill", "ln-310", "--to", nextPhase]);
    }
}

let passed = 0;
let failed = 0;

export function expect(name, result, expectedOk) {
    if (result.ok === expectedOk) {
        passed++;
        process.stdout.write(`  PASS: ${name}\n`);
    } else {
        failed++;
        process.stdout.write(`  FAIL: ${name} (expected ok=${expectedOk}, got ok=${result.ok}, error=${result.error})\n`);
    }
}

export function report(label) {
    process.stdout.write(`\n${label}: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

export function resetCounters() {
    passed = 0;
    failed = 0;
}
