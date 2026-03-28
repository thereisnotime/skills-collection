import { beforeAll, afterAll } from "bun:test";
import { provisionDatabase, seed, cleanup } from "./setup";

beforeAll(async () => {
  await provisionDatabase();
  await seed();
});

afterAll(async () => {
  await cleanup();
});
