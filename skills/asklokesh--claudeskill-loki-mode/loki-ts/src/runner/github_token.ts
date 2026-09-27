// Rule of Two (moat P9) on the Bun route: a GitHub token never reaches an
// agent session.
//
// Mirrors _loki_withhold_github_tokens in autonomy/run.sh. The runner reads
// spec text and spawns agents (claude CLI, the Agent SDK query(), codex,
// cline, aider, council voters) that all inherit process.env, so a token left
// there is one prompt injection away from a push. Unlike bash, the Bun runner
// has no post-session push or PR step of its own (issue refs and PR creation
// run on the bash route), so the token is dropped from the process outright.
//
// LOKI_ALLOW_AGENT_GITHUB_TOKEN=1 (exact value) keeps the old inheritance and
// prints one stderr line saying the agent holds the token.
//
// Hygiene against a naive injection, not an isolation boundary: code running
// as the same user can still read another process's environment. The boundary
// is a CI job that holds no write token while the agent runs.

export const GITHUB_TOKEN_VARS = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
] as const;

export const AGENT_TOKEN_WARNING_PREFIX =
  "WARNING: LOKI_ALLOW_AGENT_GITHUB_TOKEN=1: the agent session holds the GitHub token";

/**
 * Remove every GitHub token from `env` unless the operator opted out.
 * Returns the names removed. Under the opt-out nothing is removed and, when a
 * token is present, exactly one warning line goes to `warn`.
 */
export function withholdGithubTokens(
  env: NodeJS.ProcessEnv = process.env,
  warn: (line: string) => void = (line) => {
    process.stderr.write(line + "\n");
  },
): string[] {
  const present = GITHUB_TOKEN_VARS.filter((v) => (env[v] ?? "") !== "");
  if (present.length === 0) return [];
  if (env["LOKI_ALLOW_AGENT_GITHUB_TOKEN"] === "1") {
    warn(
      `${AGENT_TOKEN_WARNING_PREFIX} (${present.join(" ")}); an injected prompt can push with it (Rule of Two exposure).`,
    );
    return [];
  }
  for (const v of present) delete env[v];
  return present;
}
