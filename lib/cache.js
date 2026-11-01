import { getDb } from "./db/index.js";

/**
 * Checks if caching has been explicitly disabled via environment configuration.
 * @returns {boolean}
 */
export function isCacheDisabled() {
  const envVal = process.env.DISABLE_CACHE;
  return envVal === "true" || envVal === "1";
}

/**
 * Gets a value from lookup_cache if present and not expired.
 * `fetched_at` is an INTEGER storing epoch seconds.
 *
 * @param {string} key
 * @param {import("better-sqlite3").Database} [db]
 * @returns {any | null} Parsed JSON result or null if missing/expired
 */
export function get(key, db = getDb()) {
  if (isCacheDisabled()) {
    return null;
  }
  const stmt = db.prepare(`SELECT result_json, fetched_at, ttl_seconds FROM lookup_cache WHERE key = ?`);
  const row = stmt.get(key);

  if (!row) {
    return null;
  }

  const fetchedAtEpoch = Number(row.fetched_at);
  const nowEpoch = Math.floor(Date.now() / 1000);
  const expiresAtEpoch = fetchedAtEpoch + row.ttl_seconds;

  if (nowEpoch > expiresAtEpoch) {
    // Expired: clean it up
    db.prepare(`DELETE FROM lookup_cache WHERE key = ?`).run(key);
    return null;
  }

  try {
    return JSON.parse(row.result_json);
  } catch {
    return null;
  }
}

/**
 * Sets a value in lookup_cache with a TTL in seconds.
 * `fetched_at` is stored as an INTEGER in epoch seconds.
 *
 * @param {string} key
 * @param {any} value JSON-serializable value
 * @param {number} [ttlSeconds=3600] Time to live in seconds
 * @param {import("better-sqlite3").Database} [db]
 */
export function set(key, value, ttlSeconds = 3600, db = getDb()) {
  if (isCacheDisabled()) {
    return;
  }
  const fetchedAtEpoch = Math.floor(Date.now() / 1000);
  const resultJson = JSON.stringify(value);

  const stmt = db.prepare(`
    INSERT INTO lookup_cache (key, result_json, fetched_at, ttl_seconds)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      result_json = excluded.result_json,
      fetched_at = excluded.fetched_at,
      ttl_seconds = excluded.ttl_seconds
  `);

  stmt.run(key, resultJson, fetchedAtEpoch, ttlSeconds);
}

export const cacheGet = get;
export const cacheSet = set;

/**
 * Deletes a value from lookup_cache.
 *
 * @param {string} key
 * @param {import("better-sqlite3").Database} [db]
 */
export function del(key, db = getDb()) {
  const stmt = db.prepare(`DELETE FROM lookup_cache WHERE key = ?`);
  stmt.run(key);
}

/**
 * Purges all expired entries from lookup_cache.
 *
 * @param {import("better-sqlite3").Database} [db]
 * @returns {number} Count of purged rows
 */
export function purge(db = getDb()) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`DELETE FROM lookup_cache WHERE (fetched_at + ttl_seconds) < ?`);
  const info = stmt.run(nowEpoch);
  return info.changes;
}
