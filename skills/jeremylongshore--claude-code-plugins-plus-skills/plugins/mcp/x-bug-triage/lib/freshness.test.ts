import { describe, test, expect } from "bun:test";
import { assessFreshness } from "./freshness";

function makeTimestamp(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3600_000).toISOString();
}

describe("freshness assessment", () => {
  const windowStart = new Date(Date.now() - 24 * 3600_000).toISOString(); // 24h ago
  const windowEnd = new Date().toISOString();

  test("high confidence when all posts in window", () => {
    const posts = [
      { created_at: makeTimestamp(1) },
      { created_at: makeTimestamp(6) },
      { created_at: makeTimestamp(12) },
      { created_at: makeTimestamp(23) },
    ];
    const report = assessFreshness(posts, windowStart, windowEnd);
    expect(report.date_confidence).toBe("high");
    expect(report.freshness_ratio).toBe(1);
    expect(report.in_window_posts).toBe(4);
    expect(report.warning).toBeNull();
  });

  test("high confidence at 70% threshold", () => {
    const posts = [
      { created_at: makeTimestamp(1) },
      { created_at: makeTimestamp(6) },
      { created_at: makeTimestamp(12) },
      { created_at: makeTimestamp(20) },
      { created_at: makeTimestamp(22) },
      { created_at: makeTimestamp(23) },
      { created_at: makeTimestamp(23.5) },
      { created_at: makeTimestamp(48) }, // outside
      { created_at: makeTimestamp(72) }, // outside
      { created_at: makeTimestamp(96) }, // outside
    ];
    const report = assessFreshness(posts, windowStart, windowEnd);
    expect(report.date_confidence).toBe("high");
    expect(report.freshness_ratio).toBe(0.7);
    expect(report.warning).toBeNull();
  });

  test("medium confidence when 30-69% in window", () => {
    const posts = [
      { created_at: makeTimestamp(2) },
      { created_at: makeTimestamp(12) },
      { created_at: makeTimestamp(48) }, // outside
      { created_at: makeTimestamp(72) }, // outside
      { created_at: makeTimestamp(96) }, // outside
    ];
    const report = assessFreshness(posts, windowStart, windowEnd);
    expect(report.date_confidence).toBe("medium");
    expect(report.freshness_ratio).toBe(0.4);
    expect(report.warning).toContain("Moderate freshness");
    expect(report.warning).toContain("2/5");
  });

  test("low confidence when <30% in window", () => {
    const posts = [
      { created_at: makeTimestamp(2) },
      { created_at: makeTimestamp(48) }, // outside
      { created_at: makeTimestamp(72) }, // outside
      { created_at: makeTimestamp(96) }, // outside
      { created_at: makeTimestamp(120) }, // outside
    ];
    const report = assessFreshness(posts, windowStart, windowEnd);
    expect(report.date_confidence).toBe("low");
    expect(report.freshness_ratio).toBe(0.2);
    expect(report.warning).toContain("Low freshness");
    expect(report.warning).toContain("1/5");
  });

  test("empty posts array returns low confidence with warning", () => {
    const report = assessFreshness([], windowStart, windowEnd);
    expect(report.date_confidence).toBe("low");
    expect(report.total_posts).toBe(0);
    expect(report.freshness_ratio).toBe(0);
    expect(report.warning).toContain("No posts ingested");
  });

  test("all posts outside window returns low confidence", () => {
    const posts = [
      { created_at: makeTimestamp(48) },
      { created_at: makeTimestamp(72) },
      { created_at: makeTimestamp(96) },
    ];
    const report = assessFreshness(posts, windowStart, windowEnd);
    expect(report.date_confidence).toBe("low");
    expect(report.freshness_ratio).toBe(0);
    expect(report.in_window_posts).toBe(0);
  });

  test("defaults windowEnd to now when not provided", () => {
    const posts = [
      { created_at: makeTimestamp(1) },
      { created_at: makeTimestamp(12) },
    ];
    const report = assessFreshness(posts, windowStart);
    expect(report.date_confidence).toBe("high");
    expect(report.in_window_posts).toBe(2);
  });

  test("single post in window is high confidence", () => {
    const posts = [{ created_at: makeTimestamp(6) }];
    const report = assessFreshness(posts, windowStart, windowEnd);
    expect(report.date_confidence).toBe("high");
    expect(report.freshness_ratio).toBe(1);
  });

  test("boundary: post exactly at window start is included", () => {
    const posts = [{ created_at: windowStart }];
    const report = assessFreshness(posts, windowStart, windowEnd);
    expect(report.in_window_posts).toBe(1);
  });

  test("boundary: post exactly at window end is included", () => {
    const posts = [{ created_at: windowEnd }];
    const report = assessFreshness(posts, windowStart, windowEnd);
    expect(report.in_window_posts).toBe(1);
  });

  test("freshness ratio rounds to 2 decimal places", () => {
    const posts = [
      { created_at: makeTimestamp(2) },
      { created_at: makeTimestamp(48) },
      { created_at: makeTimestamp(72) },
    ];
    const report = assessFreshness(posts, windowStart, windowEnd);
    expect(report.freshness_ratio).toBe(0.33);
  });
});
