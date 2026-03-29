import { Database } from "bun:sqlite";
import { join } from "path";

const DEFAULT_DB_PATH = join(import.meta.dir, "..", "data", "triage.db");

let _db: Database | null = null;

export function getDb(path: string = DEFAULT_DB_PATH): Database {
  if (!_db || _db.filename !== path) {
    _db = new Database(path, { create: true });
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function transaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// --- Triage Runs ---

import type {
  TriageRun,
  BugCandidate,
  BugCluster,
  ClusterPost,
  ReviewOverride,
  SuppressionRule,
  IssueLink,
  AuditEntry,
} from "./types";

export function insertTriageRun(db: Database, run: TriageRun): void {
  db.query(`
    INSERT INTO triage_runs (run_id, started_at, completed_at, status, accounts_ingested, endpoints_summary, candidates_parsed, clusters_created, clusters_updated, warnings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.run_id,
    run.started_at,
    run.completed_at,
    run.status,
    run.accounts_ingested ? JSON.stringify(run.accounts_ingested) : null,
    run.endpoints_summary ? JSON.stringify(run.endpoints_summary) : null,
    run.candidates_parsed,
    run.clusters_created,
    run.clusters_updated,
    run.warnings ? JSON.stringify(run.warnings) : null,
  );
}

export function getTriageRun(db: Database, runId: string): TriageRun | null {
  const row = db.query("SELECT * FROM triage_runs WHERE run_id = ?").get(runId) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    ...row,
    accounts_ingested: row.accounts_ingested ? JSON.parse(row.accounts_ingested as string) : null,
    endpoints_summary: row.endpoints_summary ? JSON.parse(row.endpoints_summary as string) : null,
    warnings: row.warnings ? JSON.parse(row.warnings as string) : null,
  } as TriageRun;
}

export function updateTriageRun(db: Database, runId: string, updates: Partial<TriageRun>): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === "run_id") continue;
    fields.push(`${key} = ?`);
    if (typeof value === "object" && value !== null) {
      values.push(JSON.stringify(value));
    } else {
      values.push(value as string | number | null);
    }
  }
  values.push(runId);
  db.query(`UPDATE triage_runs SET ${fields.join(", ")} WHERE run_id = ?`).run(...values);
}

// --- Candidates ---

export function insertCandidate(db: Database, c: BugCandidate): void {
  db.query(`
    INSERT INTO candidates (
      post_id, author_handle, author_id, timestamp, source_type,
      product_surface, feature_area, symptoms, error_strings, repro_hints,
      urls, has_media, media_keys, language, conversation_id,
      thread_root_id, reply_to_id, referenced_post_ids, public_metrics,
      classification, classification_confidence, classification_rationale,
      report_quality_score, independence_score, account_authenticity_score,
      historical_accuracy_score, reporter_reliability_score, reporter_category,
      pii_flags, raw_text_redacted, raw_text_storage_policy, triage_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.post_id, c.author_handle, c.author_id, c.timestamp, c.source_type,
    c.product_surface, c.feature_area,
    JSON.stringify(c.symptoms), JSON.stringify(c.error_strings), JSON.stringify(c.repro_hints),
    JSON.stringify(c.urls), c.has_media ? 1 : 0, JSON.stringify(c.media_keys),
    c.language, c.conversation_id, c.thread_root_id, c.reply_to_id,
    JSON.stringify(c.referenced_post_ids), c.public_metrics ? JSON.stringify(c.public_metrics) : null,
    c.classification, c.classification_confidence, c.classification_rationale,
    c.report_quality_score, c.independence_score, c.account_authenticity_score,
    c.historical_accuracy_score, c.reporter_reliability_score, c.reporter_category,
    JSON.stringify(c.pii_flags), c.raw_text_redacted, c.raw_text_storage_policy, c.triage_run_id,
  );
}

export function getCandidate(db: Database, postId: string): BugCandidate | null {
  const row = db.query("SELECT * FROM candidates WHERE post_id = ?").get(postId) as Record<string, unknown> | null;
  if (!row) return null;
  return deserializeCandidate(row);
}

export function getCandidatesByRun(db: Database, runId: string): BugCandidate[] {
  const rows = db.query("SELECT * FROM candidates WHERE triage_run_id = ?").all(runId) as Record<string, unknown>[];
  return rows.map(deserializeCandidate);
}

function deserializeCandidate(row: Record<string, unknown>): BugCandidate {
  return {
    ...row,
    symptoms: JSON.parse((row.symptoms as string) || "[]"),
    error_strings: JSON.parse((row.error_strings as string) || "[]"),
    repro_hints: JSON.parse((row.repro_hints as string) || "[]"),
    urls: JSON.parse((row.urls as string) || "[]"),
    has_media: Boolean(row.has_media),
    media_keys: JSON.parse((row.media_keys as string) || "[]"),
    referenced_post_ids: JSON.parse((row.referenced_post_ids as string) || "[]"),
    public_metrics: row.public_metrics ? JSON.parse(row.public_metrics as string) : null,
    pii_flags: JSON.parse((row.pii_flags as string) || "[]"),
  } as BugCandidate;
}

// --- Clusters ---

export function insertCluster(db: Database, c: BugCluster): void {
  db.query(`
    INSERT INTO clusters (cluster_id, bug_signature, cluster_family, product_surface, feature_area, title, severity, severity_rationale, state, sub_status, report_count, first_seen, last_seen, created_at, updated_at, triage_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.cluster_id, c.bug_signature, c.cluster_family, c.product_surface, c.feature_area,
    c.title, c.severity, c.severity_rationale, c.state, c.sub_status,
    c.report_count, c.first_seen, c.last_seen, c.created_at, c.updated_at, c.triage_run_id,
  );
}

export function getCluster(db: Database, clusterId: string): BugCluster | null {
  return db.query("SELECT * FROM clusters WHERE cluster_id = ?").get(clusterId) as BugCluster | null;
}

export function getClustersByState(db: Database, state: string): BugCluster[] {
  return db.query("SELECT * FROM clusters WHERE state = ?").all(state) as BugCluster[];
}

export function updateCluster(db: Database, clusterId: string, updates: Partial<BugCluster>): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === "cluster_id") continue;
    fields.push(`${key} = ?`);
    values.push(value as string | number | null);
  }
  values.push(clusterId);
  db.query(`UPDATE clusters SET ${fields.join(", ")} WHERE cluster_id = ?`).run(...values);
}

// --- Cluster Posts ---

export function insertClusterPost(db: Database, cp: ClusterPost): void {
  db.query(`
    INSERT INTO cluster_posts (cluster_id, post_id, added_at, added_by_run_id)
    VALUES (?, ?, ?, ?)
  `).run(cp.cluster_id, cp.post_id, cp.added_at, cp.added_by_run_id);
}

export function getClusterPosts(db: Database, clusterId: string): ClusterPost[] {
  return db.query("SELECT * FROM cluster_posts WHERE cluster_id = ?").all(clusterId) as ClusterPost[];
}

// --- Overrides ---

export function insertOverride(db: Database, o: ReviewOverride): void {
  db.query(`
    INSERT INTO overrides (override_id, override_type, target_cluster_id, parameters, reason, created_by, created_at, expires_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    o.override_id, o.override_type, o.target_cluster_id,
    JSON.stringify(o.parameters), o.reason, o.created_by, o.created_at,
    o.expires_at, o.active ? 1 : 0,
  );
}

export function getActiveOverrides(db: Database): ReviewOverride[] {
  const rows = db.query("SELECT * FROM overrides WHERE active = 1").all() as Record<string, unknown>[];
  return rows.map((row) => ({
    ...row,
    parameters: JSON.parse(row.parameters as string),
    active: Boolean(row.active),
  })) as ReviewOverride[];
}

// --- Suppression Rules ---

export function insertSuppressionRule(db: Database, s: SuppressionRule): void {
  db.query(`
    INSERT INTO suppression_rules (rule_id, pattern_type, pattern_value, reason, created_by, created_at, expires_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(s.rule_id, s.pattern_type, s.pattern_value, s.reason, s.created_by, s.created_at, s.expires_at, s.active ? 1 : 0);
}

export function getActiveSuppressionRules(db: Database): SuppressionRule[] {
  const rows = db.query("SELECT * FROM suppression_rules WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))").all() as Record<string, unknown>[];
  return rows.map((row) => ({ ...row, active: Boolean(row.active) })) as SuppressionRule[];
}

// --- Issue Links ---

export function insertIssueLink(db: Database, l: IssueLink): void {
  db.query(`
    INSERT INTO issue_links (link_id, cluster_id, issue_url, issue_number, repo, link_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(l.link_id, l.cluster_id, l.issue_url, l.issue_number, l.repo, l.link_type, l.created_at);
}

export function getIssueLinksForCluster(db: Database, clusterId: string): IssueLink[] {
  return db.query("SELECT * FROM issue_links WHERE cluster_id = ?").all(clusterId) as IssueLink[];
}

// --- Audit Log ---

export function insertAuditEntry(db: Database, e: AuditEntry): void {
  db.query(`
    INSERT INTO audit_log (event_id, event_type, timestamp, run_id, cluster_id, post_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(e.event_id, e.event_type, e.timestamp, e.run_id, e.cluster_id, e.post_id, JSON.stringify(e.details));
}

export function getAuditEntriesByRun(db: Database, runId: string): AuditEntry[] {
  const rows = db.query("SELECT * FROM audit_log WHERE run_id = ?").all(runId) as Record<string, unknown>[];
  return rows.map((row) => ({ ...row, details: JSON.parse(row.details as string) })) as AuditEntry[];
}

export function getAuditEntriesByType(db: Database, eventType: string): AuditEntry[] {
  const rows = db.query("SELECT * FROM audit_log WHERE event_type = ?").all(eventType) as Record<string, unknown>[];
  return rows.map((row) => ({ ...row, details: JSON.parse(row.details as string) })) as AuditEntry[];
}
