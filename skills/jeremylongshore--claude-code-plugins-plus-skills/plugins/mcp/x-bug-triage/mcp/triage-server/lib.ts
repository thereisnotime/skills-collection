/**
 * Triage server — consolidated business logic
 * X intake, repo analysis, routing, issue drafting, and command parsing.
 */

import type {
  XPost,
  XApiResponse,
  RateLimitState,
  RequestBudget,
  ApprovedSearch,
  PartialResultMetadata,
  DegradationReport,
  RepoEvidence,
  RepoScanResult,
  RoutingResult,
  RoutingRecommendation,
  IssueDraft,
  DuplicateCheck,
  ParsedCommand,
} from "./types";
import { TWEET_FIELDS, USER_FIELDS, MEDIA_FIELDS, EXPANSIONS, RATE_LIMITS } from "./types";
import type { BugCluster } from "../../lib/types";
import type { RoutingSourcePriorityConfig } from "../../lib/config";

// ============================================================
// X Intake — Query Compiler
// ============================================================

export function validateApprovedQuery(
  queryName: string,
  approvedSearches: ApprovedSearch[],
): ApprovedSearch {
  const found = approvedSearches.find((s) => s.name === queryName);
  if (!found) {
    throw new Error(
      `Query "${queryName}" is not in approved-searches.json. Available: ${approvedSearches.map((s) => s.name).join(", ")}`,
    );
  }
  return found;
}

export function validateQueryParenthesization(query: string): void {
  const orSegments = query.split(/\s+OR\s+/);
  if (orSegments.length > 1) {
    const stripped = query.trim();
    let depth = 0;
    let hasUnparenthesizedOr = false;
    for (let i = 0; i < stripped.length; i++) {
      if (stripped[i] === "(") depth++;
      if (stripped[i] === ")") depth--;
      if (depth === 0 && stripped.substring(i).match(/^\s+OR\s+/)) {
        hasUnparenthesizedOr = true;
        break;
      }
    }
    if (hasUnparenthesizedOr) {
      throw new Error(
        `Query contains unparenthesized OR groups. All OR groups must be wrapped in parentheses: ${query}`,
      );
    }
  }
}

export function compileSearchParams(query: string): Record<string, string> {
  validateQueryParenthesization(query);
  return {
    query,
    "tweet.fields": TWEET_FIELDS,
    "user.fields": USER_FIELDS,
    "media.fields": MEDIA_FIELDS,
    expansions: EXPANSIONS,
    max_results: "100",
  };
}

// ============================================================
// X Intake — Rate Limit Tracking
// ============================================================

const rateLimitState: Map<string, RateLimitState> = new Map();

export function updateRateLimitFromHeaders(
  endpoint: string,
  headers: Record<string, string>,
): RateLimitState {
  const state: RateLimitState = {
    endpoint,
    limit: parseInt(headers["x-rate-limit-limit"] || "0", 10),
    remaining: parseInt(headers["x-rate-limit-remaining"] || "0", 10),
    resetAt: parseInt(headers["x-rate-limit-reset"] || "0", 10),
  };
  rateLimitState.set(endpoint, state);
  return state;
}

export function getRateLimitState(endpoint: string): RateLimitState | undefined {
  return rateLimitState.get(endpoint);
}

export function isRateLimited(endpoint: string): boolean {
  const state = rateLimitState.get(endpoint);
  if (!state) return false;
  return state.remaining <= 0 && Date.now() / 1000 < state.resetAt;
}

export function getResetWaitMs(endpoint: string): number {
  const state = rateLimitState.get(endpoint);
  if (!state) return 0;
  const waitMs = (state.resetAt - Date.now() / 1000) * 1000;
  return Math.max(0, waitMs);
}

export function resetRateLimitState(): void {
  rateLimitState.clear();
}

// ============================================================
// X Intake — Budget Estimation
// ============================================================

export function estimateBudget(
  endpoint: string,
  estimatedRequests: number,
): RequestBudget {
  const state = rateLimitState.get(endpoint);
  const limits = RATE_LIMITS[endpoint];
  const remainingQuota = state?.remaining ?? limits?.limit ?? 0;
  const percentUsed = remainingQuota > 0 ? ((remainingQuota - estimatedRequests) / remainingQuota) * 100 : 100;

  return {
    endpoint,
    estimatedRequests,
    remainingQuota,
    percentUsed: Math.max(0, 100 - percentUsed),
    withinBudget: estimatedRequests <= remainingQuota,
  };
}

export function checkBudgetWarning(budget: RequestBudget): string | null {
  if (!budget.withinBudget) {
    return `Budget exceeded for ${budget.endpoint}: need ${budget.estimatedRequests}, have ${budget.remainingQuota}`;
  }
  if (budget.percentUsed > 80) {
    return `High usage for ${budget.endpoint}: ${budget.percentUsed.toFixed(0)}% of quota used`;
  }
  return null;
}

// ============================================================
// X Intake — Response Parsing
// ============================================================

export function parsePostsFromResponse(response: XApiResponse): XPost[] {
  if (!response.data) return [];
  return Array.isArray(response.data) ? response.data : [response.data];
}

export function buildMetadata(
  endpoint: string,
  posts: XPost[],
  response: XApiResponse,
  warnings: string[] = [],
): PartialResultMetadata {
  const state = rateLimitState.get(endpoint);
  return {
    endpoint,
    count: posts.length,
    has_more: !!response.meta?.next_token,
    rate_limit_remaining: state?.remaining ?? null,
    warnings,
    cost_estimate: 1,
  };
}

// ============================================================
// X Intake — Deduplication
// ============================================================

export function deduplicatePosts(posts: XPost[]): XPost[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
}

export function crossReferencePosts(
  mentionPosts: XPost[],
  searchPosts: XPost[],
): { combined: XPost[]; mentionOnly: number; searchOnly: number; overlap: number } {
  const mentionIds = new Set(mentionPosts.map((p) => p.id));
  const searchIds = new Set(searchPosts.map((p) => p.id));
  const overlap = [...mentionIds].filter((id) => searchIds.has(id)).length;

  const combined = deduplicatePosts([...mentionPosts, ...searchPosts]);
  return {
    combined,
    mentionOnly: mentionPosts.length - overlap,
    searchOnly: searchPosts.length - overlap,
    overlap,
  };
}

// ============================================================
// X Intake — Retry / Backoff
// ============================================================

export function calculateBackoff(attempt: number, resetAt?: number): number {
  if (resetAt && resetAt > Date.now() / 1000) {
    return (resetAt - Date.now() / 1000) * 1000 + 1000;
  }
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

export const MAX_RETRIES = 3;
export const REQUEST_TIMEOUT_MS = 30000;

// ============================================================
// X Intake — Degradation Reporting
// ============================================================

export function createDegradationReport(
  endpoint: string,
  status: DegradationReport["status"],
  retries: number,
  error?: string,
  skippedReason?: string,
): DegradationReport {
  return {
    endpoint,
    status,
    error,
    retries,
    skipped_reason: skippedReason,
  };
}

// ============================================================
// X Intake — URL Building
// ============================================================

const X_API_BASE = "https://api.x.com/2";

export function buildUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${X_API_BASE}/${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function buildMentionsUrl(userId: string, sinceId?: string): string {
  const params: Record<string, string> = {
    "tweet.fields": TWEET_FIELDS,
    "user.fields": USER_FIELDS,
    "media.fields": MEDIA_FIELDS,
    expansions: EXPANSIONS,
    max_results: "100",
  };
  if (sinceId) params.since_id = sinceId;
  return buildUrl(`users/${userId}/mentions`, params);
}

export function buildQuoteTweetsUrl(tweetId: string): string {
  return buildUrl(`tweets/${tweetId}/quote_tweets`, {
    "tweet.fields": TWEET_FIELDS,
    "user.fields": USER_FIELDS,
    expansions: EXPANSIONS,
    max_results: "100",
  });
}

export function buildUserLookupUrl(username: string): string {
  return buildUrl(`users/by/username/${username}`, {
    "user.fields": USER_FIELDS,
  });
}

export function buildSearchUrl(query: string, variant: "recent" | "all" = "recent", sinceId?: string): string {
  const params = compileSearchParams(query);
  if (sinceId) params.since_id = sinceId;
  const path = variant === "all" ? "tweets/search/all" : "tweets/search/recent";
  return buildUrl(path, params);
}

export function buildConversationSearchUrl(conversationId: string): string {
  return buildSearchUrl(`conversation_id:${conversationId}`);
}

// ============================================================
// Repo Analysis — Evidence Tiering
// ============================================================

export function rankRepos(surfaceRepos: string[], maxRepos: number = 3): string[] {
  return surfaceRepos.slice(0, maxRepos);
}

export function assignEvidenceTier(evidenceType: RepoEvidence["evidenceType"], confidence: number): 1 | 2 | 3 | 4 {
  switch (evidenceType) {
    case "issue_match":
      return confidence >= 0.9 ? 1 : confidence >= 0.7 ? 2 : 3;
    case "recent_commit":
      return confidence >= 0.8 ? 2 : 3;
    case "affected_path":
      return confidence >= 0.7 ? 2 : 3;
    case "recent_deploy":
      return confidence >= 0.8 ? 2 : 3;
    case "sibling_failure":
      return 3;
    case "external_dependency":
      return 4;
    default:
      return 4;
  }
}

export function createDegradedScanResult(repo: string, error: string): RepoScanResult {
  return { repo, evidence: [], scanned: false, error };
}

export function sortEvidenceByTier(evidence: RepoEvidence[]): RepoEvidence[] {
  return [...evidence].sort((a, b) => a.tier - b.tier);
}

export function isExternalDependency(evidence: RepoEvidence[]): boolean {
  return evidence.some((e) => e.evidenceType === "external_dependency");
}

// ============================================================
// Internal Routing — Staleness, Precedence, Overrides
// ============================================================

const STALENESS_THRESHOLD_DAYS = 30;

export function isStale(lastActiveDate: string | null, thresholdDays: number = STALENESS_THRESHOLD_DAYS): boolean {
  if (!lastActiveDate) return true;
  const daysSince = (Date.now() - new Date(lastActiveDate).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > thresholdDays;
}

export function buildRoutingRecommendation(
  clusterId: string,
  results: RoutingResult[],
  overrideParams: Record<string, unknown> | null,
): RoutingRecommendation {
  if (overrideParams) {
    return {
      cluster_id: clusterId,
      ranked_results: results,
      top_recommendation: {
        level: 0,
        source: "routing_override",
        team: (overrideParams.new_team as string) || undefined,
        assignee: (overrideParams.new_assignee as string) || undefined,
        confidence: 1.0,
        stale: false,
      },
      uncertainty: false,
      override_applied: true,
    };
  }

  const validResults = results.filter((r) => r.team || r.assignee);
  if (validResults.length === 0) {
    return {
      cluster_id: clusterId,
      ranked_results: [],
      top_recommendation: null,
      uncertainty: true,
      uncertainty_reason: "Routing: uncertain — no routing signals available. Manual assignment required.",
      override_applied: false,
    };
  }

  return {
    cluster_id: clusterId,
    ranked_results: validResults.sort((a, b) => a.level - b.level),
    top_recommendation: validResults[0],
    uncertainty: false,
    override_applied: false,
  };
}

export function applyPrecedenceConfidence(
  result: RoutingResult,
  precedenceConfig: RoutingSourcePriorityConfig,
): RoutingResult {
  const level = precedenceConfig.precedence.find((p) => p.level === result.level);
  if (level) {
    return { ...result, confidence: result.confidence * level.confidence_modifier };
  }
  return result;
}

// ============================================================
// Issue Draft — Title, Labels, Body, Duplicates
// ============================================================

export function generateDraftTitle(cluster: BugCluster, reportCount: number): string {
  const surface = cluster.product_surface ? `[${cluster.product_surface}]` : "";
  const symptom = cluster.title || cluster.bug_signature.split("|").slice(2).join(", ").slice(0, 80);
  return `${surface} ${symptom} — ${reportCount} public reports`.trim();
}

export function generateDraftLabels(cluster: BugCluster): string[] {
  const labels = ["bug"];
  if (cluster.feature_area) labels.push(cluster.feature_area);
  if (cluster.product_surface) labels.push(cluster.product_surface);
  return labels;
}

export function generateDraftBody(cluster: BugCluster, reportCount: number): string {
  const lines: string[] = [];
  lines.push(`${reportCount} public reports on X describe ${cluster.title || cluster.bug_signature}.`);
  lines.push("");
  lines.push(`**Surface:** ${cluster.product_surface || "unknown"}`);
  lines.push(`**Feature area:** ${cluster.feature_area || "unknown"}`);
  lines.push(`**Severity:** ${cluster.severity}`);
  if (cluster.severity_rationale) lines.push(`**Severity rationale:** ${cluster.severity_rationale}`);
  lines.push(`**Family:** ${cluster.cluster_family}`);
  lines.push(`**First seen:** ${cluster.first_seen}`);
  lines.push(`**Last seen:** ${cluster.last_seen}`);
  lines.push("");
  lines.push("---");
  lines.push("*Filed via x-bug-triage-plugin from public X complaint analysis.*");
  return lines.join("\n");
}

export function createDraft(cluster: BugCluster, reportCount: number, repo: string, assignee: string | null): IssueDraft {
  return {
    cluster_id: cluster.cluster_id,
    title: generateDraftTitle(cluster, reportCount),
    labels: generateDraftLabels(cluster),
    priority: cluster.severity,
    assignee_suggestion: assignee,
    body: generateDraftBody(cluster, reportCount),
    repo,
  };
}

export function checkForDuplicates(title: string, existingTitles: string[]): DuplicateCheck {
  for (const existing of existingTitles) {
    const similarity = calculateTitleSimilarity(title, existing);
    if (similarity > 0.8) {
      return { found: true, similarity };
    }
  }
  return { found: false, similarity: 0 };
}

function calculateTitleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

// ============================================================
// Review Command — Action Confirmation
// ============================================================

const CONFIRMATION_TEMPLATES: Record<string, (clusterNumber?: number, args?: string) => string> = {
  details: (n) => `Showing details for cluster #${n}.`,
  file: (n) => `Draft issue created for cluster #${n}. Use "confirm file ${n}" to submit.`,
  "confirm file": (n) => `Issue filed for cluster #${n}.`,
  dismiss: (n, args) => `Cluster #${n} dismissed (${args || "no reason"}). Suppression rule created.`,
  merge: (n, args) => `Cluster #${n} merged with ${args || "issue"}.`,
  escalate: (n) => `Cluster #${n} escalated. Severity raised.`,
  monitor: (n) => `Cluster #${n} set to monitoring.`,
  snooze: (n, args) => `Cluster #${n} snoozed for ${args || "24h"}.`,
  split: (n) => `Cluster #${n} split. Review new sub-clusters.`,
  reroute: (n) => `Cluster #${n} rerouted.`,
  "full-report": () => `Displaying full report for all clusters.`,
};

export function formatActionConfirmation(command: ParsedCommand): string {
  if (!command.valid) return "";
  const template = CONFIRMATION_TEMPLATES[command.command];
  if (!template) return "";
  return template(command.clusterNumber, command.args);
}

// ============================================================
// Review Command Parsing
// ============================================================

const VALID_COMMANDS = ["details", "file", "dismiss", "merge", "escalate", "monitor", "snooze", "split", "reroute", "full-report", "confirm"];

export function parseReviewCommand(text: string): ParsedCommand {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === "full-report") {
    return { command: "full-report", valid: true };
  }

  // "confirm file <#>"
  const confirmMatch = trimmed.match(/^confirm\s+file\s+(\d+)$/);
  if (confirmMatch) {
    return { command: "confirm file", clusterNumber: parseInt(confirmMatch[1], 10), valid: true };
  }

  // "<command> <#> [args]"
  const cmdMatch = trimmed.match(/^(\w+(?:-\w+)?)\s+(\d+)(?:\s+(.+))?$/);
  if (cmdMatch) {
    const [, cmd, num, args] = cmdMatch;
    if (VALID_COMMANDS.includes(cmd)) {
      return { command: cmd, clusterNumber: parseInt(num, 10), args, valid: true };
    }
    return { command: cmd, valid: false, error: `Available commands: ${VALID_COMMANDS.join(", ")}` };
  }

  // Just a command name without number
  const singleCmd = trimmed.match(/^(\w+(?:-\w+)?)$/);
  if (singleCmd && VALID_COMMANDS.includes(singleCmd[1]) && singleCmd[1] !== "full-report") {
    return { command: singleCmd[1], valid: false, error: "Which cluster?" };
  }

  return { command: trimmed, valid: false, error: `Available commands: ${VALID_COMMANDS.join(", ")}` };
}
