/**
 * File-based JSON cache for X API responses.
 * SHA-256 keyed, configurable TTL, opt-in via config.
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { join } from "path";

export interface CacheConfig {
  enabled: boolean;
  ttl_seconds: number;
  directory: string;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: false,
  ttl_seconds: 3600,
  directory: join(import.meta.dir, "..", "data", "cache"),
};

interface CacheEntry<T> {
  key: string;
  data: T;
  created_at: number;
  ttl_seconds: number;
}

/**
 * Generate a deterministic SHA-256 cache key from URL + endpoint.
 */
export function cacheKey(url: string, endpoint: string): string {
  const hash = createHash("sha256");
  hash.update(`${endpoint}:${url}`);
  return hash.digest("hex");
}

/**
 * Retrieve a cached value if it exists and hasn't expired.
 * Returns null on miss, expiry, or disabled cache.
 */
export function getCached<T>(key: string, config: CacheConfig): T | null {
  if (!config.enabled) return null;

  try {
    const filePath = join(config.directory, `${key}.json`);
    const content = readFileSync(filePath, "utf-8");
    const entry = JSON.parse(content) as CacheEntry<T>;

    const ageMs = Date.now() - entry.created_at;
    if (ageMs >= entry.ttl_seconds * 1000) {
      // Expired — clean up
      try { unlinkSync(filePath); } catch {}
      return null;
    }

    return entry.data;
  } catch (err) {
    // Non-fatal: log for debugging, return miss
    if (process.env.DEBUG_CACHE) {
      console.error(`[Cache] Read failed for ${key}:`, err);
    }
    return null;
  }
}

/**
 * Store a value in the cache.
 */
export function setCached<T>(key: string, data: T, config: CacheConfig): void {
  if (!config.enabled) return;

  try {
    mkdirSync(config.directory, { recursive: true });
    const entry: CacheEntry<T> = {
      key,
      data,
      created_at: Date.now(),
      ttl_seconds: config.ttl_seconds,
    };
    const filePath = join(config.directory, `${key}.json`);
    writeFileSync(filePath, JSON.stringify(entry), "utf-8");
  } catch (err) {
    // Non-fatal: log for debugging, skip write
    if (process.env.DEBUG_CACHE) {
      console.error(`[Cache] Write failed for ${key}:`, err);
    }
  }
}

/**
 * Invalidate a specific cache entry.
 */
export function invalidateCache(key: string, config: CacheConfig): boolean {
  if (!config.enabled) return false;

  try {
    const filePath = join(config.directory, `${key}.json`);
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Invalidate all cache entries.
 */
export function invalidateAll(config: CacheConfig): number {
  if (!config.enabled) return 0;

  try {
    const files = readdirSync(config.directory).filter((f) => f.endsWith(".json"));
    let removed = 0;
    for (const file of files) {
      try {
        unlinkSync(join(config.directory, file));
        removed++;
      } catch {}
    }
    return removed;
  } catch {
    return 0;
  }
}
