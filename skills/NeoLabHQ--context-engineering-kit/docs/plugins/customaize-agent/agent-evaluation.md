# agent-evaluation

Use when testing prompt effectiveness, validating context engineering choices, or measuring agent improvement quality.

**Evaluation Approaches:**

- **LLM-as-Judge** - Direct scoring, pairwise comparison, rubric-based
- **Outcome-Focused** - Judge results, not exact paths (agents may take valid alternative routes)
- **Multi-Level Testing** - Simple to complex queries, isolated to extended interactions
- **Bias Mitigation** - Position bias, verbosity bias, self-enhancement bias

**Multi-Dimensional Evaluation Rubric:**

| Dimension | Weight | What It Measures |
|-----------|--------|------------------|
| Instruction Following | 0.30 | Task adherence |
| Output Completeness | 0.25 | Coverage of requirements |
| Tool Efficiency | 0.20 | Optimal tool selection |
| Reasoning Quality | 0.15 | Logical soundness |
| Response Coherence | 0.10 | Structure and clarity |
