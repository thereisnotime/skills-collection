# Tasks: Agent Attribution Detection (OpenCode v2 + Cross-Harness)

Ordered by dependency. `[P]` marks parallel-safe tasks.

- [x] T-001: Rewrite `skills/git-safety/scripts/prepare-commit-msg` — FR-001..004, FR-008: cross-harness detection matrix (any non-empty value), harness-derived default attribution, `OPENCODE_TERMINAL` warn-only path, dedupe + merge/squash gates, bash 3.2 compatibility.
- [x] T-002: Add `skills/git-safety/scripts/git-agent-commit` — FR-006: exports `AI_AGENT` (default `opencode`), preserves `OPENCODE_AGENT`/`OPENCODE_MODEL`, `exec git commit "$@"`; executable bit set.
- [x] T-003: Add `skills/git-safety/scripts/test-prepare-commit-msg.sh` — functional harness covering AC-1..AC-9 via a temp repo; self-cleaning; exit nonzero on failure.
- [x] T-004: Rewrite the Attribution section of `skills/git-safety/SKILL.md` — FR-005: honest "How It Works", per-harness detection summary, OpenCode v2 claim convention (wrapper + inline env), remove session-start export step, sed-extraction for appending to existing hooks (single source of truth), verification commands, version 1.1.0 → 1.2.0. Deep detail moved to `references/attribution-detection.md` (per AGENTS.md guidance).
- [x] T-005: Update `skills/ai-attribution/SKILL.md` — FR-007: Git Commits surface references the cross-harness matrix; version 1.0.0 → 1.1.0.
- [x] T-006: Verify — `bash -n` on all scripts (OK), shellcheck not installed (noted), `test-prepare-commit-msg.sh` 13/13 green, sed-extraction install path validated end-to-end, no bash 4+ syntax (AC-10), docs free of stale claims (AC-11).
- [x] T-007: Release — `git identity` check (Shaun Burdick <github@shaunburdick.com>), commit `bda9bf8`, pushed to origin, PR opened: https://github.com/shaunburdick/skills/pull/9 (body carries the `Generated-By` footer per ai-attribution).

Follow-up wave (user: "3 and 2 go in this PR"):

- [x] T-008: SKILL.md size refactor — move the pre-existing `## PR and Commit Preflights` and `## Permission-Denied Reporting and Escalation` sections (incl. Secret and Encrypted-File Boundary) verbatim into `references/preflight-checks.md` and `references/permission-denied-reporting.md`; replace with mandatory-read pointer sections + quick reference; SKILL.md 546 → 353 lines (under 500). Body-equality verified by diff against the extraction.
- [x] T-009: Plugin env-injection spike — investigated anomalyco/opencode at `v2.0.15` vs `dev`: v2.0.15 exposes `ctx.shell.hook("create.before", ...)` with mutable `ShellCreateBefore.env` reaching the spawned process (per-call, race-free); dev removed it (bash tool rewritten via `ChildProcess.make`, no hook trigger; upstream TODO: "Add plugin shell.env environment augmentation once V2 plugin hooks exist"). Findings documented in `references/attribution-detection.md` → verdict: not shippable today; claim convention remains the supported path.

Second follow-up wave (user-approved: "Both wins in PR #9") — amendment A2:

- [x] T-010: Cross-harness agent name + model attribution — FR-009/FR-010: `prepare-commit-msg` now resolves agent name from `AI_AGENT`/`AGENT` claim values (bool markers `1`/`true` and canonical `opencode` excluded; `OPENCODE_AGENT` scoped to the opencode harness) and model harness-scoped (`OPENCODE_MODEL` / `ANTHROPIC_MODEL`); trailer precedence `<agent> (model: <model>)` → `<agent>` → `<harness> (model: <model>)` → `<harness>`. Test harness extended 13 → 20 cases (AC-12..AC-17); docs updated (SKILL.md attribution section, `references/attribution-detection.md` new "Agent Name and Model Resolution" section, spec amendment A2).

Third follow-up wave (user-approved: "Implement hash check") — amendment A3:

- [x] T-011: Hook install-currency check — FR-011/AC-18/AC-19: new read-only `scripts/check-hook.sh` (block-hash comparison via `git hash-object`, existence/executable/block-syntax gates, exact remediation commands, exit 0 current / 1 outdated); SKILL.md Step 1 "Ensure Hook Exists and Is Current" + Verification run the checker (marker-only grep removed); test harness +4 smoke cases (AC-18a..d, 20 → 24 green); spec amendment A3.