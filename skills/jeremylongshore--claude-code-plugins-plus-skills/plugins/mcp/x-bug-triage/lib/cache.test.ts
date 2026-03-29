import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { cacheKey, getCached, setCached, invalidateCache, invalidateAll, DEFAULT_CACHE_CONFIG } from "./cache";
import type { CacheConfig } from "./cache";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TEST_CACHE_DIR = join(import.meta.dir, "..", "data", "test-cache");

function testConfig(overrides: Partial<CacheConfig> = {}): CacheConfig {
  return {
    enabled: true,
    ttl_seconds: 3600,
    directory: TEST_CACHE_DIR,
    ...overrides,
  };
}

describe("cache", () => {
  beforeEach(() => {
    mkdirSync(TEST_CACHE_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }
  });

  test("cacheKey produces deterministic SHA-256 hex", () => {
    const key1 = cacheKey("https://api.x.com/2/users/123/mentions", "users/:id/mentions");
    const key2 = cacheKey("https://api.x.com/2/users/123/mentions", "users/:id/mentions");
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });

  test("cacheKey differs for different URLs", () => {
    const key1 = cacheKey("https://api.x.com/2/users/123/mentions", "mentions");
    const key2 = cacheKey("https://api.x.com/2/users/456/mentions", "mentions");
    expect(key1).not.toBe(key2);
  });

  test("cache hit: stores and retrieves data", () => {
    const config = testConfig();
    const key = cacheKey("test-url", "test-endpoint");
    const data = { posts: [{ id: "1", text: "hello" }], count: 1 };

    setCached(key, data, config);
    const result = getCached<typeof data>(key, config);

    expect(result).not.toBeNull();
    expect(result!.posts[0].id).toBe("1");
    expect(result!.count).toBe(1);
  });

  test("cache miss: returns null for nonexistent key", () => {
    const config = testConfig();
    const result = getCached("nonexistent-key", config);
    expect(result).toBeNull();
  });

  test("cache expiry: returns null after TTL", () => {
    const config = testConfig({ ttl_seconds: 0 });
    const key = cacheKey("expiry-test", "endpoint");

    setCached(key, { value: "old" }, config);
    // TTL = 0 means immediately expired
    const result = getCached(key, config);
    expect(result).toBeNull();
  });

  test("cache disabled: getCached returns null", () => {
    const config = testConfig({ enabled: false });
    const key = cacheKey("disabled-test", "endpoint");

    setCached(key, { value: "data" }, config);
    const result = getCached(key, config);
    expect(result).toBeNull();
  });

  test("cache disabled: setCached is a no-op", () => {
    const config = testConfig({ enabled: false });
    const key = cacheKey("disabled-write-test", "endpoint");

    setCached(key, { value: "data" }, config);
    // Enable and check nothing was written
    const enabledConfig = testConfig({ enabled: true });
    const result = getCached(key, enabledConfig);
    expect(result).toBeNull();
  });

  test("invalidateCache removes specific entry", () => {
    const config = testConfig();
    const key = cacheKey("invalidate-test", "endpoint");

    setCached(key, { value: "data" }, config);
    expect(getCached(key, config)).not.toBeNull();

    const removed = invalidateCache(key, config);
    expect(removed).toBe(true);
    expect(getCached(key, config)).toBeNull();
  });

  test("invalidateCache returns false for nonexistent key", () => {
    const config = testConfig();
    const removed = invalidateCache("nonexistent", config);
    expect(removed).toBe(false);
  });

  test("invalidateAll removes all entries", () => {
    const config = testConfig();
    setCached(cacheKey("url1", "ep"), { a: 1 }, config);
    setCached(cacheKey("url2", "ep"), { b: 2 }, config);
    setCached(cacheKey("url3", "ep"), { c: 3 }, config);

    const removed = invalidateAll(config);
    expect(removed).toBe(3);

    expect(getCached(cacheKey("url1", "ep"), config)).toBeNull();
    expect(getCached(cacheKey("url2", "ep"), config)).toBeNull();
  });

  test("invalidateAll returns 0 when disabled", () => {
    const config = testConfig({ enabled: false });
    expect(invalidateAll(config)).toBe(0);
  });

  test("default config has cache disabled", () => {
    expect(DEFAULT_CACHE_CONFIG.enabled).toBe(false);
    expect(DEFAULT_CACHE_CONFIG.ttl_seconds).toBe(3600);
  });

  test("stores complex nested objects", () => {
    const config = testConfig();
    const key = cacheKey("complex-test", "endpoint");
    const data = {
      response: { data: [{ id: "1", text: "test", nested: { deep: true } }] },
      headers: { "x-rate-limit-remaining": "100" },
    };

    setCached(key, data, config);
    const result = getCached<typeof data>(key, config);
    expect(result!.response.data[0].nested.deep).toBe(true);
  });
});
