# neon-postgres-egress-optimizer — project plan

## Problem

Database providers charge for egress (network transfer). Customers get surprised by high bills, often caused by unoptimized queries — `SELECT *`, missing pagination, unused large columns, high-frequency repeated queries. The connection between application query patterns and egress costs isn't obvious, so users blame the provider.

## Solution

An agent skill that guides Claude Code (or any SKILL.md-compatible agent) through diagnosing and fixing excessive Postgres egress in a user's codebase.

---

## Skill design

### Architecture: self-contained

The SKILL.md bakes in all diagnostic queries, fix patterns, and workflow steps. Fully self-contained — no external doc fetches required at runtime.

**Why not hub-and-spoke like `neon-postgres`?** That skill covers a broad surface (auth, CLI, branching, etc.) and dispatches to many reference files. This skill has a single focused workflow. Self-contained is simpler, works offline, and has no breakage risk from doc URL changes.

### Structure

The skill and its evals live in separate top-level directories so that installing the skill (which copies the skill directory) doesn't pull in eval fixtures, diffs, and results.

```
skills/neon-postgres-egress-optimizer/
└── SKILL.md                          # Placeholder until a version is promoted

evals/neon-postgres-egress-optimizer/
├── PLAN.md                           # This file
├── README.md                         # Runbook: how to run evals, prompts, process
├── results.csv                       # Append-only eval results
├── eval-rubric.md                    # Problem definitions + scoring criteria
├── skill-versions/                   # Numbered skill iterations for eval
│   ├── SKILL-v001.md
│   ├── SKILL-v002.md
│   └── ...
├── diffs/
│   └── 01_20260312_A_baseline.diff
├── mock-stats/
│   └── pg_stat_statements.md         # Used by Prompt C only, never copied to fixture
└── fixtures/
    └── hono-drizzle-app/
        ├── src/
        ├── drizzle/
        └── tests/
```

### SKILL.md content outline

**Frontmatter:** Name, description (optimized for triggering — covers "high bill", "egress", "network transfer", "data transfer costs", "SELECT \*", "query optimization for cost", etc.)

**Workflow:**

1. **Diagnose** — Check if `pg_stat_statements` is available (it's enabled by default on Neon but may need `CREATE EXTENSION`). If stats are empty (common after scale-to-zero wakes the compute), instruct the user to run `SELECT pg_stat_statements_reset();`, wait for a representative traffic window, then return. When stats are available, run four diagnostic queries (total rows returned, rows per execution, most frequent queries, longest running). Interpret results: rank by egress impact, flag queries with high row counts or wide rows (JSONB, TEXT, BYTEA).

2. **Analyze codebase** — Cross-reference top offending queries with application code. Identify which columns are actually used downstream. Flag gaps between what's fetched and what's consumed.

3. **Fix** — Apply specific patterns per problem found:
   - `SELECT *` → explicit column lists (exclude unused columns, especially large ones)
   - Missing pagination → add LIMIT/OFFSET or cursor-based pagination
   - Repeated identical queries → caching layer or query deduplication
   - Application-side aggregation → server-side SQL aggregations (SUM, COUNT, GROUP BY)
   - ORM overfetching → Drizzle column selection / `.select()` with explicit fields
   - Join duplication → separate queries or subqueries that don't repeat wide columns
   - Each pattern includes before/after examples in Drizzle

4. **Verify** — Run existing tests (if any) to confirm nothing broke. Reset `pg_stat_statements`, wait for measurement window, re-run diagnostics, compare.

### Description / triggering

The description needs to be broad enough to catch indirect phrasings. Users won't say "optimize my egress" — they'll say "why is my Neon bill so high" or "my database costs jumped" or "I'm transferring too much data." The description should explicitly list these trigger phrases.

---

## Eval system

### Design principles

- **Binary scoring.** Per problem: detected (yes/no), fixed (yes/no). Scored against a rubric with yes/no questions.
- **Execution mode, not plan mode.** The agent applies actual code changes. We evaluate the diff.
- **Rubric written before first run.** Problem definitions and scoring criteria documented upfront so scoring is objective.
- **No contamination.** Fixture is copied to a temp directory for each run. The agent never sees the rubric or results.
- **Versioned skills.** Each skill iteration is saved as a numbered file in `skill-versions/` (SKILL-v001.md, SKILL-v002.md, ...). Eval runs record the version used. The main `SKILL.md` stays as a placeholder until a version is promoted by copying it to `skills/neon-postgres-egress-optimizer/SKILL.md`.

### Eval rubric

`eval-rubric.md` defines 5 problems and provides yes/no scoring questions for each. This single file is used by both human judges and LLM judges.

**Intentional problems:**

1. `SELECT *` on a table with a large JSONB column, app only uses 3 fields
2. Unpaginated list endpoint returning full table
3. High-frequency repeated query only visible via pg_stat_statements (code looks fine)
4. Application-side aggregation that should be a SQL GROUP BY
5. JOIN that duplicates wide product data across every review row

For each problem, two questions:

- **Detected?** Did the agent identify this specific problem?
- **Fixed?** Does the diff resolve it correctly?

Plus one overall question:

- **Tests pass?** Do the integration tests still pass after changes?

### Fixture: Hono + Drizzle + Bun

A minimal API app with 5 intentional egress anti-patterns embedded in route handlers. Uses Neon Testing for functional integration tests that verify the app works correctly (not egress-related assertions — business logic regression).

**Why Hono + Bun?** Minimal framework boilerplate — route handlers are almost pure query logic. Bun runs TypeScript natively with no build step, has a built-in test runner. The agent spends its time on query patterns, not framework conventions.

Each problem maps to a detection + fix check in the eval rubric (`eval-rubric.md`).

### Prompts

Three prompts of varying specificity, stored in `README.md`:

| ID  | Type     | Example                                                                                                                                          |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | Vague    | "My Neon bill spiked to $400 this month, most of it is data transfer. Help me figure out why."                                                   |
| B   | Moderate | "Optimize the database egress in this project."                                                                                                  |
| C   | Specific | "Here are my pg_stat_statements results: [paste contents of mock-stats/pg_stat_statements.md]. Analyze my codebase and fix the worst offenders." |

### Scoring

`results.csv` columns:

```
date,fixture,prompt,model,skill_version,diff_file,p1_detected,p1_fixed,p2_detected,p2_fixed,p3_detected,p3_fixed,p4_detected,p4_fixed,p5_detected,p5_fixed,tests_pass,notes
```

One row per eval run. Append-only. `skill_version` ties each run to a specific skill iteration (e.g., `v001`); empty for baseline runs.

### Eval workflow (documented in `README.md`)

```bash
# 1. Copy fixture to clean workspace (exclude any .git artifacts)
mkdir /tmp/eval-$(date +%Y%m%d)
cp -r fixtures/hono-drizzle-app/* /tmp/eval-$(date +%Y%m%d)/
cd /tmp/eval-$(date +%Y%m%d)
git init && git add . && git commit -m "baseline"

# 2. Run Claude Code with skill installed + one prompt
# (skill installed via .claude/skills/ or project config)
# Use prompt A or B from the table above
# If using Prompt C, paste the contents of mock-stats/pg_stat_statements.md
# into the prompt. Do NOT copy the file into the workspace.

# 3. Capture diff
git diff > /path/to/diff-output.md

# 4. Score against eval-rubric.md (human or LLM judge)
# Record results in results.csv
```

### Judge

**v1: Claude Code as judge, human-verified initially.**

Workflow:

1. Copy fixture to temp directory
2. Run Claude Code with skill installed + one prompt → produces a git diff
3. Feed diff + original fixture code + `eval-rubric.md` to a second Claude Code instance
4. Judge answers each yes/no question per problem and outputs a row for `results.csv`
5. Append row to `results.csv`

First few runs: human verifies the judge's scoring. Once trustworthy, human spot-checks only.

---

## Dimensions & exclusions

### Included in v1

| Dimension             | Choice                                              |
| --------------------- | --------------------------------------------------- |
| Fixture               | 1 × Hono + Drizzle + Bun app with integration tests |
| Prompts               | 3 × varying specificity                             |
| Scoring               | Binary yes/no per problem (detected/fixed)          |
| Judge                 | Claude Code with human verification                 |
| Model                 | Opus 4.6/Claude Code                                |
| ORM coverage in skill | Drizzle examples in fix patterns                    |

### Excluded (with reasoning)

| Exclusion                                             | Reasoning                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Additional ORMs (Prisma, SQLAlchemy, TypeORM)         | Skill shows Drizzle. Pattern is clear for adding more.                                                                                                                                                                                                                  |
| Vanilla SQL fixture app                               | A fixture using raw SQL (no ORM) would test the skill against a different query style. Can reuse the same eval-rubric structure. Interesting for future coverage.                                                                                                       |
| Additional fixtures (Next.js, Express, FastAPI, etc.) | One fixture tests the full loop. More can be added using the same eval-rubric structure.                                                                                                                                                                                |
| No-test-coverage fixture variant                      | v1 fixture includes tests, which gives the agent a verification mechanism. A future fixture without tests would evaluate the harder scenario.                                                                                                                           |
| Raw SQL / diagnostic-only fixture                     | Without application code, the agent can flag bad queries but can't determine which columns are actually needed or apply fixes.                                                                                                                                          |
| MCP server integration                                | Expands testing surface significantly. Skill works standalone. MCP support can be added later without changing the core workflow.                                                                                                                                       |
| Deterministic egress measurement                      | Would require running queries against a seeded live database before/after and comparing transfer bytes. High value but heavy infrastructure. Potential approach: Neon's Elephantshark or `pg_stat_statements` row counts against a real Neon instance via Neon Testing. |
| Fully automated CI pipeline                           | Eval workflow is scripted but human-initiated. Could be wired into GitHub Actions later.                                                                                                                                                                                |
| Cross-model comparison                                | Model version is recorded per run. Comparison across models is possible with the data but not part of v1 scope.                                                                                                                                                         |
| Non-English prompts / multi-turn conversations        | Prompts are English, single-turn.                                                                                                                                                                                                                                       |

---

## References

- [Tweet: "why is Neon so expensive" ($2000/month)](https://x.com/francisco_m001/status/2023471431024054356) — The customer pain point this skill addresses
- [Reduce network transfer costs](https://neon.com/docs/introduction/network-transfer) — Primary source material for the skill's diagnostic queries and fix patterns
- [pg_stat_statements](https://neon.com/docs/extensions/pg_stat_statements) — The core diagnostic extension the skill relies on
- [Cost optimization](https://neon.com/docs/introduction/cost-optimization) — Broader cost guide
- [Elephantshark](https://neon.com/blog/elephantshark-monitor-postgres-network-traffic) — Open-source Postgres traffic monitor, relevant to the "deterministic egress measurement" exclusion
- [Agent Skills specification](https://agentskills.io/specification) — SKILL.md format spec (naming, frontmatter, 500-line limit)
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) — Create, manage, and share skills to extend Claude’s capabilities in Claude Code. Includes custom commands and bundled skills.
