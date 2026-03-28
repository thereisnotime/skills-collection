import { describe, it, expect } from "bun:test";
import app from "../src/index";

describe("GET /stats", () => {
  it("returns review statistics per category", async () => {
    const res = await app.request("/stats");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(3);
  });

  it("each stat has categoryId, avgRating, reviewCount", async () => {
    const res = await app.request("/stats");
    const data = await res.json();

    for (const stat of data) {
      expect(stat).toHaveProperty("categoryId");
      expect(stat).toHaveProperty("avgRating");
      expect(stat).toHaveProperty("reviewCount");
      expect(typeof stat.avgRating).toBe("number");
      expect(typeof stat.reviewCount).toBe("number");
    }
  });

  it("computes correct averages", async () => {
    const res = await app.request("/stats");
    const data = await res.json();

    // Electronics (category 1): ratings 5, 4, 3, 5, 4 -> avg 4.2, count 5
    const electronics = data.find((s: any) => s.categoryId === 1);
    expect(electronics.avgRating).toBeCloseTo(4.2);
    expect(electronics.reviewCount).toBe(5);
  });
});
