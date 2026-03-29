import { describe, test, expect, beforeEach } from "bun:test";
import {
  // X Intake
  validateApprovedQuery,
  validateQueryParenthesization,
  compileSearchParams,
  updateRateLimitFromHeaders,
  getRateLimitState,
  isRateLimited,
  getResetWaitMs,
  resetRateLimitState,
  estimateBudget,
  checkBudgetWarning,
  parsePostsFromResponse,
  buildMetadata,
  deduplicatePosts,
  crossReferencePosts,
  calculateBackoff,
  buildUrl,
  buildMentionsUrl,
  buildUserLookupUrl,
  buildSearchUrl,
  buildConversationSearchUrl,
  buildQuoteTweetsUrl,
  createDegradationReport,
  // Repo Analysis
  rankRepos,
  assignEvidenceTier,
  createDegradedScanResult,
  sortEvidenceByTier,
  isExternalDependency,
  // Internal Routing
  isStale,
  buildRoutingRecommendation,
  applyPrecedenceConfidence,
  // Issue Draft
  generateDraftTitle,
  generateDraftLabels,
  generateDraftBody,
  createDraft,
  checkForDuplicates,
  // Review Command
  parseReviewCommand,
  formatActionConfirmation,
} from "./lib";
import type { XPost, XApiResponse, ApprovedSearch, RepoEvidence, RoutingResult } from "./types";
import type { BugCluster } from "../../lib/types";

// === Fixtures ===

const APPROVED_SEARCHES: ApprovedSearch[] = [
  { name: "claude-bugs", query: '("claude" OR "anthropic") (broken OR bug OR error OR crash)', description: "Claude product bugs" },
  { name: "api-issues", query: '("claude api" OR "anthropic api") (error OR timeout OR 500)', description: "API issues" },
];

function makePost(overrides: Partial<XPost> = {}): XPost {
  return {
    id: Math.random().toString(36).slice(2),
    text: "Test post",
    author_id: "123",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCluster(overrides: Partial<BugCluster> = {}): BugCluster {
  const now = new Date().toISOString();
  return {
    cluster_id: "c1",
    bug_signature: "web_app|chat|error 500|messages disappearing",
    cluster_family: "product_defect",
    product_surface: "web_app",
    feature_area: "chat",
    title: "Messages disappearing in chat",
    severity: "high",
    severity_rationale: "Data loss signals",
    state: "open",
    sub_status: null,
    report_count: 5,
    first_seen: now,
    last_seen: now,
    created_at: now,
    updated_at: now,
    triage_run_id: "run1",
    ...overrides,
  };
}

// ============================================================
// X Intake — Query Compiler Tests
// ============================================================

describe("query validation", () => {
  test("validates approved query", () => {
    const result = validateApprovedQuery("claude-bugs", APPROVED_SEARCHES);
    expect(result.name).toBe("claude-bugs");
    expect(result.query).toContain("claude");
  });

  test("rejects unapproved query", () => {
    expect(() => validateApprovedQuery("hacker-tools", APPROVED_SEARCHES)).toThrow(
      'Query "hacker-tools" is not in approved-searches.json',
    );
  });

  test("lists available queries in error", () => {
    try {
      validateApprovedQuery("nope", APPROVED_SEARCHES);
    } catch (e: unknown) {
      expect((e as Error).message).toContain("claude-bugs");
      expect((e as Error).message).toContain("api-issues");
    }
  });
});

describe("query parenthesization", () => {
  test("accepts fully parenthesized OR groups", () => {
    expect(() =>
      validateQueryParenthesization('("claude" OR "anthropic") broken'),
    ).not.toThrow();
  });

  test("accepts queries without OR", () => {
    expect(() =>
      validateQueryParenthesization("claude broken bug"),
    ).not.toThrow();
  });

  test("rejects unparenthesized OR groups", () => {
    expect(() =>
      validateQueryParenthesization('"claude" OR "anthropic" broken'),
    ).toThrow("unparenthesized OR");
  });

  test("accepts nested parenthesized ORs", () => {
    expect(() =>
      validateQueryParenthesization('("a" OR "b") ("c" OR "d")'),
    ).not.toThrow();
  });
});

describe("compileSearchParams", () => {
  test("includes all field expansions", () => {
    const params = compileSearchParams("test query");
    expect(params.query).toBe("test query");
    expect(params["tweet.fields"]).toContain("id");
    expect(params["tweet.fields"]).toContain("public_metrics");
    expect(params["user.fields"]).toContain("username");
    expect(params["media.fields"]).toContain("media_key");
    expect(params.expansions).toContain("author_id");
  });
});

// ============================================================
// X Intake — Rate Limit Tests
// ============================================================

describe("rate limiting", () => {
  beforeEach(() => resetRateLimitState());

  test("tracks rate limit from headers", () => {
    updateRateLimitFromHeaders("tweets/search/recent", {
      "x-rate-limit-limit": "300",
      "x-rate-limit-remaining": "250",
      "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 900),
    });
    const state = getRateLimitState("tweets/search/recent");
    expect(state).toBeDefined();
    expect(state!.limit).toBe(300);
    expect(state!.remaining).toBe(250);
  });

  test("detects rate limited state", () => {
    updateRateLimitFromHeaders("tweets/search/recent", {
      "x-rate-limit-limit": "300",
      "x-rate-limit-remaining": "0",
      "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 900),
    });
    expect(isRateLimited("tweets/search/recent")).toBe(true);
  });

  test("not rate limited when quota remaining", () => {
    updateRateLimitFromHeaders("tweets/search/recent", {
      "x-rate-limit-limit": "300",
      "x-rate-limit-remaining": "100",
      "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 900),
    });
    expect(isRateLimited("tweets/search/recent")).toBe(false);
  });

  test("not rate limited after reset time", () => {
    updateRateLimitFromHeaders("tweets/search/recent", {
      "x-rate-limit-limit": "300",
      "x-rate-limit-remaining": "0",
      "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) - 10),
    });
    expect(isRateLimited("tweets/search/recent")).toBe(false);
  });
});

// ============================================================
// X Intake — Budget Tests
// ============================================================

describe("budget estimation", () => {
  beforeEach(() => resetRateLimitState());

  test("within budget when quota sufficient", () => {
    updateRateLimitFromHeaders("tweets/search/recent", {
      "x-rate-limit-limit": "300",
      "x-rate-limit-remaining": "200",
      "x-rate-limit-reset": "0",
    });
    const budget = estimateBudget("tweets/search/recent", 10);
    expect(budget.withinBudget).toBe(true);
  });

  test("over budget when quota insufficient", () => {
    updateRateLimitFromHeaders("tweets/search/recent", {
      "x-rate-limit-limit": "300",
      "x-rate-limit-remaining": "5",
      "x-rate-limit-reset": "0",
    });
    const budget = estimateBudget("tweets/search/recent", 10);
    expect(budget.withinBudget).toBe(false);
  });

  test("warns at high usage", () => {
    updateRateLimitFromHeaders("tweets/search/recent", {
      "x-rate-limit-limit": "300",
      "x-rate-limit-remaining": "50",
      "x-rate-limit-reset": "0",
    });
    const budget = estimateBudget("tweets/search/recent", 45);
    const warning = checkBudgetWarning(budget);
    expect(warning).toContain("High usage");
  });
});

// ============================================================
// X Intake — Response Parsing Tests
// ============================================================

describe("response parsing", () => {
  test("parses array of posts", () => {
    const response: XApiResponse = {
      data: [makePost({ id: "1" }), makePost({ id: "2" })],
    };
    const posts = parsePostsFromResponse(response);
    expect(posts.length).toBe(2);
  });

  test("handles empty response", () => {
    const response: XApiResponse = { data: [] };
    const posts = parsePostsFromResponse(response);
    expect(posts.length).toBe(0);
  });

  test("builds metadata correctly", () => {
    const posts = [makePost()];
    const response: XApiResponse = { data: posts, meta: { next_token: "abc" } };
    const metadata = buildMetadata("tweets/search/recent", posts, response, ["test warning"]);
    expect(metadata.endpoint).toBe("tweets/search/recent");
    expect(metadata.count).toBe(1);
    expect(metadata.has_more).toBe(true);
    expect(metadata.warnings).toEqual(["test warning"]);
  });
});

// ============================================================
// X Intake — Deduplication Tests
// ============================================================

describe("deduplication", () => {
  test("removes duplicate posts by id", () => {
    const posts = [makePost({ id: "1" }), makePost({ id: "2" }), makePost({ id: "1" })];
    const deduped = deduplicatePosts(posts);
    expect(deduped.length).toBe(2);
  });

  test("cross-references mentions and search", () => {
    const mentions = [makePost({ id: "1" }), makePost({ id: "2" }), makePost({ id: "3" })];
    const search = [makePost({ id: "2" }), makePost({ id: "4" })];
    const result = crossReferencePosts(mentions, search);
    expect(result.combined.length).toBe(4);
    expect(result.overlap).toBe(1);
    expect(result.mentionOnly).toBe(2);
    expect(result.searchOnly).toBe(1);
  });
});

// ============================================================
// X Intake — Backoff Tests
// ============================================================

describe("backoff calculation", () => {
  test("exponential backoff increases", () => {
    const b0 = calculateBackoff(0);
    const b1 = calculateBackoff(1);
    const b2 = calculateBackoff(2);
    expect(b1).toBeGreaterThan(b0);
    expect(b2).toBeGreaterThan(b1);
  });

  test("uses reset time when available", () => {
    const futureReset = Date.now() / 1000 + 60;
    const backoff = calculateBackoff(0, futureReset);
    expect(backoff).toBeGreaterThan(50000);
  });

  test("caps at 30 seconds for exponential", () => {
    const backoff = calculateBackoff(10);
    expect(backoff).toBeLessThanOrEqual(30000);
  });
});

// ============================================================
// X Intake — URL Building Tests
// ============================================================

describe("URL building", () => {
  test("builds user lookup URL", () => {
    const url = buildUserLookupUrl("testuser");
    expect(url).toContain("users/by/username/testuser");
    expect(url).toContain("user.fields=");
  });

  test("builds mentions URL with since_id", () => {
    const url = buildMentionsUrl("12345", "67890");
    expect(url).toContain("users/12345/mentions");
    expect(url).toContain("since_id=67890");
  });

  test("builds search URL", () => {
    const url = buildSearchUrl("test query", "recent");
    expect(url).toContain("tweets/search/recent");
    expect(url).toContain("query=");
  });

  test("builds conversation search URL", () => {
    const url = buildConversationSearchUrl("conv123");
    expect(url).toContain("conversation_id%3Aconv123");
  });

  test("builds quote tweets URL", () => {
    const url = buildQuoteTweetsUrl("tweet123");
    expect(url).toContain("tweets/tweet123/quote_tweets");
  });
});

// ============================================================
// X Intake — Degradation Report Tests
// ============================================================

describe("degradation reporting", () => {
  test("creates degraded report", () => {
    const report = createDegradationReport("tweets/search/recent", "degraded", 3, "429 Too Many Requests", "Max retries");
    expect(report.status).toBe("degraded");
    expect(report.retries).toBe(3);
    expect(report.error).toContain("429");
  });

  test("creates failed report", () => {
    const report = createDegradationReport("users/by/username", "failed", 0, "401 Unauthorized");
    expect(report.status).toBe("failed");
  });
});

// ============================================================
// Repo Analysis Tests
// ============================================================

describe("repo-analysis", () => {
  test("ranks repos with top-3 cap", () => {
    expect(rankRepos(["a", "b", "c", "d"], 3).length).toBe(3);
  });

  test("assigns tier 1 for high-confidence issue match", () => {
    expect(assignEvidenceTier("issue_match", 0.95)).toBe(1);
  });

  test("assigns tier 2 for moderate issue match", () => {
    expect(assignEvidenceTier("issue_match", 0.75)).toBe(2);
  });

  test("assigns tier 3 for low-confidence match", () => {
    expect(assignEvidenceTier("issue_match", 0.5)).toBe(3);
  });

  test("assigns tier 4 for external dependency", () => {
    expect(assignEvidenceTier("external_dependency", 0.9)).toBe(4);
  });

  test("creates degraded scan result", () => {
    const result = createDegradedScanResult("org/repo", "Access denied");
    expect(result.scanned).toBe(false);
    expect(result.error).toBe("Access denied");
  });

  test("sorts evidence by tier", () => {
    const evidence: RepoEvidence[] = [
      { repo: "a", evidenceType: "issue_match", tier: 3, title: "", description: "", confidence: 0.5 },
      { repo: "a", evidenceType: "issue_match", tier: 1, title: "", description: "", confidence: 0.9 },
      { repo: "a", evidenceType: "recent_commit", tier: 2, title: "", description: "", confidence: 0.7 },
    ];
    const sorted = sortEvidenceByTier(evidence);
    expect(sorted[0].tier).toBe(1);
    expect(sorted[1].tier).toBe(2);
    expect(sorted[2].tier).toBe(3);
  });

  test("detects external dependency", () => {
    const evidence: RepoEvidence[] = [
      { repo: "a", evidenceType: "external_dependency", tier: 4, title: "", description: "", confidence: 0.5 },
    ];
    expect(isExternalDependency(evidence)).toBe(true);
  });
});

// ============================================================
// Internal Routing Tests
// ============================================================

describe("internal-routing", () => {
  test("staleness: 31 days is stale", () => {
    const date = new Date(Date.now() - 31 * 86400000).toISOString();
    expect(isStale(date)).toBe(true);
  });

  test("staleness: 29 days is not stale", () => {
    const date = new Date(Date.now() - 29 * 86400000).toISOString();
    expect(isStale(date)).toBe(false);
  });

  test("staleness: null date is stale", () => {
    expect(isStale(null)).toBe(true);
  });

  test("routing: override takes precedence", () => {
    const result = buildRoutingRecommendation("c1", [], { new_team: "override-team" });
    expect(result.override_applied).toBe(true);
    expect(result.top_recommendation?.team).toBe("override-team");
  });

  test("routing: uncertainty when no results", () => {
    const result = buildRoutingRecommendation("c1", [], null);
    expect(result.uncertainty).toBe(true);
    expect(result.uncertainty_reason).toContain("Manual assignment required");
  });

  test("routing: best result by level", () => {
    const results: RoutingResult[] = [
      { level: 3, source: "codeowners", team: "team-a", confidence: 0.8, stale: false },
      { level: 1, source: "service_owner", team: "team-b", confidence: 1.0, stale: false },
    ];
    const rec = buildRoutingRecommendation("c1", results, null);
    expect(rec.top_recommendation?.team).toBe("team-b");
  });

  test("routing: precedence confidence modifier", () => {
    const result: RoutingResult = { level: 4, source: "recent_assignees", confidence: 1.0, stale: false };
    const config = {
      precedence: [{ level: 4, source: "recent_assignees", description: "", confidence_modifier: 0.6 }],
      staleness_threshold_days: 30,
    };
    const modified = applyPrecedenceConfidence(result, config);
    expect(modified.confidence).toBe(0.6);
  });
});

// ============================================================
// Issue Draft Tests
// ============================================================

describe("issue-draft", () => {
  test("generates title with surface and count", () => {
    const title = generateDraftTitle(makeCluster(), 5);
    expect(title).toContain("[web_app]");
    expect(title).toContain("5 public reports");
  });

  test("generates labels from cluster", () => {
    const labels = generateDraftLabels(makeCluster());
    expect(labels).toContain("bug");
    expect(labels).toContain("chat");
    expect(labels).toContain("web_app");
  });

  test("generates body with severity rationale", () => {
    const body = generateDraftBody(makeCluster(), 5);
    expect(body).toContain("5 public reports");
    expect(body).toContain("Data loss signals");
    expect(body).toContain("product_defect");
  });

  test("creates complete draft", () => {
    const draft = createDraft(makeCluster(), 5, "org/repo", "@dev");
    expect(draft.repo).toBe("org/repo");
    expect(draft.assignee_suggestion).toBe("@dev");
    expect(draft.priority).toBe("high");
  });

  test("detects duplicate titles", () => {
    const result = checkForDuplicates(
      "[web_app] Messages disappearing in chat",
      ["[web_app] Messages disappearing in chat"],
    );
    expect(result.found).toBe(true);
    expect(result.similarity).toBeGreaterThan(0.8);
  });

  test("no duplicate for different titles", () => {
    const result = checkForDuplicates(
      "[web_app] Chat crash on iOS",
      ["[api] Authentication timeout on v2 endpoint"],
    );
    expect(result.found).toBe(false);
  });
});

// ============================================================
// Review Command Tests
// ============================================================

describe("review-command", () => {
  test("parses details command", () => {
    const cmd = parseReviewCommand("details 3");
    expect(cmd.valid).toBe(true);
    expect(cmd.command).toBe("details");
    expect(cmd.clusterNumber).toBe(3);
  });

  test("parses file command", () => {
    const cmd = parseReviewCommand("file 1");
    expect(cmd.valid).toBe(true);
    expect(cmd.command).toBe("file");
  });

  test("parses confirm file command", () => {
    const cmd = parseReviewCommand("confirm file 2");
    expect(cmd.valid).toBe(true);
    expect(cmd.command).toBe("confirm file");
    expect(cmd.clusterNumber).toBe(2);
  });

  test("parses dismiss with reason", () => {
    const cmd = parseReviewCommand("dismiss 3 false positive");
    expect(cmd.valid).toBe(true);
    expect(cmd.command).toBe("dismiss");
    expect(cmd.args).toBe("false positive");
  });

  test("parses merge with issue", () => {
    const cmd = parseReviewCommand("merge 1 ISSUE-42");
    expect(cmd.valid).toBe(true);
    expect(cmd.args).toBe("issue-42");
  });

  test("parses snooze with duration", () => {
    const cmd = parseReviewCommand("snooze 2 24h");
    expect(cmd.valid).toBe(true);
    expect(cmd.command).toBe("snooze");
    expect(cmd.args).toBe("24h");
  });

  test("parses full-report", () => {
    const cmd = parseReviewCommand("full-report");
    expect(cmd.valid).toBe(true);
    expect(cmd.command).toBe("full-report");
  });

  test("rejects missing cluster number", () => {
    const cmd = parseReviewCommand("details");
    expect(cmd.valid).toBe(false);
    expect(cmd.error).toContain("Which cluster?");
  });

  test("rejects unrecognized command", () => {
    const cmd = parseReviewCommand("unknown 1");
    expect(cmd.valid).toBe(false);
    expect(cmd.error).toContain("Available commands");
  });
});

// ============================================================
// Action Confirmation Tests
// ============================================================

describe("action confirmation", () => {
  test("confirms dismiss with reason", () => {
    const cmd = parseReviewCommand("dismiss 1 noise");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toBe('Cluster #1 dismissed (noise). Suppression rule created.');
  });

  test("confirms file command", () => {
    const cmd = parseReviewCommand("file 2");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toContain("Draft issue created for cluster #2");
  });

  test("confirms confirm file command", () => {
    const cmd = parseReviewCommand("confirm file 3");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toBe("Issue filed for cluster #3.");
  });

  test("confirms escalate command", () => {
    const cmd = parseReviewCommand("escalate 1");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toContain("Cluster #1 escalated");
  });

  test("confirms monitor command", () => {
    const cmd = parseReviewCommand("monitor 4");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toContain("Cluster #4 set to monitoring");
  });

  test("confirms snooze with duration", () => {
    const cmd = parseReviewCommand("snooze 2 48h");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toBe("Cluster #2 snoozed for 48h.");
  });

  test("confirms merge with issue", () => {
    const cmd = parseReviewCommand("merge 1 ISSUE-42");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toContain("merged with issue-42");
  });

  test("confirms full-report", () => {
    const cmd = parseReviewCommand("full-report");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toContain("Displaying full report");
  });

  test("returns empty for invalid command", () => {
    const cmd = parseReviewCommand("invalid");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toBe("");
  });

  test("confirms details command", () => {
    const cmd = parseReviewCommand("details 5");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toContain("Showing details for cluster #5");
  });

  test("confirms split command", () => {
    const cmd = parseReviewCommand("split 3");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toContain("Cluster #3 split");
  });

  test("confirms reroute command", () => {
    const cmd = parseReviewCommand("reroute 2");
    const msg = formatActionConfirmation(cmd);
    expect(msg).toContain("Cluster #2 rerouted");
  });
});
