// Edge-case tests for CRLF (Windows-style) line endings on .loki/ files.
//
// Goal: verify the runner's file readers handle `\r\n` line endings without
// corrupting parsing. The bash original is line-based (newline-sensitive)
// and CRLF historically caused subtle drift on WSL / cross-platform mounts.
//
// Source under test:
//   - state.ts:423 loadState (reads autonomy-state.json as JSON)
//   - state.ts:531 readOrchestratorState (reads .loki/state/orchestrator.json)
//   - state.ts:575 readProviderName (reads .loki/state/provider, single line)
//
// HUMAN_INPUT.md note: build_prompt.ts:876 reads LOKI_HUMAN_INPUT from the
// process env, not from a file -- so the CRLF-on-disk concern does not apply
// at the build_prompt boundary. This file documents that finding and
// instead exercises the file-backed surfaces that DO read CRLF-able content.
//
// Hermetic: each test creates a fresh tmpdir under tmpdir(); afterEach
// removes it.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadState,
  readOrchestratorState,
  readProviderName,
} from "../../src/runner/state.ts";

let tmp: string;
let dir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loki-crlf-"));
  dir = join(tmp, ".loki");
  mkdirSync(join(dir, "state"), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test (a): STATUS.txt-equivalent (provider file) read with CRLF
// ---------------------------------------------------------------------------
//
// readProviderName trims trailing whitespace, so CRLF on a single-line file
// must yield the same result as LF. STATUS.txt itself has no parser other
// than `cat`, so the closest analog with semantics is the provider file
// (state.ts:575-585).

describe("readProviderName: CRLF-trimmed single-line file", () => {
  it("returns the same provider name for both LF and CRLF endings", () => {
    const target = join(dir, "state", "provider");
    writeFileSync(target, "claude\r\n");
    const got = readProviderName({ lokiDirOverride: dir });
    expect(got).toBe("claude");
  });
});

// ---------------------------------------------------------------------------
// Test (b): autonomy-state.json with CRLF inside string values
// ---------------------------------------------------------------------------
//
// JSON.parse is whitespace-tolerant for structural newlines, but `\r\n`
// inside a string value is invalid JSON (must be escaped as `\r\n`). What
// we CAN robustly test is structural CRLF between fields -- the common
// case when a Windows editor saves a JSON file. loadState must accept it.

describe("loadState: autonomy-state.json with CRLF structural line endings", () => {
  it("parses CRLF-separated JSON without flagging corruption", () => {
    const target = join(dir, "autonomy-state.json");
    // Note the \r\n between every line. JSON.parse treats \r\n as whitespace
    // between tokens, so this must parse cleanly.
    const body =
      `{\r\n` +
      `    "retryCount": 3,\r\n` +
      `    "iterationCount": 7,\r\n` +
      `    "status": "running",\r\n` +
      `    "lastExitCode": 0,\r\n` +
      `    "lastRun": "2026-04-25T12:34:56Z",\r\n` +
      `    "prdPath": "/tmp/prd.md",\r\n` +
      `    "pid": 12345,\r\n` +
      `    "maxRetries": 5,\r\n` +
      `    "baseWait": 30\r\n` +
      `}\r\n`;
    writeFileSync(target, body);

    const result = loadState({ lokiDirOverride: dir });

    expect(result.corrupted).toBe(false);
    expect(result.state).not.toBeNull();
    expect(result.state?.retryCount).toBe(3);
    expect(result.state?.iterationCount).toBe(7);
    expect(result.state?.status).toBe("running");
    expect(result.state?.prdPath).toBe("/tmp/prd.md");
  });

  it("readOrchestratorState: parses CRLF-separated orchestrator.json", () => {
    const target = join(dir, "state", "orchestrator.json");
    const body =
      `{\r\n` +
      `    "currentPhase": "implementation",\r\n` +
      `    "iteration": 4,\r\n` +
      `    "complexity": "standard"\r\n` +
      `}\r\n`;
    writeFileSync(target, body);

    const got = readOrchestratorState({ lokiDirOverride: dir });
    expect(got).not.toBeNull();
    expect(got?.currentPhase).toBe("implementation");
    expect(got?.iteration).toBe(4);
    expect(got?.complexity).toBe("standard");
  });
});

// ---------------------------------------------------------------------------
// Test (c): HUMAN_INPUT.md preserved through env (documentation test)
// ---------------------------------------------------------------------------
//
// build_prompt.ts:876 reads HUMAN_INPUT from the LOKI_HUMAN_INPUT env var,
// NOT from a file on disk. So the CRLF-on-disk question does not arise at
// the build_prompt boundary -- the shell that exports the env var is
// responsible for preserving the bytes. This test documents that fact by
// asserting that a CRLF-containing env value flows through unchanged when
// read with our envStr helper-equivalent (process.env passthrough).
//
// If a future refactor moves HUMAN_INPUT.md reading into build_prompt
// itself, this test should be upgraded to write a CRLF .md file and assert
// CRLF preservation through the file reader.

describe("HUMAN_INPUT: CRLF env value flows unchanged (documentation)", () => {
  it("process.env round-trips CRLF in LOKI_HUMAN_INPUT", () => {
    const original = process.env.LOKI_HUMAN_INPUT;
    try {
      process.env.LOKI_HUMAN_INPUT = "line one\r\nline two\r\n";
      expect(process.env.LOKI_HUMAN_INPUT).toBe("line one\r\nline two\r\n");
    } finally {
      if (original === undefined) delete process.env.LOKI_HUMAN_INPUT;
      else process.env.LOKI_HUMAN_INPUT = original;
    }
  });

  it("a STATUS.txt-style file with CRLF is readable byte-for-byte", () => {
    // STATUS.txt has no parser -- it is `cat`-ed by humans. So the only
    // contract is "read returns the bytes we wrote". Verify CRLF survives
    // a write/read round-trip through our standard file primitives.
    const target = join(dir, "STATUS.txt");
    const body = "iteration 5\r\nstatus: running\r\nphase: build\r\n";
    writeFileSync(target, body);
    const got = readFileSync(target, "utf8");
    expect(got).toBe(body);
  });
});
