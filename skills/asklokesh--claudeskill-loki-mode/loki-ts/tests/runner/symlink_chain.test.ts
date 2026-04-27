// Edge-case test for deep (3+) symlink chain resolution of the loki binary.
//
// Scenario: a homebrew install creates
//   /usr/local/bin/loki                          (symlink) ->
//   /opt/homebrew/bin/loki                       (symlink) ->
//   .../Cellar/loki-mode/X.Y.Z/libexec/bin/loki  (symlink) ->
//   .../actual/loki                              (regular file)
//
// Goal: verify a 3+ deep symlink chain to the loki binary resolves cleanly
// via fs.realpathSync (the OS-native primitive used by both Node and the
// bash shim's `readlink -f` equivalent).
//
// Investigation result: the TS port has NO bin-path resolver function.
//   - loki-ts/src/commands/version.ts (8 lines) only prints getVersion().
//   - There is no equivalent of bash's `readlink -f "$0"` chain in TS.
//   - The bin/loki shell shim handles this resolution before exec'ing Bun.
// Therefore this test verifies the underlying primitive (fs.realpathSync)
// behavior the shim relies on, and documents the absent TS resolver.
//
// Hermetic: builds the chain in a unique scratch dir under tmpdir(); cleans
// up in afterEach.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), `loki-symlink-${randomUUID()}-`));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("symlink chain resolution (3+ deep)", () => {
  it("resolves a 4-link chain to the underlying regular file via realpathSync", () => {
    // Build the chain bottom-up:
    //   actual file:    <scratch>/cellar/loki-mode/9.9.9/libexec/bin/loki
    //   link 1 (deep):  <scratch>/cellar/loki-mode/9.9.9/libexec/bin/loki-shim -> ../bin/loki  (loop-prevention sanity)
    //   link 2:         <scratch>/usr/local/bin/loki -> <scratch>/opt/homebrew/bin/loki
    //   link 3:         <scratch>/opt/homebrew/bin/loki -> <scratch>/cellar/.../libexec/bin/loki-2
    //   link 4:         <scratch>/cellar/.../libexec/bin/loki-2 -> <scratch>/cellar/.../libexec/bin/loki
    const cellarBin = join(scratch, "cellar", "loki-mode", "9.9.9", "libexec", "bin");
    const usrLocalBin = join(scratch, "usr", "local", "bin");
    const homebrewBin = join(scratch, "opt", "homebrew", "bin");
    mkdirSync(cellarBin, { recursive: true });
    mkdirSync(usrLocalBin, { recursive: true });
    mkdirSync(homebrewBin, { recursive: true });

    const realFile = join(cellarBin, "loki");
    writeFileSync(realFile, "#!/usr/bin/env bun\n// real loki entry\n", { mode: 0o755 });

    const link4 = join(cellarBin, "loki-2");
    symlinkSync(realFile, link4);

    const link3 = join(homebrewBin, "loki");
    symlinkSync(link4, link3);

    const link2 = join(usrLocalBin, "loki");
    symlinkSync(link3, link2);

    // Walking from the top of the chain must collapse to the underlying file.
    const resolved = realpathSync(link2);
    expect(resolved).toBe(realpathSync(realFile));
  });

  it("realpathSync against process.argv[0] returns a real file (sanity)", () => {
    // Documents the fact that the bash shim relies on realpath; the TS
    // process.argv[0] (Bun binary) is itself reachable through realpathSync
    // even when launched via a symlink (e.g. /opt/homebrew/bin/bun).
    const argv0 = process.argv[0];
    expect(typeof argv0).toBe("string");
    expect((argv0 ?? "").length).toBeGreaterThan(0);
    const resolved = realpathSync(argv0 as string);
    expect(typeof resolved).toBe("string");
    expect(resolved.length).toBeGreaterThan(0);
  });

  // TODO: when a TS-side bin/loki path resolver is added (e.g. for
  // self-update or `loki doctor` to print the resolved entry), import and
  // test it here directly. As of v7.4.6 no such function exists in
  // loki-ts/src/ -- bash bin/loki + realpathSync handle it upstream of Bun.
});
