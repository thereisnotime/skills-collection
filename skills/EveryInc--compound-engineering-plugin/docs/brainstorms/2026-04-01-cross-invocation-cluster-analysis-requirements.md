---
date: 2026-04-01
topic: cross-invocation-cluster-analysis
---

# Cross-Invocation Cluster Analysis for resolve-pr-feedback

## Problem Frame

The resolve-pr-feedback skill's cluster analysis is gated on two signals: volume (3+ items) and verify-loop re-entry (2nd+ pass within the same invocation). The verify-loop signal is effectively dead — it requires new review threads to appear between push and verify, but automated reviewers take minutes while verify runs seconds after push. The timing gap makes this gate unreliable at best, and in the common case of automated reviewers, impossible.

This leaves volume as the only working gate. The skill misses the exact scenario clustering was designed for: a reviewer posts feedback about the same *class* of problem across multiple rounds, with each round containing only 1-2 threads. Individually, no round triggers the volume gate. But taken together, there's a clear recurring pattern — e.g., "three separate rounds of feedback all about missing convergence behavior in target writers." The skill should step back and investigate the problem class holistically rather than applying band-aids to each instance.

## Requirements

**Detection Signal**

- R1. Replace the verify-loop re-entry gate signal with a cross-invocation awareness signal. Before triaging, the skill checks whether it has previously resolved threads on this same PR. Its own prior reply comments are the evidence.
- R2. If prior resolutions exist and new unresolved feedback has arrived since the last resolution, that constitutes the re-entry signal — even with just 1 new item. If no prior resolutions are found (first invocation), the cross-invocation signal does not fire and processing continues with the volume gate as the only cluster trigger.
- R3. The volume gate (3+ items) remains unchanged as a parallel trigger. The two gates are OR'd: either one fires cluster analysis.

**Cost Control**

- R9. Cross-invocation detection must not add GraphQL API calls. The existing `get-pr-comments` query should be broadened to return both unresolved and resolved threads (with skill replies) in a single call. All cross-invocation analysis — detection, overlap check, clustering — works on data already in memory from that one call.
- R10. Cross-invocation clustering is scoped to the last N resolution rounds (not all history). A "round" is the set of threads resolved in a single skill invocation. This bounds the data the skill processes regardless of PR history length. Planning should determine the right value of N; 2-3 rounds is likely sufficient since recurring patterns surface in recent history.
- R11. When the cross-invocation signal fires but the volume gate does not, the skill runs a lightweight overlap check first: compare concern categories and file paths between new and prior threads using data already fetched. Promote to full clustering only if category or spatial overlap exists. If no overlap, skip clustering and process the new thread(s) individually.

**Clustering Input**

- R4. When the cross-invocation signal fires and overlap is confirmed (R11), cluster analysis considers both the new thread(s) AND previously-resolved threads from the last N rounds as input. This enables detecting that the same concern category keeps recurring across rounds.
- R5. Previously-resolved threads are included in category assignment and spatial grouping alongside new threads, so clusters can span rounds.

**Resolver Behavior on Cross-Invocation Clusters**

- R6. When a cross-invocation cluster forms, the resolver agent assesses the prior fixes and applies one of three modes:
  - **Band-aid fixes** — prior fixes addressed symptoms, not root cause. Re-examine and potentially redo them as part of a holistic fix.
  - **Correct but incomplete** — prior fixes were right for their scope, but the recurring pattern reveals the same problem likely exists in untouched sibling code. Keep prior fixes, fix the new thread, and proactively investigate whether the pattern extends to code no reviewer has flagged yet. This is the highest-value mode — it's what catches "three rounds of the same concern category in different files means there are probably more files with the same issue."
  - **Sound and independent** — prior fixes were adequate and the new thread is genuinely unrelated despite clustering. Use prior context for awareness only.
- R7. The cluster brief XML gains a `<prior-resolutions>` element listing previously-resolved thread IDs and their concern categories, with reply timestamps (createdAt) to establish ordering across rounds, so the resolver agent has the full cross-round picture.

**Within-Session Verify Loop**

- R8. The within-session verify loop (step 8: if new threads remain, repeat from step 2) continues to function as a workflow mechanism. Replies posted during earlier cycles within the same session count as prior resolutions for the cross-invocation signal, so the new gate naturally subsumes the old verify-loop re-entry gate.

## Success Criteria

- Recurring feedback about the same problem class across 2+ rounds triggers cluster analysis, even when each round has only 1-2 threads
- A single new thread on a PR with prior resolutions in the same concern category produces a cluster brief that includes both the new and old threads
- The resolver agent can distinguish three modes: "prior fixes were band-aids, redo holistically", "prior fixes were correct but incomplete, investigate sibling code", and "prior fixes were sound, this is independent"
- Token cost is bounded: a PR with 15 prior resolution rounds costs no more for clustering than a PR with 3, and unrelated new feedback on a multi-round PR skips clustering entirely after the lightweight overlap check

## Scope Boundaries

- No persistent state files or `.context/` storage — detection relies entirely on GitHub PR comment history
- No changes to the volume gate threshold or the cluster spatial grouping rules
- No changes to how the resolver agent handles standard (non-cluster) threads
- The `get-pr-comments` script currently filters to unresolved threads only (`isResolved == false`). Per R9, this query is broadened to also return resolved threads — no new script, just a wider filter in the existing one

## Key Decisions

- **Detection via own replies, not persistent state**: Prior resolutions are detected by checking for the skill's own reply comments on PR threads. This keeps the skill stateless and avoids `.context/` file management. The data is already authoritative (GitHub is the source of truth for what was resolved).
- **Three-mode resolver assessment**: The agent distinguishes band-aid fixes (redo), correct-but-incomplete fixes (keep fixes, investigate sibling code), and sound-and-independent fixes (context only). The "correct but incomplete" mode is the highest-value case — it's what turns "three rounds of the same concern in different files" into proactive investigation of untouched code with the same pattern.
- **Cross-invocation signal subsumes verify-loop signal**: Within-session cycles produce replies that count as prior resolutions, so the new gate handles both cross-session and within-session re-entry without needing a separate verify-loop signal.
- **Bounded lookback, not full history**: Clustering only considers the last N resolution rounds. Recurring patterns surface in recent history — if the same concern category appeared in the last 2-3 rounds, that's the signal. Going back further adds cost without proportional value.
- **Zero additional API calls**: Cross-invocation detection piggybacks on the existing `get-pr-comments` query by broadening the filter. All analysis — detection, overlap check, clustering — happens in-memory on data already fetched. No new GraphQL calls.
- **Two-tier cost control**: The lightweight overlap check (R11) prevents unnecessary full clustering. Most multi-round PRs get unrelated feedback in later rounds; those skip clustering entirely after a cheap metadata comparison. Full clustering only runs when there's evidence it will find something.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] How should the skill identify its own prior replies? Options include checking the authenticated `gh` user, matching a reply-text pattern, or both. Planning should check what the existing `resolve-pr-thread` and `reply-to-pr-thread` scripts produce and what's easily queryable.
- [Affects R4][Technical] How should previously-resolved threads be represented in the triage list alongside new threads? They need a status marker (e.g., `previously-resolved`) so clustering can include them while dispatch skips re-resolution of threads that don't cluster.
- [Affects R9][Technical] What fields does the existing `get-pr-comments` GraphQL query return per thread? Planning should check whether the query already fetches enough data (file path, line range, comment body, author) to support both resolved and unresolved threads without changing the response shape, or whether fields need to be added.
- [Affects R10][Technical] What is the right value of N for resolution round lookback? 2-3 is the starting hypothesis. Planning should consider typical PR review patterns and the marginal value of deeper lookback.

## Next Steps

-> `/ce:plan` for structured implementation planning
