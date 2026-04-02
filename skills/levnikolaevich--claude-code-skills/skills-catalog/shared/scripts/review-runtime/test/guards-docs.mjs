#!/usr/bin/env node

import {
    PHASES, createTestEnv, cleanupTestEnv, run,
    startStoryRuntime, fastForwardTo, expect, report,
} from "./helpers.mjs";

const projectRoot = createTestEnv("review-guards-docs-");

try {
    startStoryRuntime(projectRoot, "DOCS-TEST");
    fastForwardTo(projectRoot, PHASES.RESEARCH);
    run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.DOCS]);

    // TEST 1: DOCS -> AUTOFIX without docs_checkpoint (should BLOCK)
    run(projectRoot, [
        "checkpoint", "--skill", "ln-310",
        "--phase", PHASES.DOCS,
    ]);
    const t1 = run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.AUTOFIX]);
    expect("DOCS->AUTOFIX without docs_checkpoint blocks", t1, false);

    // TEST 2: DOCS -> AUTOFIX with docs_checkpoint (should ALLOW)
    run(projectRoot, [
        "checkpoint", "--skill", "ln-310",
        "--phase", PHASES.DOCS,
        "--payload", JSON.stringify({ docs_checkpoint: { docs_created: ["docs/guides/01-rest.md"], docs_skipped_reason: null } }),
    ]);
    const t2 = run(projectRoot, ["advance", "--skill", "ln-310", "--to", PHASES.AUTOFIX]);
    expect("DOCS->AUTOFIX with docs_checkpoint allows", t2, true);

    report("guards-docs");
} finally {
    cleanupTestEnv(projectRoot);
}
