# /do-in-parallel

Execute tasks in parallel across multiple targets with intelligent model selection, independence validation, meta-judge evaluation specification, LLM-as-a-judge verification, and quality-focused prompting.

- Purpose - Execute the same task across multiple independent targets in parallel
- Pattern - Supervisor/Orchestrator with parallel dispatch, context isolation, and meta-judge + judge verification
- Output - Multiple solutions, one per target, with aggregated summary
- Efficiency - Dramatic time savings through concurrent execution of independent work

## Quality Assurance

Enhanced verification with Zero-shot CoT, Constitutional AI self-critique, meta-judge evaluation specification, LLM-as-a-judge verification, and intelligent model selection

## Pattern: Parallel Orchestration with Judge Verification

This command implements a seven-phase parallel orchestration pattern:

```
Phase 1: Parse Input and Identify Targets
                     │
Phase 2: Task Analysis with Zero-shot CoT
         ┌─ Task Type Identification ─────────────────┐
         │ (transformation, analysis, documentation)  │
         ├─ Per-Target Complexity Assessment ─────────┤
         │ (high/medium/low)                          │
         ├─ Independence Validation ──────────────────┤
         │ CRITICAL: Must pass before proceeding      │
         └────────────────────────────────────────────┘
                     │
Phase 3: Model and Agent Selection
         Is task COMPLEX? → Opus
         Is task SIMPLE/MECHANICAL? → Haiku
         Otherwise → Opus (default for balanced work)
                     │
Phase 3.5: Dispatch Meta-Judge (ONCE)
         Single sadd:meta-judge agent (Opus)
         → Evaluation Specification YAML
         (Reused for ALL targets — not re-run per target)
                     │
Phase 4: Construct Per-Target Prompts
         [CoT Prefix] + [Task Body] + [Self-Critique Suffix]
         (Same structure for ALL agents, customized per target)
                     │
Phase 5: Parallel Dispatch and Judge Verification
         ┌─ Agent 1 (target A) ─→ Judge 1 (+meta-spec) ─┐
         ├─ Agent 2 (target B) ─→ Judge 2 (+meta-spec) ─┼─→ Concurrent
         └─ Agent 3 (target C) ─→ Judge 3 (+meta-spec) ─┘
                     │
         Each target: Implement → Judge (with meta-spec) → Retry (max 3)
                     │
Phase 6: Collect and Summarize Results
         Aggregate outcomes, report failures, suggest remediation
```

## Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Phase 3.5: Meta-Judge (ONCE)                                          │
│   ┌──────────────────────────────────────┐                              │
│   │ Meta-Judge (Opus, sadd:meta-judge)   │                              │
│   │ → Evaluation Specification YAML       │                              │
│   └──────────────────┬───────────────────┘                              │
│                      │ (shared across all targets)                      │
│                      ▼                                                  │
│   Parallel Targets                                                      │
│                                                                         │
│   Target A          Target B          Target C                          │
│   ┌──────────┐      ┌──────────┐      ┌──────────┐                     │
│   │Implementer│      │Implementer│      │Implementer│                    │
│   │(parallel) │      │(parallel) │      │(parallel) │                    │
│   └─────┬────┘      └─────┬────┘      └─────┬────┘                     │
│         │                 │                 │                            │
│         ▼                 ▼                 ▼                            │
│   ┌──────────┐      ┌──────────┐      ┌──────────┐                     │
│   │  Judge   │      │  Judge   │      │  Judge   │                     │
│   │(sadd:judge)│    │(sadd:judge)│    │(sadd:judge)│                    │
│   │+meta-spec │     │+meta-spec │     │+meta-spec │                    │
│   └─────┬────┘      └─────┬────┘      └─────┬────┘                     │
│         │                 │                 │                            │
│         ▼                 ▼                 ▼                            │
│   ┌──────────────────────────────────────────────────┐                  │
│   │ Parse Verdict (per target)                        │                  │
│   │ ├─ PASS (≥4)? → Complete                          │                  │
│   │ ├─ Soft PASS (≥3 + low priority issues)? → Done   │                  │
│   │ └─ FAIL (<4)? → Retry (max 3 per target)          │                  │
│   └──────────────────────────────────────────────────┘                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Usage

```bash
# Inferred targets from task description
/do-in-parallel "Apply consistent logging format to src/handlers/user.ts, src/handlers/order.ts, and src/handlers/product.ts"
```

## Advanced Options

```bash
# Basic usage with file targets
/do-in-parallel "Simplify error handling to use early returns" \
  --files "src/services/user.ts,src/services/order.ts,src/services/payment.ts"

# With named targets
/do-in-parallel "Generate unit tests achieving 80% coverage" \
  --targets "UserService,OrderService,PaymentService"

# With model override
/do-in-parallel "Security audit for injection vulnerabilities" \
  --files "src/db/queries.ts,src/api/search.ts" \
  --model opus
```

## When to Use

**Good use cases:**

- Same operation across multiple files (refactoring, formatting)
- Independent transformations (each file stands alone)
- Batch documentation generation (API docs per module)
- Parallel analysis tasks (security audit per component)
- Multi-file code generation (tests per service)

**Do NOT use when:**

- Only one target → use `/do-and-judge` instead
- Targets have dependencies → use `/do-in-steps` instead
- Tasks require sequential ordering → use `/do-in-steps` instead
- Shared state needed between executions → use `/do-in-steps` instead
- Quality-critical tasks needing comparison → use `/do-competitively` instead

## Meta-Judge and Judge Verification

A single `sadd:meta-judge` agent generates a tailored evaluation specification (rubrics, checklists, scoring criteria) before any implementation begins. This specification is reused for ALL per-target judge verifications -- it is never re-run per target or on retries.

Each parallel agent is then verified by an independent `sadd:judge` agent that applies the meta-judge specification mechanically.

| Aspect | Details |
|--------|---------|
| **Meta-Judge** | Single `sadd:meta-judge` (Opus) dispatched once before implementation |
| **Judge** | Per-target `sadd:judge` (Opus) applying the shared meta-judge spec |
| **Threshold** | Score >=4/5.0 for PASS; soft PASS at >=3 if all issues are low priority |
| **Max Retries** | 3 retries per target (same meta-judge spec reused on retries) |
| **Isolation** | Each target's failure doesn't affect others |
| **Feedback Loop** | Judge ISSUES passed to retry implementation |

### Scoring Scale

| Score | Meaning | Frequency |
|-------|---------|-----------|
| 5 | Excellent - Exceeds requirements | <5% of evaluations |
| 4 | Good - Meets ALL requirements | Genuinely solid work |
| 3 | Adequate - Meets basic requirements | Refined work |
| 2 | Below Average - Multiple issues | Common for first attempts |
| 1 | Unacceptable - Clear failures | Fundamental failures |

## Quality Enhancement Techniques

| Technique | Phase | Purpose |
|-----------|-------|---------|
| Zero-shot Chain-of-Thought | Phase 4 (prompt prefix) | Structured reasoning before implementation |
| Constitutional AI Self-Critique | Phase 4 (prompt suffix) | Internal verification before submission |
| Meta-Judge Specification | Phase 3.5 (single dispatch) | Tailored rubrics and checklists generated once, reused for all targets |
| LLM-as-a-Judge | Phase 5 (per-target) | External verification applying meta-judge spec mechanically |
| Retry with Feedback | Phase 5 (on failure) | Iterative improvement using judge-identified issues |

## Context Isolation Best Practices

- **Minimal context**: Each sub-agent receives only what it needs for its target
- **No cross-references**: Don't tell Agent A about Agent B's target
- **Let them discover**: Sub-agents read files to understand local patterns
- **File system as truth**: Changes are coordinated through the filesystem

## Error Handling

| Failure Type | Description | Recovery Action |
|--------------|-------------|-----------------|
| **Recoverable** | Judge found issues, retry available | Retry with judge feedback (max 3 per target) |
| **Approach Failure** | The approach for this target is wrong | Escalate to user with options |
| **Foundation Issue** | Requirements unclear or impossible | Escalate to user for clarification |
| **Max Retries Exceeded** | Target failed after 3 retries | Mark failed, continue other targets, report at end |

**Critical Rules:**
- Each target is isolated - failures don't affect other targets
- NEVER continue past max retries without user input
- Continue with successful targets even if some fail
- Report all failures clearly in final summary

## Theoretical Foundation

**Zero-shot Chain-of-Thought** (Kojima et al., 2022)

- "Let's think step by step" improves reasoning by 20-60%
- Applied to each parallel agent independently
- Reference: [Large Language Models are Zero-Shot Reasoners](https://arxiv.org/abs/2205.11916)

**Constitutional AI / Self-Critique** (Bai et al., 2022)

- Each agent self-verifies before completing
- Catches issues without coordinator overhead
- Reference: [Constitutional AI](https://arxiv.org/abs/2212.08073)

**Multi-Agent Context Isolation** (Multi-agent architecture patterns)

- Fresh context prevents accumulated confusion
- Focused tasks produce better results than context-polluted sessions
- Reference: [Multi-Agent Debate](https://arxiv.org/abs/2305.14325) (Du et al., 2023)

**LLM-as-a-Judge** (Zheng et al., 2023)

- Independent judge catches blind spots self-critique misses
- Structured evaluation criteria ensure consistency
- Reference: [Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685)
