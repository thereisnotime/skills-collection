// Rule of Two (moat P9) on the Bun route: GitHub tokens never reach an agent
// the runner spawns, unless the operator opts out with
// LOKI_ALLOW_AGENT_GITHUB_TOKEN=1, which also prints one stderr warning.
//
// The bash route is proven by tests/moat/p9-rule-of-two.sh
// (P9.injection-cannot-reach-token). This drives runAutonomous() through the
// REAL providers.ts claude invoker with a fake claude binary that dumps its
// environment, the same harness shape as e2e_fake_provider.test.ts.

import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runAutonomous } from "../../src/runner/autonomous.ts";
import {
  AGENT_TOKEN_WARNING_PREFIX,
  withholdGithubTokens,
} from "../../src/runner/github_token.ts";
import type { CouncilHook, RunnerContext, RunnerOpts, SignalSource } from "../../src/runner/types.ts";

setDefaultTimeout(30_000);

const GH = "ghp_BUNCANARYgh";
const GHA = "ghs_BUNCANARYgithub";

describe("withholdGithubTokens", () => {
  it("removes every GitHub token by default and warns nothing", () => {
    const env: NodeJS.ProcessEnv = {
      GH_TOKEN: GH, GITHUB_TOKEN: GHA, GH_ENTERPRISE_TOKEN: "e1", GITHUB_ENTERPRISE_TOKEN: "e2", KEEP: "x",
    };
    const warned: string[] = [];
    const removed = withholdGithubTokens(env, (l) => warned.push(l));
    expect(removed).toEqual(["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]);
    expect(env).toEqual({ KEEP: "x" });
    expect(warned).toEqual([]);
  });

  it("keeps the tokens under LOKI_ALLOW_AGENT_GITHUB_TOKEN=1 and warns exactly once", () => {
    const env: NodeJS.ProcessEnv = { GH_TOKEN: GH, GITHUB_TOKEN: GHA, LOKI_ALLOW_AGENT_GITHUB_TOKEN: "1" };
    const warned: string[] = [];
    expect(withholdGithubTokens(env, (l) => warned.push(l))).toEqual([]);
    expect(env["GH_TOKEN"]).toBe(GH);
    expect(env["GITHUB_TOKEN"]).toBe(GHA);
    expect(warned.length).toBe(1);
    expect(warned[0]!.startsWith(AGENT_TOKEN_WARNING_PREFIX)).toBe(true);
    expect(warned[0]).toContain("GH_TOKEN GITHUB_TOKEN");
  });

  it("honors only the exact value 1", () => {
    for (const v of ["true", "yes", "01", " 1", ""]) {
      const env: NodeJS.ProcessEnv = { GH_TOKEN: GH, LOKI_ALLOW_AGENT_GITHUB_TOKEN: v };
      const warned: string[] = [];
      expect(withholdGithubTokens(env, (l) => warned.push(l))).toEqual(["GH_TOKEN"]);
      expect(env["GH_TOKEN"]).toBeUndefined();
      expect(warned).toEqual([]);
    }
  });

  it("does not warn under the opt-out when there is no token to hold", () => {
    const warned: string[] = [];
    expect(withholdGithubTokens({ LOKI_ALLOW_AGENT_GITHUB_TOKEN: "1" }, (l) => warned.push(l))).toEqual([]);
    expect(warned).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Through the runner: the provider's own environment.
// ---------------------------------------------------------------------------

class OneIteration implements SignalSource {
  private checks: (0 | 1 | 2)[] = [0, 2];
  async checkHumanIntervention(): Promise<0 | 1 | 2> {
    return this.checks.shift() ?? 2;
  }
  async isBudgetExceeded(): Promise<boolean> {
    return false;
  }
}
class StopNow implements CouncilHook {
  async shouldStop(_ctx: RunnerContext): Promise<boolean> {
    return true;
  }
}

const SAVED = ["LOKI_DIR", "LOKI_CLAUDE_CLI", "GH_TOKEN", "GITHUB_TOKEN", "LOKI_ALLOW_AGENT_GITHUB_TOKEN"];
let saved: Record<string, string | undefined>;
let root: string;
let envDump: string;
let stderrLines: string[];
let realStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  saved = Object.fromEntries(SAVED.map((k) => [k, process.env[k]]));
  root = mkdtempSync(resolve(tmpdir(), "loki-gh-token-"));
  mkdirSync(resolve(root, ".loki", "queue"), { recursive: true });
  envDump = resolve(root, "provider-env.txt");
  const fake = resolve(root, "fake-claude.sh");
  writeFileSync(
    fake,
    `#!/bin/bash
env > '${envDump}'
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"s","model":"opus"}'
printf '%s\\n' '{"type":"result","subtype":"success","duration_ms":1,"is_error":false,"result":"ok"}'
exit 0
`,
  );
  chmodSync(fake, 0o755);
  process.env["LOKI_DIR"] = resolve(root, ".loki");
  process.env["LOKI_CLAUDE_CLI"] = fake;
  process.env["GH_TOKEN"] = GH;
  process.env["GITHUB_TOKEN"] = GHA;
  delete process.env["LOKI_ALLOW_AGENT_GITHUB_TOKEN"];
  stderrLines = [];
  realStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    stderrLines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return (realStderrWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = realStderrWrite;
  for (const k of SAVED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

function opts(): RunnerOpts {
  return {
    cwd: root,
    provider: "claude",
    autonomyMode: "checkpoint",
    maxRetries: 3,
    maxIterations: 5,
    baseWaitSeconds: 0,
    maxWaitSeconds: 0,
    sessionModel: "sonnet",
    loggerStream: { write: () => true } as unknown as NodeJS.WritableStream,
    signals: new OneIteration(),
    council: new StopNow(),
  };
}

const warnings = (): number =>
  stderrLines.join("").split("\n").filter((l) => l.startsWith(AGENT_TOKEN_WARNING_PREFIX)).length;

describe("runAutonomous withholds GitHub tokens from the provider", () => {
  it("default: the spawned provider sees neither token, and nothing warns", async () => {
    await runAutonomous(opts());
    const dump = readFileSync(envDump, "utf8");
    expect(dump).toContain("LOKI_DIR="); // the dump is live: inherited vars do show
    expect(dump).not.toContain(GH);
    expect(dump).not.toContain(GHA);
    expect(warnings()).toBe(0);
  });

  it("LOKI_ALLOW_AGENT_GITHUB_TOKEN=1: the provider holds both tokens, one warning line", async () => {
    process.env["LOKI_ALLOW_AGENT_GITHUB_TOKEN"] = "1";
    await runAutonomous(opts());
    const dump = readFileSync(envDump, "utf8");
    expect(dump).toContain(`GH_TOKEN=${GH}`);
    expect(dump).toContain(`GITHUB_TOKEN=${GHA}`);
    expect(warnings()).toBe(1);
  });
});
