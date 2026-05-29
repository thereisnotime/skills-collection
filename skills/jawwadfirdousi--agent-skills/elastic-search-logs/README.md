# elastic-search-logs

Query and analyze application logs in Elasticsearch with focused `curl` queries.

## What this skill covers

- Search logs with `_search`
- Filter by `trace.id`, log level, time range, and field values
- Reduce payloads with `_source` and `filter_path`
- Use secondary endpoints like `_count`, `_mapping`, `_stats`, and `_cat/indices`

## Requirements

- `curl`, `python3` (stdlib only)
- Elasticsearch credentials available via either:
  - Shell env vars `ES_USERNAME` / `ES_PASSWORD`, or
  - Per-env overrides stored in `environments.json` (set via `scripts/envs.py`)
- At least one configured environment in `environments.json` (see Setup)

## Setup

The skill stores per-environment settings (URL, index pattern, optional credentials)
in `skills/elastic-search-logs/environments.json` and manages them via the
`scripts/envs.py` CLI. **At least one environment must be configured.**

```bash
# From skills/elastic-search-logs/
python3 scripts/envs.py add dev  --url https://es-dev.example.com:9243
python3 scripts/envs.py add rc   --url https://es-rc.example.com:9243
python3 scripts/envs.py add prod --url https://es-prod.example.com:9243 \
  --description "Production cluster"

# Update later
python3 scripts/envs.py update dev --url https://es-dev-new.example.com:9243

# Remove (blocked on the last env)
python3 scripts/envs.py remove rc

# Inspect
python3 scripts/envs.py list
python3 scripts/envs.py get dev
```

Credentials can stay in your shell:

```bash
export ES_USERNAME="your-username"
export ES_PASSWORD="your-password"
```

Or be stored per-env (when dev/rc/prod use different creds):

```bash
python3 scripts/envs.py update prod --username myuser --password 'sekret'
```

`environments.json` is gitignored and `chmod 600` is applied automatically.
See `environments.example.json` for a starting point.

## How to use it

When invoking through an agent, ask which environment to query if the user
didn't specify one and multiple envs exist. The agent loads the chosen env
before each query with:

```bash
eval "$(python3 scripts/envs.py get dev --format export)" \
  && curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
       -u "$ES_USERNAME:$ES_PASSWORD" \
       -H "Content-Type: application/json" \
       -d '{ "query": { "match_all": {} }, "size": 5 }'
```

Example prompts:

```text
Use elasticsearch skill to find all ERROR logs in dev in the last 1 hour for service payments.
```

```text
Use elasticsearch skill in prod to trace request flow for trace.id YOUR_TRACE_ID and show only timestamp, message, and status code.
```

```text
Add a new staging env to elasticsearch skill with URL https://es-staging.example.com:9243.
```

## Command examples

Basic search:

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "match_all": {} },
    "size": 10,
    "sort": [{ "@timestamp": "desc" }]
  }'
```

Search by trace ID with selected fields:

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search?filter_path=hits.hits._source" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "term": { "trace.id": "YOUR_TRACE_ID" } },
    "_source": [
      "@timestamp",
      "message",
      "appPayload.res.statusCode"
    ],
    "size": 100,
    "sort": [{ "@timestamp": "desc" }]
  }'
```

Count matches:

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_count" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "term": { "trace.id": "YOUR_TRACE_ID" } }
  }'
```

View mappings:

```bash
curl -X GET "$ES_BASE_URL/$ES_INDEX_PATTERN/_mapping" \
  -u "$ES_USERNAME:$ES_PASSWORD"
```

## Notes

- `skills/elastic-search-logs/SKILL.md` contains the full query cookbook, field-path reference, and troubleshooting checklist.
- Keep credentials out of git and shell history where possible.
