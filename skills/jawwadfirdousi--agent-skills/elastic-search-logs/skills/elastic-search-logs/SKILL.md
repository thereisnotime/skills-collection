---
name: elasticsearch
description: Query and analyze logs in Elasticsearch. Use this skill when the user wants to search logs, query log data, count log entries, filter by trace IDs, or analyze application logs stored in Elasticsearch. Common use cases include debugging requests by trace ID, finding error logs, analyzing request patterns, and extracting specific fields from log entries.
---

# Elasticsearch Log Querying

## Overview

This skill provides access to Elasticsearch APIs for querying application logs. Elasticsearch stores structured log data that can be searched, filtered, and analyzed using its REST API.

## Authentication

All curl commands should use `-u "$ES_USERNAME:$ES_PASSWORD"` for authentication.
By default, credentials come from the shell env vars `ES_USERNAME` / `ES_PASSWORD`.
An environment in `environments.json` may override these per-env (see below).

## Environments Configuration

Per-environment settings (URL, index pattern, optional credentials) are stored in
`environments.json` at the skill root and managed via `scripts/envs.py`. At least
one environment must be configured for the skill to work.

If no `environments.json` exists yet, copy `environments.example.json` to
`environments.json` and edit it, or run `add` (below) to create the first env.

### Manage environments

```bash
# List configured envs
python3 scripts/envs.py list

# Add an env (URL required; index pattern, description, creds optional)
python3 scripts/envs.py add dev --url https://es-dev.example.com:9243
python3 scripts/envs.py add prod \
  --url https://es-prod.example.com:9243 \
  --index-pattern app-logs-* \
  --description "Production cluster"

# Update fields on an existing env
python3 scripts/envs.py update dev --url https://es-dev-new.example.com:9243
python3 scripts/envs.py update prod --username myuser --password 'sekret'

# Remove an env (blocked if it's the last one)
python3 scripts/envs.py remove rc

# Get an env (human / json / shell export)
python3 scripts/envs.py get dev
python3 scripts/envs.py get dev --format json
python3 scripts/envs.py get dev --format export

# Verify at least one env exists (exits non-zero otherwise)
python3 scripts/envs.py check
```

`environments.json` is gitignored because it may contain credentials. The script
sets file permissions to `600` automatically on Unix.

## Environment Selection

**IMPORTANT**: Always select an environment before running a query. If the user
hasn't specified one and multiple envs exist, ask which one to use.

Selection flow:

1. If the user named an env (e.g. "find logs in dev ..."), use that env by name.
2. Otherwise, run `python3 scripts/envs.py list` and either:
   - Use the only env if exactly one is configured, or
   - Ask the user: "Which environment should I query?"
3. Load the env's URL and index pattern into the shell before running curl:

```bash
# Load the chosen env and run the query in one shell command.
eval "$(python3 scripts/envs.py get <env-name> --format export)" \
  && curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
       -u "$ES_USERNAME:$ES_PASSWORD" \
       -H "Content-Type: application/json" \
       -d '{ "query": { "match_all": {} }, "size": 5 }'
```

The `--format export` output sets `ES_BASE_URL`, `ES_INDEX_PATTERN`, and (if the
env defines them) `ES_USERNAME` / `ES_PASSWORD`. Per-env credentials override the
shell env vars; otherwise the shell env vars are used.

## Base Configuration

- **Index Pattern**: `app-logs-*` (or `$ES_INDEX_PATTERN`)
- **Method**: POST (recommended) or GET
- **Content-Type**: `application/json`

## Primary Endpoint: `_search` (Most Commonly Used)

The `_search` endpoint is your primary tool for querying logs. Use it for finding specific logs, filtering by fields, and extracting relevant data.

**Note**: The examples below assume `ES_BASE_URL` (and optionally `ES_INDEX_PATTERN`) are already set in the current shell. Load them by prepending each command with `eval "$(python3 scripts/envs.py get <env> --format export)" &&`.

### Basic Search Query

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "match_all": {}
    },
    "size": 10,
    "sort": [
      { "@timestamp": "desc" }
    ]
  }'
```

### Search by Trace ID (Common Use Case)

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "term": {
        "trace.id": "YOUR_TRACE_ID"
      }
    },
    "size": 100,
    "sort": [
      { "@timestamp": "desc" }
    ]
  }'
```

### Search with Specific Fields (Recommended)

To reduce response size and improve readability, specify only the fields you need:

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "term": {
        "trace.id": "YOUR_TRACE_ID"
      }
    },
    "_source": [
      "@timestamp",
      "message",
      "req.url",
      "req.query",
      "kubernetes.container.name",
      "appContext.userId",
      "appPayload.res.statusCode",
      "level"
    ],
    "size": 100,
    "sort": [
      { "@timestamp": "desc" }
    ]
  }'
```

### Filtering Response with URL Parameters

Clean up the response by filtering metadata fields:

```bash
# Add ?filter_path=hits.hits._source to URL to show only _source content
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search?filter_path=hits.hits._source" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "term": {
        "trace.id": "YOUR_TRACE_ID"
      }
    },
    "_source": ["@timestamp", "message"],
    "size": 100,
    "sort": [
      { "@timestamp": "desc" }
    ]
  }'
```

### Search by Log Level

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "match": {
        "level": "DEBUG"
      }
    },
    "size": 100,
    "sort": [
      { "@timestamp": "desc" }
    ]
  }'
```

### Search with Multiple Filters

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "bool": {
        "must": [
          { "term": { "trace.id": "YOUR_TRACE_ID" }},
          { "match": { "level": "ERROR" }}
        ]
      }
    },
    "size": 100,
    "sort": [
      { "@timestamp": "desc" }
    ]
  }'
```

### Time Range Filtering

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "bool": {
        "must": [
          { "match": { "level": "ERROR" }},
          { "range": { "@timestamp": { "gte": "now-1h" }}}
        ]
      }
    },
    "size": 100,
    "sort": [
      { "@timestamp": "desc" }
    ]
  }'
```

### Common Field Paths

Here are frequently queried fields in the log structure:

| Field Path | Description |
|------------|-------------|
| `@timestamp` | Log timestamp |
| `message` | Log message content |
| `level` | Log level (info, debug, error, warning) |
| `trace.id` | Distributed trace identifier |
| `span.id` | Span identifier within a trace |
| `req.url` | Request URL |
| `req.method` | HTTP method |
| `req.query` | Query parameters |
| `req.headers.*` | Request headers |
| `appContext.userId` | App-specific user ID (example) |
| `appContext.requestId` | App-specific request correlation ID (example) |
| `appPayload.res.statusCode` | Response status code |
| `kubernetes.container.name` | Container/service name |
| `kubernetes.pod.name` | Kubernetes pod name |
| `hostname` | Service hostname |

---

## Secondary Endpoints (Less Common)

**Note**: Replace `ES_BASE_URL` with your selected environment endpoint.

### `_count` - Count Matching Documents

Faster than `_search` when you only need the count, not the actual documents.

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_count" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "term": {
        "trace.id": "YOUR_TRACE_ID"
      }
    }
  }'
```

Response:
```json
{
  "count": 8,
  "_shards": {
    "total": 18,
    "successful": 18,
    "skipped": 2,
    "failed": 0
  }
}
```

### `_mapping` - View Index Structure

View the field types and structure of your log indices.

```bash
curl -X GET "$ES_BASE_URL/$ES_INDEX_PATTERN/_mapping" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json"
```

Use this to discover available fields and their types.

### `_msearch` - Multiple Searches in One Request

Execute multiple search queries in a single HTTP request.

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_msearch" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/x-ndjson" \
  -d '
{}
{"query": {"match": {"level": "ERROR"}}, "size": 10}
{}
{"query": {"match": {"level": "WARNING"}}, "size": 10}
'
```

### `_scroll` - Paginate Through Large Result Sets

For retrieving more than 10,000 documents, use scroll API.

```bash
# Initial request with scroll parameter
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search?scroll=1m" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "match_all": {}
    },
    "size": 1000
  }'

# Subsequent requests using scroll_id from previous response
curl -X POST "$ES_BASE_URL/_search/scroll" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "scroll": "1m",
    "scroll_id": "SCROLL_ID_FROM_PREVIOUS_RESPONSE"
  }'
```

### `/_cat/indices` - List All Indices

View all available indices in the cluster.

```bash
curl -X GET "$ES_BASE_URL/_cat/indices?v" \
  -u "$ES_USERNAME:$ES_PASSWORD"
```

### `/_stats` - Index Statistics

Get statistics about index size, document count, etc.

```bash
curl -X GET "$ES_BASE_URL/$ES_INDEX_PATTERN/_stats" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json"
```

---

## Query Types Reference

### Exact Match (term)

Use for exact matching on keyword fields (IDs, enums, etc.):

```json
{
  "query": {
    "term": {
      "trace.id": "YOUR_TRACE_ID"
    }
  }
}
```

### Text Search (match)

Use for full-text search on analyzed text fields:

```json
{
  "query": {
    "match": {
      "message": "error occurred"
    }
  }
}
```

### Multiple Conditions (bool)

Combine multiple queries:

```json
{
  "query": {
    "bool": {
      "must": [
        { "term": { "trace.id": "YOUR_TRACE_ID" }},
        { "match": { "level": "ERROR" }}
      ],
      "should": [
        { "match": { "message": "timeout" }}
      ],
      "must_not": [
        { "term": { "kubernetes.container.name": "test-service" }}
      ]
    }
  }
}
```

### Range Queries

Filter by numeric or date ranges:

```json
{
  "query": {
    "range": {
      "@timestamp": {
        "gte": "now-1h",
        "lte": "now"
      }
    }
  }
}
```

### Exists Check

Find documents where a field exists:

```json
{
  "query": {
    "exists": {
      "field": "appPayload.res.statusCode"
    }
  }
}
```

---

## Best Practices

1. **Always use environment variables** for credentials - never hardcode
2. **Use `_source` filtering** to request only needed fields
3. **Set appropriate `size` limits** (default is 10, max is 10000)
4. **Use `term` for exact matches** on IDs and keywords
5. **Use `match` for text search** on message fields
6. **Sort by `@timestamp`** for chronological ordering
7. **Use `filter_path` URL parameter** to reduce response verbosity
8. **Prefer POST over GET** for search requests with body
9. **Use `_count` instead of `_search`** when only the count is needed
10. **Start broad, then narrow** - begin with simple queries and add filters

---

## Common Workflows

**Note**: Use `ES_BASE_URL` for the selected environment in the examples below.

### Debug a Specific Request by Trace ID

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search?filter_path=hits.hits._source" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "term": {
        "trace.id": "YOUR_TRACE_ID"
      }
    },
    "_source": [
      "@timestamp",
      "message",
      "kubernetes.container.name",
      "req.url",
      "appPayload.res.statusCode"
    ],
    "size": 100,
    "sort": [
      { "@timestamp": "asc" }
    ]
  }'
```

### Find Recent Errors in a Service

```bash
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "bool": {
        "must": [
          { "match": { "level": "ERROR" }},
          { "match": { "kubernetes.container.name": "my-api-service" }},
          { "range": { "@timestamp": { "gte": "now-1h" }}}
        ]
      }
    },
    "_source": ["@timestamp", "message", "trace.id"],
    "size": 50,
    "sort": [
      { "@timestamp": "desc" }
    ]
  }'
```

### Analyze Request Flow Across Services

```bash
# First, get the trace ID from the initial request
# Then query all services for that trace ID to see the full flow
curl -X POST "$ES_BASE_URL/$ES_INDEX_PATTERN/_search?filter_path=hits.hits._source" \
  -u "$ES_USERNAME:$ES_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "term": {
        "trace.id": "YOUR_TRACE_ID"
      }
    },
    "_source": [
      "@timestamp",
      "kubernetes.container.name",
      "message",
      "req.url",
      "req.method",
      "appPayload.res.statusCode",
      "appPayload.responseTime"
    ],
    "size": 100,
    "sort": [
      { "@timestamp": "asc" }
    ]
  }'
```

---

## Troubleshooting

### Empty Results (value: 0)

- Verify the trace ID or field value exists in the logs
- Check if you're querying the correct field path
- Try a broader query first (e.g., `match_all`) to see available data

### Authentication Errors

- Ensure `ES_USERNAME` and `ES_PASSWORD` are set in the shell, or stored on the
  env via `scripts/envs.py update <env> --username ... --password ...`
- Verify credentials are correct
- Check network access to the Elasticsearch endpoint

### No Environment Configured

- Run `python3 scripts/envs.py list` to see configured envs
- Add one with `python3 scripts/envs.py add <name> --url <url>`
- At least one env must exist; `remove` is blocked on the final env

### Field Not Found Errors

- Use `_mapping` endpoint to discover available fields
- Field paths are case-sensitive
- Nested fields use dot notation (e.g., `req.headers.host`)

---

## Summary

- **Environments**: Managed in `environments.json` via `scripts/envs.py` (`list`, `add`, `update`, `remove`, `get`). At least one env must always exist.
- **Environment selection**: When the user names an env ("dev", "rc", "prod"), use it. If unspecified and multiple exist, ask.
- **Load before querying**: `eval "$(python3 scripts/envs.py get <env> --format export)"` sets `ES_BASE_URL`, `ES_INDEX_PATTERN`, and optional `ES_USERNAME`/`ES_PASSWORD`.
- **Primary tool**: `_search` endpoint - use this for 95% of log querying needs.
- **Authentication**: `$ES_USERNAME:$ES_PASSWORD` from the shell or from a per-env override in `environments.json`.
- **Key query types**: `term` (exact match), `match` (text search), `bool` (combinations).
- **Essential parameters**: `_source` (field filtering), `size` (result limit), `sort` (ordering).
- **Common use case**: Debug by trace ID to see full request flow across services.
