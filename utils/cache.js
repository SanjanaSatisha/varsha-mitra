/**
 * cache.js — tiny in-memory TTL cache.
 *
 * Rounds geographic coordinates to ~1km precision so nearby requests
 * share a cache entry, and prevents hammering upstream APIs (Open-Meteo,
 * BigDataCloud) on repeat demo clicks within the same session.
 */
class TTLCache {
  /** @param {number} ttlMs - how long an entry stays valid, in milliseconds */
  constructor(ttlMs) {
    this.store = new Map();
    this.ttlMs = ttlMs;
  }

  /** Builds a cache key from a lat/lon pair, rounded to 2 decimal places. */
  static keyFor(lat, lon) {
    return `${lat.toFixed(2)},${lon.toFixed(2)}`;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    this.store.set(key, { data, time: Date.now() });
  }
}

module.exports = TTLCache;
