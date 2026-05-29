# Supabase SQL Cookbook

Reference SQL for the skill's runner:

```bash
scripts/supabase.sh sql "<SQL>"
scripts/supabase.sh sql --env <name> "<SQL>"
scripts/supabase.sh sql-file --env <name> <path>
```

All statements run through the management API with admin-level privileges. See the
Safety section of `../SKILL.md` before running destructive or production changes.

> **Dollar-quoting (`$$`) and `$1` params:** in a double-quoted `sql` argument the
> shell expands `$$` (to its PID) and `$1`, which corrupts the statement. Put any
> SQL using dollar-quoted bodies (functions, triggers, `DO` blocks) or positional
> params in a file and run it with `sql-file` — file contents are sent literally.

## DDL (schema changes)

```bash
# Create table (idempotent)
scripts/supabase.sh sql "CREATE TABLE IF NOT EXISTS public.items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);"

# Alter table
scripts/supabase.sh sql "ALTER TABLE public.items ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();"

# Drop table
scripts/supabase.sh sql "DROP TABLE IF EXISTS public.items;"

# Enable extension
scripts/supabase.sh sql "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Indexes

```bash
# B-tree index (idempotent)
scripts/supabase.sh sql "CREATE INDEX IF NOT EXISTS items_name_idx ON public.items (name);"

# CONCURRENTLY avoids locking writes, but cannot run inside a transaction block —
# run it as a single standalone statement, never bundled with other statements.
scripts/supabase.sh sql "CREATE INDEX CONCURRENTLY IF NOT EXISTS items_created_at_idx ON public.items (created_at);"
```

## Enum / custom types

```bash
scripts/supabase.sh sql "CREATE TYPE public.order_status AS ENUM ('pending', 'paid', 'shipped', 'cancelled');"
scripts/supabase.sh sql "ALTER TABLE public.orders ADD COLUMN status public.order_status NOT NULL DEFAULT 'pending';"

# Add a value to an existing enum
scripts/supabase.sh sql "ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'refunded';"
```

## Views

```bash
scripts/supabase.sh sql "CREATE OR REPLACE VIEW public.active_items AS SELECT * FROM public.items WHERE deleted_at IS NULL;"
```

## Functions / RPC

Dollar-quoted bodies (`$$`) break when passed as a double-quoted `sql` argument, so
use `sql-file`:

```sql
-- ping.sql
CREATE OR REPLACE FUNCTION public.ping() RETURNS text LANGUAGE sql AS $$
  SELECT 'ok'::text;
$$;

GRANT EXECUTE ON FUNCTION public.ping() TO authenticated;
```

```bash
scripts/supabase.sh sql-file --env dev ping.sql
```

## Triggers

```sql
-- updated_at_trigger.sql
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER items_set_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

```bash
scripts/supabase.sh sql-file --env dev updated_at_trigger.sql
```

## RLS (Row Level Security)

```bash
# Enable RLS
scripts/supabase.sh sql "ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;"

# Example policy (owners can read)
scripts/supabase.sh sql "CREATE POLICY \"items_read_own\" ON public.items FOR SELECT TO authenticated USING (owner_id = auth.uid());"

# Example policy (owners can write)
scripts/supabase.sh sql "CREATE POLICY \"items_write_own\" ON public.items FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());"
```

## Data patterns (upsert, JSONB)

```bash
# Upsert: insert or update on conflict
scripts/supabase.sh sql "INSERT INTO public.users (email, name) VALUES ('alice@test.com', 'Alice') ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name;"

# Insert multiple rows at once
scripts/supabase.sh sql "INSERT INTO public.items (name) VALUES ('a'), ('b'), ('c');"

# Query into a JSONB column (->> extracts text; @> tests containment)
scripts/supabase.sh sql "SELECT id, metadata->>'plan' AS plan FROM public.accounts WHERE metadata @> '{\"active\": true}';"

# Update a key inside a JSONB column
scripts/supabase.sh sql "UPDATE public.accounts SET metadata = jsonb_set(metadata, '{plan}', '\"pro\"') WHERE id = '123';"
```

## pgvector (embeddings + similarity search)

```bash
# Enable the extension
scripts/supabase.sh sql "CREATE EXTENSION IF NOT EXISTS vector;"

# Table with an embedding column (1536 dims, e.g. OpenAI text-embedding-3-small)
scripts/supabase.sh sql "CREATE TABLE IF NOT EXISTS public.documents (id bigserial PRIMARY KEY, content text, embedding vector(1536));"

# Approximate-nearest-neighbour index for cosine distance
scripts/supabase.sh sql "CREATE INDEX IF NOT EXISTS documents_embedding_idx ON public.documents USING hnsw (embedding vector_cosine_ops);"

# Similarity search with cosine distance (<=>). The literal vector must match the
# column's dimensionality; shown truncated here.
scripts/supabase.sh sql "SELECT id, content, embedding <=> '[0.1,0.2,0.3]'::vector AS distance FROM public.documents ORDER BY distance LIMIT 5;"
```

For a parameterized search (`match_documents(query_embedding vector, ...)` taking
`$1`), put the function in a file and use `sql-file` — `$1` would otherwise be
expanded by the shell.

## Storage Buckets (metadata only; file upload uses Storage API)

```bash
# Create bucket
scripts/supabase.sh sql "INSERT INTO storage.buckets (id, name, public) VALUES ('payment-proofs', 'payment-proofs', false);"

# Toggle public
scripts/supabase.sh sql "UPDATE storage.buckets SET public = true WHERE id = 'payment-proofs';"

# Delete bucket metadata (does not delete files)
scripts/supabase.sh sql "DELETE FROM storage.buckets WHERE id = 'payment-proofs';"
```

## Storage RLS Policies

```bash
# Enable RLS (if not already enabled)
scripts/supabase.sh sql "ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;"

# Allow authenticated users to read from a specific bucket
scripts/supabase.sh sql "CREATE POLICY \"read_payment_proofs\" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'payment-proofs');"

# Allow authenticated users to upload to a specific bucket
scripts/supabase.sh sql "CREATE POLICY \"write_payment_proofs\" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'payment-proofs');"
```

## Introspection / Debugging

```bash
# List public tables
scripts/supabase.sh sql "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"

# List columns for a table
scripts/supabase.sh sql "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' ORDER BY ordinal_position;"

# Show policies
scripts/supabase.sh sql "SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check FROM pg_policies ORDER BY schemaname, tablename, policyname;"

# Recent auth users (Supabase Auth schema)
scripts/supabase.sh sql "SELECT id, email, created_at, last_sign_in_at FROM auth.users ORDER BY created_at DESC LIMIT 20;"
```
