# hex-graph-mcp

Deterministic layered code graph MCP server. Indexes codebases into a SQLite graph via tree-sitter AST parsing, canonical symbol identities, semantic edges, and hash-based incrementality.

[![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-graph-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-graph-mcp)
[![downloads](https://img.shields.io/npm/dm/@levnikolaevich/hex-graph-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-graph-mcp)
[![license](https://img.shields.io/npm/l/@levnikolaevich/hex-graph-mcp)](./LICENSE)
![node](https://img.shields.io/node/v/@levnikolaevich/hex-graph-mcp)

### 15 MCP Tools

| Tool | Description | Key Feature |
|------|-------------|-------------|
| `index_project` | Scan and index a project into a layered code graph | Idempotent, skips unchanged files |
| `watch_project` | Keep the graph updated incrementally | Shared pipeline with full indexing |
| `search_symbols` | Find candidate symbols by name | Discovery-only, returns identity candidates |
| `get_symbol` | Return identity-safe symbol context | Canonical selector + provider status + confidence filter |
| `trace_paths` | Traverse graph paths through selected layers | `calls`, `references`, `imports`, `type`, `flow`, `mixed` + `min_confidence` |
| `find_references` | Find semantic usages of one symbol identity | Imports, calls, reads, types, reexports + `min_confidence` |
| `find_implementations` | Find `extends`, `implements`, and `overrides` relations | Built from type-layer edges |
| `find_dataflows` | Explain local and one-hop interprocedural flow | Deterministic flow summaries |
| `explain_resolution` | Show how a selector/import/reference resolved | Parsed candidates + precise-provider status |
| `find_clones` | Detect exact, normalized, and near-miss clones | Hashes, MinHash, suppression heuristics |
| `find_hotspots` | Rank risky symbols by complexity x dependency pressure | Uses unified graph and clone metadata |
| `find_unused_exports` | Find proven-unused exports and split uncertain cases | Workspace-aware, confidence-aware |
| `find_cycles` | Detect circular dependencies between workspace modules | SCC-based cycle detection |
| `get_module_metrics` | Calculate coupling metrics from workspace-module/package edges | Ca/Ce/Instability plus unresolved outgoing |
| `get_architecture` | Summarize workspace modules, boundaries, and cross-module edges | Built from workspace ownership + package edges |

## Install

```bash
npm i -g @levnikolaevich/hex-graph-mcp
claude mcp add -s user hex-graph -- hex-graph-mcp
```

Or add to `.claude/settings.json` directly:

```json
{
  "mcpServers": {
    "hex-graph": {
      "command": "node",
      "args": ["path/to/mcp/hex-graph-mcp/server.mjs"]
    }
  }
}
```

## Tools Reference

All semantic tools use canonical selectors. Pass exactly one of:

- `symbol_id`
- `workspace_qualified_name`
- `qualified_name`
- `name` + `file`

Plain `name` on its own is supported only in `search_symbols`. Ambiguous semantic selectors return `AMBIGUOUS_SYMBOL` instead of silently choosing the first match.

All semantic symbol results expose both file-local and workspace-aware identity:

- `qualified_name`
- `workspace_qualified_name`
- `package_key` / `package_name`
- `module_key` / `module_name`

Stage 2 precise overlay is additive:

- parser/workspace facts stay in the graph
- stronger provider facts use `confidence: "precise"`
- provider availability is surfaced explicitly per language
- `min_confidence` lets callers filter out weaker parser-only facts
- `JavaScript/TypeScript` uses the embedded TypeScript compiler API
- `Python`, `C#`, and `PHP` use detect-only external providers during indexing (`basedpyright`, `csharp-ls`, `phpactor`)
- missing external tooling returns a direct human-actionable message the agent can relay as-is

### index_project

Scan and index a project. Builds syntax, symbol, module, type, flow, and clone overlays from tree-sitter AST parsing.

When an external precise provider is missing for a project language, `index_project` includes a clear remediation line such as:

- `Python precise analysis is unavailable because basedpyright-langserver is not installed. Ask a human to install basedpyright and rerun index_project.`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Project root directory |
| `languages` | string[] | no | Restrict indexing to configured grammars |

### search_symbols

Full-text search for candidate symbols by name. Returns matches you can feed into semantic queries.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Symbol name or partial name |
| `kind` | string | no | Optional node-kind filter |
| `limit` | number | no | Max matches (default: 20) |

### get_symbol

Identity-safe symbol view: definition, incoming edges, outgoing edges, structural context, and confidence summary.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symbol_id` / `workspace_qualified_name` / `qualified_name` / `name`+`file` | selector | yes | Canonical selector |
| `min_confidence` | string | no | Minimum fact tier: `low`, `inferred`, `exact`, `precise` |

### trace_paths

Traverse graph paths from one symbol through selected semantic layers.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symbol_id` / `workspace_qualified_name` / `qualified_name` / `name`+`file` | selector | yes | Start selector |
| `to_symbol_id` / `to_workspace_qualified_name` / `to_qualified_name` / `to_name`+`to_file` | selector | no | Optional target selector |
| `path_kind` | string | no | `calls`, `references`, `imports`, `type`, `flow`, `mixed` |
| `direction` | string | no | `forward`, `reverse`, `both` |
| `depth` | number | no | Traversal depth |
| `limit` | number | no | Max paths |
| `min_confidence` | string | no | Filter out weaker facts below the requested tier |

### find_references

Find incoming semantic references for one symbol identity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symbol_id` / `workspace_qualified_name` / `qualified_name` / `name`+`file` | selector | yes | Canonical selector |
| `kind` | string | no | Optional edge-kind filter |
| `limit` | number | no | Max references |
| `min_confidence` | string | no | Filter out weaker facts below the requested tier |

### find_implementations

Find `extends`, `implements`, and `overrides` relations anchored to one symbol identity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symbol_id` / `workspace_qualified_name` / `qualified_name` / `name`+`file` | selector | yes | Canonical selector |
| `limit` | number | no | Max results |

### find_dataflows

Return deterministic flow summaries and targeted interprocedural flow paths for one symbol identity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symbol_id` / `workspace_qualified_name` / `qualified_name` / `name`+`file` | selector | yes | Canonical selector |
| `to_symbol_id` / `to_workspace_qualified_name` / `to_qualified_name` / `to_name`+`to_file` | selector | no | Optional target selector |
| `depth` | number | no | Flow expansion depth |
| `limit` | number | no | Max paths |

### explain_resolution

Explain how a selector/import/reference was resolved and why a candidate won.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symbol_id` / `workspace_qualified_name` / `qualified_name` / `name`+`file` | selector | yes | Canonical selector |

### watch_project

Start file watcher for incremental graph updates. Reuses the same indexing pipeline as `index_project`.

## Architecture Guardrails

- Local-first by default: embedded SQLite graph store is the source of truth for normal use.
- Parser-first by default: workspace discovery and semantic resolution run before edge materialization.
- Workspace-first identity: semantic queries expose both file-local `qualified_name` and workspace-level `workspace_qualified_name`.
- Precise providers are optional overlays, not replacements for the native graph.
- Import/export interchange stays adapter-only. It is not the core storage model or primary UX.
- Correctness is locked with semantic smoke fixtures, including permanent regressions for cross-file workspace resolution.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Project root directory to watch |

### find_clones

Detects duplicated code at three confidence levels:

| Tier | Detects | Method | Min Statements |
|------|---------|--------|----------------|
| exact | Identical copies (Type-1) | FNV-1a-64 hash of raw body | 3 |
| normalized | Renamed identifiers (Type-2) | FNV-1a-64 hash of normalized body | 5 |
| near_miss | Modified structure (Type-3) | MinHash fingerprint + Jaccard similarity | 8 |

**Parameters:**

- `path` required
- `type` — `exact` | `normalized` | `near_miss` | `all`
- `threshold` — Jaccard similarity for `near_miss`
- `min_stmts`
- `kind` — `function` | `method` | `all`
- `scope`
- `cross_file`
- `format`
- `suppress`

**Suppression heuristics:**

| Heuristic | Strength | Condition |
|-----------|----------|-----------|
| test-fixture | strong | all members in test files |
| interface-impl-hint | weak | same signature, different parents |
| bounded-context-hint | weak | different dirs, no shared callers |

**Languages with full AST fingerprinting:** JavaScript, TypeScript, Python  
**Other languages:** hash-only detection for exact and normalized tiers

### find_hotspots

Find high-risk symbols ranked by complexity x dependency pressure.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Project root (must be indexed) |
| `min_callers` | number | no | Minimum caller count |
| `min_complexity` | number | no | Minimum complexity threshold |
| `limit` | number | no | Max results |
| `scope` | string | no | File path prefix filter |
| `format` | string | no | `json` or `text` |

### find_unused_exports

Find exported symbols with no proven incoming usage.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Project root directory |
| `scope` | string | no | File path prefix filter |
| `kind` | string | no | Optional export kind filter |
| `format` | string | no | `json` or `text` |

### find_cycles

Detect circular dependencies between workspace modules.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Project root directory |
| `scope` | string | no | Optional file/path prefix filter |
| `limit` | number | no | Max cycles |
| `format` | string | no | `json` or `text` |

### get_module_metrics

Calculate coupling metrics from workspace-module dependencies.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Project root directory |
| `scope` | string | no | Optional file/path prefix filter |
| `sort` | string | no | Sort mode |
| `min_coupling` | number | no | Filter low-signal rows |
| `format` | string | no | `json` or `text` |

### get_architecture

Project architecture overview from workspace ownership and resolved package/module boundaries.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Project root directory |
| `scope` | string | no | Scope to subdirectory |
| `limit` | number | no | Max rows |
| `format` | string | no | `json` or `text` |

## Architecture

`hex-graph-mcp` stores a layered graph in SQLite and treats semantic edges as first-class data.

## Supported Languages

| Language | Extensions | Definitions & Calls | Exports | Imports (structured) | Type Layer | `find_unused_exports` |
|----------|-----------|---------------------|---------|---------------------|-----------|------------------------|
| JavaScript | .js .mjs .cjs .jsx | Full | ESM named/default/reexport | Full (relative, workspace package, alias, default, namespace) | Basic explicit syntax | Proven unused + uncertain split |
| TypeScript | .ts .tsx | Full | ESM named/default/reexport | Full (relative, workspace package, alias, default, namespace) | Basic explicit syntax | Proven unused + uncertain split |
| Python | .py | Full | `__all__` or underscore convention | Workspace-aware absolute + relative imports | Basic explicit syntax | Proven unused + uncertain split |
| C# | .cs | Full | `public` access modifier | Project/namespace ownership + references | Basic explicit syntax | Proven unused + uncertain split |
| PHP | .php | Full | Top-level + `public` methods | PSR-4 namespace resolution | Basic explicit syntax | Proven unused + uncertain split |

**Note:** Architecture, cycle detection, and coupling reports are workspace-first. File-level edges remain raw evidence in the graph, but module/package ownership is the primary reporting layer.

```
hex-graph-mcp/
  server.mjs          MCP server (stdio transport)
  package.json
  lib/
    indexer.mjs       Shared indexing pipeline
    parser.mjs        Tree-sitter parsing and language extraction
    store.mjs         SQLite graph storage and query layer
    watcher.mjs       Chokidar-based incremental updates
    clones.mjs        Clone detection engine
    cycles.mjs        Module cycle detection
    unused.mjs        Unused export analysis
```

### Storage

- **SQLite** via `better-sqlite3`
- **Nodes** for symbols, module pseudo-nodes, and synthetic bindings
- **Edges** as the semantic source of truth across syntax, symbol, module, type, and flow layers
- **FTS5** for symbol discovery
- **Hashes** for incremental invalidation and clone analysis

### Parsing

- **tree-sitter WASM** via `web-tree-sitter` and `tree-sitter-wasms`
- Extracts definitions, imports, exports, calls, references, and explicit inheritance syntax
- Feeds a shared pipeline used by both full indexing and watcher-driven reindexing

### File Watching

- **Chokidar** for cross-platform file system events
- Full index and incremental updates share the same indexing pipeline
- On file delete: associated graph state is removed and overlays are rebuilt as needed

## Use Cases

| Scenario | Tool | Example |
|----------|------|---------|
| Find candidate symbols | `search_symbols` | `query: "handleAuth"` |
| Inspect one exact symbol | `get_symbol` | `name: "UserService", file: "src/services/user.ts"` |
| Trace callers/callees/flows | `trace_paths` | `workspace_qualified_name: "...", path_kind: "mixed"` |
| Find semantic usages | `find_references` | `name: "handleAuth", file: "src/auth.ts"` |
| Find implementations | `find_implementations` | `name: "BaseStore", file: "src/store.ts"` |
| Explain ambiguous linking | `explain_resolution` | Same selector as above |
| Codebase overview | `get_architecture` | First call after `index_project` |
| Continuous sync | `watch_project` | Start once, graph stays current |
| Detect duplicates | `find_clones` | `path: "/project", type: "near_miss"` |
| Find risky code | `find_hotspots` | `path: "/project", min_callers: 3` |
| Find dead exports | `find_unused_exports` | `path: "/project"` |

## Benchmark

`hex-graph-mcp` now distinguishes:

- `tests` — correctness and regression safety
- `evals` — semantic quality on curated fixtures
- `benchmarks` — comparative workflow efficiency against built-in tools
- `diagnostics` — atomic query and latency inspection

Public benchmark mode reports only comparative workflow scenarios:

```bash
npm run benchmark -- --repo /path/to/repo
```

Optional diagnostics stay available separately:

```bash
npm run benchmark:diagnostic -- --repo /path/to/repo
```

Current sample run on the `hex-graph-mcp` repo with session-derived workflows:

| ID | Workflow | Built-in | hex-graph | Savings | Ops | Steps |
|----|----------|---------:|----------:|--------:|----:|------:|
| W1 | Explore unfamiliar MCP before refactor | 93,361 chars | 16,081 chars | 83% | 12→3 | 12→3 |
| W2 | Estimate blast radius before refactor | 106,117 chars | 49,674 chars | 53% | 7→3 | 5→3 |
| W3 | Audit cycles, dead exports, hotspots | 61,754 chars | 4,184 chars | 93% | 22→4 | 22→4 |
| W4 | Review PR semantic risk snapshot | 51,390 chars | 44,474 chars | 13% | 3→2 | 4→2 |

Workflow summary: `61%` average token savings, `44→12` ops, `43→12` steps.

The workflow benchmark focuses on graph-native developer tasks derived from recent real sessions:

- exploring an unfamiliar MCP before refactoring
- estimating semantic blast radius before a risky change
- auditing cycles, dead exports, hotspots, and module metrics
- reviewing PR risk through references and trace paths

Atomic query comparisons and index-cost output still live under `benchmark/`, but they are diagnostics only and should not be used as headline benchmark claims.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `better-sqlite3` | SQLite storage engine |
| `web-tree-sitter` + `tree-sitter-wasms` | AST parsing |
| `chokidar` | File system watcher |
| `picomatch` | Scope/glob matching |
| `zod` | Input schema validation |

Requires Node.js >= 20.0.0.

## FAQ

<details>
<summary><b>How large a codebase can it handle?</b></summary>

It is designed for local-to-mid-sized repositories and monorepo slices where deterministic indexing and fast requery matter more than cloud-scale storage. Incremental updates are hash-aware and avoid full reindex when possible.

</details>

<details>
<summary><b>Does it support monorepos?</b></summary>

Yes. Point `index_project` at the monorepo root or at a package subtree. Use `get_architecture`, `get_module_metrics`, and `scope` filters to focus analysis.

</details>

<details>
<summary><b>Where is the database stored?</b></summary>

The graph database is stored under the indexed project at `.hex-skills/codegraph/index.db`. It is rebuildable cache state and should not be committed.

</details>

<details>
<summary><b>Does watch_project survive server restarts?</b></summary>

No. The watcher runs in-process and must be started again after the MCP server restarts.

</details>

## Hex Family

| Package | Purpose | npm |
|---------|---------|-----|
| [hex-line-mcp](https://www.npmjs.com/package/@levnikolaevich/hex-line-mcp) | Local file editing with hash verification + hooks | [![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-line-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-line-mcp) |
| [hex-ssh-mcp](https://www.npmjs.com/package/@levnikolaevich/hex-ssh-mcp) | Remote file editing over SSH | [![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-ssh-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-ssh-mcp) |
| [hex-graph-mcp](https://www.npmjs.com/package/@levnikolaevich/hex-graph-mcp) | Layered code graph with AST indexing, clones, references, and architecture analysis | [![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-graph-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-graph-mcp) |

## License

MIT
