import { describe, test, expect } from "bun:test";
import { buildSourceStatusReport, formatSourceStatusBlock } from "./source-status";
import type { DegradationReport, RateLimitState } from "../mcp/triage-server/types";

function makeRateLimit(endpoint: string, remaining: number, limit: number): RateLimitState {
  return { endpoint, remaining, limit, resetAt: Math.floor(Date.now() / 1000) + 900 };
}

describe("source status report", () => {
  test("all healthy sources", () => {
    const degradations = [
      { name: "X Mentions", report: null },
      { name: "X Search", report: null },
      { name: "GitHub Issues", report: null },
    ];
    const rateLimits = new Map<string, RateLimitState>([
      ["X Mentions", makeRateLimit("users/:id/mentions", 200, 450)],
      ["X Search", makeRateLimit("tweets/search/recent", 280, 300)],
    ]);
    const postCounts = new Map([["X Mentions", 450], ["X Search", 120]]);

    const report = buildSourceStatusReport(degradations, rateLimits, postCounts);
    expect(report.all_healthy).toBe(true);
    expect(report.any_failed).toBe(false);
    expect(report.sources).toHaveLength(3);
    expect(report.sources[0].status).toBe("ok");
    expect(report.sources[0].post_count).toBe(450);
    expect(report.sources[0].rate_limit_display).toBe("200/450");
  });

  test("mixed status (one degraded)", () => {
    const degradations = [
      { name: "X Mentions", report: null },
      { name: "X Search", report: null },
      {
        name: "GitHub Issues",
        report: {
          endpoint: "github/issues",
          status: "degraded" as const,
          error: "timeout",
          retries: 2,
        },
      },
    ];
    const rateLimits = new Map<string, RateLimitState>();
    const postCounts = new Map([["X Mentions", 100], ["X Search", 50]]);

    const report = buildSourceStatusReport(degradations, rateLimits, postCounts);
    expect(report.all_healthy).toBe(false);
    expect(report.any_failed).toBe(false);
    expect(report.sources[2].status).toBe("degraded");
    expect(report.sources[2].error).toBe("timeout");
    expect(report.sources[2].rate_limit_display).toBe("---");
  });

  test("all failed sources", () => {
    const failedReport: DegradationReport = {
      endpoint: "test",
      status: "failed",
      error: "401 Unauthorized",
      retries: 0,
    };
    const degradations = [
      { name: "X Mentions", report: failedReport },
      { name: "X Search", report: failedReport },
    ];
    const rateLimits = new Map<string, RateLimitState>();
    const postCounts = new Map<string, number>();

    const report = buildSourceStatusReport(degradations, rateLimits, postCounts);
    expect(report.all_healthy).toBe(false);
    expect(report.any_failed).toBe(true);
    expect(report.sources.every((s) => s.status === "failed")).toBe(true);
  });

  test("succeeded status treated as ok", () => {
    const degradations = [
      {
        name: "X Mentions",
        report: {
          endpoint: "users/:id/mentions",
          status: "succeeded" as const,
          retries: 0,
        },
      },
    ];
    const rateLimits = new Map<string, RateLimitState>();
    const postCounts = new Map([["X Mentions", 200]]);

    const report = buildSourceStatusReport(degradations, rateLimits, postCounts);
    expect(report.sources[0].status).toBe("ok");
  });

  test("null post count shows null", () => {
    const degradations = [{ name: "X Search", report: null }];
    const rateLimits = new Map<string, RateLimitState>();
    const postCounts = new Map<string, number>();

    const report = buildSourceStatusReport(degradations, rateLimits, postCounts);
    expect(report.sources[0].post_count).toBeNull();
  });

  test("skipped_reason propagated as error", () => {
    const degradations = [
      {
        name: "X Search",
        report: {
          endpoint: "tweets/search/recent",
          status: "degraded" as const,
          retries: 3,
          skipped_reason: "Max retries on 429",
        },
      },
    ];
    const rateLimits = new Map<string, RateLimitState>();
    const postCounts = new Map<string, number>();

    const report = buildSourceStatusReport(degradations, rateLimits, postCounts);
    expect(report.sources[0].error).toBe("Max retries on 429");
  });
});

describe("formatSourceStatusBlock", () => {
  test("formats all-healthy report", () => {
    const report = buildSourceStatusReport(
      [
        { name: "X Mentions", report: null },
        { name: "X Search", report: null },
      ],
      new Map([
        ["X Mentions", makeRateLimit("mentions", 200, 450)],
        ["X Search", makeRateLimit("search", 280, 300)],
      ]),
      new Map([["X Mentions", 450], ["X Search", 120]]),
    );
    const output = formatSourceStatusBlock(report);
    expect(output).toContain("--- Sources ---");
    expect(output).toContain("X Mentions");
    expect(output).toContain("ok");
    expect(output).toContain("450 posts");
    expect(output).toContain("200/450");
  });

  test("formats degraded source", () => {
    const report = buildSourceStatusReport(
      [
        {
          name: "GitHub Issues",
          report: { endpoint: "gh", status: "degraded", error: "timeout", retries: 2 },
        },
      ],
      new Map(),
      new Map(),
    );
    const output = formatSourceStatusBlock(report);
    expect(output).toContain("degraded");
    expect(output).toContain("timeout");
  });
});
