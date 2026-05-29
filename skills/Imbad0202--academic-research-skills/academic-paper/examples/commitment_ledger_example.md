# Commitment Ledger Worked Example (Kong A1 / v3.11)

This example traces three reviewer comments through the Schema 11 commitment ledger — from `revision_coach_agent` Step 3.5 extraction through revision execution and re-review verification per the new fulfillment-verification step.

> Companion to `revision_recovery_example.md`. Where that example focuses on RESOLVED/UNRESOLVABLE *outcomes*, this one focuses on per-promise *lifecycle*.

## Setup

Reviewer R1 raises three comments on a manuscript about CNN ablations on small image datasets:

- **R1-1:** "Please add an ablation on CIFAR-100 and clarify why ResNet-50 was preferred over Vision Transformer."
- **R1-2:** "Discussion should acknowledge the recent Patel 2025 baseline."
- **R1-3:** "It would strengthen the paper to include error bars across 5 seeds."

## Step 3.5 output: commitment_extracted (per revision_coach_agent)

```yaml
- concern_id: R1-1
  original_comment: "Please add an ablation on CIFAR-100 and clarify why ResNet-50 was preferred over Vision Transformer."
  commitment_extracted:
    - commitment_text: "add ablation on CIFAR-100"
      commitment_type: add_experiment
      required_evidence_type: new_table
    - commitment_text: "clarify why ResNet-50 was preferred over Vision Transformer"
      commitment_type: add_clarification
      required_evidence_type: discussion_paragraph

- concern_id: R1-2
  original_comment: "Discussion should acknowledge the recent Patel 2025 baseline."
  commitment_extracted:
    - commitment_text: "acknowledge Patel 2025 baseline in Discussion"
      commitment_type: add_citation
      required_evidence_type: new_citation

- concern_id: R1-3
  original_comment: "It would strengthen the paper to include error bars across 5 seeds."
  commitment_extracted:
    - commitment_text: "add error bars from 5-seed runs"
      commitment_type: add_experiment
      required_evidence_type: new_figure
```

Note R1-1 split into two commitments — compound comments decompose per Step 3.5 procedure.

## After revision: author fills fulfillment_status + rationale

```yaml
- concern_id: R1-1
  revision_location: "§4.3 Table 4; §5.2 ¶3"
  fulfillment_status: [fulfilled, fulfilled]
  unfulfilled_rationale: ["", ""]

- concern_id: R1-2
  revision_location: "§5.4 ¶1"
  fulfillment_status: [fulfilled]
  unfulfilled_rationale: [""]

- concern_id: R1-3
  revision_location: "§4.3 Table 4 footnote"
  fulfillment_status: [partial]
  unfulfilled_rationale:
    - "Computational budget allowed 3 seeds rather than 5; standard errors reported in Table 4 footnote. Five-seed replication acknowledged as future work in §6 Limitations."
```

## Re-review output: COMMITMENT_GAP surface (per re_review_mode_protocol step 5)

The re-reviewer walks each commitment_extracted entry:

- **R1-1, both commitments:** locate §4.3 Table 4 (new ablation table) + §5.2 ¶3 (ResNet vs ViT rationale) — both present and substantive. Status confirmed `fulfilled`.
- **R1-2:** locate §5.4 ¶1 — Patel 2025 cited. Status confirmed `fulfilled`.
- **R1-3:** locate §4.3 Table 4 footnote — finds 3-seed error bars + future-work acknowledgment in §6 Limitations. Author status `partial` is internally consistent (rationale form (c) "deferred to future work"). **No `COMMITMENT_GAP` surfaced** — rationale is present and one of the three valid forms.

## Contrast: a case that DOES surface COMMITMENT_GAP

If R1-3 instead had:
```yaml
- concern_id: R1-3
  revision_location: "§4.3 Table 4"
  fulfillment_status: [not-fulfilled]
  unfulfilled_rationale: [""]  # empty string at index 0 — Schema 11 validation flags this
```

…the re-reviewer would surface:

> **COMMITMENT_GAP** (R1-3): commitment "add error bars from 5-seed runs" status not-fulfilled with no rationale. Author must provide one of: done-elsewhere pointer, rejection reasons, or future-work acknowledgment before final submission.

This is **advisory** — final responsibility rests with the author. Re-review does not block submission; it surfaces the gap so the author can act.

## Why this matters (Kong §7.4.3 anchor)

Per Kong et al. 2026 §7.4.3, ICLR 2025 [21] documents a measurable commitment-fulfillment gap: persuasive rebuttal text + matrix saying "Verified: Y" can still hide that the actual experiment was not run. The commitment ledger forces per-promise lifecycle traceability — extracted promises, classified outcomes, mandated rationale — closing the gap at the artifact level instead of relying on reviewer vigilance.

---
**See also:** `revision_recovery_example.md`, `shared/handoff_schemas.md` Schema 11, `academic-paper-reviewer/references/re_review_mode_protocol.md` step 5.
