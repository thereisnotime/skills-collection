# v10 TODO lists (Chief of Staff and every team member)

Updated by the Chief of Staff every turn it changes. Each agent also reports
its own numbered TODO checklist (done / pending) at the top of every reply;
that checklist is copied here when the agent reports. Status comes from
docs/v10/BOARD.md; this file is the per-person view.

Target: 3-5 releases per hour (CEO 2026-09-27 17:05Z), 60 per day.

## Chief of Staff (orchestrator), 19:10Z

1. [done 19:05:43Z] Release v9.69.0 from green 7ef5ca28 (main and tag both b2444763 by ls-remote).
2. [done] v9.68.0 on npm (`npm view loki-mode version` = 9.68.0; Release run 36342384478 success).
3. [done] v9.69.0 on npm (`npm view loki-mode version` = 9.69.0).
4. [done 19:06-19:09Z] Train 9 content: S-132, S-134, S-137, S-142, S-143, S-151 (a39c4995), S-139, S-141 (06bf5406), S-140 (e952e1ae).
5. [done 19:28:09Z] Release 10 = v9.70.0 from green b61045fd (main and tag 6c459dfa by ls-remote).
6. [done 19:19Z] S-136 landed (b61045fd); S-137 fix-forward 6e48decb.
7. [running] Batch 5 (wf_38d4e17c-211): reworks S-138, S-146, S-147, S-152; builds S-50, S-153, S-135; Architect cut S-154..S-173.
8. [running] WORKTREE_COUNT 24 of 15 at 19:37Z: my batch 6 dispatch opened 20 isolated worktrees at once (`git worktree list | grep -c claude/worktrees` = 24, every one owned by a live builder). Prune each as its slice merges; from now on a batch opens at most 15 minus the current count.
10. [done 19:37:24Z] Release 11 = v9.71.0 from green c6ed3882 (main and tag 4972a112 by ls-remote).
11. [done] Rows released at tag push reverted to merged until publish-npm succeeds (D27).
9. [pending] Drift audit every 6 turns; guard review every 50 turns.

## Team members

| Agent | Slice | Role | TODO |
|---|---|---|---|
| Engineer (opus) | S-152 | pre-push: only the Release Manager pushes main | add allowed non-main case, fix commit message; then HIGH re-review |
| Engineer | S-146 | one id="budget-banner" in the dashboard build | fix review CONCERN, rebuild static; then re-review |
| Engineer | S-147 | loki metrics --json nulls for unmeasured values | fix review CONCERN; then re-review |
| Engineer | S-138 | lint: fixtures never write the real ~/.gitconfig | fix 2nd REJECT findings; then re-review |
| Engineer | S-50 | P7 sed workaround vs dynamic repo root | build, red/green, mutate; then review |
| Engineer (opus) | S-153 | Footer.tsx on the release reuse allowlist | stub test reuse/no-reuse; then HIGH review |
| Engineer | S-135 | parallel trust-core probe mutations, private copy per worker | before/after wall time, same CASE lines; then review |
| Architect (opus) | S-154..S-173 | cut 20 ready slices | read-only; returns 20 BOARD rows |
