#!/usr/bin/env node

import {
    PHASES, createTestEnv, cleanupTestEnv, run,
    startStoryRuntime, startPlanRuntime, fastForwardTo, expect, report,
} from "./helpers.mjs";

const projectRoot = createTestEnv("review-guards-lifecycle-");

try {
    startStoryRuntime(projectRoot, "LIFECYCLE-TEST");
    fastForwardTo(projectRoot, PHASES.REFINEMENT, {
        [PHASES.REFINEMENT]: { iterations: 1, exit_reason: "CONVERGED", applied: 0 },
    });
    run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.APPROVE]);
    run(projectRoot, [
        "checkpoint", "--skill", "ln-310",
        "--phase", PHASES.APPROVE,
        "--payload", JSON.stringify({ verdict: "GO" }),
    ]);
    run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.SELF_CHECK]);

    // TEST 1: SELF_CHECK -> DONE without processes_verified_dead (should BLOCK)
    run(projectRoot, [
        "checkpoint", "--skill", "ln-310",
        "--phase", PHASES.SELF_CHECK,
        "--payload", JSON.stringify({ pass: true, final_verdict: "GO" }),
    ]);
    const t1 = run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.DONE]);
    expect("SELF_CHECK->DONE without processes_verified_dead blocks", t1, false);

    // TEST 2: SELF_CHECK -> DONE with processes_verified_dead (should ALLOW)
    run(projectRoot, [
        "checkpoint", "--skill", "ln-310",
        "--phase", PHASES.SELF_CHECK,
        "--payload", JSON.stringify({ pass: true, processes_verified_dead: true, final_verdict: "GO" }),
    ]);
    const t2 = run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.DONE]);
    expect("SELF_CHECK->DONE with processes_verified_dead allows", t2, true);

    // --- NON-STORY MODE ---
    const nonStoryRoot = createTestEnv("review-guards-nonstory-");
    try {
        startPlanRuntime(nonStoryRoot);
        fastForwardTo(nonStoryRoot, PHASES.RESEARCH);
        run(nonStoryRoot, ["advance", "--skill", "ln-310", "--to", PHASES.DOCS]);
        run(nonStoryRoot, ["checkpoint", "--skill", "ln-310", "--phase", PHASES.DOCS, "--payload", JSON.stringify({ status: "skipped_by_mode" })]);
        run(nonStoryRoot, ["advance", "--skill", "ln-310", "--to", PHASES.AUTOFIX]);
        run(nonStoryRoot, ["checkpoint", "--skill", "ln-310", "--phase", PHASES.AUTOFIX, "--payload", JSON.stringify({ status: "skipped_by_mode" })]);
        run(nonStoryRoot, ["advance", "--skill", "ln-310", "--to", PHASES.MERGE]);
        run(nonStoryRoot, ["checkpoint", "--skill", "ln-310", "--phase", PHASES.MERGE, "--payload", JSON.stringify({ merge_summary: "test" })]);
        run(nonStoryRoot, ["advance", "--skill", "ln-310", "--to", PHASES.REFINEMENT]);
        run(nonStoryRoot, [
            "checkpoint", "--skill", "ln-310",
            "--phase", PHASES.REFINEMENT,
            "--payload", JSON.stringify({ iterations: 0, exit_reason: "SKIPPED" }),
        ]);
        run(nonStoryRoot, ["advance", "--skill", "ln-310", "--to", PHASES.SELF_CHECK]);

        // TEST 3: DONE without final_verdict (final_result=null) should BLOCK
        run(nonStoryRoot, [
            "checkpoint", "--skill", "ln-310",
            "--phase", PHASES.SELF_CHECK,
            "--payload", JSON.stringify({ pass: true, processes_verified_dead: true }),
        ]);
        const t3 = run(nonStoryRoot, ["advance", "--skill", "ln-310", "--to", PHASES.DONE]);
        expect("non-story DONE without final_result blocks", t3, false);

        // TEST 4: DONE with final_verdict should ALLOW
        run(nonStoryRoot, [
            "checkpoint", "--skill", "ln-310",
            "--phase", PHASES.SELF_CHECK,
            "--payload", JSON.stringify({ pass: true, processes_verified_dead: true, final_verdict: "SUGGESTIONS" }),
        ]);
        const t4 = run(nonStoryRoot, ["advance", "--skill", "ln-310", "--to", PHASES.DONE]);
        expect("non-story DONE with final_result allows", t4, true);
    } finally {
        cleanupTestEnv(nonStoryRoot);
    }

    report("guards-lifecycle");
} finally {
    cleanupTestEnv(projectRoot);
}
