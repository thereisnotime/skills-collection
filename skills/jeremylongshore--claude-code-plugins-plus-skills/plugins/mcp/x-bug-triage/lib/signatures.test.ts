import { describe, test, expect } from "bun:test";
import { generateSignature, signatureFromString, calculateSignatureOverlap } from "./signatures";
import type { BugCandidate } from "./types";
import { randomUUID } from "crypto";

function makeCandidate(overrides: Partial<BugCandidate> = {}): BugCandidate {
  return {
    post_id: randomUUID(),
    author_handle: "user",
    author_id: "123",
    timestamp: new Date().toISOString(),
    source_type: "mention",
    product_surface: "web_app",
    feature_area: "chat",
    symptoms: ["messages disappearing"],
    error_strings: ["error 500"],
    repro_hints: [],
    urls: [],
    has_media: false,
    media_keys: [],
    language: "en",
    conversation_id: null,
    thread_root_id: null,
    reply_to_id: null,
    referenced_post_ids: [],
    public_metrics: null,
    classification: "bug_report",
    classification_confidence: 0.85,
    classification_rationale: "test",
    report_quality_score: 0.8,
    independence_score: 0.9,
    account_authenticity_score: 0.9,
    historical_accuracy_score: 0.5,
    reporter_reliability_score: 0.8,
    reporter_category: "public",
    pii_flags: [],
    raw_text_redacted: "test",
    raw_text_storage_policy: "store_redacted",
    triage_run_id: "run1",
    ...overrides,
  };
}

describe("signatures", () => {
  describe("generateSignature", () => {
    test("produces stable output for same input", () => {
      const c = makeCandidate();
      const s1 = generateSignature(c);
      const s2 = generateSignature(c);
      expect(s1.raw).toBe(s2.raw);
    });

    test("includes surface and feature area", () => {
      const c = makeCandidate({ product_surface: "mobile_ios", feature_area: "auth" });
      const sig = generateSignature(c);
      expect(sig.surface).toBe("mobile_ios");
      expect(sig.featureArea).toBe("auth");
    });

    test("handles null product_surface", () => {
      const c = makeCandidate({ product_surface: null });
      const sig = generateSignature(c);
      expect(sig.surface).toBe("unknown");
    });

    test("handles null feature_area", () => {
      const c = makeCandidate({ feature_area: null });
      const sig = generateSignature(c);
      expect(sig.featureArea).toBe("unknown");
    });

    test("handles empty symptoms", () => {
      const c = makeCandidate({ symptoms: [] });
      const sig = generateSignature(c);
      expect(sig.normalizedSymptoms).toEqual([]);
    });

    test("handles empty error_strings", () => {
      const c = makeCandidate({ error_strings: [] });
      const sig = generateSignature(c);
      expect(sig.normalizedErrors).toEqual([]);
    });

    test("normalizes to lowercase", () => {
      const c = makeCandidate({ symptoms: ["CRASH"], error_strings: ["Error 500"] });
      const sig = generateSignature(c);
      expect(sig.normalizedSymptoms).toContain("crash");
      expect(sig.normalizedErrors).toContain("error 500");
    });

    test("caps at 5 errors and 5 symptoms", () => {
      const c = makeCandidate({
        symptoms: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"],
        error_strings: ["e1", "e2", "e3", "e4", "e5", "e6"],
      });
      const sig = generateSignature(c);
      expect(sig.normalizedSymptoms.length).toBeLessThanOrEqual(5);
      expect(sig.normalizedErrors.length).toBeLessThanOrEqual(5);
    });

    test("sorts errors and symptoms for stability", () => {
      const c1 = makeCandidate({ symptoms: ["b", "a", "c"] });
      const c2 = makeCandidate({ symptoms: ["c", "a", "b"] });
      expect(generateSignature(c1).raw).toBe(generateSignature(c2).raw);
    });
  });

  describe("signatureFromString", () => {
    test("parses surface and feature area", () => {
      const sig = signatureFromString("web_app|chat|error 500|crash");
      expect(sig.surface).toBe("web_app");
      expect(sig.featureArea).toBe("chat");
    });

    test("handles empty string", () => {
      const sig = signatureFromString("");
      expect(sig.surface).toBe("unknown");
      expect(sig.featureArea).toBe("unknown");
    });

    test("handles single-field string", () => {
      const sig = signatureFromString("web_app");
      expect(sig.surface).toBe("web_app");
      expect(sig.featureArea).toBe("unknown");
    });
  });

  describe("calculateSignatureOverlap", () => {
    test("identical signatures score >= 0.9", () => {
      const c = makeCandidate();
      const sig = generateSignature(c);
      expect(calculateSignatureOverlap(sig, sig)).toBeGreaterThanOrEqual(0.9);
    });

    test("completely different signatures score < 0.3", () => {
      const c1 = makeCandidate({ product_surface: "web_app", feature_area: "chat", symptoms: ["crash"], error_strings: ["500"] });
      const c2 = makeCandidate({ product_surface: "api", feature_area: "billing", symptoms: ["timeout"], error_strings: ["403"] });
      const s1 = generateSignature(c1);
      const s2 = generateSignature(c2);
      expect(calculateSignatureOverlap(s1, s2)).toBeLessThan(0.3);
    });

    test("same surface different features scores moderate", () => {
      const c1 = makeCandidate({ product_surface: "web_app", feature_area: "chat", symptoms: ["crash"], error_strings: [] });
      const c2 = makeCandidate({ product_surface: "web_app", feature_area: "search", symptoms: ["crash"], error_strings: [] });
      const s1 = generateSignature(c1);
      const s2 = generateSignature(c2);
      const overlap = calculateSignatureOverlap(s1, s2);
      expect(overlap).toBeGreaterThan(0.3);
      expect(overlap).toBeLessThan(0.8);
    });

    test("both empty errors and symptoms gets neutral score", () => {
      const c1 = makeCandidate({ product_surface: "web_app", feature_area: "chat", symptoms: [], error_strings: [] });
      const c2 = makeCandidate({ product_surface: "web_app", feature_area: "chat", symptoms: [], error_strings: [] });
      const s1 = generateSignature(c1);
      const s2 = generateSignature(c2);
      expect(calculateSignatureOverlap(s1, s2)).toBeGreaterThan(0.6);
    });

    test("partial error overlap scores between full and none", () => {
      const c1 = makeCandidate({ symptoms: [], error_strings: ["error 500", "timeout", "crash"] });
      const c2 = makeCandidate({ symptoms: [], error_strings: ["error 500", "crash", "404"] });
      const s1 = generateSignature(c1);
      const s2 = generateSignature(c2);
      const overlap = calculateSignatureOverlap(s1, s2);
      expect(overlap).toBeGreaterThan(0.5);
      expect(overlap).toBeLessThan(0.95);
    });

    test("score is always between 0 and 1", () => {
      for (let i = 0; i < 10; i++) {
        const c1 = makeCandidate({ symptoms: [`s${i}`], error_strings: [`e${i}`] });
        const c2 = makeCandidate({ symptoms: [`s${i + 5}`], error_strings: [`e${i + 5}`] });
        const overlap = calculateSignatureOverlap(generateSignature(c1), generateSignature(c2));
        expect(overlap).toBeGreaterThanOrEqual(0);
        expect(overlap).toBeLessThanOrEqual(1);
      }
    });
  });
});
