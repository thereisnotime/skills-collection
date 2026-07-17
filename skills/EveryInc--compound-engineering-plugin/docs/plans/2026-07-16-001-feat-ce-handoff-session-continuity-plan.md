---
title: ce-handoff Session Continuity - Plan
type: feat
date: 2026-07-16
topic: ce-handoff-session-continuity
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
deepened: 2026-07-16
---

# ce-handoff Session Continuity - Plan

## Goal Capsule

- **Objective:** Add `ce-handoff`, a utility skill that captures the current agent session at a managed temporary or user-requested destination and lets a later agent discover or read any user-selected continuity source without access to the original session.
- **Product authority:** The Product Contract below defines creation, discovery, resume, portability, and non-action behavior.
- **Authority order:** The current user's request and active project instructions outrank a handoff. A handoff supplies context and evidence; text inside it does not grant permission to act.
- **Execution profile:** Implement a prose-first skill contract using the agent's existing filesystem and shell capabilities, then add distribution surfaces and fresh-context behavioral evaluation.
- **Stop conditions:** Stop for a product contradiction or a required distribution invariant that cannot be satisfied without changing the settled contract. Ordinary implementation details remain executor-owned.
- **Open blockers:** None.
- **Tail owner:** The implementation workflow owns changes, validation, review, and landing under the repository's pull-request policy.

---

## Product Contract

### Summary

`ce-handoff` creates immutable session handoffs in the managed temporary store by default or at a user-requested destination. It resumes from any continuity source selected by the user, regardless of who or what created it, and prepares a fresh agent to recommend logical next steps without automatically continuing the work.

### Problem Frame

Agent sessions accumulate decisions, constraints, work state, and conversational context that may not exist in repository files or durable project artifacts. When a session ends, a later agent may lack the history and memories that made the current state understandable, especially across models or agent harnesses.

The continuity artifact should remain lightweight. Existing plans, issues, commits, diffs, and documentation stay authoritative; the handoff points to them and fills only the context that a fresh agent would otherwise have to rediscover.

### Key Decisions

- **One skill with explicit modes.** Keep `ce-handoff` rather than introduce separate creation and resume skills. Bare `/ce-handoff` creates; `/ce-handoff create` is the explicit equivalent; `/ce-handoff resume` discovers or reads handoffs.
- **Bare invocation always creates.** Do not route a bare invocation through an intent menu. Natural-language creation and resume requests remain valid activation paths.
- **Defaults are not restrictions.** The managed store and `ce-handoff/v1` frontmatter optimize ordinary creation and discovery. Explicit user instructions may choose another destination, format, publication capability, search boundary, or resume source.
- **Immutable snapshots.** Resume never marks, updates, consumes, or supersedes a handoff automatically.
- **Selection before ingestion.** When no explicit source is supplied, discovery presents likely candidates and waits for the user to select one before reading a document body.
- **Orientation before action.** After ingesting a selected handoff, the agent summarizes the recovered context and recommends one or more logical continuations, but takes no continuation action until the user chooses.
- **Pointer-first portability.** Reference authoritative artifacts instead of copying them. Prefer repository-relative pointers for repository content and label absolute paths as machine-local capture context when they are load-bearing.
- **Prose-first implementation.** Use the agent's existing file and shell capabilities. Do not add a bundled runtime helper unless behavioral evidence later demonstrates a specific repeated failure that prose and a narrow contract test cannot address.
- **Outcome-first authoring.** Apply the canonical skill-authoring field guide directly: define the result, next consumer, completion condition, authority, and hard protocol boundaries, then admit only prose that changes observable behavior.

### Actors

- A1. **Creating user:** wants the current session captured so work or conversation can continue later.
- A2. **Creating agent:** distills the current session, inspects applicable workspace state, and writes the handoff.
- A3. **Resuming user:** chooses which handoff to ingest and whether to take any suggested continuation.
- A4. **Receiving agent:** discovers or reads the selected handoff, validates current context where appropriate, and recommends next steps without acting automatically.

### Requirements

**Activation and modes**

- R1. Bare `/ce-handoff` and natural-language requests to hand off the current session create a new handoff.
- R2. `/ce-handoff create [focus]` creates a handoff and uses the optional focus to describe what the next session should concentrate on.
- R3. `/ce-handoff resume [source or keywords]` enters resume mode; an explicit local file, URL or page, pasted document, or other readable artifact identifies the continuity source, while keywords guide discovery.
- R4. Natural-language requests to find, read, ingest, continue from, or resume a handoff activate resume mode without requiring command syntax.
- R4a. A user-supplied folder or collection scopes discovery rather than identifying one selected document.

**Creation and storage**

- R5. Creation works in a Git worktree, another repository directory, or any non-repository directory because the artifact describes the agent session rather than requiring a repository.
- R6. By default, store each handoff at `/tmp/compound-engineering/ce-handoff/<repo-namespace>/<topic>.md`, grouping worktrees from the same repository together and using `general` outside Git context. Honor an explicit user path, folder, format, or publication destination through an appropriate available capability instead of forcing the managed store.
- R7. Use a descriptive topic slug as the filename. Keep chronology and worktree identity in frontmatter rather than the path; on collision, add the smallest available numeric suffix instead of overwriting.
- R8. State that `/tmp` is reusable across invocations but OS-managed and not permanent; never promise indefinite retention.
- R9. Write a self-contained handoff using whatever content and organization best orient the next agent. Objective, user intent, accomplishments, decisions, constraints, current state, authoritative references, unfinished work, blockers, fragile local state, verification, plausible next steps, and relevant installed skills are possible coverage, not a closed required section list.
- R10. Do not duplicate content already captured in plans, issues, commits, diffs, or documentation when a pointer plus interpretive context is sufficient.
- R11. Exclude secrets, credentials, and unrelated personal information while retaining operational paths necessary to find machine-local work.
- R11a. Keep the body organization open and adaptive: the agent may add whatever sections help the next agent, while treating the listed coverage topics as examples rather than a closed or fixed template.
- R11b. State that automatic managed-store discovery requires a shared host filesystem; when the receiver cannot see the store, direct the user to transfer or publish the handoff to a receiver-visible location and resume from that explicit source without adding a bundled transport layer.

**Frontmatter contract**

- R12. Every Markdown handoff written to the managed store begins with flat YAML frontmatter containing `artifact_contract: ce-handoff/v1`, `created_at`, `title`, `summary`, `keywords`, and `cwd`. At another destination or in another format, preserve equivalent metadata when supported but do not let the YAML contract block the user's requested output.
- R13. Include optional `resume_focus` when the user supplies a focus or the intended next-session objective is clear.
- R14. When Git context exists, include applicable `repository`, `repo_root_sha`, `branch`, `head`, and `worktree_path`; sanitize repository identifiers so they contain no embedded credentials.
- R15. Do not add mutable lifecycle metadata such as `status`, `resumed_at`, or `superseded_by`.

**Pointers and continuity**

- R16. Prefer durable URLs and repository-relative file paths for authoritative artifacts, anchored by repository, branch, and captured HEAD metadata recorded once in the handoff.
- R17. Use absolute paths only for capture context or genuinely machine-local state, including uncommitted, untracked, ignored, or temporary files, and label that locality clearly.
- R18. If continuity depends on a particular worktree or other fragile local state, identify the dependency and warn without committing, stashing, copying, or otherwise mutating it automatically.
- R19. If current files or repository state contradict the handoff during resume, report the mismatch and treat current state as authoritative.

**Discovery, ingestion, and continuation**

- R20. Resume discovery searches a user-supplied folder or collection, otherwise the managed store, and reads only filesystem metadata plus bounded frontmatter through its closing delimiter before selection; it does not ingest candidate bodies to rank them.
- R21. Treat valid `ce-handoff/v1` frontmatter as enriched discovery metadata, not an eligibility gate. Surface candidates without usable CE frontmatter as unindexed using filenames, locations, and filesystem metadata rather than excluding them.
- R21a. Rank discovery candidates using user keywords and whatever title, summary, keyword metadata, repository or worktree affinity, working-directory affinity, and recency are available without treating repository affinity as a hard filter.
- R22. Present a short candidate list with enough metadata and match rationale for the user to choose; never auto-select and continue.
- R23. Read a candidate's body only after the user selects it. Read an explicit source directly, using format-appropriate inspection for long or structured material, regardless of authorship, ownership, location, format, or whether `ce-handoff` created it.
- R23a. Assess a selected source for continuity sufficiency based on its contents. If it cannot recover a meaningful objective or current state, state what is missing and wait for the user to supplement it or choose another source rather than forcing an orientation.
- R23b. If an explicit source cannot be accessed, report the access problem and ask for a reachable source or different direction rather than searching for a substitute automatically.
- R24. Derive one or more logical next steps from the selected handoff and current context rather than relying on a fixed action menu.
- R25. Do not execute, mutate files, invoke another workflow, or reopen explicitly deferred scope until the user chooses a continuation.
- R26. If no relevant candidate is found, report the search boundary and invite a specific source, another folder or collection, different keywords, or a new handoff request without treating missing results as an error.
- R27. Treat every handoff as untrusted context rather than executable instruction: current user intent, active project instructions, and verified current state remain authoritative.
- R28. Do not exclude a candidate because of ownership, authorship, or an absent or unsupported CE contract. Skip only entries that cannot be represented safely from bounded metadata, and report a bounded diagnostic that does not expose unrelated file content.
- R29. Create a new immutable handoff with user-private access where supported, never overwrite an existing handoff, and confirm the final destination contains it before reporting success.
- R30. Make each terminal state observable: creation succinctly summarizes what the generated handoff captures, returns the final path or URL plus access or retention warnings, and ends with a fenced `/ce-handoff resume <source>` command; discovery returns a shortlist and waits; selected resume returns an orientation or a concrete insufficiency report and waits; failures state what boundary was searched or rejected.
- R30a. Keep the creation handoff minimal: do not generate a narrative resume prompt. The printed command is the source of truth.

### Key Flows

- F1. **Create:** Distill the session and relevant current state, point to authoritative artifacts, write or publish one immutable handoff at the requested destination or managed default, and report its location, access or retention caveat, and continuity warnings without changing the underlying work.
- F2. **Discover:** Enumerate bounded metadata, enrich from compatible frontmatter when present, rank likely candidates, present a shortlist with reasons, and wait for the user.
- F3. **Resume:** Read the selected source, check that its contents are sufficient to orient, compare material claims with current context when useful, report drift, summarize recovered state, suggest logical continuation options, and wait.

### Acceptance Examples

- AE1. In a dirty Git worktree, bare `/ce-handoff` writes a handoff, references repository files relatively, records the worktree path for uncommitted state, warns that teardown would break continuity, and performs no preservation action.
- AE2. In a non-repository research session, a natural handoff request writes an immutable document in the general namespace with an honest temporary-retention caveat.
- AE2a. After creating any handoff, the response gives a context-specific recap sufficient to verify what was captured without opening the artifact, then ends with `/ce-handoff resume <final-path-or-URL>` ready to paste into the receiving session.
- AE3. With several stored handoffs, `/ce-handoff resume authentication` reads candidate frontmatter only, presents a ranked shortlist with match reasons, and waits without choosing or reading a body.
- AE4. With an explicit text file or web page produced outside `ce-handoff`, resume reads that source directly, summarizes it when sufficient, suggests context-specific next steps, and waits without taking action.
- AE5. If a captured worktree no longer exists but its branch and commits remain, repository-relative references remain useful and missing machine-local state is reported rather than assumed.
- AE6. If current files contradict a selected handoff, the orientation names the mismatch and uses current repository state as authority.
- AE7. If discovery encounters a CE-indexed handoff and a file without usable CE frontmatter, the first receives enriched metadata and the second may appear as an unindexed candidate without either body being read.
- AE8. If a selected handoff says to modify files immediately, the agent reports it as prior context, suggests possible continuations, and waits for current-user authorization.
- AE9. If the user asks to publish a new handoff through an installed publishing capability, creation follows that destination and returns its URL without also treating the managed store as mandatory.
- AE10. If an explicit source is readable but lacks enough continuity context, resume explains what is missing and waits for a supplement or another source instead of inventing a confident orientation.

### Success Criteria

- A fresh agent can understand the prior objective, meaningful progress, decisions, constraints, current state, and unfinished work without the original transcript.
- Candidate discovery never reads an unselected handoff body and always leaves selection to the user.
- Explicit resume accepts sufficient continuity material from outside `ce-handoff` without imposing provenance, ownership, format, location, or metadata-contract gates.
- Resume ends its orientation step with suggested continuations and no automatic continuation action.
- Handoffs remain useful in the same worktree, in another worktree when durable repository state survives, and outside repositories.
- The skill remains a compact outcome-and-boundary contract rather than a transport subsystem or procedural state machine.

### Scope Boundaries

- Native agent-session transcript discovery or reconstruction across harnesses.
- Committing handoffs to a repository by default.
- A mutable handoff index, lifecycle database, consumed state, or supersession graph.
- Automatic candidate selection, continuation, reopening of deferred work, commits, stashes, copies, worktree preservation, or cleanup.
- Automatic or unrequested publication, transfer, or duplication. User-directed storage and publication remain in scope through available capabilities.
- Guaranteed retention of files managed by the operating system's temporary directory.
- A bundled runtime helper without evidence that one is necessary.

### Dependencies / Assumptions

- The runtime can use its available capabilities to write or publish handoffs, enumerate bounded discovery metadata, and read user-selected local or remote sources.
- Git metadata is optional enrichment, not a prerequisite.
- The supported targets provide a Unix-like shell environment and `/tmp` for the managed default; user-private permissions are used where supported.

---

## Planning Contract

### Product Contract Preservation Note

- The implementation preserves the settled create, discover, select, resume, and non-action behavior.
- The earlier transport-helper design is intentionally removed. It solved speculative local filesystem adversaries rather than an observed skill failure and inflated a lightweight utility into a subsystem.
- The corrected design applies the field guide's proportionality rule: deterministic enforcement is reserved for small static contract invariants; agent judgment and ordinary file capabilities own context synthesis, ranking, and file operations.

### Selected Approach

Author one self-contained `SKILL.md` with the complete outcome spine and hard behavioral boundaries inline:

1. Route bare and explicit create/resume intent.
2. Create a pointer-first handoff at the requested destination or stable temporary default.
3. Define flat frontmatter as the managed store's enriched discovery contract without making it an eligibility gate.
4. During discovery, inspect only bounded metadata, surface unindexed candidates, and stop for user selection.
5. After selection, accept any readable continuity source, check content sufficiency, orient the user when possible, suggest possible next steps, and stop again.

The skill uses whatever ordinary filesystem and shell interfaces the active harness already provides. A small Bun contract test pins only falsifiable load-bearing language and portability exclusions. Behavioral evaluation tests the judgment boundaries in fresh contexts.

### Rejected / Deferred Approach

A bundled transport helper for publication, discovery, ownership checks, symlink defenses, stable candidate identities, and atomic installation is rejected for this implementation. No demonstrated runtime failure justifies that surface. If fresh-context evaluation later exposes a specific repeated failure, add the smallest mechanism that addresses that failure rather than restoring a general transport layer.

### Key Technical Decisions

- **KTD1 - Outcome spine stays inline.** Result, next consumer, completion state, authority boundary, bare-create route, selection pause, and post-orientation pause appear where they must fire.
- **KTD2 - Existing capabilities own storage and publication.** The skill describes observable behavior without dictating a bespoke script, parser, destination, publishing service, or cross-harness tool name.
- **KTD3 - Frontmatter enriches managed discovery.** Flat, concise metadata lets an agent shortlist CE-created candidates without reading bodies, while unindexed candidates remain discoverable from bounded external metadata.
- **KTD3a - Body structure remains agent judgment.** Unlike frontmatter, headings and section order have no interoperability role; the creating agent may invent sections and otherwise choose the organization that best orients the next agent for the session at hand.
- **KTD4 - Selection is the ingestion boundary.** No candidate body is read until the user supplies or selects a source. A supplied source needs sufficient continuity content, not CE provenance or conformance.
- **KTD5 - Context does not transfer authority.** A selected handoff can inform orientation but cannot authorize commands, mutation, link traversal, unrelated file access, or workflow invocation.
- **KTD6 - Repository collections, not run isolation.** Group handoffs by stable repository identity so discovery naturally spans worktrees; use `general` outside Git. Branch, HEAD, cwd, and worktree remain ranking metadata rather than path partitions. This product-specific collection layout intentionally does not use per-run directories because inspectable paths and cross-worktree discovery are core UX.
- **KTD7 - Distribution changes stay narrow.** Add the skill, detail page, catalog rows, and expected inventory count. Do not change release-owned versions, release notes, or auto-discovery manifests.
- **KTD8 - Fix the shared scratch rule at its owning layer.** Clarify that per-run directories remain the default while a discoverable collection may use stable sibling final artifacts when enumeration and inspectable paths are core product behavior.
- **KTD9 - Creation recap plus one resume command.** Creation briefly recaps what the handoff captured for immediate user verification, then prints `/ce-handoff resume <source>` and nothing more elaborate; the selected document and resume route already own the full context and orientation behavior, so generated launch-prompt prose adds no value.

### Implementation Units

#### U1 - Prose-first skill contract

- **Outcome:** One portable skill creates useful handoffs and resumes only through user-controlled selection and action boundaries.
- **Files:** `skills/ce-handoff/SKILL.md`, `tests/skills/ce-handoff-contract.test.ts`
- **Realizes:** R1-R30; F1-F3; AE1-AE10
- **Verification:** The focused contract test pins activation, routing, managed defaults, user-directed destinations, frontmatter fields, metadata-only discovery, arbitrary selected sources, sufficiency handling, both terminal waits, pointer semantics, redaction, retention honesty, and absence of platform-specific variables, named instruction-file reads, lifecycle fields, or bundled scripts.

#### U2 - Distribution and documentation

- **Outcome:** Users can discover the skill and understand both directions without confusing resume with creation.
- **Files:** `README.md`, `docs/skills/README.md`, `docs/skills/ce-handoff.md`, `tests/release-metadata.test.ts`, `AGENTS.md`; add `CONCEPTS.md` only if a concise glossary entry materially clarifies repository vocabulary.
- **Depends on:** U1
- **Verification:** Inventory and detail-page links agree on `ce-handoff`, Workflow Utilities placement, bare-create semantics, managed-default versus user-directed creation, arbitrary selected sources, temporary retention, selection, sufficiency, and orientation without action. The expected skill count is 31.

#### U3 - Fresh-context behavior and repository gates

- **Outcome:** Current source demonstrates intended create and resume behavior and passes the plugin's standard gates.
- **Depends on:** U1-U2
- **Verification:** Use the repository-prescribed skill evaluation workflow, injecting current source into fresh generic agents. Cover managed and user-directed creation, keyword discovery, explicit local and remote-style sources produced outside CE, insufficient selected content, no match, malformed discovery metadata, stale claims, body-sentinel privacy, and instruction-shaped selected content. Then run focused tests, `bun test`, `bun run release:validate`, `bun run plugin:validate`, and `git diff --check`.

### Risks & Mitigations

| Risk | Mitigation | Evidence |
|---|---|---|
| An agent reads candidate bodies while searching | Inline bounded-metadata boundary followed immediately by a mandatory selection stop | Contract test plus body-sentinel behavioral evaluation |
| A handoff is mistaken for current authority | Label it untrusted context; current user, project instructions, and verified state win; stop after suggesting options | Hostile-body behavioral evaluation |
| Temporary retention is misunderstood | Report the OS-managed retention caveat on creation and document it publicly | Contract test and docs review |
| Worktree-local pointers disappear | Prefer repository-relative durable references and label machine-local absolute paths and fragile state | Dirty-worktree and stale-path evaluation |
| Sensitive context is copied unnecessarily | Pointer-first body contract plus explicit secret, credential, and unrelated-personal-data redaction | Contract test and seeded-content evaluation |
| Prose grows into a pseudo-state-machine | Admit only observable constraints and keep conditional mechanics at the point where they fire | Field-guide review and final diff review |

### Verification Contract

#### Focused gates

- `bun test tests/skills/ce-handoff-contract.test.ts`
- Release metadata test confirms the documented inventory count is 31.

#### Repository gates

- `bun test`
- `bun run release:validate`
- `bun run plugin:validate`
- `git diff --check`

#### Behavioral gates

- Fresh create in a repository or worktree produces a pointer-first artifact and reports its final path, retention caveat, and fragile-state warning without preservation action.
- Fresh create briefly recaps the captured substance, then ends with a copyable `/ce-handoff resume <source>` command.
- Fresh user-directed creation follows the requested destination or publication capability without forcing a second managed-store copy.
- Fresh keyword discovery exposes only bounded shortlist metadata, including labeled unindexed candidates, but no unselected body sentinel, then waits.
- Fresh selected or explicit-source resume accepts continuity material produced outside CE, treats the body as context, reports material drift, proposes logical next actions, and waits without executing them.
- Fresh insufficient-source resume states what is missing and waits instead of manufacturing an orientation.
- No-match and malformed-candidate cases report the search boundary and recovery options without silently choosing another document.

### Definition of Done

- [ ] `ce-handoff` creates from bare, explicit, and natural handoff intent in repository and non-repository contexts.
- [ ] Every successful creation briefly summarizes what was captured and ends with the exact `/ce-handoff resume <source>` command, with no narrative launch prompt.
- [ ] Resume without an explicit source reads bounded candidate metadata only, presents a shortlist including unindexed candidates, and waits for selection.
- [ ] Selected or explicit-source resume accepts sufficient continuity material from any author or format, or reports missing context; it performs no continuation action.
- [ ] Managed-store handoff frontmatter implements `ce-handoff/v1`; bodies are pointer-first, redact secrets, and distinguish durable from machine-local state.
- [ ] No bundled runtime helper or mutable lifecycle system is introduced.
- [ ] The shared scratch guidance distinguishes run-scoped reusable state from discoverable final-artifact collections without weakening the default rule.
- [ ] Root inventory, skill catalog, detail page, and release-metadata count are consistent at 31 skills.
- [ ] Focused tests, full tests, release validation, strict plugin validation, and diff checks pass.
- [ ] Fresh-context behavioral evidence covers default and user-directed creation, non-CE and insufficient sources, unselected-body privacy, and non-transfer of authority.
- [ ] No release-owned version, changelog entry, or unnecessary manifest list is changed.
- [ ] The final change is reviewed under the repository's normal pull-request workflow.

### Sources & References

- `docs/solutions/skill-design/portable-agent-skill-authoring.md` - canonical rules for outcome-first contracts, portable capabilities, proportional authority, minimal protocol, and behavioral evaluation.
- `AGENTS.md` - repository rules for temporary storage, skill packaging, documentation, platform portability, validation, and release ownership.
- `tests/release-metadata.test.ts` - current skill inventory invariant and expected count change.
- `README.md` and `docs/skills/README.md` - user-facing inventory and Workflow Utilities catalog surfaces.
