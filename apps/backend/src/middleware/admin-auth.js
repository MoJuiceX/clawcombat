/**
 * Admin authentication middleware.
 *
 * Requires ADMIN_SECRET env var to be set — refuses to start without it.
 * Checks the X-Admin-Secret header (or body.admin_secret fallback).
 * Uses timing-safe comparison to prevent timing attacks.
 * Implements brute-force lockout after repeated failures.
 *
 * Brute-force tracking uses Redis when available for persistence across
 * restarts, falling back to in-memory when Redis is unavailable.
 */
const crypto = require('crypto');
const { ADMIN_LOCKOUT_MS, MAX_FAILED_ADMIN_ATTEMPTS, MS_PER_MINUTE } = require('../config/constants');
const log = require('../utils/logger').createLogger('ADMIN_AUTH');
const { getRedisClient } = require('../utils/redis');

// Redis key configuration
const REDIS_KEY_PREFIX = 'rate:admin:';
const LOCKOUT_TTL_SECONDS = Math.ceil(ADMIN_LOCKOUT_MS / 1000);

// In-memory brute-force tracking (fallback)
const failedAttempts = new Map(); // ip -> { count, lockedUntil }

// Cleanup stale in-memory entries every 10 minutes
const adminCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts) {
    if (entry.lockedUntil && entry.lockedUntil < now) {
      failedAttempts.delete(ip);
    }
  }
}, 10 * MS_PER_MINUTE);
if (adminCleanupInterval.unref) adminCleanupInterval.unref();

/**
 * Check if IP is locked out using Redis
 * @param {string} ip - Client IP
 * @returns {Promise<{locked: boolean, lockedUntil: number|null}>}
 */
async function checkLockoutRedis(ip) {
  const redis = await getRedisClient();
  if (!redis) {
    return checkLockoutMemory(ip);
  }

  try {
    const key = `${REDIS_KEY_PREFIX}${ip}`;
    const data = await redis.get(key);

    if (!data) {
      return { locked: false, lockedUntil: null };
    }

    const { count, lockedUntil } = JSON.parse(data);

    if (lockedUntil && lockedUntil > Date.now()) {
      return { locked: true, lockedUntil };
    }

    return { locked: false, lockedUntil: null };
  } catch (err) {
    log.warn('Redis lockout check failed, falling back to memory', { error: err.message });
    return checkLockoutMemory(ip);
  }
}

/**
 * Check if IP is locked out using in-memory Map (fallback)
 * @param {string} ip - Client IP
 * @returns {{locked: boolean, lockedUntil: number|null}}
 */
function checkLockoutMemory(ip) {
  const entry = failedAttempts.get(ip);
  if (entry && entry.lockedUntil && entry.lockedUntil > Date.now()) {
    return { locked: true, lockedUntil: entry.lockedUntil };
  }
  return { locked: false, lockedUntil: null };
}

/**
 * Track a failed admin attempt using Redis
 * @param {string} ip - Client IP
 * @returns {Promise<{count: number, locked: boolean}>}
 */
async function trackFailedAttemptRedis(ip) {
  const redis = await getRedisClient();
  if (!redis) {
    return trackFailedAttemptMemory(ip);
  }

  try {
    const key = `${REDIS_KEY_PREFIX}${ip}`;
    const existing = await redis.get(key);

    let count = 1;
    let lockedUntil = null;

    if (existing) {
      const data = JSON.parse(existing);
      count = (data.count || 0) + 1;
    }

    if (count >= MAX_FAILED_ADMIN_ATTEMPTS) {
      lockedUntil = Date.now() + ADMIN_LOCKOUT_MS;
      log.warn('Admin IP locked out via Redis', { ip, attempts: count });
    }

    // Store with TTL matching lockout duration
    await redis.set(key, JSON.stringify({ count, lockedUntil }), {
      EX: LOCKOUT_TTL_SECONDS
    });

    return { count, locked: count >= MAX_FAILED_ADMIN_ATTEMPTS };
  } catch (err) {
    log.warn('Redis failed attempt tracking failed, falling back to memory', { error: err.message });
    return trackFailedAttemptMemory(ip);
  }
}

/**
 * Track a failed admin attempt using in-memory Map (fallback)
 * @param {string} ip - Client IP
 * @returns {{count: number, locked: boolean}}
 */
function trackFailedAttemptMemory(ip) {
  const current = failedAttempts.get(ip) || { count: 0 };
  current.count++;

  if (current.count >= MAX_FAILED_ADMIN_ATTEMPTS) {
    current.lockedUntil = Date.now() + ADMIN_LOCKOUT_MS;
    log.warn('Admin IP locked out via memory', { ip, attempts: current.count });
  }

  failedAttempts.set(ip, current);
  return { count: current.count, locked: current.count >= MAX_FAILED_ADMIN_ATTEMPTS };
}

/**
 * Clear failed attempts for an IP (on successful auth) using Redis
 * @param {string} ip - Client IP
 */
async function clearFailedAttemptsRedis(ip) {
  const redis = await getRedisClient();
  if (!redis) {
    clearFailedAttemptsMemory(ip);
    return;
  }

  try {
    const key = `${REDIS_KEY_PREFIX}${ip}`;
    await redis.del(key);
  } catch (err) {
    log.warn('Redis clear failed attempts failed', { error: err.message });
  }
  // Also clear memory fallback
  clearFailedAttemptsMemory(ip);
}

/**
 * Clear failed attempts for an IP using in-memory Map (fallback)
 * @param {string} ip - Client IP
 */
function clearFailedAttemptsMemory(ip) {
  failedAttempts.delete(ip);
}

async function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    log.error('ADMIN_SECRET env var is not set — blocking admin request');
    return res.status(503).json({ error: 'Admin endpoint not configured' });
  }

  const clientIp = req.ip;

  // Check lockout (uses Redis if available)
  const { locked } = await checkLockoutRedis(clientIp);
  if (locked) {
    log.warn('Locked out IP attempted admin access', { ip: clientIp });
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  }

  const provided = req.headers['x-admin-secret'] || req.body?.admin_secret;
  if (!provided) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Timing-safe comparison to prevent timing attacks
  const secretBuf = Buffer.from(secret);
  const providedBuf = Buffer.from(String(provided));
  if (secretBuf.length !== providedBuf.length || !crypto.timingSafeEqual(secretBuf, providedBuf)) {
    // Track failed attempt (uses Redis if available)
    await trackFailedAttemptRedis(clientIp);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Success: clear failed attempts
  await clearFailedAttemptsRedis(clientIp);
  next();
}

module.exports = { requireAdmin };
