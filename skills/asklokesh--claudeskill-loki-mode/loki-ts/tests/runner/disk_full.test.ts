// Edge-case tests for atomicWriteFileSync ENOSPC ("disk full") handling.
//
// Goal: when the underlying syscall throws ENOSPC, the target file MUST NOT
// be left in a half-written state, the .tmp.<pid> sidecar MUST be cleaned
// up, and no orphan .tmp.* files may remain in the directory.
//
// Source under test: loki-ts/src/runner/state.ts atomicWriteFileSync.
//
// W1-A6 (v7.4.6 integration): __setFsForTesting now exposes writeFileSync,
// renameSync, copyFileSync, unlinkSync overrides, so these scenarios run
// for real.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync as realWriteFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __setFsForTesting,
  atomicWriteFileSync,
} from "../../src/runner/state.ts";

let tmp: string;
let dir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loki-disk-full-"));
  dir = join(tmp, ".loki");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  __setFsForTesting({});
  rmSync(tmp, { recursive: true, force: true });
});

function makeEnospc(syscall: string): NodeJS.ErrnoException {
  const err = new Error(`ENOSPC: no space left on device, ${syscall}`) as NodeJS.ErrnoException;
  err.code = "ENOSPC";
  err.errno = -28;
  err.syscall = syscall;
  return err;
}

function makeExdev(): NodeJS.ErrnoException {
  const err = new Error("EXDEV: cross-device link not permitted") as NodeJS.ErrnoException;
  err.code = "EXDEV";
  err.errno = -18;
  err.syscall = "rename";
  return err;
}

function tmpSidecars(d: string, base: string): string[] {
  return readdirSync(d).filter((n) => n.startsWith(`${base}.tmp.`));
}

describe("atomicWriteFileSync: ENOSPC on initial tmp writeFileSync", () => {
  it("re-throws and leaves target unchanged + no orphan tmp files", () => {
    const target = join(dir, "x.json");
    realWriteFileSync(target, '{"prior":"content"}');
    const before = readFileSync(target, "utf8");

    __setFsForTesting({
      writeFileSync: () => {
        throw makeEnospc("write");
      },
    });

    expect(() => atomicWriteFileSync(target, '{"new":"data"}')).toThrow(/ENOSPC/);
    expect(readFileSync(target, "utf8")).toBe(before);
    expect(tmpSidecars(dir, "x.json")).toEqual([]);
  });

  it("re-throws when target did not pre-exist; target stays absent", () => {
    const target = join(dir, "fresh.json");
    expect(existsSync(target)).toBe(false);

    __setFsForTesting({
      writeFileSync: () => {
        throw makeEnospc("write");
      },
    });

    expect(() => atomicWriteFileSync(target, "irrelevant")).toThrow(/ENOSPC/);
    expect(existsSync(target)).toBe(false);
    expect(tmpSidecars(dir, "fresh.json")).toEqual([]);
  });
});

describe("atomicWriteFileSync: ENOSPC on EXDEV-fallback copyFileSync", () => {
  it("re-throws copy error, leaves target unchanged, cleans tmp sidecar", () => {
    const target = join(dir, "y.json");
    realWriteFileSync(target, '{"keep":"this"}');
    const before = readFileSync(target, "utf8");

    __setFsForTesting({
      renameSync: () => {
        throw makeExdev();
      },
      copyFileSync: () => {
        throw makeEnospc("copyfile");
      },
    });

    expect(() => atomicWriteFileSync(target, '{"replace":"me"}')).toThrow(/ENOSPC/);
    expect(readFileSync(target, "utf8")).toBe(before);
    expect(tmpSidecars(dir, "y.json")).toEqual([]);
  });
});
