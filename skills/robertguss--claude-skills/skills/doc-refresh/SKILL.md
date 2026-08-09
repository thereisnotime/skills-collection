---
name: doc-refresh
description: Refresh a repo's documentation for a live production system — audit stale docs, rebuild a focused doc set with diagrams, update AI-agent knowledge bases, and improve code-level docstrings
---

# Documentation Refresh Skill

Use this skill when asked to overhaul, refresh, modernize, or clean up a
repository's documentation — especially for a system that is already in
production and has accumulated stale README content, dead analysis docs,
outdated AI-agent knowledge bases (`AGENTS.md`, `CLAUDE.md`, etc.), or
misleading code comments.

This skill is repo-agnostic. It does not assume any particular language,
framework, or doc tool. It encodes a phased process, a reusable checklist,
and a set of anti-patterns learned from running this refresh on real
production repos.

## When to use this skill

- The user says something like "our docs are out of date," "refresh the
  README," "clean up AGENTS.md," "audit our documentation," or "set up a
  docs/ folder with architecture diagrams."
- A repo has legacy analysis files, dead feature references, or docs that
  no longer match the live code.
- The user wants a repeatable framework they can reuse across repos.

## How to use this skill

1. Read `CHECKLIST.md` in this skill directory for the phase-by-phase
   process (Phase 0 through Phase 6).
2. Read `ANTI-PATTERNS.md` for common mistakes to avoid while auditing and
   rewriting docs.
3. Adapt the checklist to the target repo:
   - Confirm with the user which phases apply (a small repo may not need
     every phase; a large one may want each phase in its own session to
     protect context windows).
   - Identify the repo's actual doc tooling (Markdown + Mermaid is the
     default assumption below, but adjust if the repo uses something else,
     e.g. Sphinx, Docusaurus, or a wiki-only workflow).
4. Always produce (or update) a running "roadmap" file in the repo root
   (e.g. `DOCUMENTATION_ROADMAP.md`) that captures the plan, audit
   findings, and a "Lessons Learned" scratchpad. This gives future sessions
   (human or agent) a clear handoff point and turns the current refresh
   into reusable material for the next one.
5. At natural session boundaries, write or update a `HANDOFF.md` summarizing
   what was done, what was verified, and exactly what the next session
   should do next. Treat this as mandatory when the work will span more
   than one session.
6. Before declaring any phase complete, run the repo's actual lint/test
   command (discover it from `AGENTS.md`, `README.md`, `justfile`,
   `package.json`, `Makefile`, or CI config) to make sure doc-only changes
   didn't break anything, and re-check for stale references introduced by
   the phase's own edits.

## Core principles (apply unless the user overrides them)

1. **Repo docs are the source of truth.** Any external wiki mirrors the
   repo, never the reverse.
2. **Diagrams as code.** Prefer Mermaid (or another text-based diagram
   format already used in the repo) so diagrams stay version-controlled
   and diffable.
3. **Separate, focused guides over one monolithic doc.** Split by audience
   and purpose: architecture, data flow, developer onboarding, operations,
   deployment, etc.
4. **Delete stale docs outright** rather than leaving them "for reference."
   Git history is the archive.
5. **Update code-level docs (docstrings/comments) alongside Markdown.**
   A refreshed README next to a misleading docstring is a half-finished job.
6. **Phase the work and hand off explicitly.** Long doc refreshes should be
   broken into independently reviewable phases, each with its own commit(s)
   and a handoff note for whoever (or whatever) picks up next.

See `CHECKLIST.md` for the concrete phase breakdown and `ANTI-PATTERNS.md`
for pitfalls to avoid.
