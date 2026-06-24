import { describe, expect, test } from "bun:test"
import { convertClaudeToAntigravity, toToml, transformContentForAntigravity } from "../src/converters/claude-to-antigravity"
import { parseFrontmatter } from "../src/utils/frontmatter"
import type { ClaudePlugin } from "../src/types/claude"

const fixturePlugin: ClaudePlugin = {
  root: "/tmp/plugin",
  manifest: { name: "fixture", version: "1.2.3" },
  agents: [
    {
      name: "Security Reviewer",
      description: "Security-focused agent",
      capabilities: ["Threat modeling", "OWASP"],
      model: "claude-sonnet-4-20250514",
      body: "Focus on vulnerabilities.",
      sourcePath: "/tmp/plugin/agents/security-reviewer.md",
    },
  ],
  commands: [
    {
      name: "workflows:plan",
      description: "Planning command",
      argumentHint: "[FOCUS]",
      model: "inherit",
      allowedTools: ["Read"],
      body: "Plan the work.",
      sourcePath: "/tmp/plugin/commands/workflows/plan.md",
    },
  ],
  skills: [
    {
      name: "existing-skill",
      description: "Existing skill",
      sourceDir: "/tmp/plugin/skills/existing-skill",
      skillPath: "/tmp/plugin/skills/existing-skill/SKILL.md",
    },
  ],
  hooks: undefined,
  mcpServers: {
    local: { command: "echo", args: ["hello"], env: { FOO: "bar" } },
    remote: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
  },
}

const options = { agentMode: "subagent" as const, inferTemperature: false, permissions: "none" as const }

describe("convertClaudeToAntigravity", () => {
  test("converts agents to local subagent Markdown and carries the plugin version", () => {
    const bundle = convertClaudeToAntigravity(fixturePlugin, options)
    expect(bundle.version).toBe("1.2.3")
    expect(bundle.pluginName).toBe("fixture")

    const agent = bundle.agents?.find((a) => a.name === "security-reviewer")
    expect(agent).toBeDefined()
    const parsed = parseFrontmatter(agent!.content)
    expect(parsed.data.name).toBe("security-reviewer")
    expect(parsed.data.kind).toBe("local")
    expect(parsed.body).toContain("Focus on vulnerabilities.")
    expect(parsed.body).toContain("Threat modeling")
  })

  test("passes skills through as skill dirs", () => {
    const bundle = convertClaudeToAntigravity(fixturePlugin, options)
    expect(bundle.skillDirs).toEqual([{ name: "existing-skill", sourceDir: "/tmp/plugin/skills/existing-skill" }])
  })

  test("maps remote MCP servers to serverUrl (not url) and preserves stdio servers", () => {
    const bundle = convertClaudeToAntigravity(fixturePlugin, options)
    const servers = bundle.mcpServers!
    expect(servers.remote.serverUrl).toBe("https://example.com/mcp")
    expect((servers.remote as Record<string, unknown>).url).toBeUndefined()
    expect(servers.remote.headers).toEqual({ Authorization: "Bearer x" })
    expect(servers.local.command).toBe("echo")
    expect(servers.local.args).toEqual(["hello"])
    expect(servers.local.env).toEqual({ FOO: "bar" })
  })

  test("drops MCP servers with neither command nor url", () => {
    const bundle = convertClaudeToAntigravity(
      { ...fixturePlugin, mcpServers: { broken: {} } },
      options,
    )
    expect(bundle.mcpServers!.broken).toEqual({})
  })

  test("serializes commands to TOML with the args placeholder", () => {
    const bundle = convertClaudeToAntigravity(fixturePlugin, options)
    const command = bundle.commands.find((c) => c.name === "workflows/plan")
    expect(command).toBeDefined()
    expect(command!.content).toContain('description = "Planning command"')
    expect(command!.content).toContain("User request: {{args}}")
  })

  test("passes hooks through as a container only", () => {
    const withHooks: ClaudePlugin = {
      ...fixturePlugin,
      hooks: { hooks: { PreToolUse: [{ matcher: "*", hooks: [] }] } },
    }
    const bundle = convertClaudeToAntigravity(withHooks, options)
    expect(bundle.hooks).toBeDefined()
    expect(Object.keys(bundle.hooks!)).toContain("PreToolUse")
  })

  test("omits hooks when the plugin has none", () => {
    const bundle = convertClaudeToAntigravity(fixturePlugin, options)
    expect(bundle.hooks).toBeUndefined()
  })
})

describe("transformContentForAntigravity", () => {
  test("rewrites Task agent calls to subagent phrasing", () => {
    const out = transformContentForAntigravity("Task security-reviewer(check auth)")
    expect(out).toBe("Use the @security-reviewer subagent to: check auth")
  })

  test("does NOT introduce a .gemini or .agy path rewrite (KTD7 guard)", () => {
    const input = "Read the file at .claude/config and ~/.claude/state"
    const out = transformContentForAntigravity(input)
    expect(out).toContain(".claude/config")
    expect(out).toContain("~/.claude/state")
    expect(out).not.toContain(".gemini/")
    expect(out).not.toContain(".agy/")
  })
})

describe("toToml", () => {
  test("emits a description and a multi-line prompt block", () => {
    const toml = toToml("My command", "do the thing")
    expect(toml).toContain('description = "My command"')
    expect(toml).toContain('prompt = """')
    expect(toml).toContain("do the thing")
  })
})
