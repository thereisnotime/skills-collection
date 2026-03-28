# Evals runbook

How to run and score evaluations for the neon-postgres-egress-optimizer skill.

## Skill versions

Skill versions live in `skill-versions/` as numbered files: `SKILL-v001.md`, `SKILL-v002.md`, etc. Each eval run uses a specific version and records it in `results.csv`.

Workflow:

1. Copy the current version or create a new one in `skill-versions/`
2. Run evals against it
3. Record results with the version number
4. Iterate — create a new version for each change
5. When a version consistently beats baseline, promote it:

```bash
# From the repo root:
cp evals/neon-postgres-egress-optimizer/skill-versions/SKILL-vXXX.md skills/neon-postgres-egress-optimizer/SKILL.md
```

## Prompts

| ID  | Type     | Prompt                                                                                       |
| --- | -------- | -------------------------------------------------------------------------------------------- |
| A   | Vague    | My Neon bill spiked to $400 this month, most of it is data transfer. Help me figure out why. |
| B   | Moderate | Optimize the database egress in this project.                                                |

Prompt C (specific, with pg_stat_statements data) is planned but deferred until the mock stats workflow is finalized. See `eval-rubric.md` for problem P3 details — it is only detectable via stats, so prompts A and B are expected to score 0 on P3 detection.

## Baseline

Baseline established from 89 runs without the skill on Opus 4.6 high effort.

| Problem                          | Without skill               | Notes                                                                                                            |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| P1: SELECT \* unused columns     | 89/89 detected, 89/89 fixed | Always caught. The skill won't improve this.                                                                     |
| P2: Missing pagination           | 0/89 detected, 0/89 fixed   | Never caught. This is the primary target for the skill.                                                          |
| P3: High-frequency query         | 0/89 detected, 0/89 fixed   | Never caught. Expected — only detectable via pg_stat_statements data.                                            |
| P4: Application-side aggregation | 87/89 detected, 87/89 fixed | Almost always caught. Rare misses come from omitting the aggregation issue entirely.                             |
| P5: Join duplication             | 25/89 detected, 25/89 fixed | ~28% catch rate. When missed, the agent applies P1-style column narrowing instead of fixing the structural join. |

Tests passed on 89/89 baseline runs. Full results in `results.csv`.

## Results summary

| Problem                          | baseline (89 runs) | v003 (42 runs) |
| -------------------------------- | ------------------ | -------------- |
| P1: SELECT \* unused columns     | 100%               | 100%           |
| P2: Missing pagination           | 0%                 | 57%            |
| P3: High-frequency query         | 0%                 | 12%            |
| P4: Application-side aggregation | 98%                | 100%           |
| P5: Join duplication             | 28%                | 100%           |

P3 is expected to miss on prompts A/B — it requires pg_stat_statements data. Tests passed on all 139 runs. v001/v002 data (4 runs each) omitted due to small sample size; full history in `results.csv`.

## Running an eval

```bash
./eval-run.ts --prompt A --skill 003    # skill run with v003
./eval-run.ts --prompt B                # baseline run (no --skill)
```

The script handles the full lifecycle:

1. Copies the fixture to a temp workspace (`/tmp/eval-...`)
2. Installs the skill version (if `--skill` provided)
3. Initializes git and launches Claude Code
4. Captures a run-local diff artifact in the run log directory
5. Runs `bun test` (with retry + short delay on failure)
6. Captures a canonical diff to `diffs/` (race-safe for parallel runs)
7. Launches Claude Code to score against `eval-rubric.md`

Each run also writes phase logs and metadata to a log directory:

- `run-<id>.claude.log`
- `run-<id>.tests.log`
- `run-<id>.score.log`
- `run-<id>.diff`
- `run-<id>.summary.json`

You can set this explicitly with `--log-dir` and `--run-id` (used by `eval-batch.ts` automatically).

Verify Claude Code outputs "Skill(neon-postgres-egress-optimizer) — Successfully loaded skill" at the start of the run. If it doesn't, the skill didn't trigger and the run is effectively a baseline. Note this in the `results.csv` notes column.

To force the skill, abort and re-run with: `claude "/neon-postgres-egress-optimizer <prompt>"`

## Scoring

Open `eval-rubric.md` and answer each yes/no question per problem against the diff. Record one row in `results.csv`.

**Columns:**

- `date` — YYYY-MM-DD
- `fixture` — fixture name (e.g., `hono-drizzle-app`)
- `prompt` — which prompt was used (A, B)
- `model` — Claude model version used
- `skill_version` — version from `skill-versions/` (e.g., `v001`); empty for baseline runs
- `diff_file` — filename of the saved diff in diffs/ (e.g., `01_20260311_A_baseline.diff`)
- `p1_detected` through `p5_detected` — yes/no
- `p1_fixed` through `p5_fixed` — yes/no
- `tests_pass` — yes/no (run `bun test` after the agent's changes)
- `notes` — free text for anything notable

## Stats

Generate the baseline and results summary tables from `results.csv`:

```bash
./eval-stats.ts
```

Copy the output into the baseline and results summary sections above.

## Judge

For v1, score manually against the rubric. To use Claude Code as judge:

1. Copy fixture to temp directory
2. Run Claude Code with skill installed + one prompt → produces a git diff
3. Feed diff + original fixture code + `eval-rubric.md` to a second Claude Code instance
4. Judge outputs detected/fixed per problem + test pass status
5. Append row to `results.csv`

First few runs: verify the judge's scoring manually. Once trustworthy, human spot-checks only.
