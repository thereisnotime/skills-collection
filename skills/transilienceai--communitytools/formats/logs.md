# Output Type: Logs

All execution and activity logs in NDJSON format.

## Structure

```
logs/
├── pentester-coordinator.log      # Coordinator decisions (NDJSON)
├── {executor-name}.log            # Per-executor activity logs (NDJSON)
└── activity/                      # Alternative location
    └── *.log
```

## NDJSON Format

Each line is a standalone JSON object:

```json
{"timestamp": "2024-01-15T10:30:00Z", "level": "info", "agent": "coordinator", "action": "spawn_executor", "target": "sqli-search", "mission_id": "m-001"}
{"timestamp": "2024-01-15T10:30:05Z", "level": "info", "agent": "sqli-executor", "action": "test_payload", "endpoint": "/search", "result": "vulnerable"}
{"timestamp": "2024-01-15T10:31:00Z", "level": "info", "agent": "coordinator", "action": "spawn_validator", "finding_id": "F-001"}
```

## Rules

- One log file per coordinator
- One log file per executor (named after the executor)
- All logs use NDJSON format (one JSON object per line)
- Include `timestamp`, `level`, `agent`, and `action` fields minimum

## experiments.md Format

Append-only markdown table at `{OUTPUT_DIR}/experiments.md`.

```markdown
# Experiments
| # | Batch | Technique | Target | Parameters | Result | Notes |
|---|-------|-----------|--------|------------|--------|-------|
| E-001 | B1 | nmap-full | 10.10.11.42 | -sC -sV -p- | done | 80,443 open |
```

**Columns**: #=sequential ID, Batch=coordinator batch, Technique=attack class, Target=endpoint/host, Parameters=key params, Result=pending/done/success/fail, Notes=one-liner summary.

**Rules**:
- Coordinator creates header at P1, appends rows at P2 with result=pending
- Executor updates its row on completion (result + notes)
- Never prune, never rewrite existing rows
- Same technique + target = skip unless parameters differ

## tools/ Format

One file per significant tool invocation at `{OUTPUT_DIR}/tools/`.

**Naming**: `{NNN}_{tool-name}.md` — NNN is zero-padded sequential (001, 002, ...).

**Template**:
```markdown
# {tool-name}
Experiment: E-NNN
Timestamp: ISO-8601

## Input
{exact command}

## Output
{raw output, truncated if > 200 lines}
```

**Rules**:
- Log security-relevant tools only: nmap, curl, sqlmap, ffuf, nuclei, python exploits, etc.
- Skip trivial commands: cd, ls, cat, echo
- Truncate output > 200 lines with `[truncated — N lines total]`
- Link to experiment via `Experiment: E-NNN` header
