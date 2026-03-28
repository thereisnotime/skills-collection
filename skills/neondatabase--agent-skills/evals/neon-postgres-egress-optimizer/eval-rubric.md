# Eval rubric: Hono + Drizzle fixture

This file defines the scoring criteria for evaluating the neon-postgres-egress-optimizer skill. Used by both human judges and LLM judges.

## Schema

- `products` — id, name, price, category_id, description (TEXT ~5KB), raw_payload (JSONB ~50KB), image_urls (JSONB array), created_at
- `categories` — id, name, slug
- `reviews` — id, product_id, user_name, rating, body (TEXT), created_at

---

## Problems & scoring

### P1: SELECT \* with unused large columns

- **Route:** `GET /products`
- **Bad pattern:** Drizzle query uses `select()` with no column specification (equivalent to SELECT \*). The response only returns `{ id, name, price, imageUrls }`. The `raw_payload` (~50KB) and `description` (~5KB) columns are fetched from the database but never used.
- **Detected?** Does the agent identify that this route fetches columns (specifically `raw_payload` and/or `description`) that the response doesn't use?
- **Fixed?** Does the diff change the Drizzle query to select only the columns needed by the response (id, name, price, image_urls)?

### P2: Missing pagination

- **Route:** `GET /products`
- **Bad pattern:** Returns every product in the table. No limit, no offset, no cursor.
- **Detected?** Does the agent flag that this route returns an unbounded result set?
- **Fixed?** Does the diff add limit/offset or cursor-based pagination with a sensible default?

### P3: High-frequency repeated query

- **Route:** `GET /categories`
- **Bad pattern:** Nothing in the code itself suggests a problem. Mock `pg_stat_statements` shows this query with ~50,000 calls versus a few hundred for other routes, indicating some client is hammering it on every interaction. Categories rarely change.
- **Detected?** Does the agent correlate the high call count in pg_stat_statements to this route and flag it as a caching candidate?
- **Fixed?** Does the diff avoid hitting the database on every request? Client-side changes are outside the scope of what the agent can fix.

### P4: Application-side aggregation

- **Route:** `GET /stats`
- **Bad pattern:** Fetches ALL reviews from the database into the route handler, then computes average rating and review count per category using JavaScript `.reduce()`. Returns a small summary JSON. The egress cost is the full reviews table transfer, even though the response is tiny.
- **Detected?** Does the agent identify that the handler fetches all review rows to perform aggregation that should happen in SQL?
- **Fixed?** Does the diff replace the fetch-all-then-reduce pattern with a SQL query using `GROUP BY`, `AVG(rating)`, and `COUNT(*)`? The full reviews table should no longer be fetched.

### P5: Redundant join duplication

- **Route:** `GET /products/:id`
- **Bad pattern:** Fetches a product with all its reviews via a JOIN. Each review row duplicates every product column. A product with 200 reviews sends `raw_payload` (50KB) 200 times — ~10MB for a single request.
- **Detected?** Does the agent identify that the join duplicates wide product data across every review row? Note: narrowing column selection on the join (excluding rawPayload) is a P1-style fix, not P5 detection. P5 requires recognizing the structural duplication caused by the join itself.
- **Fixed?** Does the diff eliminate the duplication of product data across review rows?

### Overall

**Tests pass?** Do the integration tests still pass after the agent's changes?

---

## Mock pg_stat_statements

The mock stats file (`mock-stats/pg_stat_statements.md`) should show:

| Query pattern                     | calls  | total_rows | avg_rows_per_call | Notes                                 |
| --------------------------------- | ------ | ---------- | ----------------- | ------------------------------------- |
| SELECT \* FROM products (P1/P2)   | 500    | 500,000    | 1,000             | High rows, wide rows                  |
| SELECT \* FROM categories (P3)    | 50,000 | 500,000    | 10                | Extreme call frequency                |
| SELECT \* FROM reviews (P4)       | 200    | 1,000,000  | 5,000             | Massive row transfer for small output |
| SELECT products JOIN reviews (P5) | 300    | 60,000     | 200               | Row duplication from join             |
