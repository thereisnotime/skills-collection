import { describe, test, expect } from "bun:test";
import {
  loadApprovedAccounts,
  loadApprovedSearches,
  loadSeverityThresholds,
  loadSurfaceRepoMapping,
  loadRoutingSourcePriority,
  loadSlackPreferences,
  loadRetentionPolicy,
  loadClusterMatchingThresholds,
} from "./config";

describe("config loading", () => {
  // Happy path — all 8 configs load
  describe("happy path", () => {
    test("approved-accounts loads with correct structure", () => {
      const config = loadApprovedAccounts();
      expect(config.approved_intake_accounts).toBeInstanceOf(Array);
      expect(config.known_internal_accounts).toBeInstanceOf(Array);
      expect(config.known_partner_accounts).toBeInstanceOf(Array);
      expect(config.known_tester_accounts).toBeInstanceOf(Array);
    });

    test("approved-searches loads with version", () => {
      const config = loadApprovedSearches();
      expect(config.version).toBe("1.0.0");
      expect(config.searches).toBeInstanceOf(Array);
    });

    test("approved-searches entries have required name and query fields", () => {
      const config = loadApprovedSearches();
      for (const search of config.searches) {
        expect(typeof search.name).toBe("string");
        expect(typeof search.query).toBe("string");
      }
    });

    test("severity-thresholds loads with all triggers", () => {
      const config = loadSeverityThresholds();
      expect(config.cluster_match_threshold).toBe(0.70);
      expect(config.repo_scan_confidence_threshold).toBe(0.70);
      expect(config.escalation_triggers.report_velocity_spike).toBeDefined();
      expect(config.escalation_triggers.report_velocity_spike.count).toBe(50);
      expect(config.escalation_triggers.report_velocity_spike.window_minutes).toBe(30);
      expect(config.escalation_triggers.data_loss_language.keywords).toContain("lost");
      expect(config.escalation_triggers.security_privacy_language.keywords).toContain("unauthorized");
      expect(config.escalation_triggers.auth_billing_cascade.count).toBe(20);
      expect(config.escalation_triggers.cross_surface_failure.min_surfaces).toBe(3);
      expect(config.escalation_triggers.enterprise_blocking.keywords).toContain("enterprise");
      expect(config.viral_thread_circuit_breaker.max_replies_per_hour).toBe(500);
      expect(config.viral_thread_circuit_breaker.sample_size).toBe(100);
    });

    test("severity-thresholds cluster_match_threshold is a number between 0 and 1", () => {
      const config = loadSeverityThresholds();
      expect(config.cluster_match_threshold).toBeGreaterThan(0);
      expect(config.cluster_match_threshold).toBeLessThanOrEqual(1);
    });

    test("surface-repo-mapping loads with mappings", () => {
      const config = loadSurfaceRepoMapping();
      expect(config.mappings).toBeInstanceOf(Array);
      expect(config.mappings.length).toBeGreaterThan(0);
      const surfaces = config.mappings.map((m) => m.surface);
      expect(surfaces).toContain("web_app");
      expect(surfaces).toContain("mobile_ios");
      expect(surfaces).toContain("api");
    });

    test("surface-repo-mapping entries have repos array and description", () => {
      const config = loadSurfaceRepoMapping();
      for (const mapping of config.mappings) {
        expect(typeof mapping.surface).toBe("string");
        expect(mapping.repos).toBeInstanceOf(Array);
        expect(typeof mapping.description).toBe("string");
      }
    });

    test("routing-source-priority loads with 6 levels", () => {
      const config = loadRoutingSourcePriority();
      expect(config.precedence.length).toBe(6);
      expect(config.staleness_threshold_days).toBe(30);
      expect(config.precedence[0].level).toBe(1);
      expect(config.precedence[0].source).toBe("service_owner");
      expect(config.precedence[0].confidence_modifier).toBe(1.0);
      expect(config.precedence[5].level).toBe(6);
      expect(config.precedence[5].confidence_modifier).toBe(0.3);
    });

    test("routing-source-priority precedence levels are sequential", () => {
      const config = loadRoutingSourcePriority();
      for (let i = 0; i < config.precedence.length; i++) {
        expect(config.precedence[i].level).toBe(i + 1);
      }
    });

    test("routing-source-priority confidence_modifiers are between 0 and 1", () => {
      const config = loadRoutingSourcePriority();
      for (const level of config.precedence) {
        expect(level.confidence_modifier).toBeGreaterThan(0);
        expect(level.confidence_modifier).toBeLessThanOrEqual(1.0);
      }
    });

    test("slack-preferences loads with all fields", () => {
      const config = loadSlackPreferences();
      expect(config.summary_max_clusters).toBe(5);
      expect(config.summary_max_lines).toBe(20);
      expect(config.detail_max_representative_posts).toBe(3);
      expect(config.large_cluster_threshold).toBe(50);
      expect(config.idle_reminder_hours).toBe(24);
      expect(config.severity_icons.critical).toBe("🔴");
      expect(config.severity_icons.high).toBe("🔴");
      expect(config.severity_icons.medium).toBe("🟡");
      expect(config.severity_icons.low).toBe("🟢");
    });

    test("slack-preferences has fallback_output_dir string", () => {
      const config = loadSlackPreferences();
      expect(typeof config.fallback_output_dir).toBe("string");
      expect(config.fallback_output_dir.length).toBeGreaterThan(0);
    });

    test("retention-policy loads with all periods", () => {
      const config = loadRetentionPolicy();
      expect(config.candidates_redacted_days).toBe(90);
      expect(config.candidates_hash_only_days).toBe(365);
      expect(config.clusters_after_closed_days).toBe(365);
      expect(config.audit_logs_minimum_days).toBe(365);
      expect(config.raw_unredacted_text).toBe("never_stored");
    });

    test("retention-policy string sentinel fields are present", () => {
      const config = loadRetentionPolicy();
      expect(typeof config.clusters_while_open).toBe("string");
      expect(typeof config.overrides).toBe("string");
      expect(typeof config.suppression_rules).toBe("string");
      expect(typeof config.issue_links).toBe("string");
    });

    test("cluster-matching-thresholds loads with weights", () => {
      const config = loadClusterMatchingThresholds();
      expect(config.signature_overlap_threshold).toBe(0.70);
      expect(config.signal_weights.high_weight_deterministic.exact_error_string).toBe(1.0);
      expect(config.signal_weights.medium_weight_semantic.symptom_phrase_similarity).toBe(0.6);
      expect(config.signal_weights.supporting_temporal.same_release_window).toBe(0.3);
      expect(config.anti_clustering.different_family_block).toBe(true);
    });

    test("cluster-matching-thresholds signature_overlap_threshold is between 0 and 1", () => {
      const config = loadClusterMatchingThresholds();
      expect(config.signature_overlap_threshold).toBeGreaterThan(0);
      expect(config.signature_overlap_threshold).toBeLessThanOrEqual(1);
    });

    test("cluster-matching-thresholds high_weight_deterministic weights are at most 1.0", () => {
      const config = loadClusterMatchingThresholds();
      for (const [, weight] of Object.entries(config.signal_weights.high_weight_deterministic)) {
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(1.0);
      }
    });
  });
});
