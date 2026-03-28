import { Hono } from "hono";
import { db } from "../db/client";
import { categories } from "../db/schema";

export const categoriesRoute = new Hono();

// GET /categories — list all categories
categoriesRoute.get("/", async (c) => {
  const allCategories = await db.select().from(categories);
  return c.json(allCategories);
});
