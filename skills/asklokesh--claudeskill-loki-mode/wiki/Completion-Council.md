# Completion Council

Multi-agent definition-of-done system for autonomous session completion (v5.25.0).

---

## Overview

The Completion Council is a 3-member voting system that determines when a Loki Mode session has achieved its objectives. Instead of relying on a single agent's judgment, the council uses majority voting with anti-sycophancy protections to make robust completion decisions.

### Key Features

- **3-member council** with 2/3 majority required for completion
- **Anti-sycophancy** devil's advocate triggered on unanimous votes
- **Convergence detection** via git diff hash tracking between iterations
- **Circuit breaker** after 5 consecutive no-progress iterations
- **Dashboard integration** with real-time vote visualization

---

## How It Works

### Voting Process

1. Every N iterations (configurable via `LOKI_COUNCIL_CHECK_INTERVAL`), the council convenes
2. Each of the 3 council members independently evaluates whether the session objectives are met
3. Votes are tallied -- 2 out of 3 votes are required for a "complete" decision
4. If all 3 members vote unanimously for completion, a devil's advocate review is triggered to prevent premature completion

### Convergence Detection

The council tracks git diff hashes between iterations to detect stagnation:

- If the codebase stops changing across iterations, the convergence tracker flags it
- After `LOKI_COUNCIL_STAGNATION_LIMIT` consecutive iterations with no git changes, a circuit breaker triggers and forces session completion
- This prevents infinite loops where the AI is not making meaningful progress

### Anti-Sycophancy

When all council members agree unanimously, Loki Mode triggers a devil's advocate review:

- A separate review pass challenges the completion decision
- This guards against all members being overly optimistic
- The devil's advocate can override the unanimous vote if issues are found

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOKI_COUNCIL_ENABLED` | `true` | Enable completion council |
| `LOKI_COUNCIL_SIZE` | `3` | Number of council members |
| `LOKI_COUNCIL_THRESHOLD` | `2` | Votes needed for completion |
| `LOKI_COUNCIL_CHECK_INTERVAL` | `5` | Check every N iterations |
| `LOKI_COUNCIL_MIN_ITERATIONS` | `3` | Minimum iterations before council runs |
| `LOKI_COUNCIL_CONVERGENCE_WINDOW` | `3` | Iterations to track for convergence |
| `LOKI_COUNCIL_STAGNATION_LIMIT` | `5` | Max iterations with no git changes |

### Config File

```yaml
# .loki/config.yaml
completion:
  council:
    enabled: true
    size: 3
    threshold: 2
    check_interval: 5
    min_iterations: 3
    stagnation_limit: 5
```

### Examples

```bash
# Disable council (use simple completion detection)
export LOKI_COUNCIL_ENABLED=false

# More aggressive completion detection
export LOKI_COUNCIL_CHECK_INTERVAL=3
export LOKI_COUNCIL_STAGNATION_LIMIT=3

# Require unanimous vote (all 3 members)
export LOKI_COUNCIL_THRESHOLD=3
```

---

## CLI Commands

```bash
# Check council status
loki council status

# View vote history (decision log)
loki council verdicts

# View convergence data
loki council convergence

# Force an immediate council review
loki council force-review

# View the final completion report
loki council report

# Show council configuration
loki council config

# Show help
loki council help
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/council/state` | Current council state |
| GET | `/api/council/verdicts` | Vote history |
| GET | `/api/council/convergence` | Convergence tracking data |
| GET | `/api/council/report` | Final completion report |
| POST | `/api/council/force-review` | Trigger immediate review |

See [[API Reference]] for detailed endpoint documentation.

---

## Dashboard Tab

The Completion Council has a dedicated tab in the dashboard with four views:

| View | Description |
|------|-------------|
| **Overview** | Current council state -- enabled status, total votes, latest verdict |
| **Decision Log** | Chronological history of council verdicts with vote breakdowns |
| **Convergence** | Chart showing git diff hash changes over iterations |
| **Agents** | Active agent list with pause, resume, and kill controls |

---

## State Files

Council state is stored in `.loki/council/`:

| File | Description |
|------|-------------|
| `state.json` | Current council state and configuration |
| `convergence.log` | Git diff hash history for convergence detection |
| `votes/` | Individual vote records per iteration |
| `report.md` | Final completion report (written when session ends) |

---

## See Also

- [[Architecture]] - Council architecture diagram
- [[API Reference]] - Council API endpoints
- [[CLI Reference]] - Council CLI commands
- [[Dashboard]] - Council dashboard tab
- [[Configuration]] - Council configuration options
