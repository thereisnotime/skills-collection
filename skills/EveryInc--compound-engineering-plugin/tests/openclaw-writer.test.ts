import { describe, expect, test } from "bun:test"
import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { writeOpenClawBundle } from "../src/targets/openclaw"
import { parseFrontmatter } from "../src/utils/frontmatter"
import type { OpenClawBundle } from "../src/types/openclaw"

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function pluginDescription(relativePath: string): Promise<string> {
  const raw = await fs.readFile(path.join(import.meta.dir, "..", relativePath), "utf8")
  const { data } = parseFrontmatter(raw, relativePath)
  if (typeof data.description !== "string") {
    throw new Error(`Missing description in ${relativePath}`)
  }
  return data.description
}

function legacyAgentSkillContent(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n`
}

describe("writeOpenClawBundle", () => {
  test("writes openclaw.plugin.json with a configSchema", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-writer-"))
    const bundle: OpenClawBundle = {
      manifest: {
        id: "compound-engineering",
        name: "Compound Engineering",
        kind: "tool",
        configSchema: {
          type: "object",
          properties: {},
        },
        skills: [],
      },
      packageJson: {
        name: "openclaw-compound-engineering",
        version: "1.0.0",
      },
      entryPoint: "export default async function register() {}",
      skills: [],
      skillDirCopies: [],
      commands: [],
    }

    await writeOpenClawBundle(tempRoot, bundle)

    const manifest = JSON.parse(
      await fs.readFile(path.join(tempRoot, "openclaw.plugin.json"), "utf8"),
    )

    expect(manifest.configSchema).toEqual({
      type: "object",
      properties: {},
    })
  })

  test("removes stale legacy OpenClaw agent skill directories before writing", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-writer-cleanup-"))
    const staleDir = path.join(tempRoot, "skills", "agent-adversarial-reviewer")
    await fs.mkdir(staleDir, { recursive: true })
    await fs.writeFile(
      path.join(staleDir, "SKILL.md"),
      legacyAgentSkillContent(
        "adversarial-reviewer",
        await pluginDescription("plugins/compound-engineering/agents/review/ce-adversarial-reviewer.agent.md"),
      ),
    )

    const bundle: OpenClawBundle = {
      manifest: {
        id: "compound-engineering",
        name: "Compound Engineering",
        kind: "tool",
        configSchema: {
          type: "object",
          properties: {},
        },
        skills: [],
      },
      packageJson: {
        name: "openclaw-compound-engineering",
        version: "1.0.0",
      },
      entryPoint: "export default async function register() {}",
      skills: [],
      skillDirCopies: [],
      commands: [],
    }

    await writeOpenClawBundle(tempRoot, bundle)

    expect(await exists(staleDir)).toBe(false)
  })
})
