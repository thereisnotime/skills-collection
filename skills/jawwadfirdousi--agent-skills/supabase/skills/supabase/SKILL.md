---
name: supabase
description: "Run Supabase Management API SQL for persistent data tasks such as querying records, applying schema changes, managing policies, and handling storage metadata. Use when requests involve Supabase database CRUD, migrations, or production-like data inspection."
compatibility: Requires bash, curl, and jq, plus network access to the Supabase management API.
metadata:
  author: jawwadfirdousi
  version: "1.0"
  priority: critical
---

# Supabase

Run SQL against a Supabase project through the management API: querying data,
schema changes (DDL), policies (RLS), storage metadata, and migrations. SQL runs
with management API privileges, so treat it as admin-level database access.

Everything goes through one script, `scripts/supabase.sh`, with three commands:

- `env` — manage connection environments (stored in `environments.json`)
- `sql` — run a SQL string
- `sql-file` — run SQL from a file

## Environments

Each environment is a named entry in `environments.json` (gitignored, `chmod 600`)
holding a `url` and an optional `access_token`. Manage them with the `env`
subcommands:

```bash
# List configured envs (tokens masked)
scripts/supabase.sh env list

# Add an env (--url required; --access-token and --description optional)
scripts/supabase.sh env add dev  --url https://<dev-ref>.supabase.co  --access-token sbp_...
scripts/supabase.sh env add prod --url https://<prod-ref>.supabase.co --description "Production"

# Update one or more fields on an existing env
scripts/supabase.sh env update dev --url https://<new-ref>.supabase.co --access-token sbp_...

# Inspect one env: human (default), json, or shell export
scripts/supabase.sh env get dev
scripts/supabase.sh env get dev --format json
scripts/supabase.sh env get dev --format export

# Remove an env (refused if it is the only one)
scripts/supabase.sh env remove prod

# Verify at least one env is configured (non-zero exit otherwise)
scripts/supabase.sh env check
```

Rules the script enforces:

- `env add` requires `--url`; the env name must be unique.
- `env remove` is refused on the last remaining env.
- The access token is a secret. If an env has none stored, the shell
  `SUPABASE_ACCESS_TOKEN` is used instead.
- `environments.json` is read from the skill root, or
  `~/.config/claude/supabase-environments.json` if that is where it already exists.

If the script reports `no environments configured` or `SUPABASE_URL not set`, the
user has not finished setup: run `env add` to create the first env, or point them
at [the README](../../README.md).

## Selecting an environment

Pick the environment per command with `--env <name>`. Resolution order:

```
1) --env <name> set            -> use that env from environments.json
2) SUPABASE_URL + TOKEN exported -> use those exported values
3) exactly one env configured  -> use it (--env optional)
4) multiple envs, none named   -> error: pass --env <name>
```

When the user names an environment ("in prod", "on dev"), pass `--env <name>`. If
multiple envs exist and the user did not name one, ask which to use before running.

## Running SQL

```bash
# Run a SQL string
scripts/supabase.sh sql --env dev "SELECT * FROM users LIMIT 5"
scripts/supabase.sh sql --env prod "SELECT count(*) FROM users"
scripts/supabase.sh sql --env dev "INSERT INTO users (name, email) VALUES ('Alice', 'alice@test.com')"

# Run SQL from a file (prefer for long or multi-statement SQL)
scripts/supabase.sh sql-file --env dev ./migrations/001_init.sql
```

- Quote the SQL. Escape inner double quotes (e.g. policy names: `\"items_read_own\"`).
- `sql` sends the whole string as one query, so multiple `;`-separated statements
  run together.
- SQL that contains `$` — dollar-quoted function/trigger bodies (`$$ … $$`) or
  positional params (`$1`) — must go through `sql-file`. In a double-quoted `sql`
  argument the shell expands `$$` (to its PID) and `$1`, corrupting the statement.
  File contents are sent literally, so `sql-file` is safe.

### Reading the output

Output is the raw management API JSON, piped through `jq`:

- A successful query returns its result as JSON (an array of row objects for
  `SELECT`).
- A rejected query returns an object with a `message` field, e.g.
  `{"message": "syntax error at or near ..."}`. Detect failure by checking for a
  lone `message` key — the HTTP call (and exit code) usually still succeeds even
  when the SQL is rejected.

## Safety

These commands run with management API (admin) privileges, so a bad statement can
drop data or break a live project. Before running:

- **Confirm destructive statements with the user** — `DROP`, `TRUNCATE`, and any
  `DELETE`/`UPDATE` without a `WHERE` clause — especially against a production env.
- **Confirm the target env for writes.** If multiple envs are configured and the
  request is a write or DDL, verify which env (`--env <name>`) before running; do
  not let a write fall back to an auto-selected env.
- **Explore read-only first.** Prefer a `SELECT ... LIMIT` to inspect data and
  schema before mutating it.
- **Make migrations atomic.** Wrap multi-step changes in `BEGIN; ... COMMIT;` (via
  `sql-file`) so a mid-way failure rolls back. Note `CREATE INDEX CONCURRENTLY`
  cannot run inside a transaction — run it as a standalone statement.
- **Make migrations re-runnable.** Prefer `CREATE TABLE IF NOT EXISTS`,
  `CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`, and `DROP ... IF EXISTS`.

## SQL reference

For ready-made examples covering DDL, indexes, enum types, views, functions/RPC,
triggers, RLS, data patterns (upsert, JSONB), pgvector similarity search, storage,
and schema introspection, see [references/sql-cookbook.md](references/sql-cookbook.md).
