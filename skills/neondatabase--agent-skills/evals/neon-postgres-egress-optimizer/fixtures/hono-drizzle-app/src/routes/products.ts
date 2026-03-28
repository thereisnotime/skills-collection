import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { products, reviews } from "../db/schema";

export const productsRoute = new Hono();

// GET /products — list all products
productsRoute.get("/", async (c) => {
  const allProducts = await db.select().from(products);

  return c.json(
    allProducts.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      imageUrls: p.imageUrls,
    })),
  );
});

// GET /products/:id — single product with reviews
productsRoute.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));

  const rows = await db
    .select()
    .from(products)
    .leftJoin(reviews, eq(reviews.productId, products.id))
    .where(eq(products.id, id));

  if (rows.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }

  const product = rows[0].products;
  const productReviews = rows
    .filter((r) => r.reviews !== null)
    .map((r) => r.reviews);

  return c.json({ ...product, reviews: productReviews });
});
