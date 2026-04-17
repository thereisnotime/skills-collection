# Post-Ideation Workflow

Read this file after Phase 2 ideation agents return and the orchestrator has merged and deduped their outputs into a master candidate list. Do not load before Phase 2 completes.

## Phase 3: Adversarial Filtering

Review every candidate idea critically. The orchestrator performs this filtering directly -- do not dispatch sub-agents for critique.

Do not generate replacement ideas in this phase unless explicitly refining.

For each rejected idea, write a one-line reason.

Rejection criteria:
- too vague
- not actionable
- duplicates a stronger idea
- not grounded in the current codebase
- too expensive relative to likely value
- already covered by existing workflows or docs
- interesting but better handled as a brainstorm variant, not a product improvement

Score survivors using a consistent rubric weighing: groundedness in the current repo, expected value, novelty, pragmatism, leverage on future work, implementation burden, and overlap with stronger ideas.

Target output:
- keep 5-7 survivors by default
- if too many survive, run a second stricter pass
- if fewer than 5 survive, report that honestly rather than lowering the bar

## Phase 4: Present the Survivors

Present the surviving ideas to the user before writing the durable artifact. This is a review checkpoint, not the final archived result.

Present only the surviving ideas in structured form:

- title
- description
- rationale
- downsides
- confidence score
- estimated complexity

Then include a brief rejection summary so the user can see what was considered and cut.

Keep the presentation concise. The durable artifact holds the full record.

Allow brief follow-up questions and lightweight clarification before writing the artifact.

Do not write the ideation doc yet unless:
- the user indicates the candidate set is good enough to preserve
- the user asks to refine and continue in a way that should be recorded
- the workflow is about to hand off to `ce:brainstorm`, Proof sharing, or session end

## Phase 5: Write the Ideation Artifact

Write the ideation artifact after the candidate set has been reviewed enough to preserve.

Always write or update the artifact before:
- handing off to `ce:brainstorm`
- sharing to Proof
- ending the session

To write the artifact:

1. Ensure `docs/ideation/` exists
2. Choose the file path:
   - `docs/ideation/YYYY-MM-DD-<topic>-ideation.md`
   - `docs/ideation/YYYY-MM-DD-open-ideation.md` when no focus exists
3. Write or update the ideation document

Use this structure and omit clearly irrelevant fields only when necessary:

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
focus: <optional focus hint>
---

# Ideation: <Title>

## Codebase Context
[Grounding summary from Phase 1]

## Ranked Ideas

### 1. <Idea Title>
**Description:** [Concrete explanation]
**Rationale:** [Why this improves the project]
**Downsides:** [Tradeoffs or costs]
**Confidence:** [0-100%]
**Complexity:** [Low / Medium / High]
**Status:** [Unexplored / Explored]

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | <Idea> | <Reason rejected> |
```

If resuming:
- update the existing file in place
- preserve explored markers

## Phase 6: Refine or Hand Off

After presenting the results, ask what should happen next using the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). If no question tool is available, present the numbered options in chat and wait for the user's reply before proceeding.

**Question:** "Ideation saved. What's next?"

Offer these options:
1. **Brainstorm a selected idea** — hand off to `ce:brainstorm` with the selected idea as the seed
2. **Refine the ideation** — add, re-evaluate, or deepen ideas before handing off
3. **Open in Proof (web app) — review and comment to iterate with the agent** — open the doc in Every's Proof editor, iterate via comments, or copy a link to share with others
4. **End the session** — no further action; the ideation doc is saved

### 6.1 Brainstorm a Selected Idea

If the user selects an idea:
- write or update the ideation doc first
- mark that idea as `Explored`
- invoke `ce:brainstorm` with the selected idea as the seed

Do **not** skip brainstorming and go straight to planning from ideation output.

### 6.2 Refine the Ideation

Route refinement by intent:

- `add more ideas` or `explore new angles` -> return to Phase 2
- `re-evaluate` or `raise the bar` -> return to Phase 3
- `dig deeper on idea #N` -> expand only that idea's analysis

After each refinement:
- update the ideation document before any handoff, sharing, or session end

### 6.3 Open in Proof (web app)

If requested, hand off the ideation document to the proof skill in HITL review mode. This uploads the doc, runs an iterative review loop (user annotates in Proof, agent ingests feedback and applies tracked edits), and syncs the reviewed markdown back to `docs/ideation/`.

Load the `proof` skill in HITL-review mode with:

- **source file:** the ideation document path written in Phase 5 (e.g., `docs/ideation/YYYY-MM-DD-<topic>-ideation.md`)
- **doc title:** `Ideation: <topic>` or the H1 of the ideation doc
- **identity:** `ai:compound-engineering` / `Compound Engineering`
- **recommended next step:** `/ce:brainstorm` (shown in the proof skill's final terminal output)

If the initial upload fails (network error, Proof API down), retry once after a short wait. If it still fails, tell the user the upload didn't succeed and briefly explain why, then return to the next-step options — don't leave them wondering why the option did nothing.

When the proof skill returns control:

- `status: proceeded` with `localSynced: true` → the ideation doc on disk now reflects the review. Return to the next-step options.
- `status: proceeded` with `localSynced: false` → the reviewed version lives in Proof at `docUrl` but the local copy is stale. Offer to pull the Proof doc to `localPath` using the proof skill's Pull workflow. Return to the next-step options; if the pull was declined, include a one-line note above the menu that `<localPath>` is stale vs. Proof so the next handoff doesn't read the old content silently.
- `status: done_for_now` → the doc on disk may be stale if the user edited in Proof before leaving. Offer to pull the Proof doc to `localPath` so the local ideation artifact stays in sync, then return to the next-step options. `done_for_now` means the user stopped the HITL loop — it does not mean they ended the whole ideation session; they may still want to brainstorm or refine. If the pull was declined, include the stale-local note above the menu.
- `status: aborted` → fall back to the next-step options without changes.

### 6.4 End the Session

When ending:
- offer to commit only the ideation doc
- do not create a branch
- do not push
- if the user declines, leave the file uncommitted

## Quality Bar

Before finishing, check:

- the idea set is grounded in the actual repo
- the candidate list was generated before filtering
- the original many-ideas -> critique -> survivors mechanism was preserved
- if sub-agents were used, they improved diversity without replacing the core workflow
- every rejected idea has a reason
- survivors are materially better than a naive "give me ideas" list
- the artifact was written before any handoff, sharing, or session end
- acting on an idea routes to `ce:brainstorm`, not directly to implementation
