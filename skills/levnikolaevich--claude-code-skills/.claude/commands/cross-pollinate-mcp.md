---
description: "Audit hex MCP servers for transferable optimizations using diff-driven transfer matrix"
allowed-tools: "Bash,Agent,mcp__hex-line__read_file,mcp__hex-line__grep_search,mcp__hex-line__outline,mcp__hex-line__directory_tree,mcp__hex-line__edit_file,mcp__hex-line__write_file"
---

# Cross-Pollinate Hex MCP Servers

Diff-driven audit: find real transferable changes across hex-line-mcp, hex-ssh-mcp, hex-graph-mcp. Each delta is classified, not blindly ported.

| Server | Directory | Tools | Role |
|--------|-----------|-------|------|
| hex-line-mcp | `mcp/hex-line-mcp/` | 11 | Local file ops (source of current deltas) |
| hex-ssh-mcp | `mcp/hex-ssh-mcp/` | 6 | SSH remote ops |
| hex-graph-mcp | `mcp/hex-graph-mcp/` | 15 | Workspace-first code knowledge graph |

---

### Phase 0: Change Inventory

Start from actual changes, not theoretical checklists.

```bash
git diff --stat -- mcp/hex-line-mcp/
git status -- mcp/hex-line-mcp/
```

Read each changed file's diff. Classify changes into categories:

| Category | Examples |
|----------|---------|
| API/schema | New params, changed descriptions, tool registration |
| Runtime behavior | Edit logic, search logic, error handling |
| Output normalization | Dedup, truncate, format pipelines |
| Shared infra | Version sourcing, update-check, coerce, security |
| Tests | New test coverage |
| Docs | README, descriptions |

### Phase 1: Transfer Matrix

For EACH change from Phase 0, check if it applies to hex-ssh and hex-graph.

**Decision categories:**
- `APPLY` — real gap, same pattern needed in target server
- `ALREADY_PRESENT` — target already has equivalent implementation
- `N/A_BY_DESIGN` — change is domain-specific to source (e.g., local-only, SSH-only)
- `REJECT` — change would hurt target server

**Required evidence:** file + line reference for BOTH source change AND target server status.

Output:

| Change | Evidence (hex-line) | hex-ssh status | hex-graph status | Decision | Rationale |
|--------|-------------------|----------------|-----------------|----------|-----------|

### Shared optimization checks (always verify these):

| Check | What to look for |
|-------|-----------------|
| Dynamic version | `createRequire(...)("./package.json")` vs hardcoded string in McpServer constructor and checkForUpdates |
| Missing dependencies | All imports have matching entries in package.json dependencies |
| Safe process spawning | `execFileSync` (arg array) vs `execSync` (shell string interpolation) in production code |
| CRLF normalization | Consistent `.replace(/\r\n/g, "\n")` where files are read |
| Benchmark parity | README claims token efficiency → benchmark.mjs exists with reproducible numbers |

### Phase 2: Apply Transfers

Implement all `APPLY` decisions from Phase 1.

For each change:
1. Read target file with hex-line tools
2. Apply the change (edit_file or write_file)
3. Verify syntax: `npm run check` in target package

### Phase 3: Local Cleanup (optional)

If Phase 0 revealed drift in hex-line's own docs (README factual errors, hook regex issues), fix them here. This is NOT cross-pollination — label findings as "local cleanup".

Check only files touched by Phase 0 changes:
- **README accuracy** — tool counts, parameter tables, constants match code
- **Hook correctness** — regex patterns don't over-match (e.g., `find -exec rm`)

### Phase 4: Verify

```bash
cd mcp/hex-ssh-mcp && npm run check && npm run lint && npm test
cd mcp/hex-graph-mcp && npm run check && npm run lint && npm test  
cd mcp/hex-line-mcp && npm run check && npm run lint && npm test
```

**Gate:** 0 errors on all 3 servers.

### Phase 5: Report + Meta-Analysis

Output two tables:

**Real Transfer Gaps:**

| Change | Source | Target | Status | Action | Rationale |
|--------|--------|--------|--------|--------|-----------|

**Non-Gaps / N/A by Design:**

| Change | Source | Target | Decision | Rationale |
|--------|--------|--------|----------|-----------|

List all files created or modified.

---

### Meta-Analysis

**MANDATORY READ:** Load `shared/references/meta_analysis_protocol.md`

Analyze this session per protocol. Output per protocol format.
