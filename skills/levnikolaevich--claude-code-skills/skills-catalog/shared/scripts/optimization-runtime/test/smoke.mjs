#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    OPTIMIZATION_CYCLE_STATUSES,
    OPTIMIZATION_GATE_VERDICTS,
    OPTIMIZATION_VALIDATION_VERDICTS,
} from "../../coordinator-runtime/lib/runtime-constants.mjs";
import { PHASES } from "../lib/phases.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cliPath = join(__dirname, "..", "cli.mjs");
const projectRoot = mkdtempSync(join(tmpdir(), "optimization-runtime-"));

function run(args) {
    return JSON.parse(execFileSync("node", [cliPath, ...args], {
        cwd: projectRoot,
        encoding: "utf8",
    }));
}

try {
    const manifestPath = join(projectRoot, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
        slug: "align-endpoint",
        target: "src/api/alignment.py::align_endpoint",
        observed_metric: { type: "response_time", value: 6300, unit: "ms" },
        cycle_config: { max_cycles: 3, plateau_threshold: 5 },
        execution_mode: "execute",
    }, null, 2));

    const started = run(["start", "--project-root", projectRoot, "--slug", "align-endpoint", "--manifest-file", manifestPath]);
    if (!started.ok) {
        throw new Error("Failed to start optimization runtime");
    }

    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.PREFLIGHT]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.PARSE_INPUT]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.PARSE_INPUT, "--payload", "{\"target_metric\":{\"value\":500,\"unit\":\"ms\"}}"]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.PROFILE]);
    run(["record-worker-result", "--project-root", projectRoot, "--slug", "align-endpoint", "--worker", "ln-811", "--payload", "{\"baseline\":{\"wall_time_ms\":6300}}"]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.PROFILE]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.WRONG_TOOL_GATE]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.WRONG_TOOL_GATE, "--payload", JSON.stringify({ gate_verdict: OPTIMIZATION_GATE_VERDICTS.PROCEED })]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.RESEARCH]);
    run(["record-worker-result", "--project-root", projectRoot, "--slug", "align-endpoint", "--worker", "ln-812", "--payload", "{\"hypotheses\":[\"H1\"]}"]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.RESEARCH, "--payload", "{\"hypotheses_count\":1}"]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.SET_TARGET]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.SET_TARGET, "--payload", "{\"target_metric\":{\"value\":500,\"unit\":\"ms\"}}"]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.WRITE_CONTEXT]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.WRITE_CONTEXT, "--payload", "{\"context_file\":\".hex-skills/optimization/align-endpoint/context.md\"}"]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.VALIDATE_PLAN]);
    run(["record-worker-result", "--project-root", projectRoot, "--slug", "align-endpoint", "--worker", "ln-813", "--payload", JSON.stringify({ verdict: OPTIMIZATION_VALIDATION_VERDICTS.GO })]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.VALIDATE_PLAN, "--payload", JSON.stringify({ validation_verdict: OPTIMIZATION_VALIDATION_VERDICTS.GO })]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.EXECUTE]);
    run(["record-worker-result", "--project-root", projectRoot, "--slug", "align-endpoint", "--worker", "ln-814", "--payload", "{\"target_met\":true}"]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.EXECUTE, "--payload", "{\"execution_result\":{\"target_met\":true}}"]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.CYCLE_BOUNDARY]);
    run(["record-cycle", "--project-root", projectRoot, "--slug", "align-endpoint", "--payload", JSON.stringify({ cycle: 1, status: OPTIMIZATION_CYCLE_STATUSES.COMPLETED, stop_reason: "TARGET_MET", final_result: "TARGET_MET" })]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.CYCLE_BOUNDARY, "--payload", "{\"stop_reason\":\"TARGET_MET\",\"final_result\":\"TARGET_MET\"}"]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.AGGREGATE]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.AGGREGATE]);
    run(["advance", "--project-root", projectRoot, "--slug", "align-endpoint", "--to", PHASES.REPORT]);
    run(["checkpoint", "--project-root", projectRoot, "--slug", "align-endpoint", "--phase", PHASES.REPORT, "--payload", "{\"report_ready\":true,\"final_result\":\"TARGET_MET\"}"]);
    const completed = run(["complete", "--project-root", projectRoot, "--slug", "align-endpoint"]);

    if (!completed.ok || completed.state.phase !== PHASES.DONE) {
        throw new Error("Optimization runtime did not complete");
    }

    process.stdout.write("optimization-runtime smoke passed\n");
} finally {
    rmSync(projectRoot, { recursive: true, force: true });
}
