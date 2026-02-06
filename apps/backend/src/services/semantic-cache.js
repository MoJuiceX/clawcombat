/**
 * Semantic Cache Service
 *
 * Infrastructure for LLM response caching using semantic similarity.
 * Per SYSTEM-DESIGN-STRATEGIES.md: "Cache by meaning, not exact match"
 *
 * This service provides:
 * - Exact match caching (prompt hash)
 * - Semantic similarity search (when embeddings are available)
 * - Namespace isolation for different AI features
 * - TTL-based expiration
 * - Hit rate metrics
 *
 * Usage:
 *   const cache = require('./services/semantic-cache');
 *
 *   // Check cache first
 *   const cached = await cache.get('battle_strategy', prompt);
 *   if (cached) return cached.response;
 *
 */

const log = require('../utils/logger').createLogger('SEMANTIC_CACHE');
 *   // Generate and cache
 *   const response = await llm.generate(prompt);
 *   await cache.set('battle_strategy', prompt, response, { model: 'gpt-4' });
 */

const crypto = require('crypto');
const { getDb } = require('../db/schema');

// Default configuration
const CONFIG = {
  defaultTTLMs: 24 * 60 * 60 * 1000, // 24 hours
  similarityThreshold: 0.92,          // Cosine similarity threshold
  maxCacheSize: 10000,                // Max entries per namespace
  cleanupIntervalMs: 60 * 60 * 1000,  // Cleanup every hour
};

// Metrics tracking
const metrics = {
  hits: 0,
  misses: 0,
  semanticHits: 0,
  exactHits: 0,
};

/**
 * Hash a prompt for exact-match lookup
 */
function hashPrompt(prompt) {
  return crypto.createHash('sha256').update(prompt.trim().toLowerCase()).digest('hex');
}

/**
 * Generate a unique cache entry ID
 */
function generateId() {
  return `sc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Get cached response by exact match or semantic similarity
 *
 * @param {string} namespace - Cache namespace (e.g., 'battle_strategy', 'commentary')
 * @param {string} prompt - The prompt to look up
 * @param {Object} options
 * @param {number} options.threshold - Similarity threshold (0-1)
 * @param {Function} options.getEmbedding - Optional function to get embeddings
 * @returns {Object|null} Cached entry or null
 */
async function get(namespace, prompt, options = {}) {
  const db = getDb();
  const promptHash = hashPrompt(prompt);
  const now = new Date().toISOString();

  // Try exact match first (fast path)
  const exact = db.prepare(`
    SELECT * FROM semantic_cache
    WHERE prompt_hash = ? AND namespace = ?
    AND (expires_at IS NULL OR expires_at > ?)
  `).get(promptHash, namespace, now);

  if (exact) {
    metrics.hits++;
    metrics.exactHits++;

    // Update hit stats
    db.prepare(`
      UPDATE semantic_cache
      SET hit_count = hit_count + 1, last_hit_at = ?
      WHERE id = ?
    `).run(now, exact.id);

    return {
      response: exact.response,
      model: exact.model,
      hitType: 'exact',
      hitCount: exact.hit_count + 1,
    };
  }

  // If embedding function provided, try semantic search
  if (options.getEmbedding) {
    const threshold = options.threshold || CONFIG.similarityThreshold;
    const promptEmbedding = await options.getEmbedding(prompt);

    if (promptEmbedding) {
      const candidates = db.prepare(`
        SELECT * FROM semantic_cache
        WHERE namespace = ? AND embedding IS NOT NULL
        AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC
        LIMIT 100
      `).all(namespace, now);

      // Find best matching candidate
      let bestMatch = null;
      let bestSimilarity = 0;

      for (const candidate of candidates) {
        const similarity = cosineSimilarity(promptEmbedding, candidate.embedding);
        if (similarity >= threshold && similarity > bestSimilarity) {
          bestMatch = candidate;
          bestSimilarity = similarity;
        }
      }

      if (bestMatch) {
        metrics.hits++;
        metrics.semanticHits++;

        // Update hit stats (single query, not in loop)
        db.prepare(`
          UPDATE semantic_cache
          SET hit_count = hit_count + 1, last_hit_at = ?
          WHERE id = ?
        `).run(now, bestMatch.id);

        return {
          response: bestMatch.response,
          model: bestMatch.model,
          hitType: 'semantic',
          similarity: bestSimilarity,
          hitCount: bestMatch.hit_count + 1,
          originalPrompt: bestMatch.prompt_text,
        };
      }
    }
  }

  metrics.misses++;
  return null;
}

/**
 * Cache a response
 *
 * @param {string} namespace - Cache namespace
 * @param {string} prompt - The prompt
 * @param {string} response - The LLM response
 * @param {Object} options
 * @param {string} options.model - Model used (e.g., 'gpt-4')
 * @param {number} options.ttlMs - TTL in milliseconds
 * @param {Buffer} options.embedding - Optional embedding vector
 */
async function set(namespace, prompt, response, options = {}) {
  const db = getDb();
  const id = generateId();
  const promptHash = hashPrompt(prompt);
  const now = new Date();
  const ttlMs = options.ttlMs || CONFIG.defaultTTLMs;
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  // Remove existing entry with same hash (update behavior)
  db.prepare(`
    DELETE FROM semantic_cache
    WHERE prompt_hash = ? AND namespace = ?
  `).run(promptHash, namespace);

  // Insert new entry
  db.prepare(`
    INSERT INTO semantic_cache (
      id, prompt_hash, prompt_text, embedding, response,
      model, namespace, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    promptHash,
    prompt,
    options.embedding || null,
    response,
    options.model || 'unknown',
    namespace,
    now.toISOString(),
    expiresAt
  );

  return id;
}

/**
 * Invalidate cache entries
 *
 * @param {string} namespace - Cache namespace (or null for all)
 * @param {Object} options
 * @param {string} options.promptHash - Specific prompt hash to invalidate
 * @param {boolean} options.expiredOnly - Only remove expired entries
 */
function invalidate(namespace, options = {}) {
  const db = getDb();
  const now = new Date().toISOString();

  if (options.promptHash) {
    db.prepare(`
      DELETE FROM semantic_cache
      WHERE prompt_hash = ? AND (namespace = ? OR ? IS NULL)
    `).run(options.promptHash, namespace, namespace);
  } else if (options.expiredOnly) {
    db.prepare(`
      DELETE FROM semantic_cache
      WHERE expires_at < ? AND (namespace = ? OR ? IS NULL)
    `).run(now, namespace, namespace);
  } else if (namespace) {
    db.prepare(`DELETE FROM semantic_cache WHERE namespace = ?`).run(namespace);
  } else {
    db.prepare(`DELETE FROM semantic_cache`).run();
  }
}

/**
 * Cleanup expired entries and enforce size limits
 */
function cleanup() {
  const db = getDb();
  const now = new Date().toISOString();

  // Remove expired entries
  const expiredResult = db.prepare(`
    DELETE FROM semantic_cache WHERE expires_at < ?
  `).run(now);

  // Enforce max size per namespace (keep most recently hit)
  // Single query to get all namespace counts
  const namespaceCounts = db.prepare(`
    SELECT namespace, COUNT(*) as cnt
    FROM semantic_cache
    GROUP BY namespace
    HAVING cnt > ?
  `).all(CONFIG.maxCacheSize);

  let trimmed = 0;
  for (const { namespace, cnt } of namespaceCounts) {
    const excess = cnt - CONFIG.maxCacheSize;
    db.prepare(`
      DELETE FROM semantic_cache
      WHERE id IN (
        SELECT id FROM semantic_cache
        WHERE namespace = ?
        ORDER BY COALESCE(last_hit_at, created_at) ASC
        LIMIT ?
      )
    `).run(namespace, excess);
    trimmed += excess;
  }

  if (expiredResult.changes > 0 || trimmed > 0) {
    log.info('Cache cleanup completed', { expiredCount: expiredResult.changes, trimmedCount: trimmed });
  }
}

/**
 * Calculate cosine similarity between two embeddings
 */
function cosineSimilarity(a, b) {
  if (!a || !b) return 0;

  // Convert buffers to float arrays if needed
  const vecA = a instanceof Buffer ? new Float32Array(a.buffer) : a;
  const vecB = b instanceof Buffer ? new Float32Array(b.buffer) : b;

  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Get cache metrics
 */
function getMetrics() {
  const db = getDb();

  const stats = db.prepare(`
    SELECT
      namespace,
      COUNT(*) as entries,
      SUM(hit_count) as total_hits,
      AVG(hit_count) as avg_hits
    FROM semantic_cache
    GROUP BY namespace
  `).all();

  return {
    runtime: { ...metrics },
    hitRate: metrics.hits + metrics.misses > 0
      ? metrics.hits / (metrics.hits + metrics.misses)
      : 0,
    byNamespace: stats,
  };
}

/**
 * Reset runtime metrics
 */
function resetMetrics() {
  metrics.hits = 0;
  metrics.misses = 0;
  metrics.semanticHits = 0;
  metrics.exactHits = 0;
}

// Start cleanup interval
let cleanupInterval = null;
function startCleanup() {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanup, CONFIG.cleanupIntervalMs);
    if (cleanupInterval.unref) cleanupInterval.unref();
  }
}

function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

module.exports = {
  get,
  set,
  invalidate,
  cleanup,
  getMetrics,
  resetMetrics,
  startCleanup,
  stopCleanup,
  hashPrompt,
  cosineSimilarity,
  CONFIG,
};
