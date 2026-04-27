// Tests for src/runner/intervention.ts.
// Source-of-truth: autonomy/run.sh:11120-11326 (check_human_intervention,
// handle_pause).
//
// Hermetic: each test creates a fresh tmpdir and passes it via lokiDirOverride.
// handlePause tests use a short pollIntervalMs and a maxWaitMs ceiling.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  checkHumanIntervention,
  handlePause,
  readHumanInput,
} from "../../src/runner/intervention.ts";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
let dir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loki-intervene-test-"));
  dir = join(tmp, ".loki");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function touch(path: string, body = ""): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

describe("checkHumanIntervention: PAUSE", () => {
  it("returns pause action in standard mode and leaves PAUSE in place", () => {
    touch(join(dir, "PAUSE"));
    const r = checkHumanIntervention({ lokiDirOverride: dir });
    expect(r.action).toBe("pause");
    // PAUSE removal happens in handlePause, not the check itself.
    expect(existsSync(join(dir, "PAUSE"))).toBe(true);
  });

  it("auto-clears in perpetual mode and continues", () => {
    touch(join(dir, "PAUSE"));
    touch(join(dir, "PAUSED.md"));
    const r = checkHumanIntervention({
      lokiDirOverride: dir,
      autonomyMode: "perpetual",
    });
    expect(r.action).toBe("continue");
    expect(existsSync(join(dir, "PAUSE"))).toBe(false);
    expect(existsSync(join(dir, "PAUSED.md"))).toBe(false);
  });

  it("does NOT auto-clear in perpetual mode when BUDGET_EXCEEDED is set", () => {
    touch(join(dir, "PAUSE"));
    touch(join(dir, "signals", "BUDGET_EXCEEDED"));
    const r = checkHumanIntervention({
      lokiDirOverride: dir,
      autonomyMode: "perpetual",
    });
    expect(r.action).toBe("pause");
    expect(existsSync(join(dir, "PAUSE"))).toBe(true);
    expect(r.reason).toContain("Budget");
  });
});

describe("checkHumanIntervention: PAUSE_AT_CHECKPOINT", () => {
  it("creates PAUSE and returns pause when in checkpoint mode", () => {
    touch(join(dir, "PAUSE_AT_CHECKPOINT"));
    const r = checkHumanIntervention({
      lokiDirOverride: dir,
      autonomyMode: "checkpoint",
    });
    expect(r.action).toBe("pause");
    expect(existsSync(join(dir, "PAUSE_AT_CHECKPOINT"))).toBe(false);
    expect(existsSync(join(dir, "PAUSE"))).toBe(true);
  });

  it("removes stale PAUSE_AT_CHECKPOINT in non-checkpoint mode and continues", () => {
    touch(join(dir, "PAUSE_AT_CHECKPOINT"));
    const r = checkHumanIntervention({
      lokiDirOverride: dir,
      autonomyMode: "standard",
    });
    expect(r.action).toBe("continue");
    expect(existsSync(join(dir, "PAUSE_AT_CHECKPOINT"))).toBe(false);
  });
});

describe("checkHumanIntervention: HUMAN_INPUT.md", () => {
  it("returns input action with payload when prompt injection enabled", () => {
    touch(join(dir, "HUMAN_INPUT.md"), "fix the login bug");
    const r = checkHumanIntervention({
      lokiDirOverride: dir,
      promptInjectionEnabled: true,
      now: new Date("2026-04-25T12:34:56Z"),
    });
    expect(r.action).toBe("input");
    expect(r.payload).toBe("fix the login bug");
    // File is moved into logs/ for audit trail.
    expect(existsSync(join(dir, "HUMAN_INPUT.md"))).toBe(false);
    const logs = readdirSync(join(dir, "logs"));
    expect(logs.some((f) => f.startsWith("human-input-") && f.endsWith(".md"))).toBe(true);
  });

  it("rejects file when prompt injection disabled (default)", () => {
    touch(join(dir, "HUMAN_INPUT.md"), "should be rejected");
    const r = checkHumanIntervention({ lokiDirOverride: dir });
    expect(r.action).toBe("continue");
    expect(existsSync(join(dir, "HUMAN_INPUT.md"))).toBe(false);
    const logs = readdirSync(join(dir, "logs"));
    expect(logs.some((f) => f.startsWith("human-input-REJECTED-"))).toBe(true);
  });

  it("rejects symlinks regardless of injection flag (security)", () => {
    const real = join(tmp, "evil.md");
    writeFileSync(real, "pwn");
    symlinkSync(real, join(dir, "HUMAN_INPUT.md"));
    const r = checkHumanIntervention({
      lokiDirOverride: dir,
      promptInjectionEnabled: true,
    });
    expect(r.action).toBe("continue");
    expect(r.reason).toContain("symlink");
    expect(existsSync(join(dir, "HUMAN_INPUT.md"))).toBe(false);
    // Real file untouched.
    expect(existsSync(real)).toBe(true);
  });

  it("rejects oversized file (>1MB)", () => {
    const big = "x".repeat(1024 * 1024 + 1);
    touch(join(dir, "HUMAN_INPUT.md"), big);
    const r = checkHumanIntervention({
      lokiDirOverride: dir,
      promptInjectionEnabled: true,
    });
    expect(r.action).toBe("continue");
    expect(r.reason).toContain("1MB");
    expect(existsSync(join(dir, "HUMAN_INPUT.md"))).toBe(false);
    const logs = readdirSync(join(dir, "logs"));
    expect(logs.some((f) => f.includes("TOOLARGE"))).toBe(true);
  });

  it("accepts file at exactly 1MB boundary", () => {
    const justAtLimit = "x".repeat(1024 * 1024);
    touch(join(dir, "HUMAN_INPUT.md"), justAtLimit);
    const r = checkHumanIntervention({
      lokiDirOverride: dir,
      promptInjectionEnabled: true,
    });
    expect(r.action).toBe("input");
    expect(r.payload?.length).toBe(1024 * 1024);
  });

  it("ignores empty file (no action, no quarantine)", () => {
    touch(join(dir, "HUMAN_INPUT.md"), "");
    const r = checkHumanIntervention({
      lokiDirOverride: dir,
      promptInjectionEnabled: true,
    });
    expect(r.action).toBe("continue");
  });
});

describe("checkHumanIntervention: COUNCIL_REVIEW_REQUESTED", () => {
  it("removes the signal and continues (council subsystem not yet ported)", () => {
    touch(join(dir, "signals", "COUNCIL_REVIEW_REQUESTED"));
    const r = checkHumanIntervention({ lokiDirOverride: dir });
    expect(r.action).toBe("continue");
    expect(r.reason).toContain("Council");
    expect(existsSync(join(dir, "signals", "COUNCIL_REVIEW_REQUESTED"))).toBe(false);
  });
});

describe("checkHumanIntervention: STOP", () => {
  it("returns stop and removes the file", () => {
    touch(join(dir, "STOP"));
    const r = checkHumanIntervention({ lokiDirOverride: dir });
    expect(r.action).toBe("stop");
    expect(existsSync(join(dir, "STOP"))).toBe(false);
  });

  it("PAUSE has priority over STOP (matches bash order)", () => {
    touch(join(dir, "PAUSE"));
    touch(join(dir, "STOP"));
    const r = checkHumanIntervention({ lokiDirOverride: dir });
    expect(r.action).toBe("pause");
    // STOP must remain so the next check after pause picks it up.
    expect(existsSync(join(dir, "STOP"))).toBe(true);
  });
});

describe("checkHumanIntervention: no signals", () => {
  it("returns continue when nothing is set", () => {
    const r = checkHumanIntervention({ lokiDirOverride: dir });
    expect(r.action).toBe("continue");
  });
});

describe("readHumanInput", () => {
  it("returns body for a regular file under 1MB", () => {
    touch(join(dir, "HUMAN_INPUT.md"), "hello");
    expect(readHumanInput({ lokiDirOverride: dir })).toBe("hello");
  });

  it("returns null for symlinks", () => {
    const real = join(tmp, "real.md");
    writeFileSync(real, "x");
    symlinkSync(real, join(dir, "HUMAN_INPUT.md"));
    expect(readHumanInput({ lokiDirOverride: dir })).toBeNull();
  });

  it("returns null for files over 1MB", () => {
    touch(join(dir, "HUMAN_INPUT.md"), "y".repeat(1024 * 1024 + 1));
    expect(readHumanInput({ lokiDirOverride: dir })).toBeNull();
  });

  it("returns null when missing", () => {
    expect(readHumanInput({ lokiDirOverride: dir })).toBeNull();
  });
});

describe("handlePause", () => {
  it("returns 'resumed' when PAUSE is removed externally", async () => {
    touch(join(dir, "PAUSE"));
    const promise = handlePause({
      lokiDirOverride: dir,
      pollIntervalMs: 20,
      maxWaitMs: 2000,
    });
    // Remove PAUSE after a short delay, simulating dashboard/CLI.
    setTimeout(() => rmSync(join(dir, "PAUSE")), 60);
    const r = await promise;
    expect(r.outcome).toBe("resumed");
    expect(r.timedOut).toBe(false);
    expect(existsSync(join(dir, "PAUSED.md"))).toBe(false);
  });

  it("returns 'stop' when STOP appears mid-pause", async () => {
    touch(join(dir, "PAUSE"));
    const promise = handlePause({
      lokiDirOverride: dir,
      pollIntervalMs: 20,
      maxWaitMs: 2000,
    });
    setTimeout(() => writeFileSync(join(dir, "STOP"), ""), 60);
    const r = await promise;
    expect(r.outcome).toBe("stop");
    // STOP is consumed by handlePause.
    expect(existsSync(join(dir, "STOP"))).toBe(false);
    expect(existsSync(join(dir, "PAUSED.md"))).toBe(false);
  });

  it("writes PAUSED.md while waiting", async () => {
    touch(join(dir, "PAUSE"));
    const promise = handlePause({
      lokiDirOverride: dir,
      pollIntervalMs: 20,
      maxWaitMs: 500,
    });
    // Give the loop one tick to write PAUSED.md.
    await new Promise((r) => setTimeout(r, 40));
    expect(existsSync(join(dir, "PAUSED.md"))).toBe(true);
    const body = readFileSync(join(dir, "PAUSED.md"), "utf8");
    expect(body).toContain("Loki Mode - Paused");
    rmSync(join(dir, "PAUSE"));
    await promise;
  });

  it("respects maxWaitMs ceiling and reports timeout", async () => {
    touch(join(dir, "PAUSE"));
    const r = await handlePause({
      lokiDirOverride: dir,
      pollIntervalMs: 30,
      maxWaitMs: 100,
    });
    expect(r.timedOut).toBe(true);
    expect(r.outcome).toBe("resumed");
  });
});
