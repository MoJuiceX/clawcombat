/**
 * Standardized Caching Utility for ClawCombat
 *
 * Provides consistent TTL-based caching with:
 * - Hit/miss metrics tracking
 * - Optional max-size limit with LRU eviction
 * - Automatic cleanup of expired entries
 * - Configurable TTL per cache instance
 */

const log = require('./logger').createLogger('CACHE');

/**
 * Simple TTL Cache with metrics
 */
class TTLCache {
  /**
   * @param {Object} options
   * @param {string} options.name - Cache name for logging
   * @param {number} options.ttlMs - Time-to-live in milliseconds
   * @param {number} [options.maxSize] - Optional max entries (LRU eviction)
   * @param {number} [options.cleanupIntervalMs] - Cleanup interval (default: ttlMs * 2)
   */
  constructor(options) {
    this.name = options.name || 'unnamed';
    this.ttlMs = options.ttlMs;
    this.maxSize = options.maxSize || Infinity;
    this.cleanupIntervalMs = options.cleanupIntervalMs || this.ttlMs * 2;

    // Internal storage: key → { value, timestamp, accessCount }
    this.cache = new Map();

    // Metrics
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0
    };

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this._cleanup(), this.cleanupIntervalMs);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  /**
   * Get a value from cache
   * @param {string} key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      this.metrics.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.metrics.misses++;
      this.metrics.expirations++;
      return undefined;
    }

    // Update access for LRU
    entry.accessCount++;
    entry.lastAccess = Date.now();
    this.metrics.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this._evictLRU();
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccess: Date.now()
    });
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a specific key
   * @param {string} key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache metrics
   * @returns {Object}
   */
  getMetrics() {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      name: this.name,
      size: this.cache.size,
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      hitRate: total > 0 ? Math.round((this.metrics.hits / total) * 1000) / 10 : 0,
      evictions: this.metrics.evictions,
      expirations: this.metrics.expirations
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = { hits: 0, misses: 0, evictions: 0, expirations: 0 };
  }

  /**
   * Get or compute a value (convenience method)
   * @param {string} key
   * @param {Function} computeFn - Function to compute value if not cached
   * @returns {*}
   */
  getOrCompute(key, computeFn) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const value = computeFn();
    this.set(key, value);
    return value;
  }

  /**
   * Async version of getOrCompute
   * @param {string} key
   * @param {Function} computeFn - Async function to compute value
   * @returns {Promise<*>}
   */
  async getOrComputeAsync(key, computeFn) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const value = await computeFn();
    this.set(key, value);
    return value;
  }

  // Private: Cleanup expired entries
  _cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        this.metrics.expirations++;
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info('Cache cleanup', { name: this.name, expired: cleaned, remaining: this.cache.size });
    }
  }

  // Private: Evict least recently used entry
  _evictLRU() {
    let oldestKey = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.metrics.evictions++;
    }
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

/**
 * Simple single-value cache (like governanceStatsCache pattern)
 */
class SingleValueCache {
  /**
   * @param {Object} options
   * @param {string} options.name - Cache name for logging
   * @param {number} options.ttlMs - Time-to-live in milliseconds
   */
  constructor(options) {
    this.name = options.name || 'unnamed';
    this.ttlMs = options.ttlMs;
    this.value = null;
    this.timestamp = 0;
    this.metrics = { hits: 0, misses: 0 };
  }

  /**
   * Get cached value if fresh
   * @returns {*} Cached value or null
   */
  get() {
    if (this.value !== null && (Date.now() - this.timestamp) < this.ttlMs) {
      this.metrics.hits++;
      return this.value;
    }
    this.metrics.misses++;
    return null;
  }

  /**
   * Set cached value
   * @param {*} value
   */
  set(value) {
    this.value = value;
    this.timestamp = Date.now();
  }

  /**
   * Check if cache is fresh
   * @returns {boolean}
   */
  isFresh() {
    return this.value !== null && (Date.now() - this.timestamp) < this.ttlMs;
  }

  /**
   * Invalidate cache
   */
  invalidate() {
    this.value = null;
    this.timestamp = 0;
  }

  /**
   * Get or compute value
   * @param {Function} computeFn
   * @returns {*}
   */
  getOrCompute(computeFn) {
    const cached = this.get();
    if (cached !== null) return cached;

    const value = computeFn();
    this.set(value);
    return value;
  }

  /**
   * Get metrics
   * @returns {Object}
   */
  getMetrics() {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      name: this.name,
      isFresh: this.isFresh(),
      age: this.timestamp ? Date.now() - this.timestamp : null,
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      hitRate: total > 0 ? Math.round((this.metrics.hits / total) * 1000) / 10 : 0
    };
  }

  resetMetrics() {
    this.metrics = { hits: 0, misses: 0 };
  }
}

/**
 * Cache Registry - tracks all caches for centralized metrics
 */
class CacheRegistry {
  constructor() {
    this.caches = new Map();
    this.metricsInterval = null;
  }

  /**
   * Register a cache for tracking
   * @param {TTLCache|SingleValueCache} cache
   */
  register(cache) {
    this.caches.set(cache.name, cache);
  }

  /**
   * Get all cache metrics
   * @returns {Array<Object>}
   */
  getAllMetrics() {
    const metrics = [];
    for (const cache of this.caches.values()) {
      metrics.push(cache.getMetrics());
    }
    return metrics;
  }

  /**
   * Start periodic metrics logging
   * @param {number} intervalMs - Log interval (default: 60s)
   */
  startMetricsLogging(intervalMs = 60000) {
    if (this.metricsInterval) return;

    this.metricsInterval = setInterval(() => {
      const metrics = this.getAllMetrics();
      if (metrics.length === 0) return;

      log.info('Cache metrics:', { data: JSON.stringify(metrics.map(m => ({
        name: m.name,
        size: m.size,
        hitRate: `${m.hitRate}%`,
        hits: m.hits,
        misses: m.misses
      }))) });

      // Reset metrics after logging
      for (const cache of this.caches.values()) {
        cache.resetMetrics();
      }
    }, intervalMs);

    if (this.metricsInterval.unref) this.metricsInterval.unref();
  }

  /**
   * Stop metrics logging
   */
  stopMetricsLogging() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }
}

// Global registry instance
const cacheRegistry = new CacheRegistry();

// Factory functions for convenience
function createTTLCache(options) {
  const cache = new TTLCache(options);
  cacheRegistry.register(cache);
  return cache;
}

function createSingleValueCache(options) {
  const cache = new SingleValueCache(options);
  cacheRegistry.register(cache);
  return cache;
}

module.exports = {
  TTLCache,
  SingleValueCache,
  CacheRegistry,
  cacheRegistry,
  createTTLCache,
  createSingleValueCache
};
