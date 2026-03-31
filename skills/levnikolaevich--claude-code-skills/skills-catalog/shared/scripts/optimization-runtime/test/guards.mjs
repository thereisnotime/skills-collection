#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    OPTIMIZATION_GATE_VERDICTS,
    OPTIMIZATION_VALIDATION_VERDICTS,
} from "../../coordinator-runtime/lib/runtime-constants.mjs";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "optimization-guards-"));
const manifestPath = join(projectRoot, "manifest.json");

writeFileSync(manifestPath, JSON.stringify({
    slug: "guard-test",
    target: "src/test.py::fn",
    observed_metric: { type: "response_time", value: 5000, unit: "ms" },
    cycle_config: { max_cycles: 1, plateau_threshold: 5 },
    execution_mode: "execute",
}, null, 2));

let passed = 0;
let failed = 0;

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

const S = "--slug";
const SV = "guard-test";
const P = "--project-root";

try {
    run(["start", P, projectRoot, S, SV, "--manifest-file", manifestPath]);

    // Fast-forward to WRONG_TOOL_GATE
    run(["checkpoint", P, projectRoot, S, SV, "--phase", PHASES.PREFLIGHT]);
    run(["advance", P, projectRoot, S, SV, "--to", PHASES.PARSE_INPUT]);
    run(["checkpoint", P, projectRoot, S, SV, "--phase", PHASES.PARSE_INPUT, "--payload", "{\"target_metric\":{\"value\":500}}"]);
    run(["advance", P, projectRoot, S, SV, "--to", PHASES.PROFILE]);
    run(["checkpoint", P, projectRoot, S, SV, "--phase", PHASES.PROFILE]);
    run(["advance", P, projectRoot, S, SV, "--to", PHASES.WRONG_TOOL_GATE]);

    // TEST 1: RESEARCH blocked with BLOCK verdict
    run(["checkpoint", P, projectRoot, S, SV, "--phase", PHASES.WRONG_TOOL_GATE, "--payload", JSON.stringify({ gate_verdict: OPTIMIZATION_GATE_VERDICTS.BLOCK })]);
    const t1 = run(["advance", P, projectRoot, S, SV, "--to", PHASES.RESEARCH], { allowFailure: true });
    expect("RESEARCH blocked with BLOCK verdict", t1, false);

    // TEST 2: AGGREGATE allowed from WRONG_TOOL_GATE with BLOCK
    const t2 = run(["advance", P, projectRoot, S, SV, "--to", PHASES.AGGREGATE]);
    expect("AGGREGATE allowed from WRONG_TOOL_GATE with BLOCK", t2, true);

    // Go back — start fresh for PROCEED path
    rmSync(projectRoot, { recursive: true, force: true });
    const projectRoot2 = mkdtempSync(join(tmpdir(), "optimization-guards2-"));
    const manifestPath2 = join(projectRoot2, "manifest.json");
    writeFileSync(manifestPath2, JSON.stringify({
        slug: "guard-test", target: "src/test.py::fn",
        observed_metric: { type: "response_time", value: 5000, unit: "ms" },
        cycle_config: { max_cycles: 1, plateau_threshold: 5 },
        execution_mode: "execute",
    }, null, 2));

    const run2 = (args, options = {}) => {
        try {
            return JSON.parse(execFileSync("node", [cliPath, ...args], { cwd: projectRoot2, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
        } catch (error) {
            if (options.allowFailure) { return JSON.parse(error.stdout || error.stderr); }
            throw error;
        }
    };

    run2(["start", P, projectRoot2, S, SV, "--manifest-file", manifestPath2]);
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.PREFLIGHT]);
    run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.PARSE_INPUT]);
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.PARSE_INPUT, "--payload", "{\"target_metric\":{\"value\":500}}"]);
    run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.PROFILE]);
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.PROFILE]);
    run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.WRONG_TOOL_GATE]);

    // TEST 3: RESEARCH allowed with PROCEED verdict
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.WRONG_TOOL_GATE, "--payload", JSON.stringify({ gate_verdict: OPTIMIZATION_GATE_VERDICTS.PROCEED })]);
    const t3 = run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.RESEARCH]);
    expect("RESEARCH allowed with PROCEED verdict", t3, true);

    // TEST 4: AGGREGATE blocked from RESEARCH with hypotheses > 0
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.RESEARCH, "--payload", "{\"hypotheses_count\":3}"]);
    const t4 = run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.AGGREGATE], { allowFailure: true });
    expect("AGGREGATE blocked from RESEARCH with hypotheses", t4, false);

    // Fast-forward through SET_TARGET → WRITE_CONTEXT
    run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.SET_TARGET]);
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.SET_TARGET, "--payload", "{\"target_metric\":{\"value\":500}}"]);
    run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.WRITE_CONTEXT]);

    // TEST 5: VALIDATE_PLAN blocked without context_file
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.WRITE_CONTEXT]);
    const t5 = run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.VALIDATE_PLAN], { allowFailure: true });
    expect("VALIDATE_PLAN blocked without context_file", t5, false);

    // Fix context_file
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.WRITE_CONTEXT, "--payload", "{\"context_file\":\"ctx.md\"}"]);

    // TEST 6: VALIDATE_PLAN allowed with context_file
    const t6 = run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.VALIDATE_PLAN]);
    expect("VALIDATE_PLAN allowed with context_file", t6, true);

    // TEST 7: EXECUTE blocked with NO_GO verdict
    run2(["record-worker-result", P, projectRoot2, S, SV, "--worker", "ln-813", "--payload", JSON.stringify({ verdict: OPTIMIZATION_VALIDATION_VERDICTS.NO_GO })]);
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.VALIDATE_PLAN, "--payload", JSON.stringify({ validation_verdict: OPTIMIZATION_VALIDATION_VERDICTS.NO_GO })]);
    const t7 = run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.EXECUTE], { allowFailure: true });
    expect("EXECUTE blocked with NO_GO verdict", t7, false);

    // Fix: GO verdict
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.VALIDATE_PLAN, "--payload", JSON.stringify({ validation_verdict: OPTIMIZATION_VALIDATION_VERDICTS.GO })]);
    run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.EXECUTE]);

    // TEST 8: CYCLE_BOUNDARY blocked without execution_result
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.EXECUTE]);
    const t8 = run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.CYCLE_BOUNDARY], { allowFailure: true });
    expect("CYCLE_BOUNDARY blocked without execution_result", t8, false);

    // Fix and complete cycle
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.EXECUTE, "--payload", "{\"execution_result\":{\"target_met\":true}}"]);
    run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.CYCLE_BOUNDARY]);
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.CYCLE_BOUNDARY, "--payload", "{\"stop_reason\":\"TARGET_MET\",\"final_result\":\"TARGET_MET\"}"]);

    // TEST 9: PROFILE blocked with stop_reason (cannot start new cycle)
    const t9 = run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.PROFILE], { allowFailure: true });
    expect("PROFILE blocked after stop_reason", t9, false);

    // TEST 10: DONE blocked without report_ready
    run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.AGGREGATE]);
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.AGGREGATE]);
    run2(["advance", P, projectRoot2, S, SV, "--to", PHASES.REPORT]);
    run2(["checkpoint", P, projectRoot2, S, SV, "--phase", PHASES.REPORT, "--payload", "{\"final_result\":\"TARGET_MET\"}"]);
    const t10 = run2(["complete", P, projectRoot2, S, SV], { allowFailure: true });
    expect("DONE blocked without report_ready", t10, false);

    rmSync(projectRoot2, { recursive: true, force: true });

    process.stdout.write(`\noptimization-runtime guards: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
} finally {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
}
