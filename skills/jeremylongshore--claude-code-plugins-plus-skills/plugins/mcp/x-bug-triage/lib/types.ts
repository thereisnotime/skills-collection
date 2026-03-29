/**
 * Shared TypeScript types for x-bug-triage-plugin.
 *
 * All enums, interfaces, and type aliases used across MCP servers,
 * agents, and the shared library. Import via `@lib/types`.
 *
 * @module
 */

// =============================================================================
// Classification
// =============================================================================

/**
 * The top-level classification assigned to an ingested post by the classifier.
 *
 * - `bug_report`                  — Genuine, actionable defect report.
 * - `sarcastic_bug_report`        — Complaint framed as sarcasm; treat as
 *                                   signal but flag for human review.
 * - `feature_request`             — User asking for new or changed behavior.
 * - `account_problem`             — Login, 2FA, account suspension, etc.
 * - `billing_problem`             — Payment, subscription, charge dispute.
 * - `policy_or_expectation_mismatch` — Product works as intended but the user
 *                                      expected different behavior.
 * - `ux_friction`                 — Not a defect; workflow is confusing or
 *                                   laborious.
 * - `model_quality_issue`         — Quality of AI output (hallucination,
 *                                   reasoning, tone, etc.).
 * - `user_error_or_confusion`     — User misunderstood the product.
 * - `praise`                      — Positive feedback; no action required.
 * - `noise`                       — Spam, off-topic, unrelated content.
 * - `needs_review`                — Classifier is uncertain; escalate to human.
 */
export type Classification =
  | "bug_report"
  | "sarcastic_bug_report"
  | "feature_request"
  | "account_problem"
  | "billing_problem"
  | "policy_or_expectation_mismatch"
  | "ux_friction"
  | "model_quality_issue"
  | "user_error_or_confusion"
  | "praise"
  | "noise"
  | "needs_review";

// =============================================================================
// Cluster family
// =============================================================================

/**
 * Broad family a bug cluster belongs to. Used for routing and dashboard
 * roll-ups.
 *
 * - `product_defect`      — Code-level defect in the product surface.
 * - `model_quality_defect`— Defect in AI model output quality.
 * - `policy_mismatch`     — User expectation does not match stated policy.
 * - `ux_friction`         — Non-defect but high-friction user experience.
 */
export type ClusterFamily =
  | "product_defect"
  | "model_quality_defect"
  | "policy_mismatch"
  | "ux_friction";

// =============================================================================
// Cluster lifecycle
// =============================================================================

/**
 * Primary lifecycle state of a bug cluster.
 *
 * - `open`           — Active; no downstream action taken yet.
 * - `filed`          — GitHub issue has been filed.
 * - `monitoring`     — Filed and being watched; no new action needed now.
 * - `fix_deployed`   — A fix has shipped; watching for regression reports.
 * - `resolved`       — Confirmed resolved; cluster is being wound down.
 * - `closed`         — Cluster is closed; no further reporting expected.
 * - `suppressed`     — Matched a suppression rule; excluded from routing.
 */
export type ClusterState =
  | "open"
  | "filed"
  | "monitoring"
  | "fix_deployed"
  | "resolved"
  | "closed"
  | "suppressed";

/**
 * Secondary signal layered on top of `ClusterState`. A cluster can be in
 * state `filed` while simultaneously having sub-status `new_evidence`.
 *
 * - `new_evidence`          — New reports arrived after initial filing.
 * - `late_tail`             — Low-volume trickle well after peak; normal
 *                             decay.
 * - `regression_reopened`   — Reports reappearing after `fix_deployed`.
 * - `possible_duplicate`    — Likely a duplicate of another cluster.
 */
export type ClusterSubStatus =
  | "new_evidence"
  | "late_tail"
  | "regression_reopened"
  | "possible_duplicate";

// =============================================================================
// Severity
// =============================================================================

/**
 * Bug severity, derived from consequence and blast radius — NOT from reporter
 * prestige or cluster size alone.
 *
 * High/critical assignments MUST be accompanied by a `severity_rationale`.
 */
export type Severity = "low" | "medium" | "high" | "critical";

// =============================================================================
// Evidence tier
// =============================================================================

/**
 * Confidence tier for evidence used in clustering decisions.
 *
 * | Tier | Label    | Usage                                               |
 * |------|----------|-----------------------------------------------------|
 * | 1    | Exact    | Alone sufficient to justify clustering.             |
 * | 2    | Strong   | Strengthens; does not silently substitute Tier 1.  |
 * | 3    | Moderate | Supports grouping; not sufficient for routing.     |
 * | 4    | Weak     | Must never be presented as hard evidence.          |
 */
export type EvidenceTier = 1 | 2 | 3 | 4;

// =============================================================================
// Override
// =============================================================================

/**
 * Type of a human-authored review override.
 *
 * - `cluster_merge`      — Merge two clusters into one.
 * - `cluster_split`      — Split one cluster into two.
 * - `noise_suppression`  — Mark a cluster as noise and suppress it.
 * - `routing_override`   — Change the downstream routing target.
 * - `issue_family_link`  — Link a cluster to a specific GitHub issue/family.
 * - `severity_override`  — Manually override the computed severity.
 * - `label_correction`   — Correct the assigned classification label.
 * - `snooze`             — Temporarily suppress routing until `expires_at`.
 */
export type OverrideType =
  | "cluster_merge"
  | "cluster_split"
  | "noise_suppression"
  | "routing_override"
  | "issue_family_link"
  | "severity_override"
  | "label_correction"
  | "snooze";

// =============================================================================
// Ingestion source
// =============================================================================

/**
 * How the post arrived in the ingestion pipeline.
 *
 * - `reply`       — Direct reply to a monitored account.
 * - `mention`     — Mention of a monitored handle.
 * - `quote_post`  — Quote post referencing monitored content.
 * - `search_hit`  — Matched a keyword search query.
 * - `stream_hit`  — Matched a filtered stream rule.
 */
export type SourceType =
  | "reply"
  | "mention"
  | "quote_post"
  | "search_hit"
  | "stream_hit";

// =============================================================================
// PII / storage policy
// =============================================================================

/**
 * Storage policy applied to raw post text after PII redaction.
 *
 * - `store_redacted`   — Store the redacted version (`[REDACTED:type]` tags).
 * - `store_hash_only`  — Store only a content hash; no text.
 * - `do_not_store`     — Discard text entirely; nothing persisted.
 *
 * Raw unredacted text is NEVER stored regardless of policy.
 */
export type StoragePolicy =
  | "store_redacted"
  | "store_hash_only"
  | "do_not_store";

// =============================================================================
// Reporter
// =============================================================================

/**
 * Category of the post's author.
 *
 * Reporter reliability is supporting signal only — low reliability alone
 * does not invalidate a bug hypothesis and must never suppress
 * security/privacy/data-loss/billing candidates.
 *
 * - `public`    — General public user.
 * - `internal`  — Anthropic employee or contractor.
 * - `partner`   — Verified API/enterprise partner.
 * - `tester`    — Known beta tester or QA participant.
 */
export type ReporterCategory = "public" | "internal" | "partner" | "tester";

// =============================================================================
// Audit log
// =============================================================================

/**
 * Event types recorded in the audit log.
 *
 * - `ingest_run_started`      — A triage run began.
 * - `ingest_run_completed`    — A triage run finished (any status).
 * - `source_fetched`          — An API source was fetched.
 * - `candidate_classified`    — A post was classified.
 * - `pii_redaction`           — PII was detected and redacted.
 * - `cluster_created`         — A new cluster was created.
 * - `cluster_updated`         — An existing cluster was updated.
 * - `cluster_state_changed`   — A cluster's state/sub-status changed.
 * - `routing_recommendation`  — A routing decision was generated.
 * - `escalation_triggered`    — An escalation was triggered.
 * - `human_action`            — A human performed a Slack review action.
 * - `override_created`        — A `ReviewOverride` record was persisted.
 */
export type AuditEventType =
  | "ingest_run_started"
  | "ingest_run_completed"
  | "source_fetched"
  | "candidate_classified"
  | "pii_redaction"
  | "cluster_created"
  | "cluster_updated"
  | "cluster_state_changed"
  | "routing_recommendation"
  | "escalation_triggered"
  | "human_action"
  | "override_created";

// =============================================================================
// Triage run
// =============================================================================

/**
 * Terminal/non-terminal status of a `TriageRun`.
 *
 * - `running`    — In progress.
 * - `completed`  — Finished successfully.
 * - `partial`    — Finished but some sources/steps failed; warnings emitted.
 * - `failed`     — Fatal failure; run did not produce usable output.
 */
export type TriageRunStatus = "running" | "completed" | "partial" | "failed";

// =============================================================================
// Issue link
// =============================================================================

/**
 * Relationship type between a cluster and a GitHub issue.
 *
 * - `filed`   — This cluster directly caused the issue to be filed.
 * - `merged`  — The cluster was merged into this issue after filing.
 * - `related` — Loosely related; not the primary driver.
 */
export type IssueLinkType = "filed" | "merged" | "related";

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Public engagement metrics for an X/Twitter post as returned by the
 * Twitter v2 API `public_metrics` field.
 */
export interface PublicMetrics {
  like_count: number;
  reply_count: number;
  retweet_count: number;
  quote_count: number;
}

/**
 * A post referenced by another post (e.g., reply parent, quoted post).
 * Maps to the Twitter v2 `referenced_tweets` array element.
 */
export interface ReferencedPost {
  /** Reference type, e.g. `"replied_to"`, `"quoted"`, `"retweeted"`. */
  type: string;
  /** Post ID of the referenced post. */
  id: string;
}

/**
 * A normalized, classified, and PII-redacted candidate bug report derived
 * from a single X/Twitter post.
 *
 * Fields that store arrays or objects are noted as "stored as JSON" —
 * SQLite serializes them as JSON text; application code deserializes on read.
 *
 * Scores are in the range [0.0, 1.0] unless otherwise noted.
 */
export interface BugCandidate {
  /** X/Twitter post ID (string representation of uint64). */
  post_id: string;
  /** Author's X handle without the leading `@`. */
  author_handle: string;
  /** Author's X user ID. */
  author_id: string;
  /** Post creation time in ISO 8601 format. */
  timestamp: string;
  /** How this post entered the ingestion pipeline. */
  source_type: SourceType;
  /** Product surface the complaint targets (e.g., `"claude.ai"`, `"api"`). */
  product_surface: string | null;
  /** Feature area within the product surface (e.g., `"artifacts"`, `"tools"`). */
  feature_area: string | null;
  /** Extracted symptom phrases. Stored as JSON. */
  symptoms: string[];
  /** Verbatim error strings or codes extracted from the post. Stored as JSON. */
  error_strings: string[];
  /** Reproduction hints extracted from the post. Stored as JSON. */
  repro_hints: string[];
  /** URLs found in the post. Stored as JSON. */
  urls: string[];
  /** True if the post contains attached media. */
  has_media: boolean;
  /** Twitter media keys for attached media. Stored as JSON. */
  media_keys: string[];
  /** BCP 47 language tag detected for the post, e.g. `"en"`. */
  language: string | null;
  /** Twitter conversation thread ID. */
  conversation_id: string | null;
  /** Post ID of the thread root. */
  thread_root_id: string | null;
  /** Post ID this post is a direct reply to. */
  reply_to_id: string | null;
  /** Posts referenced by this post. Stored as JSON. */
  referenced_post_ids: ReferencedPost[];
  /** Engagement metrics from the Twitter API. Stored as JSON. */
  public_metrics: PublicMetrics | null;
  /** Top-level classification assigned by the classifier. */
  classification: Classification;
  /** Classifier confidence in [0.0, 1.0]. */
  classification_confidence: number;
  /** Natural-language rationale for the classification. */
  classification_rationale: string | null;
  /**
   * Composite quality score for the bug report itself — clarity, specificity,
   * presence of repro steps. In [0.0, 1.0].
   */
  report_quality_score: number | null;
  /**
   * Probability estimate that this post is independent of other posts
   * in the same cluster (not a retweet/reshare chain). In [0.0, 1.0].
   */
  independence_score: number | null;
  /**
   * Signal of author account authenticity (age, follower ratio, etc.).
   * In [0.0, 1.0].
   */
  account_authenticity_score: number | null;
  /**
   * Historical accuracy of this author's prior bug reports where outcome
   * is known. In [0.0, 1.0].
   */
  historical_accuracy_score: number | null;
  /**
   * Composite reporter reliability score. Supporting signal only — never
   * used as sole justification to suppress a report. In [0.0, 1.0].
   */
  reporter_reliability_score: number | null;
  /** Category of the reporter. */
  reporter_category: ReporterCategory;
  /**
   * PII type tags detected and redacted from this post.
   * Values match the `[REDACTED:type]` substitution tokens.
   * Stored as JSON.
   */
  pii_flags: string[];
  /**
   * Redacted post text with PII replaced by `[REDACTED:type]` tokens.
   * Null when `raw_text_storage_policy` is `store_hash_only` or
   * `do_not_store`.
   */
  raw_text_redacted: string | null;
  /** Governs how (or whether) the redacted text is persisted. */
  raw_text_storage_policy: StoragePolicy;
  /** ID of the `TriageRun` that ingested this candidate. */
  triage_run_id: string;
}

/**
 * A cluster grouping one or more `BugCandidate` records that share the same
 * underlying defect, as determined by the bug-clusterer agent.
 *
 * Severity must be derived from consequence and blast radius. High/critical
 * assignments require a non-null `severity_rationale`.
 */
export interface BugCluster {
  /** UUID v4 cluster identifier. */
  cluster_id: string;
  /**
   * Stable canonical signature used to deduplicate clusters across runs.
   * Typically a hash of normalized symptom + surface + feature_area.
   */
  bug_signature: string;
  /** Broad family this cluster belongs to. */
  cluster_family: ClusterFamily;
  /** Product surface most reports in this cluster target. */
  product_surface: string | null;
  /** Feature area most reports in this cluster target. */
  feature_area: string | null;
  /** Human-readable short title synthesized by the clusterer. */
  title: string | null;
  /** Computed severity of this cluster. */
  severity: Severity;
  /**
   * Required when `severity` is `"high"` or `"critical"`. Natural-language
   * justification citing consequence or blast radius.
   */
  severity_rationale: string | null;
  /** Current lifecycle state. */
  state: ClusterState;
  /** Optional secondary state signal. */
  sub_status: ClusterSubStatus | null;
  /** Total number of distinct, independent reports in this cluster. */
  report_count: number;
  /** Timestamp of the earliest report in this cluster. ISO 8601. */
  first_seen: string;
  /** Timestamp of the most recent report in this cluster. ISO 8601. */
  last_seen: string;
  /** Timestamp when this cluster record was created. ISO 8601. */
  created_at: string;
  /** Timestamp when this cluster record was last updated. ISO 8601. */
  updated_at: string;
  /** ID of the `TriageRun` that created this cluster. */
  triage_run_id: string;
}

/**
 * Join record linking a `BugCandidate` post to a `BugCluster`.
 * A single post can belong to at most one cluster.
 */
export interface ClusterPost {
  /** FK → `BugCluster.cluster_id`. */
  cluster_id: string;
  /** FK → `BugCandidate.post_id`. */
  post_id: string;
  /** Timestamp when this membership was recorded. ISO 8601. */
  added_at: string;
  /** ID of the `TriageRun` that added this membership. */
  added_by_run_id: string;
}

/**
 * A human-authored correction or directive applied during Slack review.
 * Persisted before being acted on so that the pipeline is fully auditable.
 */
export interface ReviewOverride {
  /** UUID v4 override identifier. */
  override_id: string;
  /** Type of corrective action. */
  override_type: OverrideType;
  /** Cluster this override applies to, if applicable. */
  target_cluster_id: string | null;
  /**
   * Override-type-specific parameters (e.g., merge target cluster ID,
   * new severity value). Stored as JSON.
   */
  parameters: Record<string, unknown>;
  /** Human-authored justification for this override. */
  reason: string;
  /** Identity of the person who created this override. */
  created_by: string;
  /** Timestamp when this override was created. ISO 8601. */
  created_at: string;
  /**
   * Expiry timestamp for `snooze` overrides. Null for permanent overrides.
   * ISO 8601.
   */
  expires_at: string | null;
  /** Whether this override is currently active (not expired or revoked). */
  active: boolean;
}

/**
 * A persistent rule that suppresses routing for posts or clusters matching
 * a given pattern. Evaluated before routing recommendations are generated.
 */
export interface SuppressionRule {
  /** UUID v4 rule identifier. */
  rule_id: string;
  /**
   * Pattern type indicating how `pattern_value` should be interpreted,
   * e.g. `"regex"`, `"substring"`, `"author_id"`, `"bug_signature"`.
   */
  pattern_type: string;
  /** The pattern value to match against. */
  pattern_value: string;
  /** Human-authored reason for this suppression rule. */
  reason: string;
  /** Identity of the person who created this rule. */
  created_by: string;
  /** Timestamp when this rule was created. ISO 8601. */
  created_at: string;
  /** Expiry timestamp. Null for non-expiring rules. ISO 8601. */
  expires_at: string | null;
  /** Whether this rule is currently active. */
  active: boolean;
}

/**
 * A link between a `BugCluster` and a GitHub issue.
 * Supports the full lifecycle from initial filing through merges and
 * related-issue tracking.
 */
export interface IssueLink {
  /** UUID v4 link identifier. */
  link_id: string;
  /** FK → `BugCluster.cluster_id`. */
  cluster_id: string;
  /** Full URL of the GitHub issue (e.g., `https://github.com/owner/repo/issues/123`). */
  issue_url: string;
  /** GitHub issue number. Null if the URL cannot be parsed to a number. */
  issue_number: number | null;
  /** GitHub repository in `owner/repo` format. */
  repo: string;
  /** Relationship type between the cluster and the issue. */
  link_type: IssueLinkType;
  /** Timestamp when this link was created. ISO 8601. */
  created_at: string;
}

/**
 * A single execution of the full triage pipeline — from ingestion through
 * clustering and routing. One run processes all configured X sources.
 */
export interface TriageRun {
  /** UUID v4 run identifier. */
  run_id: string;
  /** Timestamp when this run started. ISO 8601. */
  started_at: string;
  /** Timestamp when this run finished. Null if still in progress. ISO 8601. */
  completed_at: string | null;
  /** Terminal or non-terminal run status. */
  status: TriageRunStatus;
  /**
   * X account handles ingested during this run (without leading `@`).
   * Stored as JSON.
   */
  accounts_ingested: string[] | null;
  /**
   * Summary keyed by endpoint name with counts, latencies, or error info.
   * Stored as JSON.
   */
  endpoints_summary: Record<string, unknown> | null;
  /** Total number of posts parsed and normalized as `BugCandidate` records. */
  candidates_parsed: number;
  /** Number of new `BugCluster` records created during this run. */
  clusters_created: number;
  /** Number of existing `BugCluster` records updated during this run. */
  clusters_updated: number;
  /**
   * Non-fatal warnings emitted during this run (e.g., rate-limit retries,
   * partial source failures). Stored as JSON.
   */
  warnings: string[] | null;
}

/**
 * An immutable audit log entry. Written by all pipeline components for
 * compliance, debugging, and post-incident review.
 *
 * All fields except `event_id`, `event_type`, and `timestamp` are
 * contextual and may be null depending on the event type.
 */
export interface AuditEntry {
  /** UUID v4 audit event identifier. */
  event_id: string;
  /** The type of pipeline event being recorded. */
  event_type: AuditEventType;
  /** Timestamp when this event occurred. ISO 8601. */
  timestamp: string;
  /** FK → `TriageRun.run_id`, if this event occurred within a run. */
  run_id: string | null;
  /** FK → `BugCluster.cluster_id`, if this event pertains to a cluster. */
  cluster_id: string | null;
  /** FK → `BugCandidate.post_id`, if this event pertains to a post. */
  post_id: string | null;
  /**
   * Event-type-specific payload. Schema varies by `event_type`.
   * Stored as JSON.
   */
  details: Record<string, unknown>;
}
