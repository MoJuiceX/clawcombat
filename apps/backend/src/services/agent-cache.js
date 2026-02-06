/**
 * Agent Profile Cache Service
 *
 * Provides centralized caching for agent data to reduce repetitive DB lookups.
 * Used across routes for read-only agent data access.
 *
 * Features:
 * - 30-second TTL per agent
 * - Max 1000 agents (LRU eviction)
 * - Explicit invalidation on updates
 * - Batch lookup support
 */

const { createTTLCache } = require('../utils/cache');
const { getDb } = require('../db/schema');

// Agent profile cache: id → agent row
const agentCache = createTTLCache({
  name: 'agent-profiles',
  ttlMs: 30 * 1000, // 30 seconds
  maxSize: 1000,    // Max 1000 agents
  cleanupIntervalMs: 60 * 1000
});

// Agent-by-API-key cache: hash → agent row
const agentByKeyCache = createTTLCache({
  name: 'agent-by-key',
  ttlMs: 30 * 1000,
  maxSize: 500,
  cleanupIntervalMs: 60 * 1000
});

/**
 * Get agent by ID (cached)
 * @param {string} agentId
 * @param {Object} [options]
 * @param {boolean} [options.forceRefresh] - Bypass cache
 * @returns {Object|null} Agent data or null
 */
function getAgentById(agentId, options = {}) {
  if (!agentId) return null;

  // Check cache first (unless force refresh)
  if (!options.forceRefresh) {
    const cached = agentCache.get(agentId);
    if (cached !== undefined) return cached;
  }

  // Query database
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);

  // Cache result (including null for not found)
  agentCache.set(agentId, agent || null);

  return agent || null;
}

/**
 * Get active agent by ID (cached)
 * @param {string} agentId
 * @returns {Object|null} Active agent or null
 */
function getActiveAgentById(agentId) {
  const agent = getAgentById(agentId);
  return agent?.status === 'active' ? agent : null;
}

/**
 * Get agent by API key hash (cached)
 * @param {string} keyHash - SHA256 hash of the API key
 * @returns {Object|null} Active agent or null
 */
function getAgentByKeyHash(keyHash) {
  if (!keyHash) return null;

  // Check cache first
  const cached = agentByKeyCache.get(keyHash);
  if (cached !== undefined) return cached;

  // Query database
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE api_key = ? AND status = ?').get(keyHash, 'active');

  // Cache result
  agentByKeyCache.set(keyHash, agent || null);

  return agent || null;
}

/**
 * Batch get agents by IDs (cached where possible)
 * @param {string[]} agentIds
 * @returns {Map<string, Object>} Map of agentId → agent data
 */
function getAgentsByIds(agentIds) {
  if (!agentIds || agentIds.length === 0) return new Map();

  const result = new Map();
  const uncachedIds = [];

  // Check cache for each ID
  for (const id of agentIds) {
    const cached = agentCache.get(id);
    if (cached !== undefined) {
      result.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }

  // Batch fetch uncached IDs
  if (uncachedIds.length > 0) {
    const db = getDb();
    const placeholders = uncachedIds.map(() => '?').join(',');
    const agents = db.prepare(`SELECT * FROM agents WHERE id IN (${placeholders})`).all(...uncachedIds);

    // Cache and add to result
    const foundIds = new Set();
    for (const agent of agents) {
      agentCache.set(agent.id, agent);
      result.set(agent.id, agent);
      foundIds.add(agent.id);
    }

    // Cache null for not found
    for (const id of uncachedIds) {
      if (!foundIds.has(id)) {
        agentCache.set(id, null);
        result.set(id, null);
      }
    }
  }

  return result;
}

/**
 * Invalidate cached agent data
 * Call this after updating an agent
 * @param {string} agentId
 */
function invalidateAgent(agentId) {
  if (!agentId) return;
  agentCache.delete(agentId);

  // Also need to invalidate by key if we knew it
  // For now, we'll rely on TTL for key cache
}

/**
 * Invalidate agent by API key hash
 * @param {string} keyHash
 */
function invalidateAgentByKey(keyHash) {
  if (!keyHash) return;
  agentByKeyCache.delete(keyHash);
}

/**
 * Invalidate multiple agents (e.g., after a battle)
 * @param {string[]} agentIds
 */
function invalidateAgents(agentIds) {
  if (!agentIds) return;
  for (const id of agentIds) {
    agentCache.delete(id);
  }
}

/**
 * Clear all cached agent data
 */
function clearAllAgentCache() {
  agentCache.clear();
  agentByKeyCache.clear();
}

/**
 * Get cache statistics
 */
function getAgentCacheStats() {
  return {
    agentCache: agentCache.getMetrics(),
    agentByKeyCache: agentByKeyCache.getMetrics()
  };
}

module.exports = {
  getAgentById,
  getActiveAgentById,
  getAgentByKeyHash,
  getAgentsByIds,
  invalidateAgent,
  invalidateAgentByKey,
  invalidateAgents,
  clearAllAgentCache,
  getAgentCacheStats
};
