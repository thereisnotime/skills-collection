# Tasks: Release Tagging for Skill Consumers

- [x] T001 Add `.github/workflows/tag-skills.yml`: push to `main` on
  `skills/**` plus `workflow_dispatch`, `contents: write`, serialized
  concurrency, pinned checkout with full history and tags, and the script call
  with env inputs (FR-002, FR-004, FR-005)
- [x] T002 Add `.github/scripts/tag-skills.sh`: version reader, push guard
  (unbumped change, reused version), and idempotent tag creation at the push
  or dispatch target (FR-001, FR-002, FR-003, FR-004, depends on T001)
- [x] T003 Add `.github/dependabot.yml` with a weekly grouped
  `github-actions` update (FR-005)
- [x] T004 Verify locally in a scratch clone with a bare origin: syntax,
  guard failure names the skill, two-skill bump creates two tags, rerun is a
  no-op, dispatch backfills every skill (AC-001, AC-003, AC-005–AC-010)
- [ ] T005 After merge, run `workflow_dispatch` once, `git fetch --tags`, and
  confirm the nine tags at the backfill commit (AC-009)
