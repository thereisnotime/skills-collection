// Hermetic tests for src/runner/build_prompt_helpers.ts.
// Strategy: each test mints a tmp directory used as the .loki/ override.
// No real .loki/ state is touched. All bash parity claims are byte/line-cap
// checks against the same caps used by autonomy/run.sh.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadQueueTasks,
  loadLedgerContext,
  loadHandoffContext,
  loadValidationContext,
  loadBmadArch,
  loadGateFailures,
  loadMagicSpecs,
} from "../../src/runner/build_prompt_helpers.ts";

let tmpBase = "";

beforeEach(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "loki-bph-test-"));
});

afterEach(() => {
  if (tmpBase) rmSync(tmpBase, { recursive: true, force: true });
});

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function setMtime(path: string, ms: number): void {
  const sec = ms / 1000;
  utimesSync(path, sec, sec);
}

// ---------------------------------------------------------------------------
// loadQueueTasks
// ---------------------------------------------------------------------------

describe("loadQueueTasks", () => {
  it("returns [] when no queue files exist", () => {
    expect(loadQueueTasks(tmpBase)).toEqual([]);
  });

  it("parses array-format pending.json and truncates to 3", () => {
    const tasks = [1, 2, 3, 4, 5].map((i) => ({ id: `t-${i}`, type: "x" }));
    writeFile(join(tmpBase, "queue", "pending.json"), JSON.stringify(tasks));
    const got = loadQueueTasks(tmpBase);
    expect(got.length).toBe(3);
    expect(got[0]?.id).toBe("t-1");
    expect(got[2]?.id).toBe("t-3");
  });

  it("parses {tasks:[...]} object-format", () => {
    writeFile(
      join(tmpBase, "queue", "pending.json"),
      JSON.stringify({ tasks: [{ id: "a" }, { id: "b" }] }),
    );
    const got = loadQueueTasks(tmpBase);
    expect(got.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("merges in-progress before pending and applies the 3-cap across both", () => {
    writeFile(
      join(tmpBase, "queue", "in-progress.json"),
      JSON.stringify([{ id: "ip-1" }, { id: "ip-2" }]),
    );
    writeFile(
      join(tmpBase, "queue", "pending.json"),
      JSON.stringify([{ id: "p-1" }, { id: "p-2" }, { id: "p-3" }]),
    );
    const got = loadQueueTasks(tmpBase);
    expect(got.map((t) => t.id)).toEqual(["ip-1", "ip-2", "p-1"]);
  });

  it("returns [] for malformed JSON without throwing", () => {
    writeFile(join(tmpBase, "queue", "pending.json"), "{not json");
    expect(loadQueueTasks(tmpBase)).toEqual([]);
  });

  it("ignores non-object task entries", () => {
    writeFile(join(tmpBase, "queue", "pending.json"), JSON.stringify(["str", 42, { id: "ok" }]));
    const got = loadQueueTasks(tmpBase);
    expect(got.length).toBe(1);
    expect(got[0]?.id).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// loadLedgerContext
// ---------------------------------------------------------------------------

describe("loadLedgerContext", () => {
  it("returns '' when ledgers dir missing", () => {
    expect(loadLedgerContext(tmpBase)).toBe("");
  });

  it("returns '' when no LEDGER-*.md file present", () => {
    mkdirSync(join(tmpBase, "memory", "ledgers"), { recursive: true });
    writeFile(join(tmpBase, "memory", "ledgers", "other.md"), "noise");
    expect(loadLedgerContext(tmpBase)).toBe("");
  });

  it("picks the newest LEDGER-*.md by mtime and returns up to 100 lines", () => {
    const dir = join(tmpBase, "memory", "ledgers");
    mkdirSync(dir, { recursive: true });
    const oldPath = join(dir, "LEDGER-old.md");
    const newPath = join(dir, "LEDGER-new.md");
    writeFile(oldPath, "old-content");
    const big = Array.from({ length: 250 }, (_, i) => `line-${i}`).join("\n");
    writeFile(newPath, big);
    setMtime(oldPath, Date.now() - 60_000);
    setMtime(newPath, Date.now());

    const out = loadLedgerContext(tmpBase);
    const lines = out.split("\n");
    expect(lines.length).toBe(100);
    expect(lines[0]).toBe("line-0");
    expect(lines[99]).toBe("line-99");
  });

  it("returns full file when fewer than 100 lines", () => {
    const dir = join(tmpBase, "memory", "ledgers");
    mkdirSync(dir, { recursive: true });
    writeFile(join(dir, "LEDGER-1.md"), "a\nb\nc");
    expect(loadLedgerContext(tmpBase)).toBe("a\nb\nc");
  });
});

// ---------------------------------------------------------------------------
// loadHandoffContext
// ---------------------------------------------------------------------------

describe("loadHandoffContext", () => {
  it("returns '' when handoffs dir missing", () => {
    expect(loadHandoffContext(tmpBase)).toBe("");
  });

  it("returns first 80 lines of newest .md within 24h", () => {
    const dir = join(tmpBase, "memory", "handoffs");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "fresh.md");
    const lines = Array.from({ length: 200 }, (_, i) => `h-${i}`).join("\n");
    writeFile(path, lines);
    const now = Date.now();
    setMtime(path, now - 60_000); // 1 min ago
    const out = loadHandoffContext(tmpBase, now);
    const split = out.split("\n");
    expect(split.length).toBe(80);
    expect(split[0]).toBe("h-0");
    expect(split[79]).toBe("h-79");
  });

  it("skips handoffs older than 24h", () => {
    const dir = join(tmpBase, "memory", "handoffs");
    mkdirSync(dir, { recursive: true });
    const stale = join(dir, "stale.md");
    writeFile(stale, "stale-content");
    const now = Date.now();
    // 2 days ago
    setMtime(stale, now - 2 * 24 * 60 * 60 * 1000);
    expect(loadHandoffContext(tmpBase, now)).toBe("");
  });

  it("prefers newer over older when both within 24h", () => {
    const dir = join(tmpBase, "memory", "handoffs");
    mkdirSync(dir, { recursive: true });
    const older = join(dir, "older.md");
    const newer = join(dir, "newer.md");
    writeFile(older, "older");
    writeFile(newer, "newer");
    const now = Date.now();
    setMtime(older, now - 60 * 60 * 1000); // 1h ago
    setMtime(newer, now - 60_000); // 1m ago
    expect(loadHandoffContext(tmpBase, now)).toBe("newer");
  });
});

// ---------------------------------------------------------------------------
// loadValidationContext
// ---------------------------------------------------------------------------

describe("loadValidationContext", () => {
  it("returns '' when bmad-validation.md absent", () => {
    expect(loadValidationContext(tmpBase)).toBe("");
  });

  it("returns full file content under 8 KB unchanged", () => {
    writeFile(join(tmpBase, "bmad-validation.md"), "tiny validation");
    expect(loadValidationContext(tmpBase)).toBe("tiny validation");
  });

  it("caps content at 8000 bytes", () => {
    const content = "x".repeat(20_000);
    writeFile(join(tmpBase, "bmad-validation.md"), content);
    const out = loadValidationContext(tmpBase);
    expect(Buffer.byteLength(out, "utf-8")).toBe(8000);
  });
});

// ---------------------------------------------------------------------------
// loadBmadArch
// ---------------------------------------------------------------------------

describe("loadBmadArch", () => {
  it("returns '' when bmad-architecture-summary.md absent", () => {
    expect(loadBmadArch(tmpBase)).toBe("");
  });

  it("returns full file under 16 KB unchanged", () => {
    writeFile(join(tmpBase, ".loki", "bmad-architecture-summary.md"), "arch summary");
    expect(loadBmadArch(tmpBase)).toBe("arch summary");
  });

  it("caps content at 16000 bytes", () => {
    const content = "y".repeat(40_000);
    writeFile(join(tmpBase, ".loki", "bmad-architecture-summary.md"), content);
    const out = loadBmadArch(tmpBase);
    expect(Buffer.byteLength(out, "utf-8")).toBe(16000);
  });
});

// ---------------------------------------------------------------------------
// loadGateFailures
// ---------------------------------------------------------------------------

describe("loadGateFailures", () => {
  it("returns [] when file absent", () => {
    expect(loadGateFailures(tmpBase)).toEqual([]);
  });

  it("returns trimmed non-empty lines as tokens", () => {
    writeFile(
      join(tmpBase, "quality", "gate-failures.txt"),
      "static-analysis\n\n  test-results  \n\nlint\n",
    );
    expect(loadGateFailures(tmpBase)).toEqual(["static-analysis", "test-results", "lint"]);
  });
});

// ---------------------------------------------------------------------------
// loadMagicSpecs
// ---------------------------------------------------------------------------

describe("loadMagicSpecs", () => {
  it("returns count=0 + tokens=[] when specs dir missing", () => {
    expect(loadMagicSpecs(tmpBase)).toEqual({ count: 0, tokens: [] });
  });

  it("counts .md files and returns basenames without extension", () => {
    const dir = join(tmpBase, ".loki", "magic", "specs");
    mkdirSync(dir, { recursive: true });
    writeFile(join(dir, "Button.md"), "spec");
    writeFile(join(dir, "Card.md"), "spec");
    writeFile(join(dir, "ignore.txt"), "noise");
    const got = loadMagicSpecs(tmpBase);
    expect(got.count).toBe(2);
    expect([...got.tokens].sort()).toEqual(["Button", "Card"]);
  });

  it("ignores subdirectories", () => {
    const dir = join(tmpBase, ".loki", "magic", "specs");
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFile(join(dir, "Top.md"), "spec");
    writeFile(join(dir, "nested", "Hidden.md"), "spec");
    const got = loadMagicSpecs(tmpBase);
    expect(got.tokens).toEqual(["Top"]);
  });
});
