export type AntigravitySkill = {
  name: string
  content: string // Full SKILL.md with YAML frontmatter
}

export type AntigravitySkillDir = {
  name: string
  sourceDir: string
}

export type AntigravityCommand = {
  name: string // e.g. "plan" or "workflows/plan"
  content: string // Full TOML content (agy converts commands to skills on install)
}

export type AntigravityAgent = {
  name: string
  content: string // Full agent Markdown file with YAML frontmatter
}

// Antigravity MCP servers use `serverUrl` for remote servers, not `url`.
// Verified against agy v1.0.10: a remote server with `url` is rejected with
// "must have either command or serverUrl".
export type AntigravityMcpServer = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  serverUrl?: string
  headers?: Record<string, string>
}

// Minimal manifest agy requires at the bundle root. { name, version } is
// sufficient to validate; other fields are optional.
export type AntigravityPluginManifest = {
  name: string
  version: string
}

export type AntigravityBundle = {
  pluginName?: string
  version: string
  generatedSkills: AntigravitySkill[] // Target-specific generated skills, if any
  skillDirs: AntigravitySkillDir[] // From skills (pass-through)
  agents?: AntigravityAgent[] // From Claude agents
  commands: AntigravityCommand[]
  mcpServers?: Record<string, AntigravityMcpServer>
  // Container-only passthrough of Claude hooks. The per-event schema is not yet
  // verified against agy, so callers must not assume per-event fidelity.
  hooks?: Record<string, unknown>
}
