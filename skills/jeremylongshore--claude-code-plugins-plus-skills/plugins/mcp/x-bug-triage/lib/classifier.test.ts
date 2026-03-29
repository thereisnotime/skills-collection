import { describe, test, expect } from "bun:test";
import { classify } from "./classifier";

describe("classifier edge cases", () => {
  test("empty text classifies as needs_review", () => {
    const result = classify("", [], []);
    expect(result.classification).toBe("needs_review");
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  test("very short text with no signals is needs_review", () => {
    const result = classify("hi", [], []);
    expect(result.classification).toBe("needs_review");
  });

  test("bug keywords alone trigger bug_report", () => {
    const result = classify("it's broken", [], []);
    expect(result.classification).toBe("bug_report");
  });

  test("error string alone triggers bug_report", () => {
    const result = classify("something happened", [], ["Error 500"]);
    expect(result.classification).toBe("bug_report");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test("symptoms alone trigger bug_report", () => {
    const result = classify("the app", ["crashing"], []);
    expect(result.classification).toBe("bug_report");
  });

  test("confidence increases with more symptoms", () => {
    const r1 = classify("issue found", ["crash"], []);
    const r2 = classify("issue found", ["crash", "freeze", "hang"], []);
    expect(r2.confidence).toBeGreaterThan(r1.confidence);
  });

  test("confidence increases with error strings", () => {
    const r1 = classify("problem", ["crash"], []);
    const r2 = classify("problem", ["crash"], ["Error 500"]);
    expect(r2.confidence).toBeGreaterThan(r1.confidence);
  });

  test("confidence capped at 0.95", () => {
    const result = classify("bug", ["s1", "s2", "s3", "s4", "s5"], ["e1", "e2", "e3"]);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  test("sarcasm + bug signals = sarcastic_bug_report", () => {
    const result = classify("Love how it keeps crashing. Totally working as intended", ["crashing"], []);
    expect(result.classification).toBe("sarcastic_bug_report");
  });

  test("sarcasm without bug signals = not sarcastic_bug_report", () => {
    const result = classify("Love how this totally works as intended", [], []);
    expect(result.classification).not.toBe("sarcastic_bug_report");
  });

  test("billing keywords override other signals", () => {
    const result = classify("I was charged twice for my subscription plan", [], []);
    expect(result.classification).toBe("billing_problem");
  });

  test("auth + bug signals = account_problem", () => {
    const result = classify("Can't login, getting access denied", [], ["access denied"]);
    expect(result.classification).toBe("account_problem");
  });

  test("feature request without bug signals", () => {
    const result = classify("Would be great if you added dark mode please", [], []);
    expect(result.classification).toBe("feature_request");
  });

  test("noise detected for spam-like content", () => {
    const result = classify("Follow me for free crypto airdrop giveaway!", [], []);
    expect(result.classification).toBe("noise");
  });

  test("praise detected for positive feedback", () => {
    const result = classify("This product is amazing, works perfectly", [], []);
    expect(result.classification).toBe("praise");
  });

  test("model quality issue detected", () => {
    const result = classify("The AI hallucinated a wrong answer again", [], []);
    expect(result.classification).toBe("model_quality_issue");
  });

  test("rationale is always a non-empty string", () => {
    const inputs = [
      ["", [], []],
      ["broken", ["crash"], ["500"]],
      ["Follow me!", [], []],
      ["Great product!", [], []],
    ] as const;
    for (const [text, symptoms, errors] of inputs) {
      const result = classify(text, [...symptoms], [...errors]);
      expect(result.rationale.length).toBeGreaterThan(0);
    }
  });
});
