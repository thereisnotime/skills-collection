import { Database } from "bun:sqlite";
import type { ReviewOverride, BugCluster, OverrideType } from "./types";
import { getActiveOverrides, updateCluster } from "./db";

/**
 * Load all active overrides from DB at run start.
 */
export function loadOverrides(db: Database): ReviewOverride[] {
  return getActiveOverrides(db);
}

/**
 * Filter overrides by type.
 */
export function getOverridesByType(overrides: ReviewOverride[], type: OverrideType): ReviewOverride[] {
  return overrides.filter((o) => o.override_type === type);
}

/**
 * Apply severity overrides to a cluster.
 */
export function applySeverityOverrides(
  cluster: BugCluster,
  overrides: ReviewOverride[],
): BugCluster {
  const severityOverrides = overrides.filter(
    (o) => o.override_type === "severity_override" && o.target_cluster_id === cluster.cluster_id,
  );
  if (severityOverrides.length === 0) return cluster;

  // Use most recent override
  const latest = severityOverrides[severityOverrides.length - 1];
  const params = latest.parameters as { new_severity?: string };
  if (params.new_severity) {
    return {
      ...cluster,
      severity: params.new_severity as BugCluster["severity"],
      severity_rationale: `Override: ${latest.reason}`,
    };
  }
  return cluster;
}

/**
 * Apply routing overrides for a cluster.
 * Returns the override parameters if found, null otherwise.
 */
export function applyRoutingOverride(
  clusterId: string,
  overrides: ReviewOverride[],
): Record<string, unknown> | null {
  const routingOverrides = overrides.filter(
    (o) => o.override_type === "routing_override" && o.target_cluster_id === clusterId,
  );
  if (routingOverrides.length === 0) return null;
  return routingOverrides[routingOverrides.length - 1].parameters;
}

/**
 * Check if a cluster should be suppressed due to noise_suppression override.
 */
export function isClusterSuppressed(
  clusterId: string,
  overrides: ReviewOverride[],
): boolean {
  return overrides.some(
    (o) => o.override_type === "noise_suppression" && o.target_cluster_id === clusterId,
  );
}

/**
 * Check if a cluster has a snooze override that is still active.
 */
export function isClusterSnoozed(
  clusterId: string,
  overrides: ReviewOverride[],
): boolean {
  return overrides.some(
    (o) =>
      o.override_type === "snooze" &&
      o.target_cluster_id === clusterId &&
      (!o.expires_at || new Date(o.expires_at) > new Date()),
  );
}

/**
 * Apply label correction overrides.
 */
export function applyLabelCorrection(
  cluster: BugCluster,
  overrides: ReviewOverride[],
): BugCluster {
  const labelOverrides = overrides.filter(
    (o) => o.override_type === "label_correction" && o.target_cluster_id === cluster.cluster_id,
  );
  if (labelOverrides.length === 0) return cluster;

  const latest = labelOverrides[labelOverrides.length - 1];
  const params = latest.parameters as { new_family?: string; new_title?: string };
  return {
    ...cluster,
    ...(params.new_family ? { cluster_family: params.new_family as BugCluster["cluster_family"] } : {}),
    ...(params.new_title ? { title: params.new_title } : {}),
  };
}

/**
 * Apply all applicable overrides to a cluster in correct order.
 */
export function applyAllOverrides(
  cluster: BugCluster,
  overrides: ReviewOverride[],
): BugCluster {
  let result = cluster;
  result = applyLabelCorrection(result, overrides);
  result = applySeverityOverrides(result, overrides);
  // Note: routing and suppression overrides are checked separately
  // during routing and display phases
  return result;
}
