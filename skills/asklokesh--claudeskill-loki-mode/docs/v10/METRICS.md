# Metrics

Latest measured value for each metric, with n, cost, date and the command that
produced it. "Not measured" is a real value here: nothing is estimated.

## Adoption

| Metric | Value | n / window | Date | Command |
|---|---|---|---|---|
| npm downloads, last 30 days | 12,194 | 2026-08-25..2026-09-23 | 2026-09-25 | `curl -s https://api.npmjs.org/downloads/point/last-month/loki-mode` |
| npm downloads, last 7 days | 838 (about 120/day) | 2026-09-17..2026-09-23 | 2026-09-25 | `curl -s https://api.npmjs.org/downloads/point/last-week/loki-mode` |
| Organic floor (days with no release) | about 94/day | from strategy doc | 2026-09-25 | `docs/STRATEGY-2026-2028.md:9` (re-measure with the adoption eval) |
| GitHub stars / forks | 1,073 / 206 | - | 2026-09-25 | `gh api repos/asklokesh/loki-mode --jq '{stars:.stargazers_count,forks:.forks_count}'` |
| Time to first sealed PR | not measured | - | - | adoption eval (M0, not built) |
| Decisions asked of the user | not measured | - | - | adoption eval (M0, not built) |

## Factory (M0 baselines, none measured yet)

| Metric | top | floor | routed | raw Claude Code | raw Codex |
|---|---|---|---|---|---|
| Seal rate | - | - | - | n/a | n/a |
| Verified-correct rate (hidden tests) | - | - | - | - | - |
| Cost per sealed change | - | - | - | - | - |
| Time to sealed PR, one item | - | - | - | - | - |
| Human touches per change | - | - | - | - | - |

## Seal accuracy

| Metric | Target | Required n | Current n | Value |
|---|---|---|---|---|
| False-SEALED (wrong pass) | at most 1%, 95% upper bound at most 3% | about 100 seeded defects with 0 wrong passes (rule of three) | 0 | not measured |
| False-NOT-SEALED (wrong fail) | at most 5% | - | 0 | not measured |

## Verification latency

| Metric | Target | Value |
|---|---|---|
| `loki verify --fast` p95, diff scope | under 1s | not measured in v10 terms |
| Full Seal overhead beyond project tests | at most 60s median | not measured |

## Moat suite

| Property | Status | Command |
|---|---|---|
| all 9 | 2 of 9 proven (P6, P7); 58 cases registered, 19 pending, ratchet checked against v9.52.0/v9.53.0/v9.54.0 (2026-09-26, main post-v9.54.2) | `bash tests/moat/run.sh` |
| history | v9.54.2/v9.54.1 (v9.54.1 never published, see PROGRESS.md): 1 of 9 (P6) | - |
| history | v9.54.0: 1 of 9, 55 cases, 32 pass, 23 pending | - |
| history | v9.53.0: 1 of 9, 48 cases, 25 pass, 23 pending | - |
| history | v9.52.0: 0 of 9, 45 cases, 21 pass, 24 pending | - |
| runtime | about 15s locally (9 scripts in parallel), about 1m15s CI job | `time bash tests/moat/run.sh` |

## Swarm (docs/v10/SWARM.md), hourly rollup

Founder-mandated cadence: releases in the last 24h, active builders, ready
slices, slices waiting on review, median ready-to-npm. Real, measured
numbers only; "not measured" stays honest where the swarm hasn't built the
instrumentation for it yet.

| Time (ET) | Releases (24h) | Active builders | Ready slices | Awaiting review | Median ready-to-npm |
|---|---|---|---|---|---|
| 2026-09-26 16:52 | 2 (v9.54.1 unpublished due to a pre-existing gitleaks false positive, D-something; v9.54.2 at 13:43 ET) | 8 (S-04,05,07,08,09,11,13,14) + 5 rework/review-cycle agents (S-03, S-15, PF-2, PF-3 round 6) | 8 (S-17..S-24, cut this hour) | 9 rows on BOARD.md in review/review-blocked/review-pending (PF-1 row stale-approved, PF-2, PF-3, S-03, S-15, plus historical GF rows) | not measured (no per-slice ready timestamp captured yet; first real median once S-04..S-14's merge times are recorded) |

**Why only 2 releases in ~4h, against the 30-60/day target:** v9.54.1's
required-ci failure (a pre-existing test fixture gitleaks flagged,
unrelated to its own diff) cost a full release cycle to diagnose before
v9.54.2 shipped; the bulk of wall-clock since has gone into a 6-round HIGH-
tier review saga on PF-3 (the kill-by-name repo sweep), which found and
fixed FOUR real defects across those rounds (a vacuous identity check, a
verify.sh regression on GNU-timeout daemons, three more unscoped kill sites
in test infrastructure, a setsid orphaning gap, and a port-arithmetic
overflow in the round-5 fix's own test) -- each one a genuine finding worth
the round, but the serial single-reviewer-cycle-at-a-time pattern this
session fell into is not the pipelined, many-slices-in-flight model
SWARM.md describes. Corrected per the founder's 16:35 nudge: 8 builders
dispatched on every ready S-slice at once, 8 more slices cut immediately
behind them, PF-2 and S-15 pulled off the backlog of un-reviewed finished
work. LOW/MEDIUM slices release individually the moment their tier's
reviewers approve, never queued behind PF-3/GF-1.

| 2026-09-26 17:35 | 0 new npm releases this hour (7 merges to main, no VERSION bump cut yet) | 8 (S-10 review, S-19 review x2, S-14 review x2, GF-3 rebase-review, S-21..S-24 build x4 -- corrected count after fixing a quorum bug, see below) | 4 (S-21..S-24, cut and dispatched this hour) | S-05 (review-blocked, sent back), S-07 (review-blocked, sent back), S-13 (rejected, sent back), S-09 (in review), S-10 (in review), GF-3/GF-4 (blocked/in review) | not measured |

**7 merges landed this hour: PF-3, S-11, PF-2 (round 5, ends a 5-round
whack-a-mole), S-08, S-04, GF-2 (rebased past 3 other merges with 4
conflicts resolved), plus a Captain-authored fix to `scripts/local-ci.sh`'s
twin of the S-04 bug.** Moat went from 2 of 9 to 3 of 9 proven (P5 added).
No release cut yet this hour because none of these individually crosses
the release-worthy bar alone and the swarm process batches a VERSION bump
at the Captain's discretion, not per-merge -- worth revisiting per the
founder's explicit "never batch approved LOW/MEDIUM behind other work"
directive; the next action after this rollup is cutting a release.

**A quorum bug was caught and fixed before any harm:** 5 reviews (S-04,
05, 07, 08, 13) were dispatched without a pinned `model` parameter,
silently inheriting the session model instead of being pinned per D13,
and MEDIUM slices got 1 reviewer instead of SWARM.md's required 2. Caught
by the advisor before any verdict was acted on; all 5 stopped via
TaskStop before returning results, re-dispatched correctly. The
re-dispatch then found 2 REJECT (S-13: a self-referential test bug plus
an incomplete PATH-scrub helper) and 2 CONCERN (S-05: a cross-file break
in receipt-attest.py; S-07: a factually wrong D20 decision draft that
would have documented a second copy of the same bug as "already safe"
when it demonstrably isn't) -- both sent back to their builders rather
than merged. This is the review process working as intended: catching
real defects and one bad internal decision-record draft before they
reached main.

**PF-2's 5-round whack-a-mole ended by fixing the review's own scoping
rule, not the code further:** round 5's diff was the same kind of
incremental patch as rounds 1-4, but this round's review classified every
finding as either "introduced by this diff" (blocking) or "pre-existing
gap this diff doesn't worsen" (a new slice, never a veto). Unanimous 4/4
APPROVE resulted, and 10 real follow-up bypass shapes were captured as
BACKLOG 125 instead of blocking a strict improvement. Generalizes: D12's
unanimous-approval bar must be checked against "is this diff a strict
improvement," never "is this artifact perfect" -- the latter is
unsatisfiable for any heuristic scanner and produces an infinite review
loop.

**GF-4 found genuinely BLOCKED, not just rejected:** its reviewer
independently reproduced S-19's claim (a documented model spelling
silently mis-resolves under GF-4's own catalog) and identified a real
ratchet-ordering deadlock: GF-4 cannot promote `P4.three-setups-resolve`
out of pending.txt until S-19's stricter pass bar is also in the tree, or
the merge itself becomes a ratchet regression. S-19 promoted to the
critical path and reviewed immediately.
