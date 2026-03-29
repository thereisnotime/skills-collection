import { randomUUID } from "crypto";
import { Database } from "bun:sqlite";
import type {
  BugCandidate,
  BugCluster,
  ClusterFamily,
  Classification,
  ClusterPost,
  ClusterState,
  ClusterSubStatus,
} from "./types";
import { generateSignature, signatureFromString, calculateSignatureOverlap } from "./signatures";
import {
  insertCluster,
  getClustersByState,
  insertClusterPost,
  updateCluster,
  getActiveSuppressionRules,
} from "./db";

/**
 * Map classification to cluster family.
 * Some classifications don't cluster (returns null).
 */
export function classificationToFamily(classification: Classification): ClusterFamily | null {
  switch (classification) {
    case "bug_report":
    case "sarcastic_bug_report":
    case "account_problem":
    case "billing_problem":
      return "product_defect";
    case "model_quality_issue":
      return "model_quality_defect";
    case "policy_or_expectation_mismatch":
      return "policy_mismatch";
    case "ux_friction":
      return "ux_friction";
    // These don't cluster
    case "feature_request":
    case "user_error_or_confusion":
    case "praise":
    case "noise":
    case "needs_review":
      return null;
  }
}

/**
 * Check if a candidate matches any active suppression rules.
 */
export function isSuppressed(
  candidate: BugCandidate,
  rules: Array<{ pattern_type: string; pattern_value: string }>,
): boolean {
  const text = candidate.raw_text_redacted || "";
  for (const rule of rules) {
    switch (rule.pattern_type) {
      case "keyword":
        if (text.toLowerCase().includes(rule.pattern_value.toLowerCase())) return true;
        break;
      case "regex":
        try {
          if (new RegExp(rule.pattern_value, "i").test(text)) return true;
        } catch { /* invalid regex, skip */ }
        break;
      case "author":
        if (candidate.author_handle === rule.pattern_value || candidate.author_id === rule.pattern_value) return true;
        break;
    }
  }
  return false;
}

/**
 * Find the best matching existing cluster for a candidate.
 */
export function findMatchingCluster(
  candidate: BugCandidate,
  existingClusters: BugCluster[],
  family: ClusterFamily,
  threshold: number = 0.70,
): { cluster: BugCluster; overlap: number } | null {
  const candidateSig = generateSignature(candidate);
  let bestMatch: { cluster: BugCluster; overlap: number } | null = null;

  for (const cluster of existingClusters) {
    // Family-first guard: different families NEVER cluster
    if (cluster.cluster_family !== family) continue;

    // Skip suppressed/closed clusters
    if (cluster.state === "suppressed" || cluster.state === "closed") continue;

    const clusterSig = signatureFromString(cluster.bug_signature);
    const overlap = calculateSignatureOverlap(candidateSig, clusterSig);

    if (overlap >= threshold && (!bestMatch || overlap > bestMatch.overlap)) {
      bestMatch = { cluster, overlap };
    }
  }

  return bestMatch;
}

/**
 * Determine sub-status when a candidate matches an existing cluster.
 */
export function determineSubStatus(cluster: BugCluster): ClusterSubStatus {
  switch (cluster.state) {
    case "resolved":
    case "fix_deployed":
      return "regression_reopened";
    case "filed":
    case "monitoring":
      return "new_evidence";
    default:
      return "new_evidence";
  }
}

/**
 * Process a batch of candidates through the clustering pipeline.
 */
export function clusterCandidates(
  db: Database,
  candidates: BugCandidate[],
  triageRunId: string,
  threshold: number = 0.70,
): { newClusters: BugCluster[]; updatedClusters: BugCluster[]; skipped: number; suppressed: number } {
  const suppressionRules = getActiveSuppressionRules(db);

  // Get all existing active clusters
  const activeStates: ClusterState[] = ["open", "filed", "monitoring", "fix_deployed", "resolved"];
  const existingClusters: BugCluster[] = [];
  for (const state of activeStates) {
    existingClusters.push(...getClustersByState(db, state));
  }

  const newClusters: BugCluster[] = [];
  const updatedClusterIds = new Set<string>();
  const updatedClusters: BugCluster[] = [];
  let skipped = 0;
  let suppressed = 0;

  for (const candidate of candidates) {
    // Check suppression
    if (isSuppressed(candidate, suppressionRules)) {
      suppressed++;
      continue;
    }

    // Determine family
    const family = classificationToFamily(candidate.classification);
    if (!family) {
      skipped++;
      continue;
    }

    // Try to match existing cluster
    const match = findMatchingCluster(candidate, [...existingClusters, ...newClusters], family, threshold);

    if (match) {
      // Attach to existing cluster
      const subStatus = determineSubStatus(match.cluster);
      const now = new Date().toISOString();

      // Update cluster
      updateCluster(db, match.cluster.cluster_id, {
        report_count: match.cluster.report_count + 1,
        last_seen: candidate.timestamp,
        updated_at: now,
        sub_status: subStatus,
        // Reopen if resolved
        ...(match.cluster.state === "resolved" ? { state: "open" as ClusterState } : {}),
      });

      // Link post to cluster
      const cp: ClusterPost = {
        cluster_id: match.cluster.cluster_id,
        post_id: candidate.post_id,
        added_at: now,
        added_by_run_id: triageRunId,
      };
      insertClusterPost(db, cp);

      // Track updated
      if (!updatedClusterIds.has(match.cluster.cluster_id)) {
        updatedClusterIds.add(match.cluster.cluster_id);
        updatedClusters.push(match.cluster);
      }

      // Update in-memory for subsequent matches
      match.cluster.report_count++;
      match.cluster.last_seen = candidate.timestamp;
      match.cluster.sub_status = subStatus;
    } else {
      // Create new cluster
      const sig = generateSignature(candidate);
      const now = new Date().toISOString();
      const newCluster: BugCluster = {
        cluster_id: randomUUID(),
        bug_signature: sig.raw,
        cluster_family: family,
        product_surface: candidate.product_surface,
        feature_area: candidate.feature_area,
        title: null,
        severity: "low", // Will be computed by severity engine
        severity_rationale: null,
        state: "open",
        sub_status: null,
        report_count: 1,
        first_seen: candidate.timestamp,
        last_seen: candidate.timestamp,
        created_at: now,
        updated_at: now,
        triage_run_id: triageRunId,
      };

      insertCluster(db, newCluster);
      insertClusterPost(db, {
        cluster_id: newCluster.cluster_id,
        post_id: candidate.post_id,
        added_at: now,
        added_by_run_id: triageRunId,
      });

      newClusters.push(newCluster);
    }
  }

  return { newClusters, updatedClusters, skipped, suppressed };
}
