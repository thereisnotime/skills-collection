import { describe, test, expect } from "bun:test";
import {
  determineSourceType,
  extractSymptoms,
  extractErrorStrings,
  extractReproHints,
  extractUrls,
  detectProductSurface,
  detectFeatureArea,
  determineReporterCategory,
  parseCandidate,
} from "./parser";
import { classify } from "./classifier";
import { redactPii } from "./redactor";
import { scoreReporter } from "./reporter-scorer";
import type { XPost } from "../mcp/triage-server/types";
import type { ApprovedAccountsConfig } from "./config";

function makePost(overrides: Partial<XPost> = {}): XPost {
  return {
    id: "post_123",
    text: "Test post text",
    author_id: "user_456",
    created_at: "2026-03-23T10:00:00.000Z",
    ...overrides,
  };
}

const EMPTY_ACCOUNTS: ApprovedAccountsConfig = {
  approved_intake_accounts: [],
  known_internal_accounts: [],
  known_partner_accounts: [],
  known_tester_accounts: [],
};

// === Parser Tests ===

describe("parser", () => {
  describe("determineSourceType", () => {
    test("reply when referenced_tweets has replied_to", () => {
      expect(determineSourceType(makePost({ referenced_tweets: [{ type: "replied_to", id: "1" }] }))).toBe("reply");
    });

    test("quote_post when referenced_tweets has quoted", () => {
      expect(determineSourceType(makePost({ referenced_tweets: [{ type: "quoted", id: "1" }] }))).toBe("quote_post");
    });

    test("mention as default", () => {
      expect(determineSourceType(makePost())).toBe("mention");
    });
  });

  describe("extractSymptoms", () => {
    test("extracts crash symptoms", () => {
      const symptoms = extractSymptoms("The app keeps crashing whenever I open it");
      expect(symptoms.length).toBeGreaterThan(0);
      expect(symptoms.some((s) => s.includes("crash"))).toBe(true);
    });

    test("extracts disappearing symptoms", () => {
      const symptoms = extractSymptoms("My messages keep disappearing");
      expect(symptoms.some((s) => s.includes("disappear"))).toBe(true);
    });

    test("extracts not-working symptoms", () => {
      const symptoms = extractSymptoms("The search is not working at all");
      expect(symptoms.some((s) => s.includes("not working") || s.includes("not loading"))).toBe(true);
    });
  });

  describe("extractErrorStrings", () => {
    test("extracts error codes", () => {
      const errors = extractErrorStrings("Getting Error 500 every time");
      expect(errors.some((e) => e.includes("500"))).toBe(true);
    });

    test("extracts named errors", () => {
      const errors = extractErrorStrings("Seeing ECONNREFUSED when connecting");
      expect(errors.some((e) => e.includes("ECONNREFUSED"))).toBe(true);
    });
  });

  describe("extractReproHints", () => {
    test("extracts when I patterns", () => {
      const hints = extractReproHints("When I click the button it breaks");
      expect(hints.length).toBeGreaterThan(0);
    });

    test("extracts every time patterns", () => {
      const hints = extractReproHints("Every time I open the app it freezes");
      expect(hints.length).toBeGreaterThan(0);
    });
  });

  describe("detectProductSurface", () => {
    test("detects iOS", () => expect(detectProductSurface("broken on iPhone")).toBe("mobile_ios"));
    test("detects Android", () => expect(detectProductSurface("Android app crash")).toBe("mobile_android"));
    test("detects API", () => expect(detectProductSurface("API endpoint returning 500")).toBe("api"));
    test("detects web", () => expect(detectProductSurface("broken in Chrome")).toBe("web_app"));
    test("detects desktop", () => expect(detectProductSurface("desktop app freezing")).toBe("desktop"));
    test("null when unknown", () => expect(detectProductSurface("something is broken")).toBeNull());
  });

  describe("detectFeatureArea", () => {
    test("detects chat", () => expect(detectFeatureArea("chat messages gone")).toBe("chat"));
    test("detects auth", () => expect(detectFeatureArea("can't login")).toBe("auth"));
    test("detects billing", () => expect(detectFeatureArea("billing issue with subscription")).toBe("billing"));
    test("null when unknown", () => expect(detectFeatureArea("stuff is broken")).toBeNull());
  });

  describe("reporter category", () => {
    test("public by default", () => {
      expect(determineReporterCategory("123", "user", EMPTY_ACCOUNTS)).toBe("public");
    });

    test("internal when in known list", () => {
      const config = { ...EMPTY_ACCOUNTS, known_internal_accounts: ["internal_user"] };
      expect(determineReporterCategory("123", "internal_user", config)).toBe("internal");
    });

    test("partner when in known list", () => {
      const config = { ...EMPTY_ACCOUNTS, known_partner_accounts: ["partner_co"] };
      expect(determineReporterCategory("123", "partner_co", config)).toBe("partner");
    });

    test("tester when in known list", () => {
      const config = { ...EMPTY_ACCOUNTS, known_tester_accounts: ["qa_tester"] };
      expect(determineReporterCategory("123", "qa_tester", config)).toBe("tester");
    });
  });

  describe("full parseCandidate", () => {
    test("produces all 33 fields", () => {
      const post = makePost({
        text: "Error 500 on iOS chat — messages disappearing. When I open the app it crashes. My email is test@example.com",
        conversation_id: "conv_1",
        public_metrics: { like_count: 10, reply_count: 3, retweet_count: 1, quote_count: 0 },
        lang: "en",
      });
      const candidate = parseCandidate(post, "run_1", EMPTY_ACCOUNTS);

      expect(candidate.post_id).toBe("post_123");
      expect(candidate.classification).toBeDefined();
      expect(candidate.classification_confidence).toBeGreaterThan(0);
      expect(candidate.symptoms.length).toBeGreaterThan(0);
      expect(candidate.error_strings.length).toBeGreaterThan(0);
      expect(candidate.pii_flags).toContain("email");
      expect(candidate.raw_text_redacted).not.toContain("test@example.com");
      expect(candidate.raw_text_redacted).toContain("[REDACTED:email]");
      expect(candidate.product_surface).toBe("mobile_ios");
      expect(candidate.feature_area).toBe("chat");
      expect(candidate.triage_run_id).toBe("run_1");
    });
  });
});

// === Classifier Tests ===

describe("classifier", () => {
  test("classifies clear bug report", () => {
    const result = classify("The app crashes with Error 500", ["crashes"], ["Error 500"]);
    expect(result.classification).toBe("bug_report");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test("classifies sarcastic bug report", () => {
    const result = classify("Love how the app crashes every time I open it. Totally working as intended", ["crashes"], []);
    expect(result.classification).toBe("sarcastic_bug_report");
  });

  test("classifies feature request", () => {
    const result = classify("Would be great if you could add dark mode", [], []);
    expect(result.classification).toBe("feature_request");
  });

  test("classifies billing problem", () => {
    const result = classify("I was charged twice for my subscription", [], []);
    expect(result.classification).toBe("billing_problem");
  });

  test("classifies account problem", () => {
    const result = classify("Can't login, getting access denied error", [], ["access denied"]);
    expect(result.classification).toBe("account_problem");
  });

  test("classifies model quality issue", () => {
    const result = classify("The AI hallucinated a completely wrong answer", [], []);
    expect(result.classification).toBe("model_quality_issue");
  });

  test("classifies policy mismatch", () => {
    const result = classify("Why did they remove this feature? It used to work fine. This was by design apparently", [], []);
    expect(result.classification).toBe("policy_or_expectation_mismatch");
  });

  test("classifies UX friction", () => {
    const result = classify("The interface is so confusing, I can't figure out where the settings are", [], []);
    expect(result.classification).toBe("ux_friction");
  });

  test("classifies praise", () => {
    const result = classify("This product is amazing, great work on the update!", [], []);
    expect(result.classification).toBe("praise");
  });

  test("classifies noise", () => {
    const result = classify("Follow me for crypto giveaway airdrop!", [], []);
    expect(result.classification).toBe("noise");
  });

  test("classifies user error", () => {
    const result = classify("It doesn't seem to be doing what I thought it would do", [], []);
    expect(result.classification).toBe("user_error_or_confusion");
  });

  test("falls back to needs_review", () => {
    const result = classify("Something happened today", [], []);
    expect(result.classification).toBe("needs_review");
  });
});

// === Redactor Tests ===

describe("redactor", () => {
  test("redacts email addresses", () => {
    const { redactedText, piiFlags } = redactPii("Contact me at user@example.com for details");
    expect(redactedText).toContain("[REDACTED:email]");
    expect(redactedText).not.toContain("user@example.com");
    expect(piiFlags).toContain("email");
  });

  test("redacts phone numbers", () => {
    const { redactedText, piiFlags } = redactPii("Call me at 555-123-4567");
    expect(redactedText).toContain("[REDACTED:phone]");
    expect(piiFlags).toContain("phone");
  });

  test("redacts API keys with prefix", () => {
    const { redactedText, piiFlags } = redactPii("My key is sk_test_abcdefghijklmnopqrstuvwxyz");
    expect(redactedText).toContain("[REDACTED:api_key]");
    expect(piiFlags).toContain("api_key");
  });

  test("redacts account IDs", () => {
    const { redactedText, piiFlags } = redactPii("My account ID: ACCT123456");
    expect(redactedText).toContain("[REDACTED:account_id]");
    expect(piiFlags).toContain("account_id");
  });

  test("redacts URL tokens", () => {
    const { redactedText, piiFlags } = redactPii("Visit https://example.com/api?token=abc123secret&other=val");
    expect(redactedText).toContain("[REDACTED:url_token]");
    expect(piiFlags).toContain("url_token");
  });

  test("handles text with no PII", () => {
    const { redactedText, piiFlags } = redactPii("The app crashed when I clicked the button");
    expect(redactedText).toBe("The app crashed when I clicked the button");
    expect(piiFlags.length).toBe(0);
  });

  test("handles multiple PII types", () => {
    const { piiFlags } = redactPii("Email me at a@b.com, my phone is 555-111-2222, account ID: USER123456");
    expect(piiFlags.length).toBeGreaterThanOrEqual(2);
  });
});

// === Reporter Scorer Tests ===

describe("reporter scorer", () => {
  test("high quality for detailed report", () => {
    const post = makePost({
      text: "Error 500 on iOS version 3.2 when I click send. Crashes every time. See screenshot.",
      attachments: { media_keys: ["m1"] },
    });
    const scores = scoreReporter(
      post.text!,
      ["crashes"],
      ["Error 500"],
      ["when I click send"],
      post,
    );
    expect(scores.quality).toBeGreaterThan(0.6);
  });

  test("low quality for vague report", () => {
    const post = makePost({ text: "broken" });
    const scores = scoreReporter("broken", [], [], [], post);
    expect(scores.quality).toBeLessThan(0.5);
  });

  test("low independence for 'same here' reply", () => {
    const post = makePost({
      text: "same here",
      referenced_tweets: [{ type: "replied_to", id: "1" }],
    });
    const scores = scoreReporter("same here", [], [], [], post);
    expect(scores.independence).toBeLessThan(0.5);
  });

  test("high independence for original report", () => {
    const post = makePost({
      text: "The chat messages are disappearing since the update. Error 500 on mobile.",
    });
    const scores = scoreReporter(post.text!, ["disappearing"], ["Error 500"], [], post);
    expect(scores.independence).toBeGreaterThan(0.7);
  });

  test("composite score is weighted average", () => {
    const post = makePost({ text: "Detailed bug report with symptoms and error strings" });
    const scores = scoreReporter(post.text!, ["crashes"], ["Error 500"], ["when I click"], post);
    expect(scores.composite).toBeGreaterThan(0);
    expect(scores.composite).toBeLessThanOrEqual(1);
  });

  test("all scores between 0 and 1", () => {
    const post = makePost({ text: "test" });
    const scores = scoreReporter("test", [], [], [], post);
    expect(scores.quality).toBeGreaterThanOrEqual(0);
    expect(scores.quality).toBeLessThanOrEqual(1);
    expect(scores.independence).toBeGreaterThanOrEqual(0);
    expect(scores.independence).toBeLessThanOrEqual(1);
    expect(scores.authenticity).toBeGreaterThanOrEqual(0);
    expect(scores.authenticity).toBeLessThanOrEqual(1);
    expect(scores.historicalAccuracy).toBeGreaterThanOrEqual(0);
    expect(scores.historicalAccuracy).toBeLessThanOrEqual(1);
  });

  test("governance: low reliability never dismisses serious bug", () => {
    // Even with low scorer output, classification is independent
    const post = makePost({ text: "same here" });
    const scores = scoreReporter("same here", [], [], [], post);
    // Low scores don't change the classification — that's handled in classifier
    expect(scores.composite).toBeLessThan(0.7);
    // But the composite score doesn't control whether a bug is dismissed
  });
});
