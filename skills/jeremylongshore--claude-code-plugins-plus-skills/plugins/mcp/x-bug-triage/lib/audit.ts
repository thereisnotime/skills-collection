import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { AuditEventType, AuditEntry } from "./types";
import { insertAuditEntry } from "./db";

export function writeAuditEvent(
  db: Database,
  eventType: AuditEventType,
  details: Record<string, unknown>,
  options: {
    runId?: string;
    clusterId?: string;
    postId?: string;
  } = {},
): AuditEntry {
  const entry: AuditEntry = {
    event_id: randomUUID(),
    event_type: eventType,
    timestamp: new Date().toISOString(),
    run_id: options.runId ?? null,
    cluster_id: options.clusterId ?? null,
    post_id: options.postId ?? null,
    details,
  };
  insertAuditEntry(db, entry);
  return entry;
}

// Convenience functions for each event type

export function auditIngestRunStarted(db: Database, runId: string, details: { accounts: string[]; window: string }): AuditEntry {
  return writeAuditEvent(db, "ingest_run_started", details, { runId });
}

export function auditIngestRunCompleted(db: Database, runId: string, details: { status: string; summary: Record<string, unknown> }): AuditEntry {
  return writeAuditEvent(db, "ingest_run_completed", details, { runId });
}

export function auditSourceFetched(db: Database, runId: string, details: { endpoint: string; filters: Record<string, unknown>; count: number; rate_limit_remaining?: number }): AuditEntry {
  return writeAuditEvent(db, "source_fetched", details, { runId });
}

export function auditCandidateClassified(db: Database, runId: string, postId: string, details: { classification: string; confidence: number; rationale: string }): AuditEntry {
  return writeAuditEvent(db, "candidate_classified", details, { runId, postId });
}

export function auditPiiRedaction(db: Database, runId: string, postId: string, details: { pii_type: string; field_redacted: string }): AuditEntry {
  return writeAuditEvent(db, "pii_redaction", details, { runId, postId });
}

export function auditClusterCreated(db: Database, runId: string, clusterId: string, details: { signature: string; family: string }): AuditEntry {
  return writeAuditEvent(db, "cluster_created", details, { runId, clusterId });
}

export function auditClusterUpdated(db: Database, runId: string, clusterId: string, details: { change_type: string; before?: unknown; after?: unknown }): AuditEntry {
  return writeAuditEvent(db, "cluster_updated", details, { runId, clusterId });
}

export function auditClusterStateChanged(db: Database, runId: string, clusterId: string, details: { from_state: string; to_state: string; reason: string }): AuditEntry {
  return writeAuditEvent(db, "cluster_state_changed", details, { runId, clusterId });
}

export function auditRoutingRecommendation(db: Database, runId: string, clusterId: string, details: { inputs_used: string[]; ranked_results: unknown[] }): AuditEntry {
  return writeAuditEvent(db, "routing_recommendation", details, { runId, clusterId });
}

export function auditEscalationTriggered(db: Database, runId: string, clusterId: string, details: { trigger_type: string; evidence: Record<string, unknown>; threshold: unknown }): AuditEntry {
  return writeAuditEvent(db, "escalation_triggered", details, { runId, clusterId });
}

export function auditHumanAction(db: Database, runId: string, details: { action_type: string; cluster_id?: string; [key: string]: unknown }): AuditEntry {
  return writeAuditEvent(db, "human_action", details, { runId, clusterId: details.cluster_id });
}

export function auditOverrideCreated(db: Database, runId: string, details: { override_type: string; target: string; parameters: Record<string, unknown>; reason: string }): AuditEntry {
  return writeAuditEvent(db, "override_created", details, { runId });
}
