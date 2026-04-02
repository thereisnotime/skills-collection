#!/usr/bin/env node

import {
    PHASES, createTestEnv, cleanupTestEnv, run,
    startStoryRuntime, fastForwardTo, expect, report,
} from "./helpers.mjs";

const projectRoot = createTestEnv("review-guards-refinement-");

try {
    startStoryRuntime(projectRoot, "REFINE-TEST");
    fastForwardTo(projectRoot, PHASES.MERGE);
    run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.REFINEMENT]);

    // TEST 1: advance REFINEMENT -> APPROVE WITHOUT exit_reason (should BLOCK)
    run(projectRoot, [
        "checkpoint", "--skill", "ln-310",
        "--phase", PHASES.REFINEMENT,
        "--payload", JSON.stringify({ iterations: 1 }),
    ]);
    const t1 = run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.APPROVE]);
    expect("REFINEMENT->APPROVE without exit_reason blocks", t1, false);

    // TEST 2: CONVERGED with iterations=0 (should BLOCK — iterations >= 1 required)
    run(projectRoot, [
        "checkpoint", "--skill", "ln-310",
        "--phase", PHASES.REFINEMENT,
        "--payload", JSON.stringify({ iterations: 0, exit_reason: "CONVERGED", applied: 0 }),
    ]);
    const t2 = run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.APPROVE]);
    expect("REFINEMENT->APPROVE with CONVERGED but iterations=0 blocks", t2, false);

    // TEST 3: CONVERGED with iterations=3 (should ALLOW)
    run(projectRoot, [
        "checkpoint", "--skill", "ln-310",
        "--phase", PHASES.REFINEMENT,
        "--payload", JSON.stringify({ iterations: 3, exit_reason: "CONVERGED", applied: 5 }),
    ]);
    const t3 = run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.APPROVE]);
    expect("REFINEMENT->APPROVE with CONVERGED and iterations=3 allows", t3, true);

    // TEST 4: verify state fields
    const status = run(projectRoot, ["status", "--skill", "ln-310"]);
    const s = status.state || {};
    const fieldsOk = s.refinement_exit_reason === "CONVERGED"
        && s.refinement_iterations === 3
        && s.refinement_applied === 5;
    if (fieldsOk) {
        process.stdout.write("  PASS: refinement state fields correct\n");
    } else {
        process.stdout.write(`  FAIL: refinement state fields (got ${JSON.stringify({
            exit: s.refinement_exit_reason,
            iter: s.refinement_iterations,
            applied: s.refinement_applied,
        })})\n`);
        process.exit(1);
    }

    report("guards-refinement");
} finally {
    cleanupTestEnv(projectRoot);
}
