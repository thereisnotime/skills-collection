import { describe, it, expect } from "bun:test";
import app from "../src/index";

describe("GET /categories", () => {
  it("returns a list of categories", async () => {
    const res = await app.request("/categories");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(3);
  });

  it("each category has id, name, slug", async () => {
    const res = await app.request("/categories");
    const data = await res.json();

    for (const category of data) {
      expect(category).toHaveProperty("id");
      expect(category).toHaveProperty("name");
      expect(category).toHaveProperty("slug");
    }
  });
});
