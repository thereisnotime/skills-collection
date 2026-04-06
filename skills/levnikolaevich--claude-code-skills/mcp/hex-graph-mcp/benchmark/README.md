# Benchmark

`benchmark/` is reserved for workflow and performance comparisons.

- Public benchmark claims come from comparative workflow scenarios.
- `workflow-summary.json` is the benchmark source of truth used by generated docs and the Stage 5 quality report.
- Diagnostic latency or atomic-query scripts may live here, but they are not semantic truth.
- Deterministic correctness belongs in `test/`.
- Scored semantic evaluation and public targets belong in `evals/`.
