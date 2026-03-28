import { describe, it, expect } from "bun:test";
import app from "../src/index";

describe("GET /products", () => {
  it("returns a list of products", async () => {
    const res = await app.request("/products");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(5);
  });

  it("each product has id, name, price, imageUrls", async () => {
    const res = await app.request("/products");
    const data = await res.json();

    for (const product of data) {
      expect(product).toHaveProperty("id");
      expect(product).toHaveProperty("name");
      expect(product).toHaveProperty("price");
      expect(product).toHaveProperty("imageUrls");
    }
  });
});

describe("GET /products/:id", () => {
  it("returns a product with reviews", async () => {
    const res = await app.request("/products/1");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("id", 1);
    expect(data).toHaveProperty("name", "Laptop");
    expect(data).toHaveProperty("reviews");
    expect(Array.isArray(data.reviews)).toBe(true);
    expect(data.reviews.length).toBe(3);
  });

  it("returns 404 for non-existent product", async () => {
    const res = await app.request("/products/9999");
    expect(res.status).toBe(404);
  });
});
