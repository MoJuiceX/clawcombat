/**
 * Analytics Events API
 *
 * Receives frontend analytics events and stores them for analysis.
 * Uses a simple append-only storage pattern.
 *
 * Rate limiting uses Redis when available for persistence across restarts,
 * falling back to in-memory when Redis is unavailable.
 */

'use strict';

const log = require('../utils/logger').createLogger('EVENTS');
const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { getRedisClient } = require('../utils/redis');

// Rate limit constants
const RATE_LIMIT_WINDOW_SECONDS = 60;  // 1 minute
const RATE_LIMIT_MAX = 100;
const REDIS_KEY_PREFIX = 'rate:events:';

// In-memory fallback for when Redis is unavailable
const eventCounts = new Map();

/**
 * Check rate limit using Redis (persistent across restarts)
 * @param {string} ip - Client IP address
 * @returns {Promise<boolean>} - True if allowed, false if rate limited
 */
async function checkRateLimitRedis(ip) {
  const redis = await getRedisClient();
  if (!redis) {
    return checkRateLimitMemory(ip);  // Fallback to in-memory
  }

  try {
    const key = `${REDIS_KEY_PREFIX}${ip}`;
    const count = await redis.incr(key);

    // Set expiry only on first increment (count === 1)
    if (count === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }

    return count <= RATE_LIMIT_MAX;
  } catch (err) {
    log.warn('Redis rate limit check failed, falling back to memory', { error: err.message });
    return checkRateLimitMemory(ip);
  }
}

/**
 * Check rate limit using in-memory Map (fallback)
 * @param {string} ip - Client IP address
 * @returns {boolean} - True if allowed, false if rate limited
 */
function checkRateLimitMemory(ip) {
  const now = Date.now();
  const record = eventCounts.get(ip);

  if (!record || now - record.start > RATE_LIMIT_WINDOW_SECONDS * 1000) {
    eventCounts.set(ip, { start: now, count: 1 });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

// Clean up old in-memory rate limit entries periodically
const eventsCleanupInterval = setInterval(() => {
  const now = Date.now();
  const cutoff = RATE_LIMIT_WINDOW_SECONDS * 2 * 1000;  // 2x window
  for (const [key, record] of eventCounts) {
    if (now - record.start > cutoff) {
      eventCounts.delete(key);
    }
  }
}, 60000);
if (eventsCleanupInterval.unref) eventsCleanupInterval.unref();

/**
 * POST /api/events
 * Receive analytics event from frontend
 */
router.post('/', async (req, res) => {
  try {
    // Check rate limit (uses Redis if available, otherwise in-memory)
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const allowed = await checkRateLimitRedis(ip);
    if (!allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Parse body (supports both JSON and text/plain from sendBeacon)
    let data = req.body;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }

    // Validate required fields
    if (!data.event || typeof data.event !== 'string') {
      return res.status(400).json({ error: 'event field is required' });
    }

    // Sanitize event name (alphanumeric and underscores only)
    const eventName = data.event.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50);
    if (!eventName) {
      return res.status(400).json({ error: 'Invalid event name' });
    }

    // Build event record
    const event = {
      event_name: eventName,
      props: JSON.stringify(data.props || {}),
      url: (data.url || '').slice(0, 500),
      referrer: (data.referrer || '').slice(0, 500),
      device: (data.device || 'unknown').slice(0, 20),
      session_id: (data.session_id || '').slice(0, 50),
      user_id: (data.props?.user_id || '').slice(0, 100),
      ip_hash: hashIP(ip),
      user_agent: (req.headers['user-agent'] || '').slice(0, 500),
      created_at: new Date().toISOString()
    };

    // Store event
    const db = getDb();
    db.prepare(`
      INSERT INTO analytics_events (
        event_name, props, url, referrer, device, session_id, user_id, ip_hash, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.event_name,
      event.props,
      event.url,
      event.referrer,
      event.device,
      event.session_id,
      event.user_id,
      event.ip_hash,
      event.user_agent,
      event.created_at
    );

    res.status(204).send();
  } catch (err) {
    log.error('Error storing event:', { error: err.message });
    res.status(500).json({ error: 'Failed to store event' });
  }
});

/**
 * Hash IP address for privacy (one-way hash)
 */
function hashIP(ip) {
  // Simple hash - in production, use crypto.createHash with a salt
  let hash = 0;
  const str = ip + 'clawcombat-salt';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'h_' + Math.abs(hash).toString(36);
}

module.exports = router;
