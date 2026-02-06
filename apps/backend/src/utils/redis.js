/**
 * Redis Client Utility
 *
 * Provides a singleton Redis client with graceful fallback to in-memory
 * when Redis is unavailable. Used for persistent rate limiting that
 * survives server restarts.
 *
 * Environment Variables:
 *   REDIS_URL - Redis connection URL (default: redis://localhost:6379)
 *
 * Usage:
 *   const { getRedisClient, isRedisAvailable } = require('../utils/redis');
 *   const redis = await getRedisClient();
 *   if (redis) {
 *     await redis.incr('my-key');
 *   }
 */

'use strict';

const { createClient } = require('redis');
const log = require('./logger').createLogger('REDIS');

let redisClient = null;
let connectionAttempted = false;
let isConnected = false;

/**
 * Get or create the Redis client singleton.
 * Returns null if Redis is unavailable (fallback to in-memory).
 *
 * @returns {Promise<import('redis').RedisClientType|null>}
 */
async function getRedisClient() {
  // Return cached client if already connected
  if (redisClient && isConnected) {
    return redisClient;
  }

  // Don't retry connection on every call if we already failed
  if (connectionAttempted && !isConnected) {
    return null;
  }

  connectionAttempted = true;

  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    redisClient = createClient({
      url,
      socket: {
        connectTimeout: 5000,  // 5 second connection timeout
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            log.warn('Redis reconnection failed after 3 attempts, disabling Redis');
            isConnected = false;
            return false;  // Stop reconnecting
          }
          return Math.min(retries * 100, 3000);  // Exponential backoff, max 3s
        }
      }
    });

    // Event handlers
    redisClient.on('error', (err) => {
      // Only log if we were previously connected (avoid spam during initial failure)
      if (isConnected) {
        log.error('Redis connection error', { error: err.message });
        isConnected = false;
      }
    });

    redisClient.on('connect', () => {
      log.info('Redis connected', { url: url.replace(/:[^:@]+@/, ':***@') });  // Hide password in logs
      isConnected = true;
    });

    redisClient.on('reconnecting', () => {
      log.info('Redis reconnecting...');
    });

    redisClient.on('end', () => {
      log.info('Redis connection closed');
      isConnected = false;
    });

    await redisClient.connect();
    return redisClient;

  } catch (err) {
    log.warn('Redis unavailable, falling back to in-memory rate limiting', {
      error: err.message,
      url: url.replace(/:[^:@]+@/, ':***@')  // Hide password
    });
    redisClient = null;
    isConnected = false;
    return null;
  }
}

/**
 * Check if Redis is currently available without attempting reconnection.
 * Useful for fast synchronous checks.
 *
 * @returns {boolean}
 */
function isRedisAvailable() {
  return isConnected && redisClient !== null;
}

/**
 * Gracefully close the Redis connection (for clean shutdown).
 */
async function closeRedisConnection() {
  if (redisClient && isConnected) {
    try {
      await redisClient.quit();
      log.info('Redis connection closed gracefully');
    } catch (err) {
      log.error('Error closing Redis connection', { error: err.message });
    }
    redisClient = null;
    isConnected = false;
    connectionAttempted = false;
  }
}

/**
 * Reset the connection state (for testing purposes).
 * Allows retrying Redis connection after a previous failure.
 */
function resetConnectionState() {
  connectionAttempted = false;
}

module.exports = {
  getRedisClient,
  isRedisAvailable,
  closeRedisConnection,
  resetConnectionState
};
