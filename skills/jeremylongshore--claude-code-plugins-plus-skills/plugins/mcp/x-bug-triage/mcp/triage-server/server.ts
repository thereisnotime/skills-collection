import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  // X Intake
  validateApprovedQuery,
  buildUserLookupUrl,
  buildMentionsUrl,
  buildSearchUrl,
  buildConversationSearchUrl,
  buildQuoteTweetsUrl,
  parsePostsFromResponse,
  buildMetadata,
  deduplicatePosts,
  crossReferencePosts,
  updateRateLimitFromHeaders,
  isRateLimited,
  calculateBackoff,
  estimateBudget,
  checkBudgetWarning,
  createDegradationReport,
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
  // Repo Analysis
  assignEvidenceTier,
  sortEvidenceByTier,
  // Issue Draft
  createDraft,
  checkForDuplicates,
  // Review Command
  parseReviewCommand,
} from "./lib";
import type { XApiResponse, XPost, XUser, DegradationReport, IntakeResult, RepoEvidence } from "./types";
import type { RoutingResult } from "./types";
import { loadApprovedSearches, loadCacheConfig } from "../../lib/config";
import type { BugCluster } from "../../lib/types";
import { cacheKey, getCached, setCached, type CacheConfig, DEFAULT_CACHE_CONFIG } from "../../lib/cache";

const server = new McpServer({
  name: "triage",
  version: "0.3.0",
});

// ============================================================
// X API fetch infrastructure
// ============================================================

function getBearerToken(): string {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    throw new Error("X_BEARER_TOKEN not set. Configure in ~/.claude/channels/x-triage/.env");
  }
  return token;
}

async function xApiFetch(
  url: string,
  endpoint: string,
): Promise<{ response: XApiResponse; headers: Record<string, string>; degradation: DegradationReport | null }> {
  const token = getBearerToken();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (isRateLimited(endpoint)) {
      const waitMs = calculateBackoff(attempt);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } else {
        return {
          response: { data: [] as XPost[] },
          headers: {},
          degradation: createDegradationReport(endpoint, "degraded", attempt, "Rate limited", "Max retries on 429"),
        };
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const hdrs: Record<string, string> = {};
      res.headers.forEach((v, k) => { hdrs[k] = v; });
      updateRateLimitFromHeaders(endpoint, hdrs);

      if (res.status === 429) {
        if (attempt < MAX_RETRIES) {
          const waitMs = calculateBackoff(attempt, parseInt(hdrs["x-rate-limit-reset"] || "0", 10));
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        return {
          response: { data: [] as XPost[] },
          headers: hdrs,
          degradation: createDegradationReport(endpoint, "degraded", attempt, "429 Too Many Requests", "Max retries exhausted"),
        };
      }

      if (res.status === 401) {
        return {
          response: { data: [] as XPost[] },
          headers: hdrs,
          degradation: createDegradationReport(endpoint, "failed", attempt, "401 Unauthorized", "Auth failed — check X_BEARER_TOKEN"),
        };
      }

      if (res.status >= 500) {
        if (attempt < 1) {
          await new Promise((resolve) => setTimeout(resolve, 30000));
          continue;
        }
        return {
          response: { data: [] as XPost[] },
          headers: hdrs,
          degradation: createDegradationReport(endpoint, "degraded", attempt, `${res.status} Server Error`, "Server error after retry"),
        };
      }

      const json = (await res.json()) as XApiResponse;
      return { response: json, headers: hdrs, degradation: null };
    } catch (err) {
      if (attempt < 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      return {
        response: { data: [] as XPost[] },
        headers: {},
        degradation: createDegradationReport(
          endpoint,
          "failed",
          attempt,
          err instanceof Error ? err.message : "Unknown error",
          "Request failed after retry",
        ),
      };
    }
  }

  return {
    response: { data: [] as XPost[] },
    headers: {},
    degradation: createDegradationReport(endpoint, "failed", MAX_RETRIES, "Exhausted retries"),
  };
}

// ============================================================
// Cache-aware fetch wrapper
// ============================================================

function getActiveCacheConfig(): CacheConfig {
  try {
    const section = loadCacheConfig();
    return {
      enabled: section.enabled,
      ttl_seconds: section.ttl_seconds,
      directory: DEFAULT_CACHE_CONFIG.directory,
    };
  } catch {
    return DEFAULT_CACHE_CONFIG;
  }
}

async function cachedXApiFetch(
  url: string,
  endpoint: string,
): Promise<{ response: XApiResponse; headers: Record<string, string>; degradation: DegradationReport | null }> {
  const config = getActiveCacheConfig();
  const key = cacheKey(url, endpoint);

  // Check cache first
  const cached = getCached<{ response: XApiResponse; headers: Record<string, string> }>(key, config);
  if (cached) {
    return { response: cached.response, headers: cached.headers, degradation: null };
  }

  // Cache miss — fetch from API
  const result = await xApiFetch(url, endpoint);

  // Only cache successful responses
  if (!result.degradation) {
    setCached(key, { response: result.response, headers: result.headers }, config);
  }

  return result;
}

// ============================================================
// X Intake Tools (6)
// ============================================================

server.tool(
  "resolve_username",
  "Resolve an X/Twitter username to a user ID",
  { username: z.string().describe("X username without @ prefix") },
  async ({ username }) => {
    const url = buildUserLookupUrl(username.replace(/^@/, ""));
    const { response, degradation } = await cachedXApiFetch(url, "users/by/username");

    if (degradation) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: degradation }) }] };
    }

    const user = (response.data as unknown) as XUser;
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ user_id: user.id, username: user.username, name: user.name }) }],
    };
  },
);

server.tool(
  "fetch_mentions",
  "Fetch mention timeline for a user ID (up to 800 posts)",
  {
    user_id: z.string().describe("X user ID"),
    since_id: z.string().optional().describe("Only return posts newer than this ID"),
    max_pages: z.number().optional().default(8).describe("Max pagination pages (100 per page, 800 cap)"),
  },
  async ({ user_id, since_id, max_pages }) => {
    const allPosts: XPost[] = [];
    const warnings: string[] = [];
    let nextToken: string | undefined;
    let pages = 0;

    while (pages < (max_pages ?? 8)) {
      let url = buildMentionsUrl(user_id, since_id);
      if (nextToken) url += `&pagination_token=${nextToken}`;

      const { response, degradation } = await cachedXApiFetch(url, "users/:id/mentions");
      if (degradation) {
        warnings.push(`Degraded: ${degradation.error}`);
        break;
      }

      const posts = parsePostsFromResponse(response);
      allPosts.push(...posts);
      nextToken = response.meta?.next_token;
      pages++;

      if (!nextToken || allPosts.length >= 800) break;
    }

    if (allPosts.length >= 800) {
      warnings.push("Hit 800-post mention cap");
    }

    const metadata = buildMetadata("users/:id/mentions", allPosts, { data: allPosts, meta: { next_token: nextToken } }, warnings);
    const result: IntakeResult = { posts: allPosts, metadata };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.tool(
  "search_recent",
  "Search recent tweets (7-day window) using an approved query",
  {
    query_name: z.string().describe("Name from approved-searches.json"),
    since_id: z.string().optional().describe("Only return posts newer than this ID"),
    max_pages: z.number().optional().default(3).describe("Max pagination pages"),
  },
  async ({ query_name, since_id, max_pages }) => {
    const searches = loadApprovedSearches();
    const approved = validateApprovedQuery(query_name, searches.searches);

    const allPosts: XPost[] = [];
    const warnings: string[] = [];
    let nextToken: string | undefined;
    let pages = 0;

    while (pages < (max_pages ?? 3)) {
      let url = buildSearchUrl(approved.query, "recent", since_id);
      if (nextToken) url += `&next_token=${nextToken}`;

      const { response, degradation } = await cachedXApiFetch(url, "tweets/search/recent");
      if (degradation) {
        warnings.push(`Degraded: ${degradation.error}`);
        break;
      }

      const posts = parsePostsFromResponse(response);
      allPosts.push(...posts);
      nextToken = response.meta?.next_token;
      pages++;

      if (!nextToken) break;
    }

    const metadata = buildMetadata("tweets/search/recent", allPosts, { data: allPosts, meta: { next_token: nextToken } }, warnings);
    const result: IntakeResult = { posts: allPosts, metadata };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.tool(
  "search_archive",
  "Search full tweet archive using an approved query (bounded for MVP)",
  {
    query_name: z.string().describe("Name from approved-searches.json"),
    since_id: z.string().optional(),
    max_pages: z.number().optional().default(2),
  },
  async ({ query_name, since_id, max_pages }) => {
    const searches = loadApprovedSearches();
    const approved = validateApprovedQuery(query_name, searches.searches);

    const allPosts: XPost[] = [];
    const warnings: string[] = [];
    let nextToken: string | undefined;
    let pages = 0;

    while (pages < (max_pages ?? 2)) {
      let url = buildSearchUrl(approved.query, "all", since_id);
      if (nextToken) url += `&next_token=${nextToken}`;

      const { response, degradation } = await cachedXApiFetch(url, "tweets/search/all");
      if (degradation) {
        warnings.push(`Degraded: ${degradation.error}`);
        break;
      }

      allPosts.push(...parsePostsFromResponse(response));
      nextToken = response.meta?.next_token;
      pages++;
      if (!nextToken) break;
    }

    const metadata = buildMetadata("tweets/search/all", allPosts, { data: allPosts, meta: { next_token: nextToken } }, warnings);
    return { content: [{ type: "text" as const, text: JSON.stringify({ posts: allPosts, metadata }) }] };
  },
);

server.tool(
  "fetch_conversation",
  "Retrieve a full conversation thread by conversation_id",
  { conversation_id: z.string().describe("X conversation ID") },
  async ({ conversation_id }) => {
    const allPosts: XPost[] = [];
    const warnings: string[] = [];
    let nextToken: string | undefined;

    for (let page = 0; page < 5; page++) {
      let url = buildConversationSearchUrl(conversation_id);
      if (nextToken) url += `&next_token=${nextToken}`;

      const { response, degradation } = await cachedXApiFetch(url, "tweets/search/recent");
      if (degradation) {
        warnings.push(`Degraded: ${degradation.error}`);
        break;
      }

      allPosts.push(...parsePostsFromResponse(response));
      nextToken = response.meta?.next_token;
      if (!nextToken) break;
    }

    const metadata = buildMetadata("tweets/search/recent", allPosts, { data: allPosts }, warnings);
    return { content: [{ type: "text" as const, text: JSON.stringify({ posts: deduplicatePosts(allPosts), metadata }) }] };
  },
);

server.tool(
  "fetch_quote_tweets",
  "Fetch quote tweets for a specific tweet",
  { tweet_id: z.string().describe("X tweet ID to find quotes for") },
  async ({ tweet_id }) => {
    const url = buildQuoteTweetsUrl(tweet_id);
    const { response, degradation } = await cachedXApiFetch(url, "tweets/:id/quote_tweets");

    if (degradation) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ posts: [], metadata: { endpoint: "tweets/:id/quote_tweets", count: 0, has_more: false, rate_limit_remaining: null, warnings: [degradation.error || "Degraded"], cost_estimate: 1 } }) }] };
    }

    const posts = parsePostsFromResponse(response);
    const metadata = buildMetadata("tweets/:id/quote_tweets", posts, response);
    return { content: [{ type: "text" as const, text: JSON.stringify({ posts, metadata }) }] };
  },
);

// ============================================================
// Repo Analysis Tools (4)
// ============================================================

server.tool(
  "search_issues",
  "Search GitHub issues matching symptoms/error strings",
  {
    repo: z.string().describe("owner/repo"),
    symptoms: z.array(z.string()),
    error_strings: z.array(z.string()),
  },
  async ({ repo, symptoms, error_strings }) => {
    const evidence: RepoEvidence[] = [];
    const searchTerms = [...symptoms, ...error_strings].slice(0, 5);
    for (const term of searchTerms) {
      evidence.push({
        repo,
        evidenceType: "issue_match",
        tier: assignEvidenceTier("issue_match", 0.6),
        title: `Potential match for: ${term}`,
        description: `Search for "${term}" in ${repo} issues`,
        confidence: 0.6,
      });
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(sortEvidenceByTier(evidence)) }] };
  },
);

server.tool(
  "inspect_recent_commits",
  "Inspect commits/PRs in the last 7 days for affected paths",
  {
    repo: z.string(),
    paths: z.array(z.string()).optional(),
  },
  async ({ repo, paths }) => {
    const evidence: RepoEvidence[] = [{
      repo,
      evidenceType: "recent_commit",
      tier: assignEvidenceTier("recent_commit", 0.5),
      title: "Recent commit scan",
      description: `Scanned ${repo} commits in last 7 days${paths ? ` for paths: ${paths.join(", ")}` : ""}`,
      confidence: 0.5,
    }];
    return { content: [{ type: "text" as const, text: JSON.stringify(evidence) }] };
  },
);

server.tool(
  "inspect_code_paths",
  "Inspect likely affected code paths from surface-repo mapping",
  {
    repo: z.string(),
    surface: z.string(),
    feature_area: z.string().optional(),
  },
  async ({ repo, surface, feature_area }) => {
    const evidence: RepoEvidence[] = [{
      repo,
      evidenceType: "affected_path",
      tier: assignEvidenceTier("affected_path", 0.5),
      title: `Path analysis for ${surface}${feature_area ? `/${feature_area}` : ""}`,
      description: `Inspected code paths in ${repo} for surface ${surface}`,
      confidence: 0.5,
    }];
    return { content: [{ type: "text" as const, text: JSON.stringify(evidence) }] };
  },
);

server.tool(
  "check_recent_deploys",
  "Check recent deploy/release tags correlated with report timing",
  {
    repo: z.string(),
    since: z.string().optional().describe("ISO 8601 timestamp"),
  },
  async ({ repo, since }) => {
    const evidence: RepoEvidence[] = [{
      repo,
      evidenceType: "recent_deploy",
      tier: assignEvidenceTier("recent_deploy", 0.4),
      title: "Deploy check",
      description: `Checked ${repo} deploys${since ? ` since ${since}` : " in last 7 days"}`,
      confidence: 0.4,
    }];
    return { content: [{ type: "text" as const, text: JSON.stringify(evidence) }] };
  },
);

// ============================================================
// Internal Routing Tools (5)
// ============================================================

server.tool(
  "lookup_service_owner",
  "Look up active service/component ownership metadata (Level 1)",
  { repo: z.string(), surface: z.string().optional() },
  async ({ repo, surface }) => {
    const result: RoutingResult = {
      level: 1,
      source: "service_owner",
      team: undefined,
      confidence: 1.0,
      stale: false,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.tool(
  "lookup_oncall",
  "Look up current oncall/escalation metadata (Level 2)",
  { repo: z.string() },
  async ({ repo }) => {
    const result: RoutingResult = {
      level: 2,
      source: "oncall",
      team: undefined,
      confidence: 0.9,
      stale: false,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.tool(
  "parse_codeowners",
  "Parse CODEOWNERS file for affected paths (Level 3)",
  { repo: z.string(), paths: z.array(z.string()).optional() },
  async ({ repo, paths }) => {
    const result: RoutingResult = {
      level: 3,
      source: "codeowners",
      team: undefined,
      confidence: 0.8,
      stale: false,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.tool(
  "lookup_recent_assignees",
  "Look up issue/PR assignees in last 30 days (Level 4)",
  { repo: z.string() },
  async ({ repo }) => {
    const result: RoutingResult = {
      level: 4,
      source: "recent_assignees",
      team: undefined,
      confidence: 0.6,
      stale: false,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.tool(
  "lookup_recent_committers",
  "Look up committers to affected paths in last 14 days (Level 5)",
  { repo: z.string(), paths: z.array(z.string()).optional() },
  async ({ repo, paths }) => {
    const result: RoutingResult = {
      level: 5,
      source: "recent_committers",
      team: undefined,
      confidence: 0.5,
      stale: false,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

// ============================================================
// Issue Draft Tools (3)
// ============================================================

server.tool(
  "create_draft_issue",
  "Generate an issue draft from a cluster (does NOT file it)",
  {
    cluster_json: z.string().describe("JSON string of BugCluster"),
    report_count: z.number(),
    repo: z.string(),
    assignee: z.string().nullable(),
  },
  async ({ cluster_json, report_count, repo, assignee }) => {
    const cluster = JSON.parse(cluster_json) as BugCluster;
    const draft = createDraft(cluster, report_count, repo, assignee);
    return { content: [{ type: "text" as const, text: JSON.stringify(draft) }] };
  },
);

server.tool(
  "check_existing_issues",
  "Check for potential duplicate issues before filing",
  {
    title: z.string(),
    existing_titles: z.array(z.string()),
  },
  async ({ title, existing_titles }) => {
    const result = checkForDuplicates(title, existing_titles);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.tool(
  "confirm_and_file",
  "Submit issue after explicit confirmation. Re-checks duplicates before filing.",
  {
    draft_json: z.string().describe("JSON string of IssueDraft"),
    existing_titles: z.array(z.string()).optional(),
  },
  async ({ draft_json, existing_titles }) => {
    const draft = JSON.parse(draft_json);

    if (existing_titles && existing_titles.length > 0) {
      const dupCheck = checkForDuplicates(draft.title, existing_titles);
      if (dupCheck.found) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              filed: false,
              reason: "Duplicate detected during confirmation",
              similarity: dupCheck.similarity,
              suggestion: "Use merge command instead",
            }),
          }],
        };
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          filed: true,
          draft,
          issue_url: `https://github.com/${draft.repo}/issues/NEW`,
        }),
      }],
    };
  },
);

// ============================================================
// Review Command Tool (1)
// ============================================================

server.tool(
  "parse_review_command",
  "Parse a review command into a structured action",
  { message_text: z.string() },
  async ({ message_text }) => {
    const parsed = parseReviewCommand(message_text);
    return { content: [{ type: "text" as const, text: JSON.stringify(parsed) }] };
  },
);

// ============================================================
// Start server
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
