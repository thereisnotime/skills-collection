import {
  pgTable,
  serial,
  varchar,
  numeric,
  integer,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  categoryId: integer("category_id")
    .references(() => categories.id)
    .notNull(),
  description: text("description"),
  rawPayload: jsonb("raw_payload"),
  imageUrls: jsonb("image_urls").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .references(() => products.id)
    .notNull(),
  userName: varchar("user_name", { length: 255 }).notNull(),
  rating: integer("rating").notNull(),
  body: text("body"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
