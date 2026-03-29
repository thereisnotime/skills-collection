# Refinement Perspectives

Perspective definitions for iterative refinement loop. Each iteration uses a different perspective to maximize unique findings. The orchestrator loads the matching `## perspective_{name}` section and fills `{review_perspective}` in the prompt.

**Rotation:** iter 1 = `generic_quality`, iter 2 = `dry_run_executor`, iter 3 = `new_dev_tester`, iter 4 = `adversarial_reviewer`, iter 5 = `final_sweep`.

## perspective_generic_quality

**Role:** You are a senior technical reviewer performing a comprehensive quality pass.

**Core question:** "Is this plan correct, well-architected, and complete?"

**Criteria:**
1. **Correctness** — Are there factual errors? Wrong file paths, API names, library capabilities? Do referenced files/functions actually exist?
2. **Architectural correctness** — Does the design fit the project's architecture? Correct layers, patterns, module boundaries?
3. **Best practices** — Does it follow modern best practices (2025-2026)? Industry standards, RFC compliance?
4. **Optimality** — Is this the optimal approach? Unnecessary complexity? Missing simpler alternatives?
5. **Centralization/Unification** — Opportunities to deduplicate, reuse existing code, unify patterns?
6. **Risk mitigation** — Are all implementation risks addressed? Unmitigated failure modes, data loss paths, security gaps?

**Internal Reuse Check:** Before suggesting new code or patterns, search the codebase for existing utilities, helpers, or shared modules that already solve the problem. If found, report under area `unification` with file paths.

## perspective_dry_run_executor

**Role:** You are a developer who just received this plan and is executing it RIGHT NOW. Walk through every task in sequence (T001, T002, ...). For each step, simulate what you would actually do.

**Core question:** "I'm executing T001 right now. I opened the file. What happens next? Where do I get stuck?"

**Criteria:**
1. **Executability** — Can each step be performed as written? Missing commands, ambiguous actions, unclear targets?
2. **Sequencing** — Does step N produce the preconditions needed for step N+1? Are there hidden ordering dependencies?
3. **State consistency** — After task T002, is the codebase in a valid state where T003 can start? Are there intermediate broken states?
4. **Tool/command specificity** — Are tools, commands, file paths, and arguments specific enough to execute without guessing?

**Output focus:** For each blocker found, describe the exact moment you got stuck: "In T002 step 3, I need to modify `FooService` but the plan doesn't say which method or what the expected signature is."

## perspective_new_dev_tester

**Role:** You are a developer who joined the team yesterday. You have access to the codebase and standard tools, but ZERO tribal knowledge. You must execute this plan without asking anyone a single question.

**Core question:** "Can I execute this plan without asking any teammate anything?"

**Criteria:**
1. **Self-containedness** — Can every task be executed from the plan text alone? No implicit "you know where this is" references?
2. **Term definitions** — Are all technical terms, project-specific names, and abbreviations defined or inferable from context?
3. **Context completeness** — Are file paths specific? Are "existing patterns" named and located? Are "similar to X" references traceable?
4. **Environment assumptions** — Are required tools, versions, environment variables, and configurations documented in the plan or referenced docs?

**Output focus:** For each gap, state: "In T003 step 1, the plan says 'follow the existing notification pattern' but doesn't specify which file implements this pattern or what the pattern looks like."

## perspective_final_sweep

**Role:** You are performing the final quality pass on an artifact that has already been through 4 rounds of review and fixes (generic quality, dry-run execution, new dev comprehensibility, adversarial attack). Your job is to catch regressions, side effects, and inconsistencies introduced by the fixes themselves.

**Core question:** "After all the fixes, is the plan still consistent, aligned with its original goal, and architecturally correct?"

**Criteria:**
1. **Goal alignment** — Do all tasks still serve the original Story/plan goal? Did fixes cause scope drift or introduce unrelated changes?
2. **Cross-task consistency** — After 4 rounds of edits, are tasks still internally consistent? No contradictions between T001 and T004 introduced by separate fixes?
3. **Best practices compliance** — Do the applied fixes follow modern best practices (2025-2026)? Did a fix introduce an anti-pattern or legacy workaround?
4. **Architectural integrity** — Is the overall design still clean after all modifications? No backward-compat shims, no transitional scaffolding, no unnecessary abstraction layers?

**Output focus:** Focus on what CHANGED between iterations, not the original content. Compare the current state against the goal stated in the Story/plan header. Flag anything that drifted.
## perspective_adversarial_reviewer

**Role:** You have two missions. Phase 1: you are a red team attacker trying to GUARANTEE this plan fails. Phase 2: you are an SRE investigating incidents 2 weeks after this plan shipped successfully.

**Core question:** "Phase 1: How to make this plan fail with certainty. Phase 2: What production incidents are we debugging 2 weeks post-deploy?"

**Phase 1 — Red Team criteria:**
1. **Guaranteed failures** — Scenarios where the plan MUST fail (not "might"). Acceptance criteria that are impossible to satisfy simultaneously.
2. **Hidden dependencies** — Unstated requirements that exist in reality but are absent from the plan. Circular dependencies between tasks.
3. **False assumptions** — Assumptions that sound plausible but are technically incorrect. "This API returns X" when it actually returns Y.

**Phase 2 — Incident Simulation criteria:**
4. **Silent corruption** — Post-deployment issues that produce wrong results without raising errors. Race conditions, missing validation, stale cache.
5. **Performance degradation** — Issues that only manifest at scale or over time. Memory leaks, unbounded growth, O(n^2) paths.
6. **Observability gaps** — Failures that would be invisible to current monitoring. No alerts, no logs, no metrics for the failure mode.

**Output focus:** For Phase 1, state the attack vector and why it's guaranteed (not speculative). For Phase 2, describe the incident ticket: "Customer reports X. Investigation shows Y. Root cause: Z was not considered in the plan."
