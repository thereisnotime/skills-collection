import { describe, test, expect } from "bun:test";
import {
  charTrigramSimilarity,
  tokenJaccardSimilarity,
  hybridSimilarity,
  deduplicateCandidates,
} from "./dedupe";

// ============================================================
// Similarity Function Tests
// ============================================================

describe("charTrigramSimilarity", () => {
  test("identical strings return 1", () => {
    expect(charTrigramSimilarity("hello world", "hello world")).toBe(1);
  });

  test("completely different strings return low similarity", () => {
    const sim = charTrigramSimilarity("abc def ghi", "xyz uvw rst");
    expect(sim).toBeLessThan(0.1);
  });

  test("similar strings return high similarity", () => {
    const sim = charTrigramSimilarity(
      "Claude chat is broken on mobile",
      "Claude chat broken on mobile app",
    );
    expect(sim).toBeGreaterThan(0.6);
  });

  test("case insensitive", () => {
    expect(charTrigramSimilarity("Hello World", "hello world")).toBe(1);
  });

  test("both empty strings return 1", () => {
    expect(charTrigramSimilarity("", "")).toBe(1);
  });

  test("one empty string returns 0", () => {
    expect(charTrigramSimilarity("hello", "")).toBe(0);
  });

  test("very short strings (< 3 chars)", () => {
    expect(charTrigramSimilarity("ab", "ab")).toBe(1);
  });
});

describe("tokenJaccardSimilarity", () => {
  test("identical text returns 1", () => {
    expect(tokenJaccardSimilarity("hello world", "hello world")).toBe(1);
  });

  test("paraphrased content with shared words", () => {
    const sim = tokenJaccardSimilarity(
      "Claude API returns 500 error on chat endpoint",
      "Getting 500 error from Claude API chat endpoint",
    );
    expect(sim).toBeGreaterThan(0.5);
  });

  test("completely unrelated text returns low similarity", () => {
    const sim = tokenJaccardSimilarity(
      "The weather is nice today",
      "Quantum computing advances rapidly",
    );
    expect(sim).toBeLessThan(0.1);
  });

  test("ignores punctuation", () => {
    const sim = tokenJaccardSimilarity(
      "error! crash!! broken!!!",
      "error crash broken",
    );
    expect(sim).toBe(1);
  });

  test("both empty return 1", () => {
    expect(tokenJaccardSimilarity("", "")).toBe(1);
  });

  test("one empty returns 0", () => {
    expect(tokenJaccardSimilarity("hello world", "")).toBe(0);
  });
});

describe("hybridSimilarity", () => {
  test("identical returns 1", () => {
    expect(hybridSimilarity("same text here", "same text here")).toBe(1);
  });

  test("paraphrased bug reports score high", () => {
    const sim = hybridSimilarity(
      "Claude chat messages disappearing after refresh on Chrome",
      "Messages disappear in Claude chat when I refresh Chrome browser",
    );
    expect(sim).toBeGreaterThan(0.5);
  });

  test("unrelated text scores low", () => {
    const sim = hybridSimilarity(
      "API 500 error on auth endpoint",
      "Beautiful sunset at the beach today",
    );
    expect(sim).toBeLessThan(0.2);
  });
});

// ============================================================
// Deduplication Pipeline Tests
// ============================================================

describe("deduplicateCandidates", () => {
  test("identical posts are grouped", () => {
    const candidates = [
      { post_id: "1", text: "Claude chat is broken, messages disappearing", public_metrics: { like_count: 10, reply_count: 2, retweet_count: 1, quote_count: 0 } },
      { post_id: "2", text: "Claude chat is broken, messages disappearing", public_metrics: { like_count: 5, reply_count: 0, retweet_count: 0, quote_count: 0 } },
    ];
    const result = deduplicateCandidates(candidates);
    expect(result.duplicate_group_count).toBe(1);
    expect(result.unique_count).toBe(1);
    expect(result.groups[0].canonical_id).toBe("1"); // higher engagement
    expect(result.groups[0].duplicate_ids).toEqual(["2"]);
    expect(result.forward_ids.has("1")).toBe(true);
    expect(result.forward_ids.has("2")).toBe(false);
  });

  test("paraphrased posts are grouped", () => {
    const candidates = [
      { post_id: "1", text: "Claude chat messages disappearing after page refresh on Chrome browser", public_metrics: { like_count: 20, reply_count: 5, retweet_count: 3, quote_count: 1 } },
      { post_id: "2", text: "Messages disappear in Claude chat when I refresh the Chrome browser page", public_metrics: { like_count: 2, reply_count: 0, retweet_count: 0, quote_count: 0 } },
    ];
    const result = deduplicateCandidates(candidates, 0.50); // lower threshold for paraphrases
    expect(result.duplicate_group_count).toBe(1);
    expect(result.groups[0].canonical_id).toBe("1"); // higher engagement
  });

  test("unrelated posts stay separate", () => {
    const candidates = [
      { post_id: "1", text: "Claude API returns 500 error on authentication" },
      { post_id: "2", text: "Mobile app crashes when opening settings page" },
      { post_id: "3", text: "Billing page shows wrong currency for EU users" },
    ];
    const result = deduplicateCandidates(candidates);
    expect(result.duplicate_group_count).toBe(0);
    expect(result.unique_count).toBe(3);
    expect(result.forward_ids.size).toBe(3);
  });

  test("empty input returns empty result", () => {
    const result = deduplicateCandidates([]);
    expect(result.unique_count).toBe(0);
    expect(result.duplicate_group_count).toBe(0);
    expect(result.groups).toEqual([]);
  });

  test("single post returns as unique", () => {
    const result = deduplicateCandidates([{ post_id: "1", text: "test" }]);
    expect(result.unique_count).toBe(1);
    expect(result.duplicate_group_count).toBe(0);
    expect(result.forward_ids.has("1")).toBe(true);
  });

  test("canonical post is highest engagement", () => {
    const candidates = [
      { post_id: "1", text: "Claude is broken again", public_metrics: { like_count: 1, reply_count: 0, retweet_count: 0, quote_count: 0 } },
      { post_id: "2", text: "Claude is broken again", public_metrics: { like_count: 100, reply_count: 50, retweet_count: 20, quote_count: 5 } },
      { post_id: "3", text: "Claude is broken again", public_metrics: { like_count: 5, reply_count: 1, retweet_count: 0, quote_count: 0 } },
    ];
    const result = deduplicateCandidates(candidates);
    expect(result.groups[0].canonical_id).toBe("2");
    expect(result.groups[0].duplicate_ids).toContain("1");
    expect(result.groups[0].duplicate_ids).toContain("3");
  });

  test("posts without metrics default to 0 engagement", () => {
    const candidates = [
      { post_id: "1", text: "same text exact match" },
      { post_id: "2", text: "same text exact match", public_metrics: { like_count: 1, reply_count: 0, retweet_count: 0, quote_count: 0 } },
    ];
    const result = deduplicateCandidates(candidates);
    expect(result.groups[0].canonical_id).toBe("2"); // has metrics
  });

  test("respects configurable threshold", () => {
    const candidates = [
      { post_id: "1", text: "Claude chat broken on mobile" },
      { post_id: "2", text: "Claude chat issue on mobile device" },
    ];
    // Very high threshold — should not group
    const strict = deduplicateCandidates(candidates, 0.99);
    expect(strict.duplicate_group_count).toBe(0);

    // Low threshold — should group
    const loose = deduplicateCandidates(candidates, 0.30);
    expect(loose.duplicate_group_count).toBe(1);
  });

  test("transitive grouping: A~B and B~C groups A,B,C", () => {
    const candidates = [
      { post_id: "A", text: "Claude chat messages disappearing after refresh" },
      { post_id: "B", text: "Claude chat messages disappearing when refreshing page" },
      { post_id: "C", text: "Messages disappearing in Claude chat on page refresh" },
    ];
    const result = deduplicateCandidates(candidates, 0.50);
    // Should be one group (transitive)
    expect(result.duplicate_group_count).toBeLessThanOrEqual(1);
    expect(result.unique_count).toBeLessThanOrEqual(2);
  });

  test("performance: 100 posts complete in < 500ms", () => {
    const candidates = Array.from({ length: 100 }, (_, i) => ({
      post_id: `post-${i}`,
      text: `Bug report number ${i}: Claude ${i % 10 === 0 ? "chat broken" : `feature ${i} has issue ${i * 7}`} on platform ${i % 3}`,
    }));

    const start = performance.now();
    deduplicateCandidates(candidates);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
