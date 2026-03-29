import { Database } from "bun:sqlite";
import type { RetentionPolicyConfig } from "./config";

export interface RetentionReport {
  candidatesRedactedDeleted: number;
  candidatesHashOnlyDeleted: number;
  closedClustersDeleted: number;
  auditLogsDeleted: number;
  orphanedClusterPostsDeleted: number;
}

export function enforceRetention(db: Database, policy: RetentionPolicyConfig): RetentionReport {
  const report: RetentionReport = {
    candidatesRedactedDeleted: 0,
    candidatesHashOnlyDeleted: 0,
    closedClustersDeleted: 0,
    auditLogsDeleted: 0,
    orphanedClusterPostsDeleted: 0,
  };

  // Delete redacted candidates older than retention period
  const r1 = db.query(
    `DELETE FROM candidates WHERE raw_text_storage_policy = 'store_redacted' AND timestamp < datetime('now', '-' || ? || ' days')`
  ).run(policy.candidates_redacted_days);
  report.candidatesRedactedDeleted = r1.changes;

  // Delete hash-only candidates older than retention period
  const r2 = db.query(
    `DELETE FROM candidates WHERE raw_text_storage_policy = 'store_hash_only' AND timestamp < datetime('now', '-' || ? || ' days')`
  ).run(policy.candidates_hash_only_days);
  report.candidatesHashOnlyDeleted = r2.changes;

  // Delete closed clusters older than retention period
  const r3 = db.query(
    `DELETE FROM clusters WHERE state = 'closed' AND updated_at < datetime('now', '-' || ? || ' days')`
  ).run(policy.clusters_after_closed_days);
  report.closedClustersDeleted = r3.changes;

  // Delete audit logs older than minimum retention
  const r4 = db.query(
    `DELETE FROM audit_log WHERE timestamp < datetime('now', '-' || ? || ' days')`
  ).run(policy.audit_logs_minimum_days);
  report.auditLogsDeleted = r4.changes;

  // Clean orphaned cluster_posts
  const r5 = db.query(
    `DELETE FROM cluster_posts WHERE cluster_id NOT IN (SELECT cluster_id FROM clusters) OR post_id NOT IN (SELECT post_id FROM candidates)`
  ).run();
  report.orphanedClusterPostsDeleted = r5.changes;

  return report;
}
