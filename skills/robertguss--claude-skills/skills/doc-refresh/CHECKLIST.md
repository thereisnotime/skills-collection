# Documentation Refresh Checklist

A phase-by-phase playbook for refreshing a repo's documentation. Skip or
merge phases for small repos; keep them separate (one phase per session)
for large or unfamiliar codebases to protect context windows and keep each
change reviewable.

## Phase 0 — Capture the Plan

- [ ] Confirm scope and principles with the user (which doc types, which
      audiences, diagram tooling, whether a wiki mirror is needed).
- [ ] Create a roadmap file in the repo root (e.g. `DOCUMENTATION_ROADMAP.md`)
      with: project context, principles, proposed doc structure, and a
      phase list matching this checklist.
- [ ] Get explicit sign-off on the plan before deleting or rewriting
      anything.

**Deliverable:** roadmap file, confirmed plan.

## Phase 1 — Discovery & Audit

- [ ] Inventory every documentation file in the repo (`docs/`, root
      `*.md`, module-level `AGENTS.md`/`README.md`, wikis, etc.).
- [ ] Use git history to confirm what has already been removed —
      `git log --oneline`, `git show --stat <commit>` — so you don't redo
      work or reintroduce deleted content.
- [ ] Cross-check each existing doc against the live code:
      - Do referenced files/paths actually exist on disk?
      - Do referenced commands actually run (check `justfile`, `Makefile`,
        `package.json` scripts, CI config)?
      - Do referenced dependencies actually get imported/used, or are they
        dead weight (check lockfiles vs. actual imports)?
- [ ] Map the real codebase structure: entry points, core business logic,
      integrations/clients, data models, config, deployment, cron/scheduled
      jobs, and secrets handling. For large repos, split this by domain and
      run parallel subagents (e.g. one per major module directory) to map
      faster.
- [ ] Grep for known anti-pattern keywords across **both** Markdown and
      code: names of removed features/integrations, deleted script paths,
      deleted directories, old deployment targets, etc.
- [ ] Distinguish **dead product references** from **live data
      references**. A third-party name can appear in code/docs for a
      legitimate reason (e.g. reading an ID field originating from a
      removed integration) even after the integration itself was removed.
      Don't blindly strip every occurrence — verify what the code actually
      does before deciding a reference is stale.
- [ ] Produce an audit report: which docs are stale/wrong/duplicated, which
      files should be deleted, and a canonical outline for the new doc set.

**Deliverable:** audit findings appended to the roadmap file, final doc
outline, list of files to delete.

## Phase 2 — Foundation Docs

- [ ] Rewrite the top-level README as a concise landing page that links out
      to focused guides (not a dump of everything).
- [ ] Create a documentation hub/index page listing all guides.
- [ ] Create an architecture doc with a component diagram (Mermaid or the
      repo's existing diagram convention).
- [ ] Create a data-flow / end-to-end process doc for the system's core
      workflows.

**Deliverable:** core documentation skeleton in place.

## Phase 3 — Operational & Developer Guides + AI Knowledge Base

- [ ] Create a developer onboarding guide (local setup, common tasks,
      running tests).
- [ ] Create an operations runbook (daily checks, alerting, troubleshooting,
      rollback/reprocessing procedures) if the system runs in production.
- [ ] Create a deployment guide (infra, environment variables, secrets,
      scheduled jobs) if applicable.
- [ ] Rewrite the AI-agent knowledge base file(s) (e.g. `AGENTS.md`,
      `CLAUDE.md`) to reflect current code structure, conventions, and
      anti-patterns, and to link to the new docs instead of duplicating
      them.

**Deliverable:** human and AI maintainer guides in place.

## Phase 4 — Code-Level Documentation

- [ ] Audit inline comments and docstrings for public modules, classes,
      and functions, prioritizing files that are most-read (entry points,
      core business logic, integration clients).
- [ ] Remove or correct misleading/outdated comments (especially ones
      describing removed features).
- [ ] Ensure module-level `AGENTS.md`-style files (if the repo uses them)
      are consistent with the top-level rewrite from Phase 3.

**Deliverable:** accurate, useful code-level documentation.

## Phase 5 — Cleanup, Consistency Review, and Publish

- [ ] Delete every stale doc identified in Phase 1.
- [ ] Re-grep the whole repo (docs and code) for the anti-pattern keywords
      from Phase 1 to confirm nothing new slipped in during Phases 2-4.
- [ ] Check all internal links between the new docs (index -> guides,
      README -> docs) actually resolve.
- [ ] Run the repo's lint/format/test commands to confirm no regressions
      from doc-only changes (e.g. accidental code edits while fixing
      docstrings).
- [ ] Mirror to an external wiki/portal if the project uses one — repo docs
      remain the source of truth; the mirror is generated/copied from them.

**Deliverable:** clean repo doc set, verified consistency, optional wiki
mirror.

## Phase 6 — Extract Reusable Material

- [ ] Review the "Lessons Learned" notes accumulated in the roadmap file
      across all prior phases.
- [ ] Generalize repo-specific findings into reusable patterns (this file
      and `ANTI-PATTERNS.md` are the output of that generalization).
- [ ] Update or create this skill (or an equivalent playbook) so the next
      repo refresh starts from a stronger baseline.

**Deliverable:** updated reusable skill/checklist/anti-patterns.

## Session Handoff Template

When a phase completes and work will continue in a new session, write or
update `HANDOFF.md` with:

- Current branch and latest commit hash.
- What was done in this session (bullet list, phase-by-phase).
- What was verified (lint/test results, links checked, etc.).
- The next phase's goal, concrete steps, and any "keep in mind" constraints
  (e.g. don't reintroduce a removed feature's terminology).
- Useful commands and key files for the next session to reference.
- Open questions, if any.
