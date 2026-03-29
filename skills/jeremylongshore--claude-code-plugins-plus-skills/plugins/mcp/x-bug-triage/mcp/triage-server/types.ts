/**
 * Consolidated triage server types
 * Merged from x-intake, repo-analysis, internal-routing, issue-draft servers
 */

// === X Intake Types ===

export interface XApiConfig {
  bearerToken: string;
  baseUrl: string;
}

export interface RateLimitState {
  endpoint: string;
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp
}

export interface RequestBudget {
  endpoint: string;
  estimatedRequests: number;
  remainingQuota: number;
  percentUsed: number;
  withinBudget: boolean;
}

export interface PartialResultMetadata {
  endpoint: string;
  count: number;
  has_more: boolean;
  rate_limit_remaining: number | null;
  warnings: string[];
  cost_estimate: number;
}

export interface XPost {
  id: string;
  text: string;
  author_id: string;
  conversation_id?: string;
  created_at: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{ type: string; id: string }>;
  attachments?: { media_keys?: string[] };
  public_metrics?: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
    quote_count: number;
  };
  entities?: {
    urls?: Array<{ expanded_url: string }>;
    mentions?: Array<{ username: string }>;
  };
  lang?: string;
}

export interface XUser {
  id: string;
  username: string;
  name: string;
  verified?: boolean;
  created_at?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
}

export interface XApiResponse<T = XPost[]> {
  data: T;
  includes?: {
    users?: XUser[];
    tweets?: XPost[];
    media?: Array<{ media_key: string; type: string; url?: string }>;
  };
  meta?: {
    next_token?: string;
    result_count?: number;
    newest_id?: string;
    oldest_id?: string;
  };
}

export interface ApprovedSearch {
  name: string;
  query: string;
  description?: string;
}

export interface IntakeResult {
  posts: XPost[];
  metadata: PartialResultMetadata;
}

export interface DegradationReport {
  endpoint: string;
  status: "succeeded" | "degraded" | "failed";
  error?: string;
  retries: number;
  skipped_reason?: string;
}

export const TWEET_FIELDS = "id,text,author_id,conversation_id,created_at,in_reply_to_user_id,referenced_tweets,attachments,public_metrics,entities,lang";
export const USER_FIELDS = "id,username,name,verified,created_at,public_metrics";
export const MEDIA_FIELDS = "media_key,type,url,preview_image_url";
export const EXPANSIONS = "author_id,referenced_tweets.id,attachments.media_keys,in_reply_to_user_id";

export const RATE_LIMITS: Record<string, { limit: number; window: number }> = {
  "users/by/username": { limit: 300, window: 900 },
  "users/:id/mentions": { limit: 450, window: 900 },
  "tweets/search/recent": { limit: 300, window: 900 },
  "tweets/search/all": { limit: 300, window: 900 },
  "tweets/:id/quote_tweets": { limit: 75, window: 900 },
};

// === Repo Analysis Types ===

export interface RepoEvidence {
  repo: string;
  evidenceType: "issue_match" | "recent_commit" | "affected_path" | "recent_deploy" | "sibling_failure" | "external_dependency";
  tier: 1 | 2 | 3 | 4;
  title: string;
  url?: string;
  description: string;
  timestamp?: string;
  confidence: number;
}

export interface RepoScanResult {
  repo: string;
  evidence: RepoEvidence[];
  scanned: boolean;
  error?: string;
}

// === Internal Routing Types ===

export interface RoutingResult {
  level: number;
  source: string;
  team?: string;
  assignee?: string;
  confidence: number;
  stale: boolean;
  staleDays?: number;
}

export interface RoutingRecommendation {
  cluster_id: string;
  ranked_results: RoutingResult[];
  top_recommendation: RoutingResult | null;
  uncertainty: boolean;
  uncertainty_reason?: string;
  override_applied: boolean;
}

// === Issue Draft Types ===

export interface IssueDraft {
  cluster_id: string;
  title: string;
  labels: string[];
  priority: string;
  assignee_suggestion: string | null;
  body: string;
  repo: string;
}

export interface DuplicateCheck {
  found: boolean;
  existing_issue_url?: string;
  existing_issue_number?: number;
  similarity: number;
}

// === Review Command Types ===

export interface ParsedCommand {
  command: string;
  clusterNumber?: number;
  args?: string;
  valid: boolean;
  error?: string;
}
