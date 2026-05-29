# supabase

Supabase management skill for persistent data operations, SQL execution, schema changes, storage setup, and related admin workflows.

## What It Is

This skill wraps the Supabase management API behind a small shell script so an agent can run SQL or apply SQL files against a Supabase project. It is intended for tasks like querying data, creating or altering tables, defining policies, managing storage metadata, and handling other persistent-data work.

Because it uses management API access, treat it like admin-level database access.

## Requirements

- `bash`, `curl`, and `jq`
- A Supabase project URL
- A Supabase personal access token with management API access

## Setup

Environments are stored as named entries in a single JSON file,
`skills/supabase/environments.json` (gitignored), and managed with the
`env` subcommands of `skills/supabase/scripts/supabase.sh`.

Add one environment per Supabase project you work with:

```bash
cd skills/supabase

# URL is required; access token + description are optional
scripts/supabase.sh env add dev \
  --url https://<dev-ref>.supabase.co \
  --access-token sbp_<management_api_token>

scripts/supabase.sh env add prod \
  --url https://<prod-ref>.supabase.co \
  --access-token sbp_<management_api_token> \
  --description "Production project"

scripts/supabase.sh env list
```

Generate a management API token at
<https://supabase.com/dashboard/account/tokens>. Treat it as admin-level: it can
run arbitrary SQL against the project, so scope and store it accordingly.

Each environment holds:

```json
{
  "name": "dev",
  "description": "Development project",
  "url": "https://<project-ref>.supabase.co",
  "access_token": "sbp_<management_api_token>"
}
```

`environments.json` is gitignored and `chmod 600` is applied automatically, since
it may hold tokens. A copyable template lives at
`skills/supabase/environments.example.json`. The access token is a secret: if an
environment omits it, the script falls back to the shell `SUPABASE_ACCESS_TOKEN`,
so you can keep tokens out of the file and export them instead.

Manage environments:

```bash
scripts/supabase.sh env list                    # show all envs (tokens masked)
scripts/supabase.sh env add <name> --url ...     # add a new env
scripts/supabase.sh env update <name> --url ...  # change fields on an env
scripts/supabase.sh env remove <name>            # delete an env (blocked on the last one)
scripts/supabase.sh env get <name>               # inspect one env
scripts/supabase.sh env check                    # verify at least one env exists
```

Env resolution order when running a command:

1. `--env <name>` selects that environment from `environments.json`.
2. Else if `SUPABASE_URL` and `SUPABASE_ACCESS_TOKEN` are already exported, they are used.
3. Else if exactly one environment is configured, it is auto-selected (`--env` optional).
4. Else (multiple envs, none named) the script errors and asks for `--env <name>`.

## How To Use It

Run raw SQL:

```bash
# --env is optional only when exactly one env is configured
skills/supabase/scripts/supabase.sh sql "SELECT * FROM users LIMIT 5"
skills/supabase/scripts/supabase.sh sql --env dev  "SELECT * FROM users LIMIT 5"
skills/supabase/scripts/supabase.sh sql --env prod "SELECT * FROM users LIMIT 5"
```

Run SQL from a file:

```bash
skills/supabase/scripts/supabase.sh sql-file ./migrations/001_init.sql
skills/supabase/scripts/supabase.sh sql-file --env dev ./migrations/001_init.sql
```

## Common Uses

- Querying or debugging production-like data
- Creating tables, views, functions, triggers, and extensions
- Managing RLS policies
- Managing storage bucket metadata
- Applying migrations from SQL files

## Example Prompts

```text
Use the supabase skill to add a new table for invoice_exports and create the required RLS policies.
```

```text
Use the supabase skill to inspect the public schema and show me the columns on the users table.
```

## Notes

- `skills/supabase/references/sql-cookbook.md` contains a larger command reference with examples for DDL, RLS, storage, and introspection.
- Environments are managed with `skills/supabase/scripts/supabase.sh env ...` and stored in `environments.json`.
- The script derives the Supabase project ref from each environment's `url`.
- Keep tokens out of committed files; `environments.json` is gitignored and `chmod 600`.
