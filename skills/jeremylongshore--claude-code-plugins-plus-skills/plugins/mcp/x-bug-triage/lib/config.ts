import { readFileSync } from "fs";
import { join } from "path";

const CONFIG_DIR = join(import.meta.dir, "..", "config");

export interface ApprovedAccountsConfig {
  approved_intake_accounts: string[];
  known_internal_accounts: string[];
  known_partner_accounts: string[];
  known_tester_accounts: string[];
}

export interface ApprovedSearchesConfig {
  version: string;
  searches: Array<{
    name: string;
    query: string;
    description?: string;
  }>;
}

export interface EscalationTrigger {
  count?: number;
  window_minutes?: number;
  keywords?: string[];
  min_surfaces?: number;
}

export interface SeverityThresholdsConfig {
  cluster_match_threshold: number;
  repo_scan_confidence_threshold: number;
  escalation_triggers: Record<string, EscalationTrigger>;
  viral_thread_circuit_breaker: {
    max_replies_per_hour: number;
    sample_size: number;
  };
}

export interface SurfaceMapping {
  surface: string;
  repos: string[];
  description: string;
}

export interface SurfaceRepoMappingConfig {
  mappings: SurfaceMapping[];
}

export interface RoutingLevel {
  level: number;
  source: string;
  description: string;
  confidence_modifier: number;
}

export interface RoutingSourcePriorityConfig {
  precedence: RoutingLevel[];
  staleness_threshold_days: number;
}

export interface SlackPreferencesConfig {
  summary_max_clusters: number;
  summary_max_lines: number;
  detail_max_representative_posts: number;
  large_cluster_threshold: number;
  idle_reminder_hours: number;
  severity_icons: Record<string, string>;
  fallback_output_dir: string;
}

export interface CacheConfigSection {
  enabled: boolean;
  ttl_seconds: number;
}

export interface RetentionPolicyConfig {
  candidates_redacted_days: number;
  candidates_hash_only_days: number;
  clusters_after_closed_days: number;
  clusters_while_open: string;
  overrides: string;
  suppression_rules: string;
  issue_links: string;
  audit_logs_minimum_days: number;
  raw_unredacted_text: string;
  cache?: CacheConfigSection;
}

export interface SignalWeights {
  high_weight_deterministic: Record<string, number>;
  medium_weight_semantic: Record<string, number>;
  supporting_temporal: Record<string, number>;
}

export interface ClusterMatchingThresholdsConfig {
  signature_overlap_threshold: number;
  signal_weights: SignalWeights;
  anti_clustering: Record<string, number | boolean>;
}

function loadJson<T>(filename: string): T {
  const path = join(CONFIG_DIR, filename);
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content) as T;
}

function validateRequired(obj: Record<string, unknown>, fields: string[], configName: string): void {
  for (const field of fields) {
    if (!(field in obj)) {
      throw new Error(`Config ${configName} missing required field: ${field}`);
    }
  }
}

export function loadApprovedAccounts(): ApprovedAccountsConfig {
  const config = loadJson<ApprovedAccountsConfig>("approved-accounts.json");
  validateRequired(config as unknown as Record<string, unknown>, ["approved_intake_accounts", "known_internal_accounts", "known_partner_accounts", "known_tester_accounts"], "approved-accounts");
  return config;
}

export function loadApprovedSearches(): ApprovedSearchesConfig {
  const config = loadJson<ApprovedSearchesConfig>("approved-searches.json");
  validateRequired(config as unknown as Record<string, unknown>, ["version", "searches"], "approved-searches");
  return config;
}

export function loadSeverityThresholds(): SeverityThresholdsConfig {
  const config = loadJson<SeverityThresholdsConfig>("severity-thresholds.json");
  validateRequired(config as unknown as Record<string, unknown>, ["cluster_match_threshold", "repo_scan_confidence_threshold", "escalation_triggers"], "severity-thresholds");
  return config;
}

export function loadSurfaceRepoMapping(): SurfaceRepoMappingConfig {
  const config = loadJson<SurfaceRepoMappingConfig>("surface-repo-mapping.json");
  validateRequired(config as unknown as Record<string, unknown>, ["mappings"], "surface-repo-mapping");
  return config;
}

export function loadRoutingSourcePriority(): RoutingSourcePriorityConfig {
  const config = loadJson<RoutingSourcePriorityConfig>("routing-source-priority.json");
  validateRequired(config as unknown as Record<string, unknown>, ["precedence", "staleness_threshold_days"], "routing-source-priority");
  return config;
}

export function loadSlackPreferences(): SlackPreferencesConfig {
  const config = loadJson<SlackPreferencesConfig>("slack-preferences.json");
  validateRequired(config as unknown as Record<string, unknown>, ["summary_max_clusters", "severity_icons"], "slack-preferences");
  return config;
}

export function loadRetentionPolicy(): RetentionPolicyConfig {
  const config = loadJson<RetentionPolicyConfig>("retention-policy.json");
  validateRequired(config as unknown as Record<string, unknown>, ["candidates_redacted_days", "audit_logs_minimum_days"], "retention-policy");
  return config;
}

export function loadCacheConfig(): CacheConfigSection {
  try {
    const retention = loadRetentionPolicy();
    return retention.cache ?? { enabled: false, ttl_seconds: 3600 };
  } catch {
    return { enabled: false, ttl_seconds: 3600 };
  }
}

export function loadClusterMatchingThresholds(): ClusterMatchingThresholdsConfig {
  const config = loadJson<ClusterMatchingThresholdsConfig>("cluster-matching-thresholds.json");
  validateRequired(config as unknown as Record<string, unknown>, ["signature_overlap_threshold", "signal_weights"], "cluster-matching-thresholds");
  return config;
}
