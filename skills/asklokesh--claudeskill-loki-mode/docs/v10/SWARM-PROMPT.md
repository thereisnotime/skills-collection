# Founder prompt: the swarm (2026-09-26)

Verbatim, as given. `docs/v10/SWARM.md` records what was adopted, the
reconciliations required by CLAUDE.md and the build prompt (D12, D13), and
why. Read SWARM.md first; this file is the historical source text.

---

ultracode

Switch the v10 build from one loop to a coordinated swarm. Goal: 10-20x more releases per day than cycles 1-4 (about 3 releases in 18 hours), without weakening anything in docs/LOKI-10-BUILD-PROMPT.md sections 2, 5b and 5c. Every "never do" rule still applies. Save this prompt as docs/v10/SWARM.md and follow it until the v10 definition of done.

Why it is slow (docs/v10/PROGRESS.md): each cycle batches 3-6 slices into one release. It reviews the whole batch in serial council rounds (cycle 1 took 9 rounds, cycle 3 took 6). Then it verifies every channel before the next cycle starts. So each release waits on the slowest slice and on every round.

ROLES. All roles are agents you spawn through Workflow. You are the orchestrator, and the only one who writes FOUNDER-QUEUE.md.

1. Product Owner (1 agent; writes docs/v10/BACKLOG.md and docs/v10/BOARD.md, never code).
   - Ranks the backlog per build prompt section 3.
   - Cuts work into release-sized slices. Each slice has:
     - under about 300 changed lines;
     - one owner;
     - a declared file set that overlaps no other in-flight slice;
     - acceptance checks written before building (the Wall);
     - a risk tier.
   - Keeps twice the builder count of ready slices queued, so builders never wait.

2. Builders (6-10 in parallel; isolation: worktree; one slice each; single writer).
   - Implement with red-then-green tests.
   - Run diff-scoped tests plus tests/moat in the worktree.
   - Return the patch and its evidence.
   - Never touch main or VERSION, and never edit outside the declared file set. If that is needed, return BLOCKED and let the PO re-slice.

3. Reviewers (read-only, parallel, diff-scoped, tiered by risk). Each finding must come with a reproduction.
   - HIGH tier (verifier, Seal, gates, council, exit codes, auth, secrets, tests/moat): 3 reviewers with different lenses (correctness, security/bypass, fail-closed), plus 1 adversarial reviewer told to find a false pass. APPROVE needs 3 of 4.
   - MEDIUM tier (runtime, CLI behavior, dashboard logic): 2 reviewers.
   - LOW tier (docs, copy, tests only, UI without a data path, deleting unreachable code): 1 reviewer.
   - The builder fixes findings in the same worktree. After 3 rounds, the slice goes back to the PO to be cut smaller. It never blocks the line.

4. Release Captain (exactly 1; the only agent allowed to write main, bump VERSION, tag or publish). It runs a serial merge queue. For each approved slice:
   - Rebase onto origin/main.
   - Run bash scripts/local-ci.sh (fast tier) and tests/moat. The ratchet must not regress; if it does, refuse the merge.
   - Stage by name, commit with the asklokesh identity, push.
   - Cut a release through scripts/release.sh.
   - Wait for the previous release's required-ci (Tests, Bun Parity, Security Audit) to go green before bumping VERSION again, so releases never cancel each other's CI (the v9.7-v9.9 failure).
   - If several slices are waiting, ship them together as one version rather than wait.
   - On a code conflict, send the slice back to its builder with the new base. Never resolve code conflicts itself.

5. Channel Verifier (1, async, read-only).
   - After each release, check: npm latest and gitHead, the tag, the GitHub release, Docker amd64/arm64, the Homebrew sha256, and a smoke test from a fresh PATH.
   - Never block the next merge.
   - A failure becomes a HIGH-priority fix-forward slice. Never unpublish or delete a version.

ORCHESTRATION
- Run repeated Workflow waves. In each wave, the PO produces up to 10 slices, then run: pipeline(slices, build -> verify -> review/fix loop -> captain queue).
- Use pipeline, not barriers. A LOW slice ships while a HIGH slice is still in review.
- In the script, serialize the Captain with a promise chain, so exactly one merge or release runs at a time.
- Agents coordinate through BOARD.md (slice id, owner, file set, tier, status, blockers) and through structured return values. Only the PO and the Captain write BOARD.md.
- Start the next wave as soon as the PO has ready slices. Never wait on channel verification.

SPEED LEVERS, in order
1. One slice, one release.
2. Risk-tiered review; most slices are LOW or MEDIUM.
3. Parallel reviewers per slice instead of serial whole-batch rounds.
4. Asynchronous channel verification.
5. Diff-scoped tests while building; the full fast tier plus moat runs only at merge.
6. Flaky tests: rerun once, record it, open a slice. Never pass a flake silently (see BACKLOG 93).

GUARDRAILS (restated, because speed pressure erodes them)
- When goals conflict: moat > Seal accuracy > delivered accuracy > cost > speed.
- The moat ratchet never regresses on main.
- If two releases in a row fail required-ci, stop releasing, fix main, then resume.
- No force push. Never delete versions. Never disable tests.
- The swarm spends faster. Log spend per wave in METRICS.md. If a wave would push past founder-queue item 3, drop to 3 builders, keep shipping LOW slices, and add one founder-queue line asking for a higher budget.

METRICS (append to METRICS.md after every wave)
- releases in the last 24h
- median slice lead time (ready to npm)
- review rounds per slice, by tier
- moat proven count
- required-ci failures
- spend

Target: at least 30 releases per 24h at steady state, with the moat proven count never decreasing.

START NOW
1. Write docs/v10/SWARM.md and docs/v10/BOARD.md.
2. Have the PO slice the top of the backlog: BACKLOG 94-98, P9 Rule of Two, and M0 measurement (claude-opus-5-5 in the model catalog, the seeded-defect corpus, the adoption eval).
3. Launch wave 1.
4. After each wave, append a wave entry to PROGRESS.md.

---

**Note on step 2 of START NOW:** BACKLOG 94-98, P9, and the model-catalog half
of M0 were already done or in flight when this prompt arrived (P9 fully done
awaiting a validation PR; P4's catalog and three-setups cases done awaiting
review; BACKLOG 95 and 97 fixed on main; 96 and 98 partly fixed by the P7
sweep). Wave 1's real seed is the actual repo state at adoption time, recorded
in `docs/v10/BOARD.md`, not this stale list.
