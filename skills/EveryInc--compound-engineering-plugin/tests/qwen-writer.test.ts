import { describe, expect, test } from "bun:test"
import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { writeQwenBundle } from "../src/targets/qwen"
import type { QwenBundle } from "../src/types/qwen"

function makeBundle(mcpServers?: Record<string, { command: string }>): QwenBundle {
  return {
    config: {
      name: "test-plugin",
      version: "1.0.0",
      commands: "commands",
      skills: "skills",
      agents: "agents",
      mcpServers,
    },
    agents: [],
    commandFiles: [],
    skillDirs: [],
  }
}

describe("writeQwenBundle", () => {
  test("removes stale plugin MCP servers on re-install", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-converge-"))

    await writeQwenBundle(tempRoot, makeBundle({ old: { command: "old-server" } }))
    await writeQwenBundle(tempRoot, makeBundle({ fresh: { command: "new-server" } }))

    const result = JSON.parse(await fs.readFile(path.join(tempRoot, "qwen-extension.json"), "utf8"))
    expect(result.mcpServers.fresh).toBeDefined()
    expect(result.mcpServers.old).toBeUndefined()
  })

  test("preserves user-added MCP servers across re-installs", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-user-mcp-"))

    // User has their own MCP server alongside plugin-managed ones (tracking key present)
    await fs.writeFile(
      path.join(tempRoot, "qwen-extension.json"),
      JSON.stringify({
        name: "user-project",
        mcpServers: { "user-tool": { command: "my-tool" } },
        _compound_managed_mcp: [],
      }),
    )

    await writeQwenBundle(tempRoot, makeBundle({ plugin: { command: "plugin-server" } }))

    const result = JSON.parse(await fs.readFile(path.join(tempRoot, "qwen-extension.json"), "utf8"))
    expect(result.mcpServers["user-tool"]).toBeDefined()
    expect(result.mcpServers.plugin).toBeDefined()
  })

  test("preserves unknown top-level keys from existing config", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-preserve-"))

    await fs.writeFile(
      path.join(tempRoot, "qwen-extension.json"),
      JSON.stringify({ name: "user-project", customField: "should-survive" }),
    )

    await writeQwenBundle(tempRoot, makeBundle({ plugin: { command: "p" } }))

    const result = JSON.parse(await fs.readFile(path.join(tempRoot, "qwen-extension.json"), "utf8"))
    expect(result.customField).toBe("should-survive")
    // Tracking key should be written so future installs can prune stale plugin keys
    expect(result._compound_managed_keys).toBeInstanceOf(Array)
    expect(result._compound_managed_keys).not.toContain("customField")
  })

  test("prunes stale servers from legacy config without tracking key", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-legacy-"))

    // Simulate old writer output: has mcpServers but no _compound_managed_mcp
    await fs.writeFile(
      path.join(tempRoot, "qwen-extension.json"),
      JSON.stringify({
        name: "old-project",
        mcpServers: { old: { command: "old-server" }, renamed: { command: "renamed-server" } },
      }),
    )

    await writeQwenBundle(tempRoot, makeBundle({ fresh: { command: "new-server" } }))

    const result = JSON.parse(await fs.readFile(path.join(tempRoot, "qwen-extension.json"), "utf8"))
    expect(result.mcpServers.fresh).toBeDefined()
    expect(result.mcpServers.old).toBeUndefined()
    expect(result.mcpServers.renamed).toBeUndefined()
    expect(result._compound_managed_mcp).toEqual(["fresh"])
  })

  test("does not prune untracked user config when plugin has zero MCP servers", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-untracked-"))

    // Pre-existing user config with no tracking key (never had the plugin before)
    await fs.writeFile(
      path.join(tempRoot, "qwen-extension.json"),
      JSON.stringify({
        name: "user-project",
        mcpServers: { "user-tool": { command: "my-tool" } },
      }),
    )

    // Plugin installs with zero MCP servers
    await writeQwenBundle(tempRoot, makeBundle())

    const result = JSON.parse(await fs.readFile(path.join(tempRoot, "qwen-extension.json"), "utf8"))
    expect(result.mcpServers["user-tool"]).toBeDefined()
    expect(result._compound_managed_mcp).toEqual([])
  })

  test("cleans up all plugin MCP servers when bundle has none", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-zero-"))

    await writeQwenBundle(tempRoot, makeBundle({ old: { command: "old-server" } }))
    await writeQwenBundle(tempRoot, makeBundle())

    const result = JSON.parse(await fs.readFile(path.join(tempRoot, "qwen-extension.json"), "utf8"))
    expect(result.mcpServers).toBeUndefined()
    expect(result._compound_managed_mcp).toEqual([])
  })

  test("preserves user servers across zero-MCP-then-MCP round trip", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-roundtrip-"))

    // 1. Install with plugin MCP
    await writeQwenBundle(tempRoot, makeBundle({ plugin: { command: "plugin-server" } }))

    // 2. User adds their own server (with tracking key present)
    const configPath = path.join(tempRoot, "qwen-extension.json")
    const afterInstall = JSON.parse(await fs.readFile(configPath, "utf8"))
    afterInstall.mcpServers["user-tool"] = { command: "my-tool" }
    await fs.writeFile(configPath, JSON.stringify(afterInstall))

    // 3. Install with zero plugin MCP
    await writeQwenBundle(tempRoot, makeBundle())

    // 4. Install with plugin MCP again
    await writeQwenBundle(tempRoot, makeBundle({ new_plugin: { command: "new-plugin" } }))

    const result = JSON.parse(await fs.readFile(configPath, "utf8"))
    expect(result.mcpServers["user-tool"]).toBeDefined()
    expect(result.mcpServers.new_plugin).toBeDefined()
    expect(result.mcpServers.plugin).toBeUndefined()
  })

  test("prunes stale top-level plugin keys when incoming config drops them", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-stale-keys-"))

    // First install with settings
    const bundleWithSettings: QwenBundle = {
      config: {
        name: "test-plugin",
        version: "1.0.0",
        commands: "commands",
        skills: "skills",
        agents: "agents",
        settings: [{ name: "api-key", description: "API key", envVar: "API_KEY", sensitive: true }],
      },
      agents: [],
      commandFiles: [],
      skillDirs: [],
    }
    await writeQwenBundle(tempRoot, bundleWithSettings)

    // User adds their own top-level key
    const configPath = path.join(tempRoot, "qwen-extension.json")
    const afterInstall = JSON.parse(await fs.readFile(configPath, "utf8"))
    afterInstall.userCustom = "should-survive"
    await fs.writeFile(configPath, JSON.stringify(afterInstall))

    // Second install without settings
    await writeQwenBundle(tempRoot, makeBundle())

    const result = JSON.parse(await fs.readFile(configPath, "utf8"))
    expect(result.settings).toBeUndefined()
    expect(result.userCustom).toBe("should-survive")
    expect(result.name).toBe("test-plugin")
  })
})
