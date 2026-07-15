import { readFile, access } from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"

const PLUGIN_ROOT = path.join(process.cwd(), "skills")

// The settled-decisions reference is byte-duplicated into every consuming
// skill (the plugin has no cross-skill import mechanism — see AGENTS.md "File
// References in Skills"). All copies must stay identical. Adding a consumer
// is one line here plus the duplicated file in that skill.
const SHARED_ASSETS = ["references/settled-decisions.md"]

const CONSUMER_SKILLS = ["ce-plan", "ce-brainstorm"]

describe("settled-decisions shared-asset parity", () => {
  for (const asset of SHARED_ASSETS) {
    test(`${asset} exists in every consumer and is byte-identical`, async () => {
      const contents = await Promise.all(
        CONSUMER_SKILLS.map(async (skill) => {
          const p = path.join(PLUGIN_ROOT, skill, asset)
          await access(p) // fails the test if a consumer is missing the copy
          return readFile(p, "utf8")
        }),
      )
      for (let i = 1; i < contents.length; i++) {
        expect(contents[i]).toBe(contents[0])
      }
    })
  }

  test("the shared reference pins the closed two-class enum", async () => {
    const canonical = await readFile(
      path.join(PLUGIN_ROOT, CONSUMER_SKILLS[0], SHARED_ASSETS[0]),
      "utf8",
    )
    expect(canonical).toContain("`user-directed`")
    expect(canonical).toContain("`user-approved`")
    // Byte-parity alone would let every copy drift to a third class together.
    expect(canonical).not.toContain("evidence-settled")
    expect(canonical).not.toContain("agent-settled")
  })
})
