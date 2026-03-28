import { Hono } from "hono";
import { db } from "../db/client";
import { reviews, products } from "../db/schema";

export const statsRoute = new Hono();

// GET /stats — review statistics per category
statsRoute.get("/", async (c) => {
  const allReviews = await db.select().from(reviews);
  const allProducts = await db.select().from(products);

  const productCategoryMap = allProducts.reduce(
    (acc, product) => {
      acc[product.id] = product.categoryId;
      return acc;
    },
    {} as Record<number, number>,
  );

  const statsMap = allReviews.reduce(
    (acc, review) => {
      const categoryId = productCategoryMap[review.productId];
      if (!acc[categoryId]) acc[categoryId] = { totalRating: 0, count: 0 };
      acc[categoryId].totalRating += review.rating;
      acc[categoryId].count += 1;
      return acc;
    },
    {} as Record<number, { totalRating: number; count: number }>,
  );

  const stats = Object.entries(statsMap).map(([categoryId, s]) => ({
    categoryId: Number(categoryId),
    avgRating: s.totalRating / s.count,
    reviewCount: s.count,
  }));

  return c.json(stats);
});
