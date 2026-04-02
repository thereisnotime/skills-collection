import fs from "fs/promises"
import path from "path"
import type { ClaudeHomeConfig } from "../parsers/claude-home"
import { mergeCodexConfig, renderCodexConfig } from "../targets/codex"
import { writeTextSecure } from "../utils/files"
import { syncCodexCommands } from "./commands"
import { syncSkills } from "./skills"

export async function syncToCodex(
  config: ClaudeHomeConfig,
  outputRoot: string,
): Promise<void> {
  await syncSkills(config.skills, path.join(outputRoot, "skills"))
  await syncCodexCommands(config, outputRoot)

  // Write MCP servers to config.toml, or clean up stale managed block if none remain
  const configPath = path.join(outputRoot, "config.toml")
  let existingContent = ""
  try {
    existingContent = await fs.readFile(configPath, "utf-8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
  }
  const mcpToml = renderCodexConfig(config.mcpServers)
  const merged = mergeCodexConfig(existingContent, mcpToml)
  if (merged !== null) {
    await writeTextSecure(configPath, merged)
  }
}
