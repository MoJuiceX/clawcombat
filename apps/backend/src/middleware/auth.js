const crypto = require('crypto');
const { getDb } = require('../db/schema');
const { LAST_ACTIVE_THROTTLE_MS, MS_PER_MINUTE } = require('../config/constants');
const { getActiveAgentByKeyHash, getActiveAgentByBotToken } = require('../services/agent-queries');
const log = require('../utils/logger').createLogger('AUTH');

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// PERFORMANCE: In-memory cache to batch last_active updates
// Only write to DB if >5 minutes since last update
const lastActiveCache = new Map();

// MEMORY MANAGEMENT: Clean up stale entries every 10 minutes
// Prevents unbounded memory growth from inactive agents
const authCacheCleanupInterval = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [agentId, lastUpdated] of lastActiveCache) {
    // Remove entries that haven't been accessed in 2x the throttle window
    if (now - lastUpdated > LAST_ACTIVE_THROTTLE_MS * 2) {
      lastActiveCache.delete(agentId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log.debug('Cache cleanup', { cleaned, remaining: lastActiveCache.size });
  }
}, 10 * 60 * 1000); // 10 minutes
if (authCacheCleanupInterval.unref) authCacheCleanupInterval.unref();

function authenticateAgent(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    log.warn('Missing auth header', { ip: req.ip });
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  const tokenHash = hashApiKey(token);
  const db = getDb();

  // Support both clw_sk_ (API keys) and clw_bot_ (bot tokens)
  // NOTE: The 'api_key' column actually stores the SHA-256 hash of the key, not the plaintext.
  // This is a naming legacy for backward compatibility - see db/schema.js for documentation.
  const agent = token.startsWith('clw_bot_')
    ? getActiveAgentByBotToken(tokenHash)
    : getActiveAgentByKeyHash(tokenHash);

  if (!agent) {
    log.warn('Invalid API key attempt', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid API key or inactive agent' });
  }

  // PERFORMANCE: Throttle last_active updates to reduce DB writes
  const now = Date.now();
  const lastUpdated = lastActiveCache.get(agent.id) || 0;
  if (now - lastUpdated > LAST_ACTIVE_THROTTLE_MS) {
    db.prepare('UPDATE agents SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?').run(agent.id);
    lastActiveCache.set(agent.id, now);
  }

  req.agent = agent;
  next();
}

/**
 * Optional agent authentication - sets req.agent if valid, but doesn't fail if missing/invalid
 * Use for endpoints that work for both authenticated and anonymous users
 */
function optionalAgentAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(); // No auth header, continue without agent
  }

  const token = authHeader.slice(7);
  const tokenHash = hashApiKey(token);

  const agent = token.startsWith('clw_bot_')
    ? getActiveAgentByBotToken(tokenHash)
    : getActiveAgentByKeyHash(tokenHash);

  if (agent) {
    req.agent = agent;
  }
  next();
}

/**
 * Get agent ID from auth header without middleware (for inline use)
 * Returns agent ID or null if not authenticated
 */
function getAgentIdFromAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const tokenHash = hashApiKey(token);
  const db = getDb();

  let agent;
  if (token.startsWith('clw_bot_')) {
    agent = db.prepare('SELECT id FROM agents WHERE bot_token_hash = ? AND status = ?').get(tokenHash, 'active');
  } else {
    agent = db.prepare('SELECT id FROM agents WHERE api_key = ? AND status = ?').get(tokenHash, 'active');
  }

  return agent ? agent.id : null;
}

module.exports = { authenticateAgent, optionalAgentAuth, getAgentIdFromAuth, hashApiKey };
