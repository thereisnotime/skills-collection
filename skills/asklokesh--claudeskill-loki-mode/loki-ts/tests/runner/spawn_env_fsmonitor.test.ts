// BACKLOG 149 round 4: in Bun (measured on 1.3.13) a child spawned with NO
// `env` option (Bun.spawn, Bun.spawnSync, execFileSync, spawnSync) inherits
// the environment from process START, ignoring later process.env edits. So
// withholdGithubTokens() protected the provider, but every bare git call the
// runner itself makes inside the agent's working tree (council.ts
// trackIteration, prd_reuse.ts computeCodebaseSignature) ran with the REAL
// GH_TOKEN and SSH_AUTH_SOCK. An agent that sets core.fsmonitor in .git/config
// gets its script run by that git call, holding the operator's credentials.
//
// The bug only exists for values present at process START, so the production
// paths run in a child bun process whose start environment carries synthetic
// canaries. A control call with no `env` in the same child proves the harness
// can see the leak, so a green result is not vacuous.

import { afterEach, beforeEach, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

setDefaultTimeout(30_000);

const SRC = resolve(import.meta.dir, "../../src/runner");
const CANARY_TOKEN = "ghp_FSMONCANARYstartenv0000000000";
const CANARY_SOCK = "/tmp/loki-fsmon-canary-agent.sock";

let root: string;
beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), "loki-fsmon-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it("runner git calls do not hand start-env credentials to an agent-set core.fsmonitor", () => {
  const repo = resolve(root, "repo");
  const rec = resolve(root, "fsmon.rec");
  const control = resolve(root, "control.rec");
  const g = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, env: { ...process.env }, stdio: "ignore" });
  execFileSync("git", ["init", "-q", repo], { env: { ...process.env }, stdio: "ignore" });
  writeFileSync(resolve(repo, "a.txt"), "a\n");
  g("add", "a.txt");
  g("-c", "user.email=x@example.invalid", "-c", "user.name=x", "commit", "-q", "-m", "i");
  // Records what the fsmonitor hook sees; exit 1 = "no fsmonitor data", which
  // makes git fall back to a normal scan. A second hook writes the control
  // record, selected per call with `-c core.fsmonitor=` (an argument, so it
  // does not depend on the environment under test).
  const mkHook = (path: string, out: string) => {
    writeFileSync(
      path,
      `#!/bin/sh\nprintf '%s|%s\\n' "\${GH_TOKEN:-absent}" "\${SSH_AUTH_SOCK:-absent}" >> '${out}'\nexit 1\n`,
    );
    chmodSync(path, 0o755);
  };
  const hook = resolve(root, "fsmon.sh");
  const controlHook = resolve(root, "fsmon-control.sh");
  mkHook(hook, rec);
  mkHook(controlHook, control);
  g("config", "core.fsmonitor", hook);
  const prd = resolve(repo, "prd.md");
  writeFileSync(prd, "# prd\n");

  const driver = resolve(root, "driver.ts");
  writeFileSync(
    driver,
    `import { execFileSync } from "node:child_process";
import { withholdGithubTokens } from ${JSON.stringify(resolve(SRC, "github_token.ts"))};
import { defaultCouncil } from ${JSON.stringify(resolve(SRC, "council.ts"))};
import { resolvePrdForRun } from ${JSON.stringify(resolve(SRC, "prd_reuse.ts"))};
withholdGithubTokens(process.env, () => {});
await defaultCouncil.trackIteration!("");
resolvePrdForRun({ prdPath: ${JSON.stringify(prd)}, cwd: ${JSON.stringify(repo)} });
// Control: the same kind of call WITHOUT env. Must still see the canary, or
// this Bun no longer has the start-env behavior and the test proves nothing.
try { execFileSync("git", ["-c", "core.fsmonitor=" + ${JSON.stringify(controlHook)}, "status", "--porcelain"], { cwd: ${JSON.stringify(repo)}, stdio: "ignore" }); } catch {}
`,
  );

  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  env["GH_TOKEN"] = CANARY_TOKEN;
  env["SSH_AUTH_SOCK"] = CANARY_SOCK;
  env["TARGET_DIR"] = repo;
  env["LOKI_DIR"] = resolve(repo, ".loki");
  delete env["LOKI_ALLOW_AGENT_GITHUB_TOKEN"];
  const r = spawnSync("bun", [driver], { cwd: repo, env, encoding: "utf8" });
  expect(r.status).toBe(0);

  const lines = readFileSync(rec, "utf8").trim().split("\n").filter(Boolean);
  // Both production paths ran git status/diff, which invoke fsmonitor.
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const l of lines) {
    expect(l).not.toContain(CANARY_TOKEN);
    expect(l).not.toContain(CANARY_SOCK);
    expect(l).toMatch(/^ghp_LOKIWITHHELDsentinel\w+INVALID\|absent$/);
  }
  // Positive control: the bare call leaks, so the checks above can fail.
  const ctl = readFileSync(control, "utf8");
  expect(ctl).toContain(`${CANARY_TOKEN}|${CANARY_SOCK}`);
});
