// FIX-W4-E bug-hunt regression tests for build_prompt.ts.
//
// Covers three confirmed bugs fixed in this file:
//   H7: extractQueueTasks throws on a numeric task id (`(123).startsWith` is not
//       a function), the throw propagates out of buildPrompt, and the WHOLE real
//       prompt is discarded in favor of the stub. Fix: coerce fields to string.
//   H8: buildPromptForRunner passed PRD CONTENT where buildPrompt expects a PATH.
//       Non-degraded -> the entire PRD body was interpolated into the one-line
//       anchor; degraded -> resolve(content) -> missing path -> PRD dropped.
//       Fix: pass ctx.prdPath (or null) so buildPrompt's own path handling reads
//       the file.
//   L1: buildGateFailureContext read gate-failures.txt with no cap and inlined
//       the whole file. Fix: cap at 8000 bytes (matches the most-capping
//       siblings; never triggers on parity fixtures).
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildPrompt, buildPromptForRunner } from "../src/runner/build_prompt.ts";
import type { RunnerContext as LoopRunnerContext } from "../src/runner/types.ts";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(resolve(tmpdir(), "loki-bp-w4-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function mkLoki(...segs: string[]): string {
  const dir = resolve(workDir, ".loki", ...segs);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function emptyEnv(over: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    PHASE_UNIT_TESTS: "false",
    PHASE_API_TESTS: "false",
    PHASE_E2E_TESTS: "false",
    PHASE_SECURITY: "false",
    PHASE_INTEGRATION: "false",
    PHASE_CODE_REVIEW: "false",
    PHASE_WEB_RESEARCH: "false",
    PHASE_PERFORMANCE: "false",
    PHASE_ACCESSIBILITY: "false",
    PHASE_REGRESSION: "false",
    PHASE_UAT: "false",
    MAX_PARALLEL_AGENTS: "10",
    MAX_ITERATIONS: "1000",
    AUTONOMY_MODE: "",
    PERPETUAL_MODE: "false",
    PROVIDER_DEGRADED: "false",
    LOKI_LEGACY_PROMPT_ORDERING: "false",
    COMPLETION_PROMISE: "",
    LOKI_HUMAN_INPUT: "",
    TARGET_DIR: ".",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// H7: numeric task id must NOT throw; the real prompt must still be built.
// ---------------------------------------------------------------------------

describe("H7 -- numeric queue task id does not throw away the prompt", () => {
  it("builds the real prompt (not the stub) for a queue with a numeric id", async () => {
    const qdir = mkLoki("queue");
    // The confirmed live trigger: id is the NUMBER 123, not a string.
    writeFileSync(
      resolve(qdir, "pending.json"),
      JSON.stringify([{ id: 123, type: "refactor", payload: { action: "tidy up" } }]),
    );

    const env = emptyEnv();
    let out = "";
    // The bug was an uncaught throw -- assert no throw first.
    await expect(
      (async () => {
        out = await buildPrompt({
          retry: 0,
          prd: null,
          iteration: 1,
          ctx: { cwd: workDir, env },
        });
      })(),
    ).resolves.toBeUndefined();

    // And assert this is the REAL prompt, not a stub: it must carry the
    // structural anchors that only the full builder emits.
    expect(out).toContain("<loki_system>");
    expect(out).toContain("RALPH WIGGUM MODE ACTIVE");
    expect(out).toContain("[CACHE_BREAKPOINT]");
    // The numeric id must have been coerced and surfaced in the queue block.
    expect(out).toContain("id=123");
    expect(out).toContain("tidy up");
  });

  it("handles a numeric id on the PRD-source branch too (taskId.startsWith)", async () => {
    const qdir = mkLoki("queue");
    // source=prd forces the prd-branch where taskId.startsWith() is reached.
    writeFileSync(
      resolve(qdir, "pending.json"),
      JSON.stringify([{ id: 456, source: "prd", title: "Numeric-id PRD task" }]),
    );

    const env = emptyEnv();
    const out = await buildPrompt({
      retry: 0,
      prd: null,
      iteration: 1,
      ctx: { cwd: workDir, env },
    });

    expect(out).toContain("<loki_system>");
    expect(out).toContain("456: Numeric-id PRD task");
  });
});

// ---------------------------------------------------------------------------
// H8: buildPromptForRunner must honor the PATH contract.
// ---------------------------------------------------------------------------

function makeLoopCtx(over: Partial<LoopRunnerContext> = {}): LoopRunnerContext {
  return {
    cwd: workDir,
    lokiDir: resolve(workDir, ".loki"),
    prdPath: undefined,
    provider: "claude",
    maxRetries: 3,
    maxIterations: 1000,
    baseWaitSeconds: 1,
    maxWaitSeconds: 60,
    autonomyMode: "perpetual",
    sessionModel: "development",
    budgetLimit: undefined,
    completionPromise: undefined,
    iterationCount: 1,
    retryCount: 0,
    currentTier: "development",
    log: () => {},
    ...over,
  };
}

describe("H8 -- buildPromptForRunner passes the PRD path, not its content", () => {
  it("anchors on the PRD PATH and never inlines the PRD body", async () => {
    const prdPath = resolve(workDir, "prd.md");
    const prdBody =
      "UNIQUE_PRD_BODY_TOKEN_SHOULD_NOT_APPEAR_IN_ANCHOR\nBuild a thing with many requirements.";
    writeFileSync(prdPath, prdBody);

    const out = await buildPromptForRunner(makeLoopCtx({ prdPath }));

    // Anchor must reference the PATH ...
    expect(out).toContain(`Loki Mode with PRD at ${prdPath}`);
    expect(out).toContain("prd.md");
    // ... and the full (non-degraded) prompt must NOT splice the PRD body into
    // the one-line anchor (that was the H8 bug). The body is read by the agent
    // from the path, not interpolated here.
    expect(out).not.toContain("UNIQUE_PRD_BODY_TOKEN_SHOULD_NOT_APPEAR_IN_ANCHOR");
  });

  it("does not crash when prdPath is undefined (codebase-analysis mode)", async () => {
    let out = "";
    await expect(
      (async () => {
        out = await buildPromptForRunner(makeLoopCtx({ prdPath: undefined }));
      })(),
    ).resolves.toBeUndefined();
    // No PRD -> plain anchor, and the codebase-analysis instruction is present.
    expect(out).toContain("<loki_system>");
    expect(out).toContain("Loki Mode");
    expect(out).toContain("CODEBASE_ANALYSIS_MODE");
  });
});

// ---------------------------------------------------------------------------
// L1: a huge gate-failures.txt must be truncated in the output.
// ---------------------------------------------------------------------------

describe("L1 -- gate-failures.txt is capped, not inlined whole", () => {
  it("truncates a multi-megabyte gate-failures dump", async () => {
    const qdir = mkLoki("quality");
    // 2 MB of stack-trace-like content -- far above the 8000-byte cap.
    const huge = "STACK_FRAME_LINE_PADDING_".repeat(100000);
    expect(huge.length).toBeGreaterThan(2_000_000);
    writeFileSync(resolve(qdir, "gate-failures.txt"), huge);

    const out = await buildPrompt({
      retry: 0,
      prd: null,
      iteration: 1,
      ctx: { cwd: workDir, env: emptyEnv() },
    });

    // The gate-failure block must be present (the file existed) ...
    expect(out).toContain("QUALITY GATE FAILURES FROM PREVIOUS ITERATION");
    // ... but the 2 MB payload must NOT be inlined wholesale. With an 8000-byte
    // cap on the failures content, the total prompt stays small. Use a generous
    // bound well below the raw file size to prove truncation happened.
    expect(out.length).toBeLessThan(100_000);
  });

  it("keeps a small gate-failures.txt intact (cap does not trigger)", async () => {
    const qdir = mkLoki("quality");
    writeFileSync(resolve(qdir, "gate-failures.txt"), "static-analysis: 2 errors");

    const out = await buildPrompt({
      retry: 0,
      prd: null,
      iteration: 1,
      ctx: { cwd: workDir, env: emptyEnv() },
    });
    expect(out).toContain("QUALITY GATE FAILURES FROM PREVIOUS ITERATION: [static-analysis: 2 errors]");
  });
});
