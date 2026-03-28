import { Hono } from "hono";
import { productsRoute } from "./routes/products";
import { categoriesRoute } from "./routes/categories";
import { statsRoute } from "./routes/stats";

const app = new Hono();

app.route("/products", productsRoute);
app.route("/categories", categoriesRoute);
app.route("/stats", statsRoute);

export default app;
