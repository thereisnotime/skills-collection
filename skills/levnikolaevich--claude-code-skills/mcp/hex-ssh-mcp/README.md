# hex-ssh-mcp

Token-efficient SSH MCP server with hash-verified remote file editing.

[![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-ssh-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-ssh-mcp)
[![downloads](https://img.shields.io/npm/dm/@levnikolaevich/hex-ssh-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-ssh-mcp)
[![license](https://img.shields.io/npm/l/@levnikolaevich/hex-ssh-mcp)](./LICENSE)
![node](https://img.shields.io/node/v/@levnikolaevich/hex-ssh-mcp)

Every remote file read returns FNV-1a hash-annotated lines and range checksums. Edits verify those checksums before applying changes -- preventing stale-context corruption across SSH boundaries. Command output is normalized and deduplicated for minimal token usage.

## Features

### 6 MCP Tools

| Tool | Description | Key Feature |
|------|-------------|-------------|
| `remote-ssh` | Execute shell commands on remote servers | Disabled by default; normalized output when enabled |
| `ssh-read-lines` | Read remote file with hash-annotated lines | Partial reads via `startLine`/`endLine`/`maxLines` |
| `ssh-edit-block` | Hash-verified anchor edits in remote files | Checksum verification + compact diff output |
| `ssh-search-code` | Search remote files with grep | Deduplicated results with `(xN)` counts |
| `ssh-write-chunk` | Write or append to remote files | Rewrite is atomic; append is direct |
| `ssh-verify` | Check if held checksums are still valid | Single-line response avoids full re-read |

### Output Normalization

Built into `remote-ssh` and `ssh-search-code`. Pipeline:

1. **Normalize** -- replaces UUIDs, timestamps, IPs, hex IDs, large numbers with placeholders
2. **Deduplicate** -- collapses identical normalized lines with `(xN)` counts
3. **Truncate** -- keeps first 40 + last 20 lines, omits the middle

## Install

```bash
npm i -g @levnikolaevich/hex-ssh-mcp
claude mcp add -s user hex-ssh -e ALLOWED_HOSTS=server1,server2 -- hex-ssh-mcp
```

Requires Node.js >= 18.0.0.

## Supported Remote Targets

Linux/POSIX hosts with standard coreutils (grep, sed, wc, base64).


## SSH Config Support

hex-ssh automatically reads `~/.ssh/config` to resolve host aliases, usernames, ports, and identity files. Just use your SSH alias:

```
host: "contabo"  // resolves HostName, User, Port, IdentityFile from config
```

### Resolution Priority

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | Explicit tool args | `user: "admin"` overrides config |
| 2 | `~/.ssh/config` | `Host contabo` block |
| 3 | ENV vars | `SSH_PRIVATE_KEY` |
| 4 (lowest) | Defaults | port 22, `~/.ssh/id_*` |

### Connection Reuse

Connections are pooled and reused across tool calls to the same host with the same auth identity. Idle connections close after 60 seconds. Max 10 pooled connections.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SSH_CONFIG_PATH` | Override `~/.ssh/config` path |
| `ALLOWED_HOSTS` | Comma-separated resolved hostnames/IPs (not aliases) |

### Unsupported Directives (v1)

`ProxyJump` and `ProxyCommand` return an explicit `UNSUPPORTED_SSH_CONFIG` error. ssh2 does not support native proxy tunneling.

### Multi-Key Auth

When SSH config provides multiple `IdentityFile` entries, hex-ssh tries each key in order (like OpenSSH). If the server rejects a key, the next one is attempted automatically.
## Security

### Host Key Verification

SSH host keys are verified against known fingerprints (fail-closed). Sources checked in order:

1. `ALLOWED_HOST_FINGERPRINTS` env -- comma-separated `SHA256:<base64>` values
2. `~/.ssh/known_hosts` -- parsed, fingerprints computed from stored keys

If neither source has a match, the connection is **rejected**. Override known_hosts path with `KNOWN_HOSTS_PATH` env. Note: v1 supports plain hostname entries only (hashed hostnames and @cert-authority markers are not parsed).

### Shell Escaping

All user-supplied arguments (file paths, patterns, commands) are single-quote escaped before shell interpolation. Null bytes and newlines in arguments are rejected (`UNSAFE_ARG` error).

### Command Policy (remote-ssh)

`remote-ssh` is disabled by default. Modes:

| Mode | Behavior |
|------|----------|
| `disabled` (default) | Reject all `remote-ssh` calls |
| `safe` | Allow commands except blocked dangerous patterns |
| `open` | Allow all commands |

Dangerous patterns are blocked in `safe` mode:

| Pattern | Reason |
|---------|--------|
| `rm -rf /` | Root/home deletion |
| `mkfs` | Filesystem format |
| `dd if=/dev/zero` | Direct disk write |
| Fork bombs | Process exhaustion |
| `> /dev/sd*` | Direct device write |
| `chmod 777` | Removes access restrictions |

Set `REMOTE_SSH_MODE=safe` or `REMOTE_SSH_MODE=open` explicitly to enable the tool.

### Path Canonicalization

All remote paths must be absolute (start with `/`). `..` segments are resolved before validation. Both file paths and `ALLOWED_DIRS` entries are canonicalized symmetrically.

### Exec Timeout

SSH commands are terminated after 120 seconds (`EXEC_TIMEOUT` error).

### Atomic File Writes

File content is base64-encoded for transfer (no shell injection via content).

- `rewrite` uses temp file + rename and is atomic
- `append` writes directly with `>>` and is not atomic

### ALLOWED_HOSTS (recommended)

Comma-separated list of permitted hostnames/IPs. When set, connections to unlisted hosts are rejected.

```
ALLOWED_HOSTS=prod-web,prod-db,10.0.0.5
```

When unset, all hosts are permitted.

### ALLOWED_DIRS (optional)

Comma-separated list of permitted remote directory prefixes. When set, file operations outside these paths are rejected.

```
ALLOWED_DIRS=/home/deploy,/var/www,/etc/nginx
```

When unset, all remote paths are permitted.

### SSH Key Authentication

Key-only authentication (no passwords). Resolution order:

1. `privateKeyPath` tool parameter (explicit per-call)
2. `SSH_PRIVATE_KEY` env var (path or raw key content starting with `-----`)
3. Default paths: `~/.ssh/id_rsa`, `~/.ssh/id_ed25519`, `~/.ssh/id_ecdsa`

Supported key types: RSA, ED25519, ECDSA.

## Tools Reference

### remote-ssh

Execute shell commands on remote servers. Disabled by default; set `REMOTE_SSH_MODE=safe` or `REMOTE_SSH_MODE=open` to enable. Output is normalized and deduplicated when the tool runs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `host` | string | yes | Remote hostname or IP |
| `user` | string | yes | SSH username |
| `command` | string | yes | Shell command to execute |
| `privateKeyPath` | string | no | Path to SSH private key |
| `port` | number | no | SSH port (default: 22) |

### ssh-read-lines

Read remote file with FNV-1a hash-annotated lines and range checksums. Always prefer over `remote-ssh cat` -- returns edit-ready hashes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `host` | string | yes | Remote hostname or IP |
| `user` | string | yes | SSH username |
| `filePath` | string | yes | Path to file on remote server |
| `startLine` | number | no | Start line, 1-based (default: 1) |
| `endLine` | number | no | End line (reads to limit if not set) |
| `maxLines` | number | no | Max lines to read (default: 200) |
| `plain` | boolean | no | Omit hashes, output `lineNum\|content` instead |
| `privateKeyPath` | string | no | Path to SSH private key |
| `port` | number | no | SSH port (default: 22) |

Output format:

```
File: /etc/nginx/nginx.conf (85 lines) [showing 1-50] (35 more below)

ab.1    worker_processes auto;
cd.2    error_log /var/log/nginx/error.log;
...
checksum: 1-50:f7e2a1b0
```

### ssh-edit-block

Edit remote files using hash-verified anchors. Use `ssh-read-lines` first to get hash anchors and checksums.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `host` | string | yes | Remote hostname or IP |
| `user` | string | yes | SSH username |
| `filePath` | string | yes | Path to file on remote server |
| `newText` | string | yes | Replacement text (for anchor/range/insert edits) |
| `anchor` | string | no | Hash anchor `ab.42` to set single line |
| `startAnchor` | string | no | Start hash anchor for range replace |
| `endAnchor` | string | no | End hash anchor for range replace |
| `insertAfter` | string | no | Hash anchor to insert after |
| `checksum` | string | no | Range checksum from `ssh-read-lines` (e.g. `1-50:f7e2a1b0`) |
| `privateKeyPath` | string | no | Path to SSH private key |
| `port` | number | no | SSH port (default: 22) |

Returns a compact diff of applied changes. If checksum is stale, returns an error with the current checksum.

### ssh-search-code

Search remote files with grep. Results are deduplicated (identical normalized lines collapsed with `(xN)` counts).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `host` | string | yes | Remote hostname or IP |
| `user` | string | yes | SSH username |
| `path` | string | yes | Directory to search on remote server |
| `pattern` | string | yes | Text or regex pattern |
| `filePattern` | string | no | Glob filter (e.g. `"*.js"`, `"*.py"`) |
| `ignoreCase` | boolean | no | Case-insensitive search (default: false) |
| `maxResults` | number | no | Max result lines (default: 50) |
| `contextLines` | number | no | Context lines around matches (default: 0) |
| `privateKeyPath` | string | no | Path to SSH private key |
| `port` | number | no | SSH port (default: 22) |

### ssh-write-chunk

Write content to remote files (rewrite or append). Creates parent directories. `rewrite` is atomic via temp file + rename; `append` is non-atomic direct append. For existing files, prefer `ssh-edit-block` (shows diff, verifies hashes).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `host` | string | yes | Remote hostname or IP |
| `user` | string | yes | SSH username |
| `filePath` | string | yes | Path to file on remote server |
| `content` | string | yes | Content to write |
| `mode` | string | no | `"rewrite"` or `"append"` (default: `"rewrite"`) |
| `privateKeyPath` | string | no | Path to SSH private key |
| `port` | number | no | SSH port (default: 22) |

### ssh-verify

Verify range checksums from prior `ssh-read-lines` calls without re-reading full content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `host` | string | yes | Remote hostname or IP |
| `user` | string | yes | SSH username |
| `filePath` | string | yes | Path to file on remote server |
| `checksums` | string | yes | JSON array of checksum strings, e.g. `["1-50:f7e2a1b0"]` |
| `privateKeyPath` | string | no | Path to SSH private key |
| `port` | number | no | SSH port (default: 22) |

Returns a single-line confirmation when all valid, or lists changed ranges with current checksums.

## Output Normalization

The `normalize.mjs` module reduces token waste in command output. Applied automatically by `remote-ssh` and used internally by `ssh-search-code`.

### Measurement Note

The repository currently ships only a normalization diagnostic for `hex-ssh-mcp`, not a public comparative benchmark against built-in tools. That diagnostic measures normalize/deduplicate/truncate efficiency on synthetic command-output fixtures and should not be presented as a real workflow benchmark.

Run it with:

```bash
npm run benchmark:diagnostic
```

Current normalization diagnostic sample:

| ID | Scenario | Input | Output | Savings |
|----|----------|------:|-------:|--------:|
| 1 | Hash annotation overhead | 3,934 chars | 4,526 chars | -15% |
| 2 | Normalize: npm install | 11,219 chars | 2,953 chars | 74% |
| 3 | Normalize: server logs | 19,715 chars | 4,470 chars | 77% |
| 4 | Dedup: grep results | 5,799 chars | 3,199 chars | 45% |
| 5 | Smart truncate: large output | 22,281 chars | 2,717 chars | 88% |

Diagnostic summary: `72%` average reduction (`62,948 → 17,865 chars`).

### Normalization Rules

| Pattern | Replacement | Example |
|---------|-------------|---------|
| UUIDs | `<UUID>` | `550e8400-e29b-41d4-...` -> `<UUID>` |
| Timestamps | `<TS>` | `2026-03-19 14:30:00` -> `<TS>` |
| IP addresses | `<IP>` | `192.168.1.100:8080` -> `<IP>` |
| Hex IDs in paths | `/<ID>` | `/a1b2c3d4e5` -> `/<ID>` |
| Large numbers | `<N>` | `1234567` -> `<N>` |
| Trace IDs | `trace_id=<TRACE>` | `trace_id=f7e2a1b0` -> `trace_id=<TRACE>` |

### Deduplication

Identical lines (after normalization) are collapsed into a single line with `(xN)` count, sorted by frequency descending.

### Smart Truncation

Output exceeding 60 lines (40 head + 20 tail) is truncated with a gap indicator showing the number of omitted lines.

## Architecture

```
hex-ssh-mcp/
  server.mjs          MCP server (stdio transport, 6 tools)
  package.json
  lib/
    ssh-client.mjs    SSH connection, host/path validation, key resolution
    hash.mjs          FNV-1a hashing, 2-char tags, range checksums
    normalize.mjs     Output normalization, deduplication, truncation
```

### Relationship to hex-line-mcp

Both servers share the same FNV-1a hash format and line annotation convention (`tag.lineNum\tcontent`). Checksums from `ssh-read-lines` are structurally identical to those from hex-line's `read_file`.

### Hash Format

```
ab.42    const x = calculateTotal(items);
```

- `ab` -- 2-char FNV-1a tag derived from content (whitespace-normalized)
- `42` -- line number (1-indexed)
- Tab separator, then original content
- Tag alphabet: `abcdefghijklmnopqrstuvwxyz234567` (32 symbols, bitwise selection)

### Range Checksums

```
checksum: 1-50:f7e2a1b0
```

FNV-1a accumulator over all line hashes in the range (little-endian byte feed). Detects changes to any line, even ones not being edited.

## FAQ

<details>
<summary><b>Does it support password authentication?</b></summary>

No. Key-only authentication (RSA, ED25519, ECDSA). This is a security design decision -- passwords in agent prompts are a leak risk. Configure SSH keys via `SSH_PRIVATE_KEY` env var or default paths (~/.ssh/).

</details>

<details>
<summary><b>Can I connect to multiple servers in one session?</b></summary>

Yes. Each tool call specifies `host` and `user` independently. There is no persistent connection -- each call opens a new SSH session. This avoids stale connection issues but adds ~1s overhead per call.

</details>

<details>
<summary><b>How does output normalization differ from hex-line's RTK?</b></summary>

Same concept, different trigger. hex-ssh normalizes inside the `remote-ssh` tool itself (always active). hex-line's RTK is a PostToolUse hook that filters Bash output (only triggers above 50 lines). Both use the same normalization patterns.

</details>

<details>
<summary><b>What if ALLOWED_HOSTS is not set?</b></summary>

All hosts are permitted. Setting `ALLOWED_HOSTS` is recommended for production use -- it restricts which remote servers the agent can connect to, preventing lateral movement if prompts are manipulated.

</details>

## Hex Family

| Package | Purpose | npm |
|---------|---------|-----|
| [hex-line-mcp](https://www.npmjs.com/package/@levnikolaevich/hex-line-mcp) | Local file editing with hash verification + hooks | [![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-line-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-line-mcp) |
| [hex-ssh-mcp](https://www.npmjs.com/package/@levnikolaevich/hex-ssh-mcp) | Remote file editing over SSH | [![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-ssh-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-ssh-mcp) |
| [hex-graph-mcp](https://www.npmjs.com/package/@levnikolaevich/hex-graph-mcp) | Code knowledge graph with AST indexing | [![npm](https://img.shields.io/npm/v/@levnikolaevich/hex-graph-mcp)](https://www.npmjs.com/package/@levnikolaevich/hex-graph-mcp) |

## License

MIT
