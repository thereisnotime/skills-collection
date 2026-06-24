---
title: "feat: Add Antigravity (agy) target and remove Gemini CLI target"
date: 2026-06-22
type: feat
status: draft
origin: docs/specs/antigravity.md
---

# feat: Add Antigravity (`agy`) target and remove Gemini CLI target

## Summary

Replace the `gemini` converter/install target with a new `antigravity` target that emits the
Antigravity CLI (`agy`) plugin format verified in `docs/specs/antigravity.md`. Ship this plugin's own
installable bundle as a committed `.agy/` folder so users can `git clone … && agy plugin install
./compound-engineering-plugin/.agy`. Remove all `gemini` target machinery, `gemini-extension.json`,
the Gemini spec, and gemini tests, registering the removed artifacts in both cleanup registries so
upgraders are swept. Keep `GEMINI.md` (still read by `agy` as workspace context).

This is **Wave 2** of the Gemini→Antigravity migration. Wave 1 (skill prose sweep: `Gemini CLI` →
`Antigravity CLI (agy)`, `ask_user` → `ask_question` across 37 files, plus README transition notes)
is already done and uncommitted on branch `tmchow/antigravity-cli-support`.

---

## Problem Frame

Google replaced the consumer Gemini CLI with Antigravity CLI (`agy`) — a distinct Go-based terminal
agent with its own install model, plugin format, and permission system, still backed by Gemini
models. This repo currently treats Gemini CLI as a first-class converter/install target. With the
consumer Gemini CLI retired, that target is dead weight and its install instructions are broken. We
need to target Antigravity instead and remove Gemini entirely.

The Antigravity format was verified empirically against `agy` v1.0.10 (not docs — `antigravity.google/docs`
renders client-side). All format facts below trace to `docs/specs/antigravity.md`.

---

## Requirements

- **R1** — A new `antigravity` converter target emits the verified `agy` plugin format: root
  `plugin.json` (`{name, version}`), `skills/<n>/SKILL.md`, `agents/<n>.md`, commands as skills,
  `mcp_config.json` (`{mcpServers}`), `hooks.json` (`{hooks}`). (origin: `docs/specs/antigravity.md`)
- **R2** — Remote MCP servers emit `serverUrl` (not `url`/`httpUrl`); stdio servers emit
  `{command, args}`. (origin spec: "remote MCP uses serverUrl")
- **R3** — This plugin ships a committed `.agy/` bundle installable via `agy plugin install ./.agy`,
  with `.agy/skills` symlinked to `../skills` so the canonical root `skills/` is reused, not duplicated.
- **R4** — The `gemini` target and all its machinery are removed; removed artifacts are registered in
  `STALE_*` (`src/utils/legacy-cleanup.ts`) and `EXTRA_LEGACY_ARTIFACTS_BY_PLUGIN`
  (`src/data/plugin-legacy-artifacts.ts`).
- **R5** — `GEMINI.md` is retained (still read by `agy`); `gemini-extension.json` and
  `docs/specs/gemini.md` are removed.
- **R6** — README install instructions use the working `agy plugin install ./compound-engineering-plugin/.agy`
  flow.
- **R7** — `bun test` and `bun run release:validate` pass.

---

## Key Technical Decisions

**KTD1 — Antigravity is a "bundle-emitting" target, not an "install-into-user-dir" target.**
The gemini writer writes skills/agents/commands into a live `.gemini/` directory. `agy` instead
ingests a plugin *directory* via `agy plugin install <dir>` into its own internal registry (surfaced
by `agy plugin list --json`, no readable `plugins/` tree). So the antigravity target's writer emits a
self-contained plugin *bundle* (the `.agy/`-shaped layout) to its output root; it does **not** write
into `~/.gemini/antigravity-cli/`. `install --to antigravity` emits the bundle and surfaces the
`agy plugin install <path>` command rather than mutating agy's registry directly.

**KTD2 — Committed `.agy/` folder with a `skills` symlink (chosen with user).**
This plugin's canonical distribution is a committed `.agy/` directory at repo root containing
`plugin.json` plus a `skills -> ../skills` symlink (verified working: `agy plugin install ./.agy`
follows the symlink and registers skills). Rationale: keeps the repo root clean (no root `plugin.json`
beside `.claude-plugin/`, Codex, and Cursor manifests) and reuses the canonical `skills/` rather than
duplicating it. The plugin ships no root `agents/`, `commands/`, or MCP servers, so `skills` is the
only symlink needed and `mcp_config.json`/`hooks.json` are emitted only if/when this plugin gains
those components. Alternatives rejected: committed root `plugin.json` (clutters root, install command
`agy plugin install .` marginally cleaner) and generated `dist/` (install path is a build artifact,
less discoverable). Symlink portability is acceptable — AGENTS.md declares native Windows a non-target.

**KTD3 — MCP field mapping `url` → `serverUrl`.** The gemini converter emitted `url` for HTTP MCP
servers; the antigravity converter must emit `serverUrl` into `mcp_config.json` (verified: validator
rejects `url`/`httpUrl` with "must have either command or serverUrl"). Stdio servers keep `{command,
args, env}`.

**KTD4 — Commands emitted as commands; `agy` converts them to skills on install.** `agy plugin
validate` reports `commands/*.{toml,md}` as "converted to skills". The converter may emit commands in
either form; emit `commands/<n>.toml` (mirroring the existing gemini TOML serialization, the
lowest-delta path) and document that `agy` converts them. This plugin ships no commands, so this path
is exercised only by the general converter and its tests.

**KTD5 — Hooks: emit the container only; defer per-event schema.** `agy` accepts `hooks.json` shaped
`{hooks: {...}}` (container verified), but the per-event matcher/command schema and supported event
names were not verified in the spike. The converter emits the `{hooks}` wrapper and maps Claude hook
entries structurally, but real per-event hook fidelity is deferred (see Scope Boundaries) until the
schema is verified against a live `agy` run. The gemini converter skipped hooks entirely, so this is
already a net improvement.

**KTD6 — Release component swap.** In `src/release/components.ts`, remove the `gemini-extension.json`
prefix and add `.agy/plugin.json` (the new committed, release-owned manifest). Keep the `GEMINI.md`
prefix (file is retained). Update `src/release/metadata.ts`'s gemini manifest type accordingly.

**KTD7 — Content path rewriting.** The gemini converter's `transformContentForGemini` rewrote
`.claude/` → `.gemini/` and `Task X()` → `Use the @X subagent`. For antigravity, the agy content
conventions for these rewrites were not verified in the spike. Default: carry the subagent-call
rewrite (harness-neutral phrasing) and leave `.claude/` path rewriting **out** unless verified,
rather than emit an unverified `.gemini`/`.agy` path rewrite. Flagged as an execution-time check.

---

## High-Level Technical Design

New-target touch-points (union of the `gemini` and `opencode` wiring), in dependency order:

```
types/antigravity.ts ─┐
                      ├─> converters/claude-to-antigravity.ts ─┐
                      │                                        ├─> targets/index.ts (register)
                      └─> targets/antigravity.ts (writer) ─────┘        │
                                                                        ├─> commands/convert.ts  (--to)
                                                                        ├─> commands/install.ts  (--to)
                                                                        ├─> commands/cleanup.ts  (case + fn)
                                                                        ├─> utils/detect-tools.ts (~/.gemini/antigravity-cli)
                                                                        ├─> utils/resolve-output.ts (.agy output root)
                                                                        ├─> data/plugin-legacy-artifacts.ts (getLegacyAntigravityArtifacts)
                                                                        └─> release/{components,metadata}.ts
```

Emitted `agy` bundle shape (general converter output; this plugin's committed bundle is the subset in **bold**):

```
<output-root>/
  plugin.json          # { "name", "version" }          (committed: .agy/plugin.json)
  skills/<name>/SKILL.md                                 (committed: .agy/skills -> ../skills symlink)
  agents/<name>.md
  commands/<name>.toml # agy converts these to skills
  mcp_config.json      # { "mcpServers": { "<n>": {command,args} | {serverUrl} } }
  hooks.json           # { "hooks": { ... } }  (container only; see KTD5)
```

---

## Output Structure (this plugin's committed bundle)

```
.agy/
  plugin.json          # { "name": "compound-engineering", "version": <release-owned> }
  skills -> ../skills  # symlink to canonical root skills/
```

---

## Implementation Units

### U1. Antigravity types

**Goal:** Define the bundle and sub-types mirroring `src/types/gemini.ts`, adjusted for the agy format.
**Requirements:** R1, R2
**Dependencies:** none
**Files:** `src/types/antigravity.ts`
**Approach:** Define `AntigravityBundle` (pluginName, generatedSkills, skillDirs, agents?, commands,
mcpServers?, hooks?), `AntigravitySkill`, `AntigravitySkillDir`, `AntigravityAgent`,
`AntigravityCommand`, and `AntigravityMcpServer` with `command? / args? / env? / serverUrl? / headers?`
(note `serverUrl`, not `url`). Add a `pluginManifest` shape `{ name: string; version: string }`.
**Patterns to follow:** `src/types/gemini.ts`.
**Test scenarios:** Test expectation: none — pure type definitions, exercised by U2/U3 tests.

### U2. claude-to-antigravity converter

**Goal:** Convert a `ClaudePlugin` into an `AntigravityBundle`.
**Requirements:** R1, R2
**Dependencies:** U1
**Files:** `src/converters/claude-to-antigravity.ts`, `tests/antigravity-converter.test.ts`
**Approach:** Mirror `convertClaudeToGemini`. Filter skills by an `antigravity` platform tag (and keep
back-compat acceptance of skills tagged for the prior gemini key if `ce_platforms` gating matters —
confirm at execution). Convert agents via a `convertAgent` analog (YAML frontmatter). Convert commands
to `commands/<n>.toml` via a `toToml` analog (KTD4). Map MCP servers with `url` → `serverUrl` (KTD3).
Emit `{hooks}` container (KTD5). Provide `transformContentForAntigravity` carrying the subagent-call
rewrite; omit unverified path rewrites (KTD7).
**Patterns to follow:** `src/converters/claude-to-gemini.ts` (`convertClaudeToGemini`,
`convertMcpServers`, `convertAgent`, `convertCommand`, `toToml`, `transformContentForGemini`).
**Test scenarios:**
- Happy path: skills pass through as skillDirs; agents map to `AntigravityAgent[]` with frontmatter.
- MCP remote server `{url}` input emits `{serverUrl}`; stdio `{command,args,env}` preserved. **Covers R2.**
- MCP server with neither command nor serverUrl is dropped/flagged (matches agy validation).
- Command with `argumentHint` serializes to TOML with the args placeholder.
- Content transform rewrites a `Task agent(x)` call to harness-neutral subagent phrasing; does NOT
  introduce a `.gemini`/`.agy` path rewrite (KTD7 guard).
- Hooks input produces a `{hooks}` container (no per-event fidelity asserted — KTD5).

### U3. Antigravity writer

**Goal:** Write an `AntigravityBundle` to an output root as the agy bundle layout.
**Requirements:** R1, R3
**Dependencies:** U1, U2
**Files:** `src/targets/antigravity.ts`, `tests/antigravity-writer.test.ts`
**Approach:** Export `writeAntigravityBundle(outputRoot, bundle)`. Write `plugin.json` (`{name,
version}`), `skills/<n>/SKILL.md` (copy dirs + generatedSkills, applying
`transformContentForAntigravity`), `agents/<n>.md`, `commands/<n>.toml`, and — only when present —
`mcp_config.json` (`{mcpServers}`) and `hooks.json` (`{hooks}`). Resolve the version from the same
source the gemini path used (release-owned). Do **not** write into `~/.gemini/antigravity-cli/` (KTD1).
**Patterns to follow:** `src/targets/gemini.ts` (`writeGeminiBundle`, `resolveGeminiPaths`).
**Test scenarios:**
- Happy path: given a bundle with one skillDir + one agent, the expected files appear at the right paths.
- `plugin.json` contains `{name, version}` and validates the minimal-manifest contract.
- `mcp_config.json` is written only when servers exist; absent otherwise (this plugin's case).
- `hooks.json` written only when hooks exist.
- Remote MCP server is serialized with `serverUrl`. **Covers R2.**

### U4. Register target + wire convert/install/detect/resolve-output

**Goal:** Make `antigravity` a selectable, detectable target.
**Requirements:** R1
**Dependencies:** U2, U3
**Files:** `src/targets/index.ts`, `src/commands/convert.ts`, `src/commands/install.ts`,
`src/utils/detect-tools.ts`, `src/utils/resolve-output.ts`, `tests/cli.test.ts`,
`tests/detect-tools.test.ts`, `tests/resolve-output.test.ts`
**Approach:** Add the `antigravity` entry to `targets` (`implemented: true`, `convertClaudeToAntigravity`,
`writeAntigravityBundle`). Add `antigravity` to the `--to` option descriptions in `convert.ts` and
`install.ts`. In `detect-tools.ts`, detect `~/.gemini/antigravity-cli/` (and workspace `.agy/`). In
`resolve-output.ts`, add an `antigravity` case resolving the output root to `<base>/.agy`.
**Patterns to follow:** the `gemini` and `opencode` registrations and cases.
**Test scenarios:**
- `--to antigravity` dispatches the converter+writer and produces the bundle. **Covers R1.**
- detect-tools finds an antigravity install at `~/.gemini/antigravity-cli/`.
- resolve-output returns `<base>/.agy` for `antigravity`.

### U5. Cleanup wiring for antigravity

**Goal:** `cleanup --target antigravity` removes legacy CE artifacts from an agy install.
**Requirements:** R1
**Dependencies:** U4
**Files:** `src/commands/cleanup.ts`, `src/data/plugin-legacy-artifacts.ts`,
`tests/legacy-cleanup.test.ts` (or the existing cleanup test file)
**Approach:** Add `antigravity` to `cleanupTargets`, a `case "antigravity"` dispatch, a
`cleanupAntigravity()` function, and a `getLegacyAntigravityArtifacts(bundle)` analog of
`getLegacyGeminiArtifacts`. Note agy's internal registry is not a readable tree, so cleanup targets the
emitted bundle dir (`.agy/`) / workspace artifacts rather than agy's private store; scope conservatively.
**Patterns to follow:** `cleanupGemini`, `getLegacyGeminiArtifacts`.
**Test scenarios:**
- `getLegacyAntigravityArtifacts` excludes artifacts present in the current bundle and includes known
  stale ones.
- cleanup is a no-op when nothing stale is present.

### U6. Commit this plugin's `.agy/` bundle

**Goal:** Ship the installable `.agy/` directory at repo root.
**Requirements:** R3, R6
**Dependencies:** U3
**Files:** `.agy/plugin.json`, `.agy/skills` (symlink → `../skills`)
**Approach:** Create `.agy/plugin.json` = `{ "name": "compound-engineering", "version": <release-owned> }`
and a committed symlink `.agy/skills -> ../skills`. Verify `agy plugin validate ./.agy` reports skills
processed. Generated by the U3 writer pointed at `.agy` (or authored directly given the trivial shape).
Ensure the symlink is committed as a git symlink (mode 120000), not a copied directory.
**Patterns to follow:** the committed `gemini-extension.json` / `GEMINI.md` distribution artifacts.
**Test scenarios:** Test expectation: none at unit level (config/scaffolding) — covered by a smoke
assertion that `.agy/plugin.json` parses and `.agy/skills` resolves to `skills/`. Manual verification:
`agy plugin install ./.agy` registers skills.

### U7. Finalize README install instructions

**Goal:** Replace the Wave 1 transition note with the working install command.
**Requirements:** R6
**Dependencies:** U6
**Files:** `README.md`
**Approach:** Update the "Antigravity CLI (`agy`)" install section and the local-checkout section to:
`git clone https://github.com/EveryInc/compound-engineering-plugin` then
`agy plugin install ./compound-engineering-plugin/.agy`. Note `agy` reads `GEMINI.md` context. Remove
the "packaging is rolling out" hedge.
**Patterns to follow:** existing README per-harness install sections.
**Test scenarios:** Test expectation: none — documentation.

### U8. Remove the gemini target

**Goal:** Delete all gemini target machinery and the now-dead distribution/spec files.
**Requirements:** R4, R5
**Dependencies:** U4 (antigravity must be wired before gemini is unwired so `--to`/registry stay valid)
**Files (delete):** `src/targets/gemini.ts`, `src/converters/claude-to-gemini.ts`,
`src/types/gemini.ts`, `gemini-extension.json`, `docs/specs/gemini.md`, `tests/gemini-writer.test.ts`,
`tests/gemini-converter.test.ts`.
**Files (edit — remove gemini references):** `src/targets/index.ts`, `src/commands/convert.ts`,
`src/commands/install.ts`, `src/commands/cleanup.ts` (drop `case "gemini"`, `cleanupGemini`,
`--gemini-home`, `resolveGeminiWorkspaceRoot`), `src/utils/detect-tools.ts`,
`src/utils/resolve-output.ts`, `src/data/plugin-legacy-artifacts.ts` (`getLegacyGeminiArtifacts`),
`src/release/components.ts` (drop `gemini-extension.json` prefix; keep `GEMINI.md`),
`src/release/metadata.ts` (gemini manifest type), and any gemini assertions in `tests/cli.test.ts`,
`tests/detect-tools.test.ts`, `tests/resolve-output.test.ts`, `tests/real-plugin-conversion.test.ts`,
`tests/release-metadata.test.ts`, `tests/release-preview.test.ts`.
**Approach:** Remove rather than rename. **Keep `GEMINI.md`.** Keep the global `STALE_*` /
`EXTRA_LEGACY_ARTIFACTS_BY_PLUGIN` *entries* that name historical skills (those are platform-neutral);
U9 covers adding the gemini-specific removed artifacts.
**Patterns to follow:** prior target-removal precedent in `docs/plans/` (native-install cleanup).
**Test scenarios:**
- `--to gemini` is no longer accepted (errors as an unknown target).
- No remaining import of `claude-to-gemini` / `gemini` writer anywhere (grep-clean).
- `release:validate` still passes with `GEMINI.md` tracked and `gemini-extension.json` gone.

### U9. Register removed gemini artifacts in cleanup registries

**Goal:** Ensure upgraders get stale gemini artifacts swept.
**Requirements:** R4
**Dependencies:** U8
**Files:** `src/utils/legacy-cleanup.ts` (`STALE_SKILL_DIRS` / `STALE_AGENT_NAMES` /
`STALE_PROMPT_FILES`), `src/data/plugin-legacy-artifacts.ts`
(`EXTRA_LEGACY_ARTIFACTS_BY_PLUGIN["compound-engineering"]`), the cleanup test file.
**Approach:** Add the removed gemini-target output artifacts (e.g. `gemini-extension.json` and any
gemini-only generated dirs) to the appropriate registry so flat-install upgrades sweep them, per the
AGENTS.md "removing a skill/agent/command" convention extended to a removed target's artifacts.
**Test scenarios:**
- A simulated stale `gemini-extension.json` / `.gemini` artifact is detected and swept by cleanup.
- Registry additions are sorted/duplicate-free where the existing structure requires it.

### U10. Full-suite green + end-to-end conversion test

**Goal:** Prove the whole change is consistent.
**Requirements:** R7
**Dependencies:** U2–U9
**Files:** `tests/real-plugin-conversion.test.ts`, `tests/cli.test.ts`
**Approach:** Add an end-to-end `--to antigravity` conversion assertion (real plugin → expected `.agy`
bundle shape). Run `bun test` and `bun run release:validate` to green. Confirm skill count unchanged
(27) in release metadata.
**Test scenarios:**
- End-to-end: converting the sample fixture to `antigravity` yields `plugin.json`, `skills/`, and (when
  present) `mcp_config.json` with `serverUrl`. **Covers R1, R2.**
- `bun run release:validate` reports in-sync metadata. **Covers R7.**

---

## Scope Boundaries

**In scope:** the antigravity target (converter, writer, wiring, cleanup), the committed `.agy/`
bundle, gemini target removal + registry sweeps, README install finalization, tests.

**Retained (NOT removed):** `GEMINI.md` (still read by `agy`); the Wave 1 skill-prose changes;
historical references to gemini in `docs/plans/`, `docs/solutions/`, and `docs/brainstorms/`
(point-in-time records — rewriting them would falsify history).

### Deferred to Follow-Up Work

- **Per-event hooks fidelity** — emit real hook matchers/commands once the `agy` `hooks.json` event
  schema is verified against a live run (KTD5).
- **Antigravity marketplace distribution** (`agy plugin install <plugin>@<marketplace>`,
  `agy plugin link`) — only if/when we want gallery distribution.
- **`agy plugin import claude` path** — documenting the import bridge as an alternative install route.
- **Content path-rewrite conventions** — confirm whether agy expects any `.claude/`-equivalent path
  rewrite and add it to `transformContentForAntigravity` (KTD7).

---

## Risks & Dependencies

- **Symlink fidelity in git/CI.** `.agy/skills` must commit as a symlink (mode 120000) and survive
  checkout + `agy plugin install` in CI. Mitigation: assert the symlink target in a test; AGENTS.md
  already scopes out native Windows.
- **Unverified hook/path conventions.** KTD5/KTD7 ride on unverified agy behavior; both are deferred or
  conservatively defaulted so they cannot ship wrong output.
- **Release-owned version.** `.agy/plugin.json` version is release-owned — do not hand-bump; wire it
  the same way `gemini-extension.json`'s version was sourced (KTD6). Get the components/metadata swap
  right or `release:validate` fails.
- **Removal ordering.** Wire antigravity (U4) before removing gemini (U8) so the registry/CLI never
  has zero valid non-default targets mid-change.
- **`ce_platforms` gating.** Confirm whether any skills gate on a `gemini` platform tag that the
  converter's `filterSkillsByPlatform` reads; if so, add an `antigravity` tag/alias so skills are not
  silently excluded from antigravity output.

---

## Sources & Research

- `docs/specs/antigravity.md` — empirically verified `agy` v1.0.10 format (install model, plugin.json,
  component layout, `serverUrl`, commands→skills, `ask_question`, `GEMINI.md` retention). Primary
  grounding for R1–R3, R5.
- Gemini target wiring map (this session's repo research) — the union of `gemini`/`opencode`
  touch-points reflected in U1–U10.
- AGENTS.md — "Adding a New Target Provider" checklist and the dual cleanup-registry convention (R4).
