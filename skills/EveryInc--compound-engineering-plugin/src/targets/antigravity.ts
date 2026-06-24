import path from "path"
import { copySkillDir, ensureDir, sanitizePathName, writeJson, writeText } from "../utils/files"
import { transformContentForAntigravity } from "../converters/claude-to-antigravity"
import type { AntigravityBundle, AntigravityPluginManifest } from "../types/antigravity"

/**
 * Write an Antigravity (`agy`) plugin bundle.
 *
 * Unlike the former Gemini writer, this does NOT write into a live install
 * directory. `agy` ingests a plugin *directory* via `agy plugin install <dir>`
 * into its own internal registry, so this emits a self-contained bundle (the
 * `.agy/`-shaped layout) that the user then installs. See docs/specs/antigravity.md.
 */
export async function writeAntigravityBundle(outputRoot: string, bundle: AntigravityBundle): Promise<void> {
  const paths = resolveAntigravityPaths(outputRoot)
  await ensureDir(paths.bundleDir)

  const manifest: AntigravityPluginManifest = {
    name: bundle.pluginName ?? "plugin",
    version: bundle.version,
  }
  await writeJson(path.join(paths.bundleDir, "plugin.json"), manifest)

  for (const skill of bundle.generatedSkills) {
    const skillName = sanitizePathName(skill.name)
    await writeText(path.join(paths.skillsDir, skillName, "SKILL.md"), skill.content + "\n")
  }

  for (const skill of bundle.skillDirs) {
    const skillName = sanitizePathName(skill.name)
    await copySkillDir(skill.sourceDir, path.join(paths.skillsDir, skillName), transformContentForAntigravity)
  }

  for (const agent of bundle.agents ?? []) {
    const agentFile = `${sanitizePathName(agent.name)}.md`
    await writeText(path.join(paths.agentsDir, agentFile), agent.content + "\n")
  }

  for (const command of bundle.commands) {
    const dest = path.join(paths.commandsDir, ...command.name.split("/")) + ".toml"
    await writeText(dest, command.content + "\n")
  }

  if (bundle.mcpServers && Object.keys(bundle.mcpServers).length > 0) {
    await writeJson(path.join(paths.bundleDir, "mcp_config.json"), { mcpServers: bundle.mcpServers })
  }

  if (bundle.hooks && Object.keys(bundle.hooks).length > 0) {
    await writeJson(path.join(paths.bundleDir, "hooks.json"), { hooks: bundle.hooks })
  }
}

function resolveAntigravityPaths(outputRoot: string) {
  const bundleDir = path.basename(outputRoot) === ".agy" ? outputRoot : path.join(outputRoot, ".agy")
  return {
    bundleDir,
    skillsDir: path.join(bundleDir, "skills"),
    agentsDir: path.join(bundleDir, "agents"),
    commandsDir: path.join(bundleDir, "commands"),
  }
}
